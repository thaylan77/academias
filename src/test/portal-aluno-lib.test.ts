import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

function clienteFalso(respostas: Record<string, Resposta>, usuario: { id: string } | null = { id: "login-1" }) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order"]) {
      q[metodo] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return q;
      };
    }
    q.then = (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(respostas[tabela] ?? { data: [], error: null }).then(ok, falha);
    return q;
  });
  return {
    from,
    chamadas,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: usuario }, error: null }),
      onAuthStateChange: vi.fn(),
    },
  };
}

async function carregarComCliente(cliente: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(cliente);
  return import("../lib/portal-aluno");
}

const filtros = (chamadas: Chamada[], tabela: string) =>
  chamadas.filter((c) => c.tabela === tabela && c.metodo === "eq").map((c) => c.args);

describe("Portal do aluno: leituras", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cadastros: só os ligados ao login (mesmo se o login for da equipe), com a academia", async () => {
    const cliente = clienteFalso({
      alunos: {
        data: [
          { id: "a1", nome: "Filho Um", status: "ativo", academia_id: "acad-a", academias: { nome: "Dojo A", fuso: "America/Manaus" } },
          { id: "b1", nome: "Filho Dois", status: "inativo", academia_id: "acad-b", academias: null },
        ],
        error: null,
      },
    });
    const lib = await carregarComCliente(cliente);
    const alunos = await lib.meusAlunos();
    expect(filtros(cliente.chamadas, "alunos")).toEqual([["user_id", "login-1"]]);
    expect(alunos).toEqual([
      { id: "a1", nome: "Filho Um", status: "ativo", academia_id: "acad-a", academia: "Dojo A", fuso: "America/Manaus" },
      { id: "b1", nome: "Filho Dois", status: "inativo", academia_id: "acad-b", academia: "", fuso: "America/Sao_Paulo" },
    ]);
  });

  it("cadastros: sem login, lista vazia sem consultar; erro do login ou da consulta sobe", async () => {
    const semLogin = clienteFalso({}, null);
    expect(await (await carregarComCliente(semLogin)).meusAlunos()).toEqual([]);
    expect(semLogin.from).not.toHaveBeenCalled();

    const comErro = clienteFalso({ alunos: { data: null, error: { message: "x" } } });
    await expect((await carregarComCliente(comErro)).meusAlunos()).rejects.toEqual({ message: "x" });

    const loginFalhou = clienteFalso({});
    loginFalhou.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "jwt" } });
    await expect((await carregarComCliente(loginFalhou)).meusAlunos()).rejects.toEqual({ message: "jwt" });
    expect(loginFalhou.from).not.toHaveBeenCalled();
  });

  it("graduação: filtra pela academia e pelo aluno; junta modalidade e progresso; sem progresso (inativo) mostra só a faixa", async () => {
    const cliente = clienteFalso({
      vw_graduacao_atual: {
        data: [
          { modalidade_id: "jj", faixa: "Azul", cor: "#1E40AF", grau: 2, graduado_em: "2026-03-01" },
          { modalidade_id: "mt", faixa: "Branca", cor: null, grau: 0, graduado_em: "2025-01-10" },
        ],
        error: null,
      },
      vw_progresso_graduacao: {
        data: [{ modalidade_id: "jj", proximo_passo: "grau 3", aulas_desde: 40, min_aulas: 40, meses_desde: 7, min_meses: 6, apto: true }],
        error: null,
      },
      modalidades: { data: [{ id: "jj", nome: "Jiu-Jitsu" }, { id: "mt", nome: "Muay Thai" }], error: null },
    });
    const lib = await carregarComCliente(cliente);
    const itens = await lib.minhaGraduacao({ id: "a1", academia_id: "acad-a" });

    expect(filtros(cliente.chamadas, "vw_graduacao_atual")).toEqual([["academia_id", "acad-a"], ["aluno_id", "a1"]]);
    expect(filtros(cliente.chamadas, "vw_progresso_graduacao")).toEqual([["academia_id", "acad-a"], ["aluno_id", "a1"]]);
    expect(filtros(cliente.chamadas, "modalidades")).toEqual([["academia_id", "acad-a"]]);
    expect(itens).toEqual([
      {
        modalidade_id: "jj", modalidade: "Jiu-Jitsu", faixa: "Azul", cor: "#1E40AF", grau: 2, graduado_em: "2026-03-01",
        progresso: { proximo_passo: "grau 3", aulas_desde: 40, min_aulas: 40, meses_desde: 7, min_meses: 6, apto: true },
      },
      { modalidade_id: "mt", modalidade: "Muay Thai", faixa: "Branca", cor: null, grau: 0, graduado_em: "2025-01-10", progresso: null },
    ]);
  });

  it.each(["vw_graduacao_atual", "vw_progresso_graduacao", "modalidades"])("graduação: erro em %s sobe", async (tabela) => {
    const cliente = clienteFalso({ [tabela]: { data: null, error: { message: "falhou " + tabela } } });
    const lib = await carregarComCliente(cliente);
    await expect(lib.minhaGraduacao({ id: "a1", academia_id: "acad-a" })).rejects.toEqual({ message: "falhou " + tabela });
  });
});
