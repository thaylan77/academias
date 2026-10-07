import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

// Cliente falso: a consulta a membros_academia devolve `consulta`.
function clienteFalso(consulta: { data: any; error: any } | Error, usuario: any = null) {
  const maybeSingle =
    consulta instanceof Error ? vi.fn().mockRejectedValue(consulta) : vi.fn().mockResolvedValue(consulta);
  const eqAcademia = vi.fn().mockReturnValue({ maybeSingle });
  const eqAtivo = vi.fn().mockReturnValue({ eq: eqAcademia });
  const eqUsuario = vi.fn().mockReturnValue({ eq: eqAtivo });
  const select = vi.fn().mockReturnValue({ eq: eqUsuario });
  const from = vi.fn().mockReturnValue({ select });
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: usuario } }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: usuario }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  return { from, auth, eqUsuario, eqAtivo, eqAcademia };
}

// Carrega src/lib/supabase.ts com um cliente Supabase configurado (falso).
async function carregarComCliente(cliente: any) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as any).mockReturnValue(cliente);
  return import("../lib/supabase");
}

const PROFESSOR_DA_A = {
  id: "user-a",
  email: "prof@a.test",
  // Metadado global do usuário: não pode valer como papel em outra academia.
  user_metadata: { papel: "professor", nome: "Prof da A" },
};

