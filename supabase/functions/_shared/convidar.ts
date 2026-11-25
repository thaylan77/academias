// Lógica da Edge Function convidar-membro (docs/specs/convite-membros.md,
// 4.4). As dependências chegam por parâmetro: o index.ts liga o Auth e o
// banco de verdade; os testes, versões simuladas.

import { claimsDoToken, CORS, emailMascarado, erro, hintDoErro, json, tokenDoPedido } from "./http.ts";

/** Erro do Auth: só o status interessa (4xx = recusa definitiva). */
export interface ErroAuth {
  status?: number;
  message?: string;
}

export interface DepsConvidar {
  /** SITE_URL da variável de ambiente da função (nunca do pedido). */
  siteUrl: string;
  /** Valida o token no Auth; devolve o id do usuário ou null. */
  usuarioDoToken(jwt: string): Promise<string | null>;
  /** RPC com service_role. */
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  /** auth.admin.inviteUserByEmail. */
  convidarPorEmail(email: string, redirectTo: string): Promise<{ userId: string | null; erro: ErroAuth | null }>;
  /** auth.admin.updateUserById: marca definir_senha e, se vier, troca a senha. */
  marcarDefinirSenha(userId: string, novaSenha?: string): Promise<ErroAuth | null>;
  /** signInWithOtp com shouldCreateUser = false. */
  enviarLinkMagico(email: string, redirectTo: string): Promise<ErroAuth | null>;
  log(msg: string): void;
}

interface Criado {
  convite_id: string;
  email: string;
  conta: "nenhuma" | "nao_confirmada" | "confirmada";
  user_id: string | null;
  enviar: boolean;
  envio_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Status HTTP por hint (o front decide pelo hint, não pelo status). */
export function statusDoHint(hint: string): number {
  if (hint === "sem_permissao") return 403;
  if (hint === "limite_convites" || hint === "convite_reenvio_cedo") return 429;
  return 400;
}

/** Senha aleatória de 32 bytes que ninguém recebe (conta não confirmada). */
export function senhaAleatoria(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function convidarMembro(req: Request, deps: DepsConvidar): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return erro(405, "metodo_invalido");

  const jwt = tokenDoPedido(req);
  const userId = jwt ? await deps.usuarioDoToken(jwt) : null;
  if (!jwt || !userId) return erro(401, "sem_sessao");

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return erro(400, "dados_invalidos");
  }
  const { academia_id, email, papel } = corpo ?? {};
  if (
    typeof academia_id !== "string" || !UUID.test(academia_id) ||
    typeof email !== "string" || typeof papel !== "string"
  ) {
    return erro(400, "dados_invalidos");
  }

  // 1. O banco decide tudo (papel, limites, conta); a função só executa.
  const claims = claimsDoToken(jwt);
  const { data, error } = await deps.rpc("criar_convite_interna", {
    p_user_id: userId,
    p_academia_id: academia_id,
    p_email: email,
    p_papel: papel,
    p_iat: claims.iat,
    p_sessao: claims.sessao,
  });
  if (error) {
    const hint = hintDoErro(error);
    if (hint) return erro(statusDoHint(hint), hint);
    deps.log("convidar-membro: erro inesperado em criar_convite_interna");
    return erro(500, "erro_interno");
  }
  const c = data as Criado;
  const redirectTo = deps.siteUrl.replace(/\/+$/, "") + "/painel/convites";

  // Conta criada com o e-mail de outra pessoa e nunca confirmada: a senha
  // dela cai (ninguém recebe a nova) e a conta fica marcada para definir
  // senha. Vale mesmo sem envio.
  let falhaAntes: ErroAuth | null = null;
  if (c.conta === "nao_confirmada" && c.user_id) {
    falhaAntes = await deps.marcarDefinirSenha(c.user_id, senhaAleatoria());
  }

  // Limite por endereço estourado pelo histórico de outra academia: sem
  // e-mail, e a resposta é a mesma de um envio.
  if (!c.enviar) return json(200, { convite_id: c.convite_id, email_enviado: true });

  // 2. Envio, segundo a conta.
  let falha: ErroAuth | null = falhaAntes;
  if (!falha) {
    if (c.conta === "nenhuma") {
      const r = await deps.convidarPorEmail(c.email, redirectTo);
      falha = r.erro;
      if (!falha && r.userId) {
        const m = await deps.marcarDefinirSenha(r.userId);
        if (m) {
          deps.log(`convidar-membro: convite enviado, mas a marca definir_senha falhou (${emailMascarado(c.email)})`);
        }
      }
    } else {
      falha = await deps.enviarLinkMagico(c.email, redirectTo);
    }
  }

  // 3. A reserva do envio: confirmada se o provedor aceitou; liberada se
  //    recusou de vez (4xx, ou nem chegou a tentar). Falha de rede ou 5xx
  //    não diz se o e-mail saiu: a reserva fica até o expurgo (lado seguro).
  if (c.envio_id) {
    if (!falha) {
      await deps.rpc("confirmar_envio_convite_interna", { p_envio_id: c.envio_id });
    } else if (falha === falhaAntes || (falha.status !== undefined && falha.status >= 400 && falha.status < 500)) {
      await deps.rpc("liberar_envio_convite_interna", { p_envio_id: c.envio_id });
    }
  }
  if (falha) {
    deps.log(`convidar-membro: e-mail não saiu para ${emailMascarado(c.email)} (status ${falha.status ?? "?"})`);
  }
  return json(200, { convite_id: c.convite_id, email_enviado: !falha });
}
