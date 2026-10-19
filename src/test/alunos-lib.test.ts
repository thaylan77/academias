import { describe, it, expect, afterEach, vi } from "vitest";
import {
  AlunoResumo,
  cpfValido,
  filtrarAlunos,
  formularioVazio,
  idadeEm,
  podeAnonimizar,
  podeEditarAlunos,
  podeVerFinanceiro,
  telefoneE164,
  validarAluno,
} from "../lib/alunos";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const CPF_OK = "52998224725";
const CPF_RESP = "11144477735";

describe("Formatos", () => {
  it("CPF: só 11 dígitos com verificadores certos", () => {
    expect(cpfValido(CPF_OK)).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("123")).toBe(false);
  });

  it("telefone vira E.164 (55 + DDD + número); sem o 55, acrescenta", () => {
    expect(telefoneE164("(85) 99999-1234")).toBe("5585999991234");
    expect(telefoneE164("85 3333-1234")).toBe("558533331234");
    expect(telefoneE164("+55 85 99999-1234")).toBe("5585999991234");
    expect(telefoneE164("99999-1234")).toBeNull();
  });

  it("idade completa no dia", () => {
    expect(idadeEm("2008-10-19", "2026-10-18")).toBe(17);
    expect(idadeEm("2008-10-18", "2026-10-18")).toBe(18);
    expect(idadeEm(null, "2026-10-18")).toBeNull();
  });
});

describe("Validação do formulário", () => {
  const HOJE = "2026-10-18";

  it("normaliza CPF e telefone para só dígitos e limpa campos vazios", () => {
    const f = { ...formularioVazio(), nome: "  Ana   Souza ", cpf: "529.982.247-25", telefone: "(85) 99999-1234" };
    const v = validarAluno(f, HOJE);
    expect(v).toMatchObject({
      ok: true,
      dados: { nome: "Ana Souza", cpf: CPF_OK, telefone: "5585999991234", email: null, data_nascimento: null, status: "ativo" },
    });
  });

  it("aponta cada campo inválido", () => {
    const f = { ...formularioVazio(), nome: "A", cpf: "123", telefone: "123", email: "x@", data_nascimento: "2030-01-01" };
    const v = validarAluno(f, HOJE);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.erros).sort()).toEqual(["cpf", "data_nascimento", "email", "nome", "telefone"]);
  });

  it("menor de 18 anos precisa de nome e CPF do responsável (mesma regra da matrícula online)", () => {
    const menor = { ...formularioVazio(), nome: "Pedro", data_nascimento: "2015-05-01" };
    const v = validarAluno(menor, HOJE);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.erros).sort()).toEqual(["responsavel_cpf", "responsavel_nome"]);

    const comResponsavel = { ...menor, responsavel_nome: "Maria", responsavel_cpf: CPF_RESP };
    expect(validarAluno(comResponsavel, HOJE).ok).toBe(true);

    const adulto = { ...formularioVazio(), nome: "Joana", data_nascimento: "1990-05-01" };
    expect(validarAluno(adulto, HOJE).ok).toBe(true);
  });
});

describe("Busca e filtro", () => {
  const LISTA: AlunoResumo[] = [
    { id: "1", nome: "João Araújo", cpf: CPF_OK, telefone: null, data_nascimento: null, situacao: "ativo" },
    { id: "2", nome: "Maria Silva", cpf: null, telefone: null, data_nascimento: null, situacao: "pendente" },
    { id: "3", nome: "Aluno anonimizado", cpf: null, telefone: null, data_nascimento: null, situacao: "anonimizado" },
  ];

  it("por nome sem acento nem maiúscula, e por CPF com ou sem máscara", () => {
    expect(filtrarAlunos(LISTA, "joao araujo", "todas").map((a) => a.id)).toEqual(["1"]);
    expect(filtrarAlunos(LISTA, "529.982", "todas").map((a) => a.id)).toEqual(["1"]);
    expect(filtrarAlunos(LISTA, "", "todas")).toHaveLength(3);
  });

  it("por situação, inclusive anonimizado", () => {
    expect(filtrarAlunos(LISTA, "", "pendente").map((a) => a.id)).toEqual(["2"]);
    expect(filtrarAlunos(LISTA, "", "anonimizado").map((a) => a.id)).toEqual(["3"]);
  });
});

