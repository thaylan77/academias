import { describe, it, expect, afterEach, vi } from "vitest";
import {
  AcademiaDoMembro,
  caminhoPainel,
  escolherAcademia,
  itensDoMenu,
  lerCaminhoPainel,
  papelPodeVer,
} from "../lib/painel";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const A: AcademiaDoMembro = { academia_id: "a", nome: "Academia A", slug: "academia-a", papel: "dono", ativa: true };
const B: AcademiaDoMembro = { academia_id: "b", nome: "Academia B", slug: "academia-b", papel: "professor", ativa: false };

describe("Menu por papel (tabela do AGENTS.md)", () => {
  it("professor não vê matrículas nem cobranças", () => {
    const secoes = itensDoMenu("professor").map((i) => i.secao);
    expect(secoes).toEqual(["inicio", "alunos", "turmas", "graduacoes"]);
    expect(papelPodeVer("professor", "cobrancas")).toBe(false);
    expect(papelPodeVer("professor", "matriculas")).toBe(false);
  });

  it("recepção vê alunos, turmas, matrículas, cobranças e graduações", () => {
    expect(itensDoMenu("recepcao").map((i) => i.secao)).toEqual([
      "inicio", "alunos", "turmas", "matriculas", "cobrancas", "graduacoes",
    ]);
  });

  it("dono e admin veem tudo", () => {
    for (const papel of ["dono", "admin"] as const) {
      expect(itensDoMenu(papel)).toHaveLength(6);
    }
  });
});

describe("Qual academia abrir", () => {
  it("uma academia só: entra direto", () => {
    expect(escolherAcademia([A], null, null)).toEqual({ tipo: "academia", academia: A });
  });

  it("várias: usa a guardada se ainda for do login, senão pergunta", () => {
    expect(escolherAcademia([A, B], null, "academia-b")).toEqual({ tipo: "academia", academia: B });
    expect(escolherAcademia([A, B], null, "academia-que-saiu")).toEqual({ tipo: "escolher" });
    expect(escolherAcademia([A, B], null, null)).toEqual({ tipo: "escolher" });
  });

  it("o slug da URL manda, mas só vale para academia do login", () => {
    expect(escolherAcademia([A, B], "academia-a", "academia-b")).toEqual({ tipo: "academia", academia: A });
    expect(escolherAcademia([A], "academia-c", null)).toEqual({ tipo: "sem_acesso", slug: "academia-c" });
  });
});

describe("Caminhos do painel", () => {
  it("lê e monta /painel, /painel/<slug> e /painel/<slug>/<seção>", () => {
    expect(lerCaminhoPainel("/painel")).toEqual({ slug: null, secao: "inicio" });
    expect(lerCaminhoPainel("/painel/academia-a")).toEqual({ slug: "academia-a", secao: "inicio" });
    expect(lerCaminhoPainel("/painel/academia-a/cobrancas")).toEqual({ slug: "academia-a", secao: "cobrancas" });
    expect(lerCaminhoPainel("/painel/academia-a/inexistente")).toEqual({ slug: "academia-a", secao: "inicio" });
    expect(caminhoPainel("academia-a", "turmas")).toBe("/painel/academia-a/turmas");
    expect(caminhoPainel("academia-a")).toBe("/painel/academia-a");
    expect(caminhoPainel(null)).toBe("/painel");
  });
});

// ------------------------------------------------------------------ com cliente Supabase (falso)

const SESSAO_DE = (id: string) => ({ access_token: `acesso-${id}`, refresh_token: `renova-${id}`, user: { id } });

function clienteFalso(vinculos: unknown[], ativas: Record<string, boolean>, usuario: { id: string } | null = { id: "user-1" }) {
  const eqAtivo = vi.fn().mockResolvedValue({ data: vinculos, error: null });
  const eqUsuario = vi.fn().mockReturnValue({ eq: eqAtivo });
  const select = vi.fn().mockReturnValue({ eq: eqUsuario });
  return {
    from: vi.fn().mockReturnValue({ select }),
    rpc: vi.fn(async (_nome: string, args: { p_academia_id: string }) => ({ data: ativas[args.p_academia_id] ?? false, error: null })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: usuario ? SESSAO_DE(usuario.id) : null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: usuario }, error: null }),
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: { user: usuario, session: usuario ? SESSAO_DE(usuario.id) : null }, error: null }),
      setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(),
    },
    select,
    eqUsuario,
    eqAtivo,
  };
}

