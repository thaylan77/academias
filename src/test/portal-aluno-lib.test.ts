import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

function clienteFalso(respostas: Record<string, Resposta>, usuario: { id: string } | null = { id: "login-1" }) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "or", "order", "limit"]) {
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

  it("presenças: filtra pela academia e pelo aluno, mais recente primeiro, com o nome da turma e uma linha a mais para saber se há outra página", async () => {
    const linhas = Array.from({ length: 31 }, (_, i) => ({
      id: "p" + i, data: "2026-10-01", checkin_em: "2026-10-01T22:00:00.123456+00:00", turma_id: i === 0 ? "t-sumiu" : "t1", origem: "qrcode",
    }));
    const cliente = clienteFalso({
      presencas: { data: linhas, error: null },
      turmas: { data: [{ id: "t1", nome: "Adulto Noite" }], error: null },
    });
    const lib = await carregarComCliente(cliente);
    const r = await lib.minhasPresencas({ id: "a1", academia_id: "acad-a" });

    expect(filtros(cliente.chamadas, "presencas")).toEqual([["academia_id", "acad-a"], ["aluno_id", "a1"]]);
    expect(filtros(cliente.chamadas, "turmas")).toEqual([["academia_id", "acad-a"]]);
    const de = (metodo: string) => cliente.chamadas.filter((c) => c.tabela === "presencas" && c.metodo === metodo).map((c) => c.args);
    expect(de("order")).toEqual([["data", { ascending: false }], ["checkin_em", { ascending: false }], ["id", { ascending: false }]]);
    expect(de("limit")).toEqual([[31]]);
    expect(de("or")).toEqual([]);
    expect(r.temMais).toBe(true);
    expect(r.itens).toHaveLength(30);
    expect(r.itens[0]).toEqual({ id: "p0", data: "2026-10-01", checkin_em: "2026-10-01T22:00:00.123456+00:00", turma: "Turma", origem: "qrcode" });
    expect(r.itens[1].turma).toBe("Adulto Noite");
  });

  it("presenças: a página seguinte começa depois da última lida (cursor por data, check-in e id, não por posição)", async () => {
    const cliente = clienteFalso({});
    const lib = await carregarComCliente(cliente);
    await lib.minhasPresencas(
      { id: "a1", academia_id: "acad-a" },
      { id: "p9", data: "2026-10-21", checkin_em: "2026-10-21T22:05:00.5+00:00" }
    );
    const or = cliente.chamadas.filter((c) => c.tabela === "presencas" && c.metodo === "or").map((c) => c.args);
    expect(or).toEqual([[
      'data.lt.2026-10-21,and(data.eq.2026-10-21,checkin_em.lt."2026-10-21T22:05:00.5+00:00"),' +
        'and(data.eq.2026-10-21,checkin_em.eq."2026-10-21T22:05:00.5+00:00",id.lt.p9)',
    ]]);
    // O cursor soma aos filtros de academia e aluno, nunca os troca.
    expect(filtros(cliente.chamadas, "presencas")).toEqual([["academia_id", "acad-a"], ["aluno_id", "a1"]]);
  });

  it("presenças: última página sem linha a mais; erro de qualquer leitura sobe", async () => {
    const ultima = clienteFalso({ presencas: { data: [{ id: "p1", data: "2026-10-01", turma_id: "t1", origem: "recepcao" }], error: null } });
    expect((await (await carregarComCliente(ultima)).minhasPresencas({ id: "a1", academia_id: "acad-a" })).temMais).toBe(false);
    for (const tabela of ["presencas", "turmas"]) {
      const cliente = clienteFalso({ [tabela]: { data: null, error: { message: "falhou " + tabela } } });
      await expect((await carregarComCliente(cliente)).minhasPresencas({ id: "a1", academia_id: "acad-a" }))
        .rejects.toEqual({ message: "falhou " + tabela });
    }
  });

  it.each(["vw_graduacao_atual", "vw_progresso_graduacao", "modalidades"])("graduação: erro em %s sobe", async (tabela) => {
    const cliente = clienteFalso({ [tabela]: { data: null, error: { message: "falhou " + tabela } } });
    const lib = await carregarComCliente(cliente);
    await expect(lib.minhaGraduacao({ id: "a1", academia_id: "acad-a" })).rejects.toEqual({ message: "falhou " + tabela });
  });
});
