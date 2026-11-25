// Apoio dos testes das Edge Functions: JWT de mentira e dependências
// simuladas que registram as chamadas.

import type { DepsConvidar, ErroAuth } from "../_shared/convidar.ts";
import type { DepsSenha } from "../_shared/senha.ts";

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** JWT só com o payload (a assinatura é conferida pelo Auth, aqui simulado). */
export function jwtFalso(payload: Record<string, unknown>): string {
  return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.assinatura`;
}

export const USUARIO = "11111111-1111-4111-8111-111111111111";
export const SESSAO = "22222222-2222-4222-8222-222222222222";
export const ACADEMIA = "33333333-3333-4333-8333-333333333333";

export const TOKEN_LINK = jwtFalso({
  sub: USUARIO,
  iat: 1700000000,
  session_id: SESSAO,
  amr: [{ method: "otp", timestamp: 1700000000 }],
});
export const TOKEN_SENHA = jwtFalso({
  sub: USUARIO,
  iat: 1700000000,
  session_id: SESSAO,
  amr: [{ method: "password", timestamp: 1700000000 }],
});

export function pedido(corpo: unknown, token: string | null = TOKEN_LINK): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request("http://localhost/funcao", { method: "POST", headers, body: JSON.stringify(corpo) });
}

export interface Chamada {
  nome: string;
  args: unknown[];
}

export interface Simulado {
  rpcCriar?: { data?: unknown; error?: unknown };
  convidar?: { userId: string | null; erro: ErroAuth | null };
  marcar?: ErroAuth | null;
  link?: ErroAuth | null;
  rpcSenha?: { data?: unknown; error?: unknown };
}

export function depsSimuladas(s: Simulado = {}) {
  const chamadas: Chamada[] = [];
  const logs: string[] = [];
  const registra = (nome: string, ...args: unknown[]) => chamadas.push({ nome, args });
  const deps: DepsConvidar & DepsSenha = {
    siteUrl: "https://painel.exemplo.test/",
    usuarioDoToken(jwt) {
      registra("usuarioDoToken", jwt);
      return Promise.resolve(jwt ? USUARIO : null);
    },
    rpc(nome, args) {
      registra("rpc:" + nome, args);
      if (nome === "criar_convite_interna") {
        return Promise.resolve({ data: s.rpcCriar?.data ?? null, error: s.rpcCriar?.error ?? null });
      }
      if (nome === "definir_senha_comprovada_interna") {
        return Promise.resolve({ data: s.rpcSenha?.data ?? null, error: s.rpcSenha?.error ?? null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    convidarPorEmail(email, redirectTo) {
      registra("convidarPorEmail", email, redirectTo);
      return Promise.resolve(s.convidar ?? { userId: "44444444-4444-4444-8444-444444444444", erro: null });
    },
    marcarDefinirSenha(userId, novaSenha) {
      registra("marcarDefinirSenha", userId, novaSenha);
      return Promise.resolve(s.marcar ?? null);
    },
    enviarLinkMagico(email, redirectTo) {
      registra("enviarLinkMagico", email, redirectTo);
      return Promise.resolve(s.link ?? null);
    },
    log(msg) {
      logs.push(msg);
    },
  };
  const nomes = () => chamadas.map((c) => c.nome);
  const de = (nome: string) => chamadas.filter((c) => c.nome === nome);
  return { deps, chamadas, logs, nomes, de };
}

export function criado(conta: string, extra: Record<string, unknown> = {}) {
  return {
    data: {
      convite_id: "55555555-5555-4555-8555-555555555555",
      email: "pessoa@exemplo.test",
      conta,
      user_id: conta === "nenhuma" ? null : "66666666-6666-4666-8666-666666666666",
      enviar: true,
      envio_id: "77777777-7777-4777-8777-777777777777",
      ...extra,
    },
  };
}