describe("Papel da equipe por academia (sem papel por omissão)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("devolve o papel de membros_academia, filtrando por usuário, ativo e academia", async () => {
    const cliente = clienteFalso({ data: { papel: "admin" }, error: null });
    const lib = await carregarComCliente(cliente);

    const vinculo = await lib.resolverPapelEquipe(cliente, "user-123", "acad-uuid-456");

    expect(vinculo).toEqual({ tipo: "membro", papel: "admin" });
    expect(cliente.from).toHaveBeenCalledWith("membros_academia");
    expect(cliente.eqUsuario).toHaveBeenCalledWith("user_id", "user-123");
    expect(cliente.eqAtivo).toHaveBeenCalledWith("ativo", true);
    expect(cliente.eqAcademia).toHaveBeenCalledWith("academia_id", "acad-uuid-456");
  });

  it("sem vínculo ativo na academia, não devolve papel nenhum", async () => {
    const cliente = clienteFalso({ data: null, error: null });
    const lib = await carregarComCliente(cliente);

    expect(await lib.resolverPapelEquipe(cliente, "user-a", "academia-b")).toEqual({ tipo: "sem_vinculo" });
  });

  it("falha de consulta não vira vínculo", async () => {
    const erro = { message: "permission denied", code: "42501" };
    const lib = await carregarComCliente(clienteFalso({ data: null, error: erro }));
    const cliente = clienteFalso({ data: null, error: erro });

    expect(await lib.resolverPapelEquipe(cliente, "user-a", "academia-a")).toEqual({ tipo: "erro", erro });

    const queda = new Error("Failed to fetch");
    const clienteSemRede = clienteFalso(queda);
    expect(await lib.resolverPapelEquipe(clienteSemRede, "user-a", "academia-a")).toEqual({
      tipo: "erro",
      erro: queda,
    });
  });

  it("sem academia, não consulta e não devolve papel", async () => {
    const cliente = clienteFalso({ data: { papel: "admin" }, error: null });
    const lib = await carregarComCliente(cliente);

    const vinculo = await lib.resolverPapelEquipe(cliente, "user-a", "");
    expect(vinculo.tipo).toBe("erro");
    expect(cliente.from).not.toHaveBeenCalled();
  });

  it("login: professor da academia A é recusado no totem da academia B e a sessão local é desfeita", async () => {
    const cliente = clienteFalso({ data: null, error: null }, PROFESSOR_DA_A);
    const lib = await carregarComCliente(cliente);

    const res = await lib.loginEquipe("prof@a.test", "senha", "professor", "academia-b");

    expect(res.sucesso).toBe(false);
    expect(res.usuario).toBeUndefined();
    expect(res.mensagem).toBe("Este login não faz parte da equipe desta academia.");
    expect(cliente.eqAcademia).toHaveBeenCalledWith("academia_id", "academia-b");
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("login: membro entra com o papel do banco, não com o do metadado", async () => {
    const cliente = clienteFalso({ data: { papel: "recepcao" }, error: null }, PROFESSOR_DA_A);
    const lib = await carregarComCliente(cliente);

    const res = await lib.loginEquipe("prof@a.test", "senha", "professor", "academia-a");

    expect(res.sucesso).toBe(true);
    expect(res.usuario?.papel).toBe("recepcao");
    expect(cliente.auth.signOut).not.toHaveBeenCalled();
  });

  it("login: sem academia carregada, nem tenta autenticar", async () => {
    const cliente = clienteFalso({ data: { papel: "admin" }, error: null }, PROFESSOR_DA_A);
    const lib = await carregarComCliente(cliente);

    const res = await lib.loginEquipe("prof@a.test", "senha", "professor", undefined);

    expect(res.sucesso).toBe(false);
    expect(cliente.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("login: falha ao confirmar o vínculo recusa com mensagem de conexão", async () => {
    const cliente = clienteFalso(new Error("Failed to fetch"), PROFESSOR_DA_A);
    const lib = await carregarComCliente(cliente);

    const res = await lib.loginEquipe("prof@a.test", "senha", "professor", "academia-a");

    expect(res.sucesso).toBe(false);
    expect(res.mensagem).toMatch(/Não foi possível confirmar seu vínculo/);
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sessão existente de outra academia não é aceita no totem desta", async () => {
    const cliente = clienteFalso({ data: null, error: null }, PROFESSOR_DA_A);
    const lib = await carregarComCliente(cliente);

    expect(await lib.obterSessaoEquipe("academia-b")).toBeNull();
  });

  it("sessão existente de membro é aceita com o papel do banco", async () => {
    const cliente = clienteFalso({ data: { papel: "totem" }, error: null }, PROFESSOR_DA_A);
    const lib = await carregarComCliente(cliente);

    const usuario = await lib.obterSessaoEquipe("academia-a");
    expect(usuario?.papel).toBe("totem");
    expect(usuario?.id).toBe("user-a");
  });
});

describe("Falha ao renovar a sessão: só recusa de credencial desloga", () => {
  let lib: typeof import("../lib/supabase");

  beforeEach(async () => {
    lib = await carregarComCliente(clienteFalso({ data: null, error: null }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["limite de requisições (429)", { status: 429, code: "over_request_rate_limit", message: "Too many requests" }],
    ["tempo esgotado (408)", { status: 408, message: "Request Timeout" }],
    ["erro do servidor (503)", { status: 503, message: "Service Unavailable" }],
    ["queda de rede", { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }],
    ["erro sem status nem código", new Error("Falha ao carregar recurso")],
    ["nulo", null],
  ])("%s é transitório", (_nome, erro) => {
    expect(lib.falhaDeRenovacaoEhDefinitiva(erro)).toBe(false);
  });

  it.each([
    ["refresh token inexistente", { status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token" }],
    ["refresh token já usado", { status: 400, code: "refresh_token_already_used" }],
    ["sessão ausente", { name: "AuthSessionMissingError", message: "Auth session missing!" }],
    ["sessão encerrada no servidor", { status: 403, code: "session_not_found" }],
    ["usuário banido", { status: 403, code: "user_banned" }],
    ["401 sem código", { status: 401 }],
  ])("%s é definitivo", (_nome, erro) => {
    expect(lib.falhaDeRenovacaoEhDefinitiva(erro)).toBe(true);
  });

  it("renovarSessao: 429 mantém a sessão (transitório)", async () => {
    const cliente: any = clienteFalso({ data: null, error: null });
    cliente.auth.refreshSession = vi
      .fn()
      .mockResolvedValue({ data: { session: null }, error: { status: 429, message: "rate limit" } });
    const comCliente = await carregarComCliente(cliente);

    const res = await comCliente.renovarSessao();
    expect(res.sucesso).toBe(false);
    expect(res.ehTransitorio).toBe(true);
  });

  it("renovarSessao: refresh token inválido é definitivo", async () => {
    const cliente: any = clienteFalso({ data: null, error: null });
    cliente.auth.refreshSession = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { status: 400, code: "refresh_token_not_found", message: "Invalid Refresh Token" },
    });
    const comCliente = await carregarComCliente(cliente);

    const res = await comCliente.renovarSessao();
    expect(res.sucesso).toBe(false);
    expect(res.ehTransitorio).toBe(false);
  });

  it("renovarSessao: exceção de rede é transitória", async () => {
    const cliente: any = clienteFalso({ data: null, error: null });
    cliente.auth.refreshSession = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const comCliente = await carregarComCliente(cliente);

    const res = await comCliente.renovarSessao();
    expect(res.ehTransitorio).toBe(true);
  });
});