describe("O que a tela mostra para cada papel (o banco é quem protege)", () => {
  it("cria e edita: dono, admin e recepção, só com a assinatura em dia", () => {
    expect(podeEditarAlunos("recepcao", true)).toBe(true);
    expect(podeEditarAlunos("admin", true)).toBe(true);
    expect(podeEditarAlunos("professor", true)).toBe(false);
    expect(podeEditarAlunos("dono", false)).toBe(false);
  });

  it("anonimiza: dono e admin, mesmo com a academia suspensa", () => {
    expect(podeAnonimizar("dono")).toBe(true);
    expect(podeAnonimizar("admin")).toBe(true);
    expect(podeAnonimizar("recepcao")).toBe(false);
    expect(podeAnonimizar("professor")).toBe(false);
  });

  it("situação financeira: quem lê cobranças", () => {
    expect(podeVerFinanceiro("recepcao")).toBe(true);
    expect(podeVerFinanceiro("professor")).toBe(false);
  });
});

// ------------------------------------------------------------------ com cliente Supabase (falso)

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

/** Cliente falso: registra cada chamada e responde por tabela. */
function clienteFalso(respostas: Record<string, Resposta | ((chamadas: Chamada[]) => Resposta)>) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const minhas: Chamada[] = [];
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order", "insert", "update", "maybeSingle", "single"]) {
      q[metodo] = (...args: unknown[]) => {
        const c = { tabela, metodo, args };
        chamadas.push(c);
        minhas.push(c);
        return q;
      };
    }
    q.then = (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) => {
      const r = respostas[tabela];
      const valor = typeof r === "function" ? r(minhas) : r ?? { data: null, error: null };
      return Promise.resolve(valor).then(ok, falha);
    };
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
  return import("../lib/alunos");
}

const ACADEMIA = "acad-a";
const ALUNO = "f9000000-0000-4000-8000-0000000001a1";
const filtros = (chamadas: Chamada[], tabela: string) =>
  chamadas.filter((c) => c.tabela === tabela && c.metodo === "eq").map((c) => c.args);

const LINHA_ALUNO = {
  id: ALUNO, nome: "Ana", cpf: CPF_OK, data_nascimento: null, telefone: null, email: null,
  responsavel_nome: null, responsavel_cpf: null, responsavel_telefone: null,
  contato_emergencia: null, observacoes_medicas: null, status: "ativo", anonimizado_em: null,
};

