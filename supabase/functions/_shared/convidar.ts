// Lógica da Edge Function convidar-membro (docs/specs/convite-membros.md,
// 4.4). As dependências chegam por parâmetro: o index.ts liga o Auth e o
// banco de verdade; os testes, versões simuladas.

import {
  claimsDoToken,
  codigoDoErro,
  CORS,
  emailMascarado,
  erro,
  hintDoErro,
  json,
  type Rpc,
  tokenDoPedido,
} from "./http.ts";

/** Erro do Auth: só o status interessa. */
export interface ErroAuth {
  status?: number;
  message?: string;
}

export interface DepsConvidar {
  /** SITE_URL da variável de ambiente da função (nunca do pedido). */
  siteUrl: string;
  /**
   * Valida o token no Auth: o id do usuário, ou null se o Auth recusou o
   * token. Falha do próprio Auth (5xx, rede) lança exceção.
   */
  usuarioDoToken(jwt: string): Promise<string | null>;
  /** RPC com service_role. */
  rpc: Rpc;
  /** auth.admin.inviteUserByEmail. */
  convidarPorEmail(email: string, redirectTo: string): Promise<{ userId: string | null; erro: ErroAuth | null }>;
  /** signInWithOtp com shouldCreateUser = false. */
  enviarLinkMagico(email: string, redirectTo: string): Promise<ErroAuth | null>;
  /**
   * Roda o trabalho depois da resposta (EdgeRuntime.waitUntil no runtime):
   * o tempo de resposta não depende da conta, da cota global nem do Auth.
   * Fora do runtime (testes), espera o trabalho.
   */
  emSegundoPlano(tarefa: () => Promise<void>): Promise<void>;
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

/**
 * O Auth recusou o envio com certeza de que o e-mail não saiu (4xx, menos
 * 408, que é tempo esgotado e não diz nada).
 */
export function recusaDefinitiva(f: ErroAuth): boolean {
  return f.status !== undefined && f.status >= 400 && f.status < 500 && f.status !== 408;
}

/** RPC das reservas: idempotente no banco; uma nova tentativa e, se falhar, log. */
async function resolverReserva(deps: DepsConvidar, nome: string, envioId: string): Promise<void> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { error } = await deps.rpc(nome, { p_envio_id: envioId });
    if (!error) return;
    if (tentativa === 2) {
      deps.log(`convidar-membro: ${nome} falhou para a reserva ${envioId} (código ${codigoDoErro(error)})`);
    }
  }
}

export async function convidarMembro(req: Request, deps: DepsConvidar): Promise<Response> {
  try {
    return await tratar(req, deps);
  } catch (e) {
    deps.log(`convidar-membro: exceção (${e instanceof Error ? e.name : "desconhecida"})`);
    return erro(500, "erro_interno");
  }
}

async function tratar(req: Request, deps: DepsConvidar): Promise<Response> {
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
    deps.log(`convidar-membro: erro inesperado em criar_convite_interna (código ${codigoDoErro(error)})`);
    return erro(500, "erro_interno");
  }
  const c = data as Criado;

  // A resposta sai já, igual em todos os casos (envio, supressão, falha) e
  // sem esperar nada que dependa da conta, da cota global ou do Auth: o
  // conteúdo e o tempo dela não revelam a conta nem convites de outras
  // academias. Neutralização, envio e reserva rodam depois; a falha fica no
  // log. Se o trabalho cair no meio, a reserva sem resultado segura o
  // endereço até o expurgo (lado seguro).
  await deps.emSegundoPlano(async () => {
    try {
      await processarEnvio(c, deps);
    } catch (e) {
      deps.log(`convidar-membro: exceção no envio (${e instanceof Error ? e.name : "desconhecida"})`);
    }
  });
  return json(200, { convite_id: c.convite_id });
}

async function processarEnvio(c: Criado, deps: DepsConvidar): Promise<void> {
  const redirectTo = deps.siteUrl + "/painel/convites";

  // Conta com o e-mail do convidado que nunca foi confirmada: quem a criou
  // pode não ser o dono do e-mail. O banco derruba a senha, as sessões e os
  // tokens dela, com a conta travada e só se o e-mail continuar não
  // confirmado (quem confirmou nesse meio-tempo não perde a senha). Vale
  // mesmo sem envio.
  let falhaAntes: ErroAuth | null = null;
  if (c.conta === "nao_confirmada" && c.user_id) {
    const n = await deps.rpc("neutralizar_conta_nao_confirmada_interna", { p_user_id: c.user_id });
    if (n.error) {
      falhaAntes = { status: 500 };
      deps.log(`convidar-membro: não neutralizou a conta não confirmada (código ${codigoDoErro(n.error)})`);
    }
  }

  // Limite por endereço estourado pelo histórico de outra academia: sem
  // e-mail.
  if (!c.enviar) return;

  // Assume a reserva logo antes de chamar o Auth (marca durável): uma reserva
  // que nenhum worker assumiu em 2 minutos é liberada pelo job; a assumida
  // fica, porque o e-mail pode ter saído. Se ela já foi liberada (este worker
  // atrasou), não envia.
  if (c.envio_id) {
    const assumida = await deps.rpc("assumir_envio_convite_interna", { p_envio_id: c.envio_id });
    if (assumida.error || assumida.data !== true) {
      deps.log(
        `convidar-membro: reserva ${c.envio_id} não assumida (código ${
          assumida.error ? codigoDoErro(assumida.error) : "liberada"
        }); sem envio`,
      );
      return;
    }
  }

  // 2. Envio, segundo a conta. A conta que deixou de estar não confirmada
  //    no meio do caminho recebe o link mágico como uma confirmada.
  let falha: ErroAuth | null = falhaAntes;
  if (!falha) {
    if (c.conta === "nenhuma") {
      const r = await deps.convidarPorEmail(c.email, redirectTo);
      falha = r.erro;
      if (!falha && r.userId) {
        // A marca vem no banco, condicional: se a pessoa já gravou a senha
        // nova (o link saiu antes desta linha), ela não volta.
        const m = await deps.rpc("marcar_definir_senha_interna", { p_user_id: r.userId });
        if (m.error) {
          deps.log(
            `convidar-membro: convite enviado, mas a marca definir_senha falhou (código ${codigoDoErro(m.error)})`,
          );
        }
      }
    } else {
      falha = await deps.enviarLinkMagico(c.email, redirectTo);
    }
  }

  // 3. A reserva do envio: confirmada se o Auth aceitou; liberada se recusou
  //    de vez ou nem chegou a tentar. Falha de rede, 5xx ou 408 não diz se o
  //    e-mail saiu: a reserva fica até o expurgo (lado seguro contra spam).
  if (c.envio_id) {
    if (!falha) {
      await resolverReserva(deps, "confirmar_envio_convite_interna", c.envio_id);
    } else if (falha === falhaAntes || recusaDefinitiva(falha)) {
      await resolverReserva(deps, "liberar_envio_convite_interna", c.envio_id);
    }
  }
  if (falha) {
    deps.log(`convidar-membro: e-mail não saiu para ${emailMascarado(c.email)} (status ${falha.status ?? "?"})`);
  }
}
