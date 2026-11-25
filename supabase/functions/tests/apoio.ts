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

export function tokenCom(metodo: string): string {
  return jwtFalso({ sub: USUARIO, iat: 1700000000, session_id: SESSAO, amr: [{ method: metodo, timestamp: 1 }] });
}
export const TOKEN_LINK = tokenCom("otp");
export const TOKEN_SENHA = tokenCom("password");

export function pedido(corpo: unknown, token: string | null = TOKEN_LINK, metodo = "POST"): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const body = metodo === "POST" ? (typeof corpo === "string" ? corpo : JSON.stringify(corpo)) : undefined;
  return new Request("http://localhost/funcao", { method: metodo, headers, body });
}

export interface Chamada {
  nome: string;
  args: unknown[];
}

type RespostaRpc = { data?: unknown; error?: unknown };

export interface Simulado {
  /** Como o Auth trata o token: aceita (padrão), recusa ou cai. */
  token?: "valido" | "invalido" | "falha";
  /** Respostas por RPC; uma lista é consumida em ordem (a última se repete). */
  rpc?: Record<string, RespostaRpc | RespostaRpc[]>;
  criar?: { userId: string | null; erro: ErroAuth | null };
  link?: ErroAuth | null;
  /** Guarda o trabalho em segundo plano sem esperar (padrão: espera). */
  adiar?: boolean;
  /** Atraso do link mágico, para simular o Auth lento. */
  atrasoLink?: Promise<void>;
}

export function depsSimuladas(s: Simulado = {}) {
  const chamadas: Chamada[] = [];
  const logs: string[] = [];
  const consumo: Record<string, number> = {};
  const pendentes: Promise<void>[] = [];
  const registra = (nome: string, ...args: unknown[]) => chamadas.push({ nome, args });
  const deps: DepsConvidar & DepsSenha = {
    siteUrl: "https://painel.exemplo.test",
    usuarioDoToken(jwt) {
      registra("usuarioDoToken", jwt);
      if (s.token === "falha") return Promise.reject(new Error("Auth indisponível"));
      return Promise.resolve(s.token === "invalido" ? null : USUARIO);
    },
    rpc(nome, args) {
      registra("rpc:" + nome, args);
      // Padrão: a reserva é assumida (o worker pode chamar o Auth).
      if (nome === "assumir_envio_convite_interna" && !s.rpc?.[nome]) {
        return Promise.resolve({ data: true, error: null });
      }
      const r = s.rpc?.[nome];
      if (Array.isArray(r)) {
        const i = Math.min(consumo[nome] ?? 0, r.length - 1);
        consumo[nome] = (consumo[nome] ?? 0) + 1;
        return Promise.resolve({ data: r[i].data ?? null, error: r[i].error ?? null });
      }
      return Promise.resolve({ data: r?.data ?? null, error: r?.error ?? null });
    },
    criarConta(email) {
      registra("criarConta", email);
      return Promise.resolve(s.criar ?? { userId: "44444444-4444-4444-8444-444444444444", erro: null });
    },
    async enviarLinkMagico(email, redirectTo) {
      registra("enviarLinkMagico", email, redirectTo);
      if (s.atrasoLink) await s.atrasoLink;
      return s.link ?? null;
    },
    emSegundoPlano(tarefa) {
      registra("emSegundoPlano");
      const p = tarefa();
      if (s.adiar) {
        pendentes.push(p);
        return Promise.resolve();
      }
      return p;
    },
    log(msg) {
      logs.push(msg);
    },
  };
  const nomes = () => chamadas.map((c) => c.nome);
  const de = (nome: string) => chamadas.filter((c) => c.nome === nome);
  return { deps, chamadas, logs, nomes, de, pendentes };
}

export const CONVITE = "55555555-5555-4555-8555-555555555555";
export const ENVIO = "77777777-7777-4777-8777-777777777777";
export const CONTA = "66666666-6666-4666-8666-666666666666";

export function criado(conta: string, extra: Record<string, unknown> = {}): RespostaRpc {
  return {
    data: {
      convite_id: CONVITE,
      email: "pessoa@exemplo.test",
      conta,
      user_id: conta === "nenhuma" ? null : CONTA,
      enviar: true,
      envio_id: ENVIO,
      ...extra,
    },
  };
}
