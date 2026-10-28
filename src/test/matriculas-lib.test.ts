import { describe, it, expect, afterEach, vi } from "vitest";
import {
  Matricula,
  filtrarMatriculas,
  lerValorMatricula,
  podeDestrancar,
  podeEncerrar,
  podeGerirMatriculas,
  podeTrancar,
  podeVerMatriculas,
  situacaoDa,
  validarNovaMatricula,
} from "../lib/matriculas";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const HOJE = "2026-10-27";

function mat(extra: Partial<Matricula> = {}): Matricula {
  return {
    id: "m1", aluno_id: "a1", aluno: "Ana Souza", plano_id: "p1", plano: "Mensal", status: "ativa", origem: "recepcao",
    data_inicio: "2026-01-10", data_fim: null, dia_vencimento: 10, valor: null, turmas: [], ...extra,
  };
}

const FORM = { aluno_id: "a1", plano_id: "p1", turma_ids: ["t1"], data_inicio: HOJE, dia_vencimento: "10", valor: "", cobrar_a_partir: "" };

describe("Regras de tela", () => {
  it("dono, admin e recepção veem; gravam só com a assinatura em dia; professor não", () => {
    for (const papel of ["dono", "admin", "recepcao"] as const) {
      expect(podeVerMatriculas(papel)).toBe(true);
      expect(podeGerirMatriculas(papel, true)).toBe(true);
      expect(podeGerirMatriculas(papel, false)).toBe(false);
    }
    expect(podeVerMatriculas("professor")).toBe(false);
    expect(podeGerirMatriculas("professor", true)).toBe(false);
  });

  it("encerrada é ativa ou trancada com fim antes de hoje", () => {
    expect(situacaoDa(mat({ data_fim: "2026-10-26" }), HOJE)).toBe("encerrada");
    expect(situacaoDa(mat({ status: "trancada", data_fim: "2026-10-26" }), HOJE)).toBe("encerrada");
    expect(situacaoDa(mat({ data_fim: HOJE }), HOJE)).toBe("ativa");
    expect(situacaoDa(mat({ status: "cancelada", data_fim: "2026-01-01" }), HOJE)).toBe("cancelada");
  });

  it("ações por situação, como o banco aceita", () => {
    expect(podeEncerrar(mat())).toBe(true);
    expect(podeEncerrar(mat({ status: "trancada" }))).toBe(true);
    expect(podeEncerrar(mat({ status: "pendente" }))).toBe(false);
    expect(podeEncerrar(mat({ status: "desconhecido" }))).toBe(false);
    // Corrigir o fim de uma que já terminou também vale.
    expect(podeEncerrar(mat({ data_fim: "2026-10-01" }))).toBe(true);
    expect(podeEncerrar(mat({ status: "trancada", data_fim: "2026-10-01" }))).toBe(true);
    expect(podeTrancar(mat(), HOJE)).toBe(true);
    expect(podeTrancar(mat({ data_fim: "2026-10-26" }), HOJE)).toBe(false);
    expect(podeTrancar(mat({ status: "trancada" }), HOJE)).toBe(false);
    expect(podeTrancar(mat({ data_fim: HOJE }), HOJE)).toBe(true);
    expect(podeDestrancar(mat({ status: "trancada" }), HOJE)).toBe(true);
    expect(podeDestrancar(mat({ status: "trancada", data_fim: HOJE }), HOJE)).toBe(true);
    // Trancada que já terminou não destranca (o banco recusa).
    expect(podeDestrancar(mat({ status: "trancada", data_fim: "2026-10-26" }), HOJE)).toBe(false);
    expect(podeDestrancar(mat(), HOJE)).toBe(false);
  });

  it("filtra por situação e por nome sem acento", () => {
    const lista = [mat(), mat({ id: "m2", aluno: "João", status: "pendente" }), mat({ id: "m3", aluno: "José", data_fim: "2026-02-01" })];
    expect(filtrarMatriculas(lista, { situacao: "encerrada", aluno: "" }, HOJE).map((m) => m.id)).toEqual(["m3"]);
    expect(filtrarMatriculas(lista, { situacao: "todas", aluno: "joao" }, HOJE).map((m) => m.id)).toEqual(["m2"]);
    expect(filtrarMatriculas(lista, { situacao: "ativa", aluno: "" }, HOJE).map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("validarNovaMatricula", () => {
  it("monta os dados, sem turma repetida e com o mês inicial no dia 1", () => {
    const v = validarNovaMatricula({ ...FORM, turma_ids: ["t1", "t2", "t1"], valor: "1.234,50", cobrar_a_partir: "2026-11" }, HOJE);
    expect(v).toEqual({ ok: true, dados: {
      aluno_id: "a1", plano_id: "p1", turma_ids: ["t1", "t2"], data_inicio: HOJE, dia_vencimento: 10, valor: 1234.5, cobrar_a_partir: "2026-11-01",
    } });
  });

  it("sem plano, o dia de vencimento é opcional e o plano vai nulo", () => {
    const v = validarNovaMatricula({ ...FORM, plano_id: "", dia_vencimento: "" }, HOJE);
    expect(v).toEqual({ ok: true, dados: {
      aluno_id: "a1", plano_id: null, turma_ids: ["t1"], data_inicio: HOJE, dia_vencimento: null, valor: null, cobrar_a_partir: null,
    } });
  });

  it.each([
    [{ aluno_id: "" }, "Escolha o aluno."],
    [{ turma_ids: [] }, "Escolha pelo menos uma turma."],
    [{ data_inicio: "2026-02-31" }, "Informe a data de início."],
    [{ dia_vencimento: "" }, "Com plano, informe o dia de vencimento"],
    [{ dia_vencimento: "29" }, "O dia de vencimento vai de 1 a 28."],
    [{ dia_vencimento: "2.5" }, "O dia de vencimento vai de 1 a 28."],
    [{ valor: "abc" }, "Valor inválido."],
    [{ cobrar_a_partir: "2026-09" }, "O mês inicial de cobrança precisa ser o mês atual ou depois"],
    [{ data_inicio: "2026-12-05", cobrar_a_partir: "2026-11" }, "não antes do mês de início das aulas"],
    [{ cobrar_a_partir: "2026-13" }, "Mês inicial de cobrança inválido."],
  ])("recusa %o", (troca, msg) => {
    const v = validarNovaMatricula({ ...FORM, ...troca }, HOJE);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.mensagem).toContain(msg);
  });

  it("valor: jeito brasileiro e ponto decimal, nunca o ponto como milhar errado", () => {
    expect(lerValorMatricula("150")).toBe(150);
    expect(lerValorMatricula("150,5")).toBe(150.5);
    expect(lerValorMatricula("150.50")).toBe(150.5);
    expect(lerValorMatricula("1.234,56")).toBe(1234.56);
    expect(lerValorMatricula("0")).toBe(0);
    expect(lerValorMatricula("1,234.56")).toBe(null);
    expect(lerValorMatricula("-5")).toBe(null);
    for (const ruim of ["150,555", "150.123", "1.23.456,00", "", "  ", "123456789", "1e3"]) {
      expect(lerValorMatricula(ruim)).toBe(null);
    }
    expect(lerValorMatricula("99999999,99")).toBe(99999999.99);
  });
});

// ------------------------------------------------------------------ com cliente Supabase (falso)

type Chamada = { metodo: string; args: unknown[] };

function clienteFalso(resposta: { data: unknown; error: unknown }, rpc: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order", "range"]) {
      q[metodo] = (...args: unknown[]) => {
        chamadas.push({ metodo: `${tabela}.${metodo}`, args });
        return q;
      };
    }
    q.then = (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, falha);
    return q;
  });
  return { from, rpc: vi.fn().mockResolvedValue(rpc), chamadas, auth: { onAuthStateChange: vi.fn() } };
}

async function carregarComCliente(cliente: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(cliente);
  return import("../lib/matriculas");
}

describe("Leitura e RPCs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lista filtrada pela academia, com turmas em ordem e status desconhecido sem ação", async () => {
    const cliente = clienteFalso({
      data: [
        { id: "m1", aluno_id: "a1", plano_id: "p1", status: "ativa", origem: "online", data_inicio: "2026-01-10", data_fim: null,
          dia_vencimento: 10, valor: "150.50", alunos: { nome: "Ana" }, planos: { nome: "Mensal" },
          matricula_turmas: [{ turma_id: "t2", turmas: { nome: "Noite" } }, { turma_id: "t1", turmas: { nome: "Manhã" } }] },
        { id: "m2", aluno_id: "a2", plano_id: null, status: "outra", origem: "recepcao", data_inicio: "2026-01-01", data_fim: null,
          dia_vencimento: null, valor: null, alunos: null, planos: null, matricula_turmas: null },
      ],
      error: null,
    });
    const lib = await carregarComCliente(cliente);
    const lista = await lib.listarMatriculas("acad-a");
    expect(cliente.chamadas.filter((c) => c.metodo === "matriculas.eq").map((c) => c.args)).toEqual([["academia_id", "acad-a"]]);
    expect(lista[0]).toMatchObject({ valor: 150.5, origem: "online", turmas: [{ id: "t1", nome: "Manhã" }, { id: "t2", nome: "Noite" }] });
    expect(lista[1]).toMatchObject({ status: "desconhecido", aluno: "", turmas: [] });
    expect(lib.podeEncerrar(lista[1])).toBe(false);
  });

  it("planos: só os ativos da academia", async () => {
    const cliente = clienteFalso({ data: [{ id: "p1", nome: "Mensal", valor: "150", periodicidade: "mensal" }], error: null });
    const lib = await carregarComCliente(cliente);
    expect(await lib.listarPlanos("acad-a")).toEqual([{ id: "p1", nome: "Mensal", valor: 150, periodicidade: "mensal" }]);
    expect(cliente.chamadas.filter((c) => c.metodo === "planos.eq").map((c) => c.args)).toEqual([["academia_id", "acad-a"], ["ativo", true]]);
  });

  it("criar_matricula recebe a academia e os dados; devolve o id", async () => {
    const cliente = clienteFalso({ data: [], error: null }, { data: "m-nova", error: null });
    const lib = await carregarComCliente(cliente);
    const r = await lib.criarMatricula("acad-a", {
      aluno_id: "a1", plano_id: "p1", turma_ids: ["t1"], data_inicio: HOJE, dia_vencimento: 10, valor: null, cobrar_a_partir: null,
    });
    expect(r).toEqual({ sucesso: true, valor: "m-nova" });
    expect(cliente.rpc).toHaveBeenCalledWith("criar_matricula", {
      p_academia_id: "acad-a",
      p_dados: { aluno_id: "a1", plano_id: "p1", turma_ids: ["t1"], data_inicio: HOJE, dia_vencimento: 10, valor: null, cobrar_a_partir: null },
    });
  });

  it("aprovar sem dia não manda o parâmetro; com dia, manda", async () => {
    const cliente = clienteFalso({ data: [], error: null }, { data: null, error: null });
    const lib = await carregarComCliente(cliente);
    await lib.aprovarMatricula("m1", null);
    await lib.aprovarMatricula("m1", 5);
    expect(cliente.rpc.mock.calls).toEqual([
      ["aprovar_matricula", { p_matricula_id: "m1" }],
      ["aprovar_matricula", { p_matricula_id: "m1", p_dia_vencimento: 5 }],
    ]);
  });

  it("encerrar e trancar devolvem as pendentes; destrancar só confirma", async () => {
    const cliente = clienteFalso({ data: [], error: null }, { data: 2, error: null });
    const lib = await carregarComCliente(cliente);
    expect(await lib.encerrarMatricula("m1", HOJE)).toEqual({ sucesso: true, valor: 2 });
    expect(await lib.trancarMatricula("m1")).toEqual({ sucesso: true, valor: 2 });
    expect(cliente.rpc).toHaveBeenCalledWith("encerrar_matricula", { p_matricula_id: "m1", p_data_fim: HOJE });
    expect(cliente.rpc).toHaveBeenCalledWith("trancar_matricula", { p_matricula_id: "m1" });
  });

  it("destrancar chama a RPC com a matrícula e só confirma", async () => {
    const cliente = clienteFalso({ data: [], error: null }, { data: null, error: null });
    const lib = await carregarComCliente(cliente);
    expect(await lib.destrancarMatricula("m1")).toEqual({ sucesso: true, valor: undefined });
    expect(cliente.rpc).toHaveBeenCalledWith("destrancar_matricula", { p_matricula_id: "m1" });
  });

  it("encerrar sem número na resposta não é sucesso", async () => {
    const lib = await carregarComCliente(clienteFalso({ data: [], error: null }, { data: null, error: null }));
    expect((await lib.encerrarMatricula("m1", HOJE)).sucesso).toBe(false);
  });

  it.each([
    ["matricula_duplicada", "já tem matrícula nesta turma"],
    ["dia_vencimento_obrigatorio", "informe o dia de vencimento"],
    ["cobrar_a_partir_invalido", "mês inicial de cobrança"],
    ["sem_permissao", "assinatura em dia"],
    ["dados_invalidos", "Confira os dados"],
    [null, "Verifique a conexão"],
  ])("criar: hint %s vira mensagem própria", async (hint, msg) => {
    const lib = await carregarComCliente(clienteFalso({ data: [], error: null }, { data: null, error: { message: "texto qualquer do banco", hint } }));
    const r = await lib.criarMatricula("acad-a", {
      aluno_id: "a1", plano_id: null, turma_ids: ["t1"], data_inicio: HOJE, dia_vencimento: null, valor: null, cobrar_a_partir: null,
    });
    expect(r.sucesso).toBe(false);
    expect(!r.sucesso && r.mensagem).toContain(msg);
  });

  it.each([
    ["aprovar", "matricula_nao_pendente", "não está mais pendente"],
    ["aprovar", "matricula_vencida", "já terminou: não dá para aprovar"],
    ["aprovar", "matricula_duplicada", "já tem matrícula nesta turma"],
    ["aprovar", "dia_vencimento_obrigatorio", "informe o dia de vencimento"],
    ["aprovar", "sem_permissao", "assinatura em dia"],
    ["encerrar", "matricula_duplicada", "já tem matrícula nesta turma"],
    ["trancar", "sem_permissao", "assinatura em dia"],
    ["destrancar", "matricula_duplicada", "já tem matrícula nesta turma"],
    ["destrancar", null, "Verifique a conexão"],
    ["encerrar", "matricula_nao_encerravel", "Só matrícula ativa ou trancada"],
    ["encerrar", "dados_invalidos", "antes do início"],
    ["trancar", "matricula_nao_ativa", "ativa e em andamento"],
    ["destrancar", "matricula_nao_trancada", "não está trancada"],
  ])("%s: hint %s", async (acao, hint, msg) => {
    const lib = await carregarComCliente(clienteFalso({ data: [], error: null }, { data: null, error: { message: "x", hint } }));
    const r =
      acao === "aprovar" ? await lib.aprovarMatricula("m1", null)
      : acao === "encerrar" ? await lib.encerrarMatricula("m1", HOJE)
      : acao === "trancar" ? await lib.trancarMatricula("m1")
      : await lib.destrancarMatricula("m1");
    expect(!r.sucesso && r.mensagem).toContain(msg);
  });
});
