// Lógica da Edge Function concluir-senha (docs/specs/convite-membros.md,
// 4.4): grava a senha nova escolhida na sessão aberta pelo link do convite,
// junto com a prova que o aceite exige, numa só operação no banco
// (definir_senha_comprovada_interna). Não usa auth.updateUser.

import { claimsDoToken, codigoDoErro, CORS, erro, hintDoErro, json, type Rpc, tokenDoPedido } from "./http.ts";

export interface DepsSenha {
  /** Id do usuário, null se o Auth recusou o token; falha do Auth lança. */
  usuarioDoToken(jwt: string): Promise<string | null>;
  rpc: Rpc;
  log(msg: string): void;
}

/**
 * Métodos de login por link: exatamente os que o aceite aceita
 * (convite_do_login_travado, na migration do convite).
 */
export const POR_LINK = new Set(["otp", "magiclink", "invite", "recovery", "email/signup", "email_change"]);

export async function concluirSenha(req: Request, deps: DepsSenha): Promise<Response> {
  try {
    return await tratar(req, deps);
  } catch (e) {
    deps.log(`concluir-senha: exceção (${e instanceof Error ? e.name : "desconhecida"})`);
    return erro(500, "erro_interno");
  }
}

async function tratar(req: Request, deps: DepsSenha): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return erro(405, "metodo_invalido");

  const jwt = tokenDoPedido(req);
  const userId = jwt ? await deps.usuarioDoToken(jwt) : null;
  if (!jwt || !userId) return erro(401, "sem_sessao");

  // Só numa sessão aberta pelo link enviado ao e-mail: quem entrou com a
  // senha antiga não troca a senha por aqui.
  const claims = claimsDoToken(jwt);
  if (!claims.sessao || !claims.amr.some((a) => POR_LINK.has(a?.method))) {
    return erro(403, "convite_exige_link");
  }

  let senha: unknown;
  try {
    senha = (await req.json())?.senha;
  } catch {
    return erro(400, "dados_invalidos");
  }
  if (typeof senha !== "string") return erro(400, "dados_invalidos");

  const { error } = await deps.rpc("definir_senha_comprovada_interna", {
    p_user_id: userId,
    p_sessao: claims.sessao,
    p_senha: senha,
    // Com MFA, o banco exige aal2 no token apresentado e na sessão viva.
    p_aal: claims.aal,
  });
  if (error) {
    const hint = hintDoErro(error);
    if (hint) return erro(hint === "convite_exige_link" ? 403 : 400, hint);
    deps.log(`concluir-senha: erro inesperado em definir_senha_comprovada_interna (código ${codigoDoErro(error)})`);
    return erro(500, "erro_interno");
  }
  // O front renova a sessão em seguida: a prova move o marco dos vínculos.
  return json(200, { ok: true });
}
