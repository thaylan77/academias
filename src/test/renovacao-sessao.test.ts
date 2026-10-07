// Renovação da sessão com o cliente Supabase de verdade e a rede simulada.
// Confere o que os testes com cliente falso não alcançam: o que a biblioteca
// de autenticação faz com a sessão guardada quando a renovação falha.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const URL_PROJETO = "https://exemplo.supabase.co";
const CHAVE_STORAGE = "sb-exemplo-auth-token";

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (expiraEmSegundos: number) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "user-1", role: "authenticated", exp: expiraEmSegundos })}.assinatura`;

const agoraSeg = () => Math.floor(Date.now() / 1000);
const USUARIO = {
  id: "user-1",
  aud: "authenticated",
  role: "authenticated",
  email: "totem@a.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

// Sessão guardada no aparelho com o token de acesso já vencido: só o refresh token vale.
function guardarSessaoVencida() {
  localStorage.setItem(
    CHAVE_STORAGE,
    JSON.stringify({
      access_token: jwt(agoraSeg() - 3600),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: agoraSeg() - 3600,
      refresh_token: "refresh-antigo",
      user: USUARIO,
    })
  );
}

const sessaoGuardada = () => JSON.parse(localStorage.getItem(CHAVE_STORAGE) ?? "null");

const json = (status: number, corpo: object) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const sessaoNova = () =>
  json(200, {
    access_token: jwt(agoraSeg() + 3600),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: agoraSeg() + 3600,
    refresh_token: "refresh-novo",
    user: USUARIO,
  });

// Instala a rede simulada: `respostas` é consumida a cada pedido de renovação;
// a última se repete. Devolve os status que o Auth "respondeu".
function simularRede(respostas: Array<() => Response>) {
  const renovacoes: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/auth/v1/token") && url.includes("grant_type=refresh_token")) {
        const resposta = respostas[Math.min(renovacoes.length, respostas.length - 1)]();
        renovacoes.push(resposta.status);
        return resposta;
      }
      return json(404, { message: "não simulado: " + url });
    })
  );
  return renovacoes;
}

async function carregarLib() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", URL_PROJETO);
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  return import("../lib/supabase");
}

describe("Renovação da sessão com o cliente real", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    const lib = await import("../lib/supabase");
    await lib.supabase?.auth.stopAutoRefresh();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("refresh com 429 e depois sucesso: a sessão não é apagada e o totem se recupera sem novo login", async () => {
    guardarSessaoVencida();
    const renovacoes = simularRede([
      () => json(429, { code: 429, error_code: "over_request_rate_limit", msg: "Too many requests" }),
      sessaoNova,
    ]);

    const lib = await carregarLib();
    const res = await lib.renovarSessao();

    expect(renovacoes[0]).toBe(429);
    expect(renovacoes).toContain(200);
    expect(res.sucesso).toBe(true);
    expect(sessaoGuardada()?.refresh_token).toBe("refresh-novo");
  });

  it("refresh com 408 e depois sucesso: mesma coisa", async () => {
    guardarSessaoVencida();
    const renovacoes = simularRede([() => json(408, { msg: "Request Timeout" }), sessaoNova]);

    const lib = await carregarLib();
    const res = await lib.renovarSessao();

    expect(renovacoes[0]).toBe(408);
    expect(res.sucesso).toBe(true);
    expect(sessaoGuardada()?.refresh_token).toBe("refresh-novo");
  });

  it("refresh token recusado (400): a sessão é apagada e a falha é definitiva", async () => {
    guardarSessaoVencida();
    simularRede([
      () => json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }),
    ]);

    const lib = await carregarLib();
    const res = await lib.renovarSessao();

    expect(res.sucesso).toBe(false);
    expect(res.ehTransitorio).toBe(false);
    expect(sessaoGuardada()).toBeNull();
  });
});

describe("fetchQuePreservaSessao", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const RENOVACAO = `${URL_PROJETO}/auth/v1/token?grant_type=refresh_token`;

  it.each([408, 429])("renovação com %i vira 503, com o corpo preservado", async (status) => {
    simularRede([() => json(status, { msg: "passageiro" })]);
    const lib = await carregarLib();

    const resposta = await lib.fetchQuePreservaSessao(RENOVACAO, { method: "POST" });

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ msg: "passageiro" });
  });

  it.each([200, 400, 401, 403, 500])("renovação com %i passa sem alteração", async (status) => {
    simularRede([() => json(status, { msg: "como veio" })]);
    const lib = await carregarLib();

    const resposta = await lib.fetchQuePreservaSessao(RENOVACAO, { method: "POST" });

    expect(resposta.status).toBe(status);
  });

  it("429 fora da renovação (login por senha, RPC) não é alterado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { msg: "limite" })));
    const lib = await carregarLib();

    for (const url of [
      `${URL_PROJETO}/auth/v1/token?grant_type=password`,
      `${URL_PROJETO}/rest/v1/rpc/totem_turmas_agora`,
    ]) {
      const resposta = await lib.fetchQuePreservaSessao(url, { method: "POST" });
      expect(resposta.status).toBe(429);
    }
  });
});