/**
 * O primeiro createClient é o cliente compartilhado (sessão do navegador);
 * os seguintes, os clientes isolados das tentativas de login.
 */
async function carregarComCliente(compartilhado: unknown, isolado?: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>)
    .mockReset()
    .mockReturnValueOnce(compartilhado)
    .mockReturnValue(isolado ?? compartilhado);
  return import("../lib/painel");
}

describe("Academias do login", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const VINCULOS = [
    { academia_id: "b", papel: "professor", academias: { nome: "Zen Dojo", slug: "zen" } },
    { academia_id: "a", papel: "dono", academias: { nome: "Alpha", slug: "alpha" } },
    { academia_id: "t", papel: "totem", academias: { nome: "Totem", slug: "totem" } },
  ];
  const SO_TOTEM = [{ academia_id: "t", papel: "totem", academias: { nome: "Totem", slug: "totem" } }];

  it("filtra pelo próprio usuário (não pelos vínculos que dono e admin enxergam) e só os ativos", async () => {
    const cliente = clienteFalso(VINCULOS, { a: true, b: false });
    const lib = await carregarComCliente(cliente);

    await lib.listarMinhasAcademias();

    expect(cliente.from).toHaveBeenCalledWith("membros_academia");
    expect(cliente.select).toHaveBeenCalledWith("academia_id, papel, academias(nome, slug)");
    expect(cliente.eqUsuario).toHaveBeenCalledWith("user_id", "user-1");
    expect(cliente.eqAtivo).toHaveBeenCalledWith("ativo", true);
  });

  it("tira o papel totem, confere a assinatura de cada academia e ordena por nome", async () => {
    const cliente = clienteFalso(VINCULOS, { a: true, b: false });
    const lib = await carregarComCliente(cliente);

    const lista = await lib.listarMinhasAcademias();

    expect(lista).toEqual([
      { academia_id: "a", nome: "Alpha", slug: "alpha", papel: "dono", ativa: true },
      { academia_id: "b", nome: "Zen Dojo", slug: "zen", papel: "professor", ativa: false },
    ]);
    expect(cliente.rpc).toHaveBeenCalledWith("academia_ativa", { p_academia_id: "a" });
    expect(cliente.rpc).not.toHaveBeenCalledWith("academia_ativa", { p_academia_id: "t" });
  });

  it("sem sessão, nenhuma academia", async () => {
    const cliente = clienteFalso(VINCULOS, {}, null);
    const lib = await carregarComCliente(cliente);
    expect(await lib.listarMinhasAcademias()).toEqual([]);
    expect(cliente.from).not.toHaveBeenCalled();
  });

  it("sessão que não deu para confirmar é erro, não 'sem sessão' (token vencido e renovação falhando)", async () => {
    // O SDK devolve session null com erro de rede e mantém a credencial guardada.
    const naRenovacao = clienteFalso(VINCULOS, {});
    naRenovacao.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" },
    });
    let lib = await carregarComCliente(naRenovacao);
    await expect(lib.listarMinhasAcademias()).rejects.toMatchObject({ name: "AuthRetryableFetchError" });

    const naConfirmacao = clienteFalso(VINCULOS, {});
    naConfirmacao.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 0, message: "Failed to fetch" } });
    lib = await carregarComCliente(naConfirmacao);
    await expect(lib.listarMinhasAcademias()).rejects.toMatchObject({ message: "Failed to fetch" });
  });

  it("erro na consulta dos vínculos ou em academia_ativa propaga (nunca marca academia como ativa)", async () => {
    const comErroNaConsulta = clienteFalso(VINCULOS, {});
    comErroNaConsulta.eqAtivo.mockResolvedValue({ data: null, error: { message: "boom" } });
    let lib = await carregarComCliente(comErroNaConsulta);
    await expect(lib.listarMinhasAcademias()).rejects.toMatchObject({ message: "boom" });

    const comErroNaAtiva = clienteFalso(VINCULOS, {});
    comErroNaAtiva.rpc.mockResolvedValue({ data: null, error: { message: "rpc falhou" } } as never);
    lib = await carregarComCliente(comErroNaAtiva);
    await expect(lib.listarMinhasAcademias()).rejects.toMatchObject({ message: "rpc falhou" });
  });

  describe("entrar: a tentativa roda num cliente isolado e só o login aceito vai para o navegador", () => {
    it("sucesso: confere os vínculos no cliente isolado e então publica a sessão no compartilhado", async () => {
      const compartilhado = clienteFalso([], {}, null);
      const isolado = clienteFalso(VINCULOS, { a: true, b: true });
      const lib = await carregarComCliente(compartilhado, isolado);

      const res = await lib.entrarNoPainel("dono@a.test", "senha");

      expect(isolado.auth.signInWithPassword).toHaveBeenCalledWith({ email: "dono@a.test", password: "senha" });
      expect(isolado.eqUsuario).toHaveBeenCalledWith("user_id", "user-1");
      expect(compartilhado.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(compartilhado.auth.setSession).toHaveBeenCalledWith({
        access_token: "acesso-user-1",
        refresh_token: "renova-user-1",
      });
      expect(isolado.auth.signOut).not.toHaveBeenCalled();
      expect(res).toMatchObject({ sucesso: true, usuarioId: "user-1", academias: [{ slug: "alpha" }, { slug: "zen" }] });
    });

    it("recusa (sem vínculo ou erro ao carregar) não toca a sessão do navegador, nem a de outro usuário", async () => {
      const casos: Array<[unknown[], boolean, string]> = [
        [SO_TOTEM, false, "Este login não faz parte da equipe de nenhuma academia."],
        [VINCULOS, true, "Não foi possível carregar suas academias. Verifique a conexão e tente de novo."],
      ];
      for (const [vinculos, comErro, mensagem] of casos) {
        // B já está com sessão no navegador (outra aba); A tenta e é recusado.
        const compartilhado = clienteFalso([], {}, { id: "user-b" });
        const isolado = clienteFalso(vinculos, {});
        if (comErro) isolado.eqAtivo.mockResolvedValue({ data: null, error: { message: "rede" } });
        // Nem o signOut da tentativa falhando muda nada no navegador.
        isolado.auth.signOut.mockRejectedValue(new Error("rede"));
        const lib = await carregarComCliente(compartilhado, isolado);

        expect(await lib.entrarNoPainel("a@a.test", "senha")).toEqual({ sucesso: false, mensagem });
        expect(isolado.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
        expect(compartilhado.auth.signOut).not.toHaveBeenCalled();
        expect(compartilhado.auth.setSession).not.toHaveBeenCalled();
      }
    });

    it("senha errada: mensagem em português, sem consultar vínculos", async () => {
      const compartilhado = clienteFalso([], {}, null);
      const isolado = clienteFalso(VINCULOS, {});
      isolado.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { status: 400, message: "Invalid login credentials" },
      });
      const lib = await carregarComCliente(compartilhado, isolado);

      expect(await lib.entrarNoPainel("x@a.test", "errada")).toEqual({ sucesso: false, mensagem: "E-mail ou senha incorretos." });
      expect(isolado.from).not.toHaveBeenCalled();
      expect(compartilhado.auth.setSession).not.toHaveBeenCalled();
    });

    it("tentativa invalidada antes de gravar (a sessão mudou em outra aba): não grava nada no navegador", async () => {
      const compartilhado = clienteFalso([], {}, null);
      const isolado = clienteFalso(VINCULOS, { a: true });
      const lib = await carregarComCliente(compartilhado, isolado);
      const podePublicar = vi.fn().mockReturnValue(false);

      const res = await lib.entrarNoPainel("dono@a.test", "senha", { podePublicar, continuaValida: () => true });

      expect(res).toEqual({ sucesso: false, mensagem: "A sessão deste navegador mudou em outra aba. Entre de novo." });
      expect(podePublicar).toHaveBeenCalledWith("user-1");
      expect(compartilhado.auth.setSession).not.toHaveBeenCalled();
      expect(compartilhado.auth.signOut).not.toHaveBeenCalled();
      expect(isolado.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("mudança durante a própria gravação: desfaz a sessão gravada", async () => {
      const compartilhado = clienteFalso([], {}, null);
      const isolado = clienteFalso(VINCULOS, { a: true });
      const lib = await carregarComCliente(compartilhado, isolado);
      const ordem: string[] = [];
      compartilhado.auth.setSession.mockImplementation(async () => {
        ordem.push("grava");
        return { data: {}, error: null };
      });
      compartilhado.auth.signOut.mockImplementation(async () => {
        ordem.push("desfaz");
        return { error: null };
      });

      const res = await lib.entrarNoPainel("dono@a.test", "senha", {
        podePublicar: () => true,
        continuaValida: () => false,
      });

      expect(res).toEqual({ sucesso: false, mensagem: "A sessão deste navegador mudou em outra aba. Entre de novo." });
      expect(ordem).toEqual(["grava", "desfaz"]);
      expect(compartilhado.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    });

    it("mudança durante a gravação e falha ao desfazer (erro devolvido ou lançado): avisa que a sessão pode ter ficado", async () => {
      for (const falha of ["devolvido", "lançado"] as const) {
        const compartilhado = clienteFalso([], {}, null);
        if (falha === "devolvido") {
          compartilhado.auth.signOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
        } else {
          compartilhado.auth.signOut.mockRejectedValue(new Error("rede"));
        }
        const isolado = clienteFalso(VINCULOS, { a: true });
        const lib = await carregarComCliente(compartilhado, isolado);

        const res = await lib.entrarNoPainel("dono@a.test", "senha", {
          podePublicar: () => true,
          continuaValida: () => false,
        });

        expect(res).toEqual({
          sucesso: false,
          mensagem: "A sessão deste navegador mudou em outra aba. Entre de novo.",
          sessaoPodeTerFicado: true,
        });
      }
    });

    it("falha ao publicar a sessão no navegador: não entra", async () => {
      const compartilhado = clienteFalso([], {}, null);
      compartilhado.auth.setSession.mockResolvedValue({ data: {}, error: { status: 0, message: "Failed to fetch" } });
      const isolado = clienteFalso(VINCULOS, { a: true });
      const lib = await carregarComCliente(compartilhado, isolado);

      expect(await lib.entrarNoPainel("dono@a.test", "senha")).toEqual({
        sucesso: false,
        mensagem: "Não foi possível entrar agora. Verifique a conexão e tente de novo.",
      });
    });

    it("só credencial recusada vira 'senha incorreta'", async () => {
      const casos: Array<[object, string]> = [
        [{ status: 400, code: "invalid_credentials" }, "E-mail ou senha incorretos."],
        [{ status: 400, code: "email_not_confirmed" }, "Confirme o seu e-mail antes de entrar."],
        [{ status: 429, code: "over_request_rate_limit" }, "Muitas tentativas. Espere um pouco e tente de novo."],
        [{ status: 0 }, "Não foi possível entrar agora. Verifique a conexão e tente de novo."],
        [{ status: 503 }, "Não foi possível entrar agora. Verifique a conexão e tente de novo."],
      ];
      for (const [erro, mensagem] of casos) {
        const isolado = clienteFalso(VINCULOS, {});
        isolado.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: "x", ...erro } });
        const lib = await carregarComCliente(clienteFalso([], {}, null), isolado);
        expect(await lib.entrarNoPainel("x@a.test", "senha")).toEqual({ sucesso: false, mensagem });
      }
    });
  });

  it("sair desfaz a sessão só neste aparelho", async () => {
    const cliente = clienteFalso(VINCULOS, {});
    const lib = await carregarComCliente(cliente);
    expect(await lib.sairDoPainel()).toBe(true);
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sair avisa quando a sessão pode ter ficado guardada (erro devolvido ou lançado)", async () => {
    const comErro = clienteFalso(VINCULOS, {});
    // Token vencido e renovação falhando: o SDK devolve erro sem remover a sessão.
    comErro.auth.signOut.mockResolvedValue({ error: { name: "AuthRetryableFetchError", status: 0 } });
    let lib = await carregarComCliente(comErro);
    expect(await lib.sairDoPainel()).toBe(false);

    const lancando = clienteFalso(VINCULOS, {});
    lancando.auth.signOut.mockRejectedValue(new Error("rede"));
    lib = await carregarComCliente(lancando);
    expect(await lib.sairDoPainel()).toBe(false);
  });

  it("observarSessao repassa o id do usuário (ou null) e para de observar", async () => {
    const cliente = clienteFalso(VINCULOS, {});
    const unsubscribe = vi.fn();
    let callback: (evento: string, sessao: { user: { id: string } } | null) => void = () => {};
    cliente.auth.onAuthStateChange.mockImplementation((cb) => {
      callback = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    const lib = await carregarComCliente(cliente);

    const vistos: Array<string | null> = [];
    const parar = lib.observarSessao((id) => vistos.push(id));
    callback("SIGNED_IN", { user: { id: "u1" } });
    callback("SIGNED_OUT", null);
    parar();

    expect(vistos).toEqual(["u1", null]);
    expect(unsubscribe).toHaveBeenCalled();
  });
});