describe("Dados (sempre filtrados pela academia selecionada)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lista: filtra por academia_id e marca anonimizados", async () => {
    const cliente = clienteFalso({
      alunos: {
        data: [
          { ...LINHA_ALUNO },
          { ...LINHA_ALUNO, id: "x", nome: "Aluno anonimizado", cpf: null, status: "inativo", anonimizado_em: "2026-10-01T00:00:00Z" },
        ],
        error: null,
      },
    });
    const lib = await carregarComCliente(cliente);

    const lista = await lib.listarAlunos(ACADEMIA);

    expect(filtros(cliente.chamadas, "alunos")).toEqual([["academia_id", ACADEMIA]]);
    expect(lista.map((a) => a.situacao)).toEqual(["ativo", "anonimizado"]);
  });

  it("ficha: aluno, matrículas e cobranças, todos filtrados por academia_id e aluno_id", async () => {
    const cliente = clienteFalso({
      alunos: { data: LINHA_ALUNO, error: null },
      matriculas: {
        data: [{ id: "m1", status: "ativa", data_inicio: "2026-01-01", data_fim: null, valor: "150.00",
                 planos: { nome: "Mensal" }, matricula_turmas: [{ turmas: { nome: "Adulto" } }] }],
        error: null,
      },
      cobrancas: { data: [{ valor: "150.00" }, { valor: "150.00" }], error: null },
      vw_inadimplentes: { data: { cobrancas_atrasadas: 1, total_atrasado: "150.00" }, error: null },
    });
    const lib = await carregarComCliente(cliente);

    const ficha = await lib.lerFichaDoAluno(ACADEMIA, ALUNO, true);

    expect(filtros(cliente.chamadas, "alunos")).toEqual([["academia_id", ACADEMIA], ["id", ALUNO]]);
    expect(filtros(cliente.chamadas, "matriculas")).toEqual([["academia_id", ACADEMIA], ["aluno_id", ALUNO]]);
    expect(filtros(cliente.chamadas, "cobrancas")).toEqual([["academia_id", ACADEMIA], ["aluno_id", ALUNO], ["status", "pendente"]]);
    expect(filtros(cliente.chamadas, "vw_inadimplentes")).toEqual([["academia_id", ACADEMIA], ["aluno_id", ALUNO]]);
    expect(ficha.matriculas).toEqual([
      { id: "m1", status: "ativa", data_inicio: "2026-01-01", data_fim: null, valor: 150, plano: "Mensal", turmas: ["Adulto"] },
    ]);
    expect(ficha.financeiro).toEqual({ pendentes: 2, totalPendente: 300, atrasadas: 1, totalAtrasado: 150 });
  });

  it("ficha para quem não lê cobranças: nem consulta o financeiro", async () => {
    const cliente = clienteFalso({ alunos: { data: LINHA_ALUNO, error: null }, matriculas: { data: [], error: null } });
    const lib = await carregarComCliente(cliente);

    const ficha = await lib.lerFichaDoAluno(ACADEMIA, ALUNO, false);

    expect(ficha.financeiro).toBeNull();
    expect(cliente.from).not.toHaveBeenCalledWith("cobrancas");
    expect(cliente.from).not.toHaveBeenCalledWith("vw_inadimplentes");
  });

  it("ficha de aluno de outra academia (ou inexistente): não encontrado", async () => {
    const cliente = clienteFalso({ alunos: { data: null, error: null } });
    const lib = await carregarComCliente(cliente);
    await expect(lib.lerFichaDoAluno(ACADEMIA, ALUNO, true)).rejects.toBeInstanceOf(lib.AlunoNaoEncontrado);
  });

  it("cadastro novo grava com o academia_id da academia selecionada", async () => {
    const cliente = clienteFalso({ alunos: { data: { id: "novo-id" }, error: null } });
    const lib = await carregarComCliente(cliente);
    const v = lib.validarAluno({ ...lib.formularioVazio(), nome: "Ana" }, "2026-10-18");
    if (!v.ok) throw new Error("formulário deveria passar");

    expect(await lib.salvarAluno(ACADEMIA, v.dados)).toEqual({ sucesso: true, id: "novo-id" });
    const insert = cliente.chamadas.find((c) => c.metodo === "insert");
    expect(insert?.args[0]).toMatchObject({ academia_id: ACADEMIA, nome: "Ana" });
  });

  it("edição filtra por academia_id e id; sem linha devolvida é falta de permissão", async () => {
    const cliente = clienteFalso({ alunos: { data: null, error: null } });
    const lib = await carregarComCliente(cliente);
    const v = lib.validarAluno({ ...lib.formularioVazio(), nome: "Ana" }, "2026-10-18");
    if (!v.ok) throw new Error("formulário deveria passar");

    const res = await lib.salvarAluno(ACADEMIA, v.dados, ALUNO);

    expect(filtros(cliente.chamadas, "alunos")).toEqual([["academia_id", ACADEMIA], ["id", ALUNO]]);
    expect(res).toEqual({
      sucesso: false,
      mensagem: "Não foi possível salvar: seu papel não altera alunos, ou a assinatura da academia está suspensa.",
    });
  });

  it("erros ao salvar decididos por hint e código, nunca pelo texto", async () => {
    const casos: Array<[object, string]> = [
      [{ hint: "cpf_duplicado", code: "P0001", message: "qualquer texto" }, "Já existe um aluno com esse CPF nesta academia."],
      [{ hint: "aluno_anonimizado", code: "P0001", message: "x" }, "Este cadastro foi anonimizado e não pode mais ser alterado."],
      [{ hint: null, code: "42501", message: "new row violates row-level security policy" },
        "Não foi possível salvar: seu papel não altera alunos, ou a assinatura da academia está suspensa."],
      [{ hint: null, code: "23505", message: "duplicate key" }, "Já existe um aluno com esse CPF nesta academia."],
      [{ hint: null, code: "XX000", message: "Já existe um aluno com esse CPF" },
        "Não foi possível salvar o aluno. Verifique a conexão e tente de novo."],
    ];
    for (const [erro, mensagem] of casos) {
      const cliente = clienteFalso({ alunos: { data: null, error: erro } });
      const lib = await carregarComCliente(cliente);
      const v = lib.validarAluno({ ...lib.formularioVazio(), nome: "Ana" }, "2026-10-18");
      if (!v.ok) throw new Error("formulário deveria passar");
      expect(await lib.salvarAluno(ACADEMIA, v.dados)).toEqual({ sucesso: false, mensagem });
    }
  });

  it("anonimizar chama a RPC e trata os hints", async () => {
    const casos: Array<[unknown, object]> = [
      [null, { sucesso: true }],
      [{ hint: "anonimizar_cobranca_pendente" }, { sucesso: false, mensagem: "Cancele ou dê baixa nas cobranças pendentes do aluno antes de anonimizar." }],
      [{ hint: "sem_permissao" }, { sucesso: false, mensagem: "Só o dono e a administração podem anonimizar alunos." }],
    ];
    for (const [erro, esperado] of casos) {
      const cliente = clienteFalso({});
      cliente.rpc.mockResolvedValue({ data: null, error: erro });
      const lib = await carregarComCliente(cliente);
      expect(await lib.anonimizarAluno(ALUNO)).toEqual(esperado);
      expect(cliente.rpc).toHaveBeenCalledWith("anonimizar_aluno", { p_aluno_id: ALUNO });
    }
  });
});
