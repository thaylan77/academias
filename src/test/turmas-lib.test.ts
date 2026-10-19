import { describe, it, expect, afterEach, vi } from "vitest";
import {
  conferirHorarios,
  descreverHorario,
  matriculaVigente,
  ordenarHorarios,
  podeGerirTurmas,
} from "../lib/turmas";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

describe("Horários", () => {
  it("aceita horários válidos, inclusive encostados no mesmo dia", () => {
    expect(conferirHorarios([
      { dia_semana: 1, hora_inicio: "10:00", hora_fim: "11:00" },
      { dia_semana: 1, hora_inicio: "11:00", hora_fim: "12:00" },
      { dia_semana: 3, hora_inicio: "10:30", hora_fim: "11:30" },
    ])).toBeNull();
  });

  it("aponta fim antes do início, hora vazia e dia fora da semana, por linha", () => {
    expect(conferirHorarios([
      { dia_semana: 1, hora_inicio: "11:00", hora_fim: "10:00" },
      { dia_semana: 2, hora_inicio: "", hora_fim: "10:00" },
      { dia_semana: 7, hora_inicio: "10:00", hora_fim: "11:00" },
    ])).toEqual({
      0: "O fim precisa ser depois do início.",
      1: "Informe início e fim.",
      2: "Escolha o dia.",
    });
  });

  it("aponta sobreposição no mesmo dia na segunda linha", () => {
    expect(conferirHorarios([
      { dia_semana: 2, hora_inicio: "10:00", hora_fim: "11:00" },
      { dia_semana: 2, hora_inicio: "10:30", hora_fim: "12:00" },
    ])).toEqual({ 1: "Sobrepõe o horário de terça das 10:00." });
  });

  it("ordena por dia e hora e descreve em português", () => {
    const h = ordenarHorarios([
      { dia_semana: 3, hora_inicio: "19:00", hora_fim: "20:00" },
      { dia_semana: 1, hora_inicio: "19:00", hora_fim: "20:00" },
      { dia_semana: 1, hora_inicio: "07:00", hora_fim: "08:00" },
    ]);
    expect(h.map(descreverHorario)).toEqual([
      "Segunda, 07:00 às 08:00", "Segunda, 19:00 às 20:00", "Quarta, 19:00 às 20:00",
    ]);
  });
});

describe("Regras de tela", () => {
  it("só dono e admin, com a assinatura em dia, gerem turmas e catálogo", () => {
    expect(podeGerirTurmas("dono", true)).toBe(true);
    expect(podeGerirTurmas("admin", true)).toBe(true);
    expect(podeGerirTurmas("professor", true)).toBe(false);
    expect(podeGerirTurmas("recepcao", true)).toBe(false);
    expect(podeGerirTurmas("dono", false)).toBe(false);
  });

  it("matrícula vigente: começou e não terminou no dia da academia", () => {
    const m = { matricula_id: "m", aluno_id: "a", nome: "A", status: "ativa", data_inicio: "2026-10-01", data_fim: null };
    expect(matriculaVigente(m, "2026-10-18")).toBe(true);
    expect(matriculaVigente({ ...m, data_inicio: "2026-10-19" }, "2026-10-18")).toBe(false);
    expect(matriculaVigente({ ...m, data_fim: "2026-10-18" }, "2026-10-18")).toBe(true);
    expect(matriculaVigente({ ...m, data_fim: "2026-10-17" }, "2026-10-18")).toBe(false);
  });
});

// ------------------------------------------------------------------ com cliente Supabase (falso)

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

function clienteFalso(respostas: Record<string, Resposta>) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order", "insert", "update", "maybeSingle", "single"]) {
      q[metodo] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return q;
      };
    }
    q.then = (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(respostas[tabela] ?? { data: null, error: null }).then(ok, falha);
    return q;
  });
  return { from, rpc: vi.fn(), chamadas, auth: { onAuthStateChange: vi.fn() } };
}

async function carregarComCliente(cliente: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(cliente);
  return import("../lib/turmas");
}

const ACADEMIA = "acad-a";
const TURMA = "fa000000-0000-4000-8000-0000000004a1";
const filtros = (chamadas: Chamada[], tabela: string) =>
  chamadas.filter((c) => c.tabela === tabela && c.metodo === "eq").map((c) => c.args);

const LINHA_TURMA = {
  id: TURMA, nome: "Adulto", modalidade_id: "mod", professor_id: "prof", publico: "adulto", capacidade: 20, ativa: true,
  modalidades: { nome: "Jiu-Jitsu" }, professores: { nome: "Mestre" },
  turma_horarios: [
    { dia_semana: 3, hora_inicio: "19:00:00", hora_fim: "20:30:00" },
    { dia_semana: 1, hora_inicio: "19:00:00", hora_fim: "20:30:00" },
  ],
};

