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

function clienteFalso(vinculos: unknown[], ativas: Record<string, boolean>, usuario: { id: string } | null = { id: "user-1" }) {
  const eqAtivo = vi.fn().mockResolvedValue({ data: vinculos, error: null });
  const eqUsuario = vi.fn().mockReturnValue({ eq: eqAtivo });
  const select = vi.fn().mockReturnValue({ eq: eqUsuario });
  return {
    from: vi.fn().mockReturnValue({ select }),
    rpc: vi.fn(async (_nome: string, args: { p_academia_id: string }) => ({ data: ativas[args.p_academia_id] ?? false, error: null })),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: usuario } }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: usuario }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    select,
    eqUsuario,
    eqAtivo,
  };
}

async function carregarComCliente(cliente: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>).mockReturnValue(cliente);
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

  it("filtra pelo próprio usuário (não pelos vínculos que dono e admin enxergam) e só os ativos", async () => {
    const cliente = clienteFalso(VINCULOS, { a: true, b: false });
    const lib = await carregarComCliente(cliente);

    await lib.listarMinhasAcademias();

    expect(cliente.from).toHaveBeenCalledWith("membros_academia");
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

  it("login sem vínculo em nenhuma academia é recusado e a sessão é desfeita só neste aparelho", async () => {
    const cliente = clienteFalso([{ academia_id: "t", papel: "totem", academias: { nome: "Totem", slug: "totem" } }], {});
    const lib = await carregarComCliente(cliente);

    const res = await lib.entrarNoPainel("totem@a.test", "senha");

    expect(res).toEqual({ sucesso: false, mensagem: "Este login não faz parte da equipe de nenhuma academia." });
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("senha errada: mensagem em português, sem consultar vínculos", async () => {
    const cliente = clienteFalso(VINCULOS, {});
    cliente.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 400, message: "Invalid login credentials" } });
    const lib = await carregarComCliente(cliente);

    const res = await lib.entrarNoPainel("x@a.test", "errada");

    expect(res).toEqual({ sucesso: false, mensagem: "E-mail ou senha incorretos." });
    expect(cliente.from).not.toHaveBeenCalled();
  });

  it("sair desfaz a sessão só neste aparelho", async () => {
    const cliente = clienteFalso(VINCULOS, {});
    const lib = await carregarComCliente(cliente);
    await lib.sairDoPainel();
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
