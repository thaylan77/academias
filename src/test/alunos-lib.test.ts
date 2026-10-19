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
    for (const metodo of ["select", "eq", "order", "range", "insert", "update", "maybeSingle", "single"]) {
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
      mensagem: "Não foi possível salvar: o aluno não está nesta academia, seu papel não altera alunos, ou a assinatura está suspensa.",
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

describe("Cobertura pedida na primeira revisão", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hoje é o dia no fuso da academia, não no do navegador", async () => {
    const { hojeNoFuso } = await import("../lib/alunos");
    const instante = new Date("2026-10-19T02:00:00Z");
    expect(hojeNoFuso("America/Fortaleza", instante)).toBe("2026-10-18");
    expect(hojeNoFuso("Asia/Tokyo", instante)).toBe("2026-10-19");
    expect(hojeNoFuso("Fuso/Inexistente", instante)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("data de nascimento que não existe no calendário é recusada", () => {
    for (const data of ["2010-02-31", "2010-13-01", "1850-01-01"]) {
      const v = validarAluno({ ...formularioVazio(), nome: "Ana", data_nascimento: data }, "2026-10-18");
      expect(v.ok, data).toBe(false);
    }
  });

  it("responsável: telefone em E.164, CPF conferido, vazios viram null", () => {
    const f = {
      ...formularioVazio(), nome: "Pedro", data_nascimento: "2015-05-01",
      responsavel_nome: " Maria ", responsavel_cpf: "111.444.777-35", responsavel_telefone: "(55) 99999-1234",
      contato_emergencia: "   ", observacoes_medicas: "",
    };
    expect(validarAluno(f, "2026-10-18")).toMatchObject({
      ok: true,
      dados: {
        responsavel_nome: "Maria", responsavel_cpf: CPF_RESP,
        // DDD 55 (RS) sem o código do país: vira 55 + 55 + número.
        responsavel_telefone: "5555999991234",
        contato_emergencia: null, observacoes_medicas: null,
      },
    });
    const ruim = validarAluno({ ...f, responsavel_cpf: "11144477734", responsavel_telefone: "1234" }, "2026-10-18");
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(Object.keys(ruim.erros).sort()).toEqual(["responsavel_cpf", "responsavel_telefone"]);
  });

  it("permissões: ninguém cria ou edita com a academia suspensa; dono e admin veem o financeiro", () => {
    for (const papel of ["dono", "admin", "recepcao", "professor"] as const) {
      expect(podeEditarAlunos(papel, false), papel).toBe(false);
    }
    expect(podeEditarAlunos("dono", true)).toBe(true);
    expect(podeVerFinanceiro("dono")).toBe(true);
    expect(podeVerFinanceiro("admin")).toBe(true);
  });

  it("lista: só as colunas da lista (sem dados sensíveis) e em páginas de 1.000", async () => {
    const pagina1 = Array.from({ length: 1000 }, (_, i) => ({ ...LINHA_ALUNO, id: `a${i}`, nome: `Aluno ${i}` }));
    const pagina2 = [{ ...LINHA_ALUNO, id: "z", nome: "Zé" }];
    const cliente = clienteFalso({
      alunos: (minhas) => {
        const r = minhas.find((c) => c.metodo === "range");
        return { data: r?.args[0] === 0 ? pagina1 : pagina2, error: null };
      },
    });
    const lib = await carregarComCliente(cliente);

    const lista = await lib.listarAlunos(ACADEMIA);

    expect(lista).toHaveLength(1001);
    expect(cliente.chamadas.filter((c) => c.metodo === "range").map((c) => c.args)).toEqual([[0, 999], [1000, 1999]]);
    const colunas = String(cliente.chamadas.find((c) => c.metodo === "select")?.args[0]);
    expect(colunas).toContain("anonimizado_em");
    expect(colunas).not.toContain("observacoes_medicas");
    expect(colunas).not.toContain("*");
  });

  it("ficha: pede as colunas pelo nome, nunca *", async () => {
    const cliente = clienteFalso({ alunos: { data: LINHA_ALUNO, error: null }, matriculas: { data: [], error: null } });
    const lib = await carregarComCliente(cliente);
    await lib.lerFichaDoAluno(ACADEMIA, ALUNO, false);
    const colunas = String(cliente.chamadas.find((c) => c.tabela === "alunos" && c.metodo === "select")?.args[0]);
    expect(colunas).toContain("anonimizado_em");
    expect(colunas).not.toContain("*");
    expect(colunas).not.toContain("user_id");
  });

  it("ficha: aluno em dia (sem linha na vw_inadimplentes) mostra zero em atraso", async () => {
    const cliente = clienteFalso({
      alunos: { data: LINHA_ALUNO, error: null },
      matriculas: { data: [], error: null },
      cobrancas: { data: [], error: null },
      vw_inadimplentes: { data: null, error: null },
    });
    const lib = await carregarComCliente(cliente);
    expect((await lib.lerFichaDoAluno(ACADEMIA, ALUNO, true)).financeiro).toEqual({
      pendentes: 0, totalPendente: 0, atrasadas: 0, totalAtrasado: 0,
    });
  });

  it("erro em qualquer leitura propaga (nunca mostra zero pendências por engano)", async () => {
    const erro = { error: { message: "rede" }, data: null };
    const ok = { data: [], error: null };
    const casos: Array<Record<string, Resposta>> = [
      { alunos: erro },
      { alunos: { data: LINHA_ALUNO, error: null }, matriculas: erro },
      { alunos: { data: LINHA_ALUNO, error: null }, matriculas: ok, cobrancas: erro, vw_inadimplentes: { data: null, error: null } },
      { alunos: { data: LINHA_ALUNO, error: null }, matriculas: ok, cobrancas: ok, vw_inadimplentes: erro },
    ];
    for (const respostas of casos) {
      const lib = await carregarComCliente(clienteFalso(respostas));
      await expect(lib.lerFichaDoAluno(ACADEMIA, ALUNO, true)).rejects.toMatchObject({ message: "rede" });
    }
    const lib = await carregarComCliente(clienteFalso({ alunos: erro }));
    await expect(lib.listarAlunos(ACADEMIA)).rejects.toMatchObject({ message: "rede" });
  });

  it("cadastro: insert em alunos e pede o id de volta", async () => {
    const cliente = clienteFalso({ alunos: { data: { id: "novo-id" }, error: null } });
    const lib = await carregarComCliente(cliente);
    const v = lib.validarAluno({ ...lib.formularioVazio(), nome: "Ana" }, "2026-10-18");
    if (!v.ok) throw new Error("formulário deveria passar");

    await lib.salvarAluno(ACADEMIA, v.dados);

    const metodos = cliente.chamadas.map((c) => `${c.tabela}.${c.metodo}`);
    expect(metodos).toEqual(["alunos.insert", "alunos.select", "alunos.single"]);
    expect(cliente.chamadas[1].args).toEqual(["id"]);
  });

  it("edição: update com só as colunas do formulário (nada de academia_id, user_id ou anonimizado_em)", async () => {
    const cliente = clienteFalso({ alunos: { data: { id: ALUNO }, error: null } });
    const lib = await carregarComCliente(cliente);
    const v = lib.validarAluno({ ...lib.formularioVazio(), nome: "Ana" }, "2026-10-18");
    if (!v.ok) throw new Error("formulário deveria passar");

    expect(await lib.salvarAluno(ACADEMIA, v.dados, ALUNO)).toEqual({ sucesso: true, id: ALUNO });

    const update = cliente.chamadas.find((c) => c.metodo === "update");
    expect(cliente.chamadas.some((c) => c.metodo === "insert")).toBe(false);
    expect(Object.keys(update?.args[0] as object).sort()).toEqual([
      "contato_emergencia", "cpf", "data_nascimento", "email", "nome", "observacoes_medicas",
      "responsavel_cpf", "responsavel_nome", "responsavel_telefone", "status", "telefone",
    ]);
  });

  it("anonimizar: erro sem hint conhecido dá mensagem genérica, sem repassar o texto do banco", async () => {
    const cliente = clienteFalso({});
    cliente.rpc.mockResolvedValue({ data: null, error: { hint: null, code: "XX000", message: "texto interno do banco" } });
    const lib = await carregarComCliente(cliente);
    expect(await lib.anonimizarAluno(ALUNO)).toEqual({
      sucesso: false,
      mensagem: "Não foi possível anonimizar. Verifique a conexão e tente de novo.",
    });
  });
});