describe("Dados (sempre filtrados pela academia selecionada)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lista: filtra por academia_id, junta modalidade, professor e horários (hora curta, em ordem)", async () => {
    const cliente = clienteFalso({ turmas: { data: [LINHA_TURMA], error: null } });
    const lib = await carregarComCliente(cliente);

    const [t] = await lib.listarTurmas(ACADEMIA);

    expect(filtros(cliente.chamadas, "turmas")).toEqual([["academia_id", ACADEMIA]]);
    expect(t).toMatchObject({ modalidade: "Jiu-Jitsu", professor: "Mestre", publico: "adulto" });
    expect(t.horarios).toEqual([
      { dia_semana: 1, hora_inicio: "19:00", hora_fim: "20:30" },
      { dia_semana: 3, hora_inicio: "19:00", hora_fim: "20:30" },
    ]);
  });

  it("catálogo: modalidades e professores da academia", async () => {
    const cliente = clienteFalso({ modalidades: { data: [], error: null }, professores: { data: [], error: null } });
    const lib = await carregarComCliente(cliente);
    await lib.lerCatalogo(ACADEMIA);
    expect(filtros(cliente.chamadas, "modalidades")).toEqual([["academia_id", ACADEMIA]]);
    expect(filtros(cliente.chamadas, "professores")).toEqual([["academia_id", ACADEMIA]]);
  });

  it("turma: filtra por academia e id; matriculados sem cancelada, por nome", async () => {
    const cliente = clienteFalso({
      turmas: { data: LINHA_TURMA, error: null },
      matricula_turmas: {
        data: [
          { matricula_id: "m2", matriculas: { id: "m2", status: "ativa", data_inicio: "2026-01-01", data_fim: null, aluno_id: "a2", alunos: { nome: "Zé" } } },
          { matricula_id: "m1", matriculas: { id: "m1", status: "trancada", data_inicio: "2026-01-01", data_fim: null, aluno_id: "a1", alunos: { nome: "Ana" } } },
          { matricula_id: "m3", matriculas: { id: "m3", status: "cancelada", data_inicio: "2026-01-01", data_fim: "2026-02-01", aluno_id: "a3", alunos: { nome: "Bia" } } },
        ],
        error: null,
      },
    });
    const lib = await carregarComCliente(cliente);

    const { matriculados } = await lib.lerTurma(ACADEMIA, TURMA);

    expect(filtros(cliente.chamadas, "turmas")).toEqual([["academia_id", ACADEMIA], ["id", TURMA]]);
    expect(filtros(cliente.chamadas, "matricula_turmas")).toEqual([["academia_id", ACADEMIA], ["turma_id", TURMA]]);
    expect(matriculados.map((m) => m.nome)).toEqual(["Ana", "Zé"]);
  });

  it("turma de outra academia (ou inexistente): não encontrada", async () => {
    const lib = await carregarComCliente(clienteFalso({ turmas: { data: null, error: null } }));
    await expect(lib.lerTurma(ACADEMIA, TURMA)).rejects.toBeInstanceOf(lib.TurmaNaoEncontrada);
  });

  it("erro de leitura propaga", async () => {
    const erro = { data: null, error: { message: "rede" } };
    let lib = await carregarComCliente(clienteFalso({ turmas: erro }));
    await expect(lib.listarTurmas(ACADEMIA)).rejects.toMatchObject({ message: "rede" });
    lib = await carregarComCliente(clienteFalso({ turmas: { data: LINHA_TURMA, error: null }, matricula_turmas: erro }));
    await expect(lib.lerTurma(ACADEMIA, TURMA)).rejects.toMatchObject({ message: "rede" });
  });

  const DADOS = {
    nome: "  Adulto  ", modalidade_id: "mod", professor_id: null, publico: "adulto" as const, capacidade: null, ativa: true,
    horarios: [{ dia_semana: 1, hora_inicio: "19:00", hora_fim: "20:00" }],
  };

  it("salvar: cria sem p_turma_id e edita com ele, sempre na academia selecionada", async () => {
    const cliente = clienteFalso({});
    cliente.rpc.mockResolvedValue({ data: TURMA, error: null });
    const lib = await carregarComCliente(cliente);

    expect(await lib.salvarTurma(ACADEMIA, DADOS)).toEqual({ sucesso: true, id: TURMA });
    expect(cliente.rpc).toHaveBeenLastCalledWith("salvar_turma", {
      p_academia_id: ACADEMIA,
      p_dados: { ...DADOS, nome: "Adulto" },
    });

    await lib.salvarTurma(ACADEMIA, DADOS, TURMA);
    expect(cliente.rpc).toHaveBeenLastCalledWith("salvar_turma", expect.objectContaining({ p_academia_id: ACADEMIA, p_turma_id: TURMA }));
  });

  it("salvar: cada hint vira uma mensagem; sem hint conhecido, a genérica", async () => {
    const casos: Array<[string | null, string]> = [
      ["sem_permissao", "Só o dono e a administração alteram turmas, e só com a assinatura da academia em dia."],
      ["horario_invalido", "Há horário inválido: confira o dia e se o fim é depois do início."],
      ["horario_sobreposto", "Há horários que se sobrepõem no mesmo dia."],
      ["turma_nao_encontrada", "Turma não encontrada nesta academia."],
      ["dados_invalidos", "Confira os dados da turma: nome, modalidade, professor, público e capacidade."],
      [null, "Não foi possível salvar. Verifique a conexão e tente de novo."],
    ];
    for (const [hint, mensagem] of casos) {
      const cliente = clienteFalso({});
      cliente.rpc.mockResolvedValue({ data: null, error: { hint, message: "texto do banco" } });
      const lib = await carregarComCliente(cliente);
      expect(await lib.salvarTurma(ACADEMIA, DADOS)).toEqual({ sucesso: false, mensagem });
    }
  });

  it("modalidade: nome duplicado (23505), sem permissão (42501 ou nenhuma linha) e nome vazio", async () => {
    let lib = await carregarComCliente(clienteFalso({ modalidades: { data: null, error: { code: "23505" } } }));
    expect(await lib.salvarModalidade(ACADEMIA, { nome: "Judô", ativa: true })).toEqual({
      sucesso: false, mensagem: "Já existe uma modalidade com esse nome.",
    });
    lib = await carregarComCliente(clienteFalso({ modalidades: { data: null, error: { code: "42501" } } }));
    expect(await lib.salvarModalidade(ACADEMIA, { nome: "Judô", ativa: true })).toMatchObject({ sucesso: false });
    lib = await carregarComCliente(clienteFalso({ modalidades: { data: null, error: null } }));
    expect(await lib.salvarModalidade(ACADEMIA, { nome: "Judô", ativa: true }, "m1")).toMatchObject({ sucesso: false });
    expect(await lib.salvarModalidade(ACADEMIA, { nome: " ", ativa: true })).toEqual({
      sucesso: false, mensagem: "Informe o nome da modalidade.",
    });
  });

  it("modalidade: cria com academia_id e edita filtrando por academia e id", async () => {
    const cliente = clienteFalso({ modalidades: { data: { id: "m1" }, error: null } });
    const lib = await carregarComCliente(cliente);
    await lib.salvarModalidade(ACADEMIA, { nome: " Judô ", ativa: true });
    expect(cliente.chamadas.find((c) => c.metodo === "insert")?.args[0]).toEqual({ academia_id: ACADEMIA, nome: "Judô", ativa: true });
    await lib.salvarModalidade(ACADEMIA, { nome: "Judô", ativa: false }, "m1");
    expect(filtros(cliente.chamadas, "modalidades")).toEqual([["academia_id", ACADEMIA], ["id", "m1"]]);
  });

  it("professor: telefone em E.164, e-mail conferido, grava na academia", async () => {
    const cliente = clienteFalso({ professores: { data: { id: "p1" }, error: null } });
    const lib = await carregarComCliente(cliente);

    expect(await lib.salvarProfessor(ACADEMIA, { nome: "Mestre", telefone: "(85) 99999-1234", email: "", ativo: true }))
      .toEqual({ sucesso: true, id: "p1" });
    expect(cliente.chamadas.find((c) => c.metodo === "insert")?.args[0]).toEqual({
      academia_id: ACADEMIA, nome: "Mestre", telefone: "5585999991234", email: null, ativo: true,
    });
    expect(await lib.salvarProfessor(ACADEMIA, { nome: "Mestre", telefone: "123", email: "", ativo: true }))
      .toEqual({ sucesso: false, mensagem: "Telefone com DDD, por exemplo (85) 99999-9999." });
    expect(await lib.salvarProfessor(ACADEMIA, { nome: "Mestre", telefone: "", email: "x@", ativo: true }))
      .toEqual({ sucesso: false, mensagem: "E-mail inválido." });
  });
});
