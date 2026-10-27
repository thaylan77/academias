import { describe, it, expect, afterEach, vi } from "vitest";
import { Progresso, filtrarProgresso, podeEditarFaixas, podeRegistrarGraduacao, validarFaixa } from "../lib/graduacoes";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

describe("Regras de tela", () => {
  it("registrar: dono, admin e professor com a assinatura em dia; recepção não", () => {
    expect(podeRegistrarGraduacao("professor", true)).toBe(true);
    expect(podeRegistrarGraduacao("admin", true)).toBe(true);
    expect(podeRegistrarGraduacao("dono", true)).toBe(true);
    expect(podeRegistrarGraduacao("recepcao", true)).toBe(false);
    expect(podeRegistrarGraduacao("professor", false)).toBe(false);
  });

  it("faixas: só dono e admin com a assinatura em dia", () => {
    expect(podeEditarFaixas("admin", true)).toBe(true);
    expect(podeEditarFaixas("professor", true)).toBe(false);
    expect(podeEditarFaixas("dono", false)).toBe(false);
  });

  it("faixa: confere nome, cor, ordem, graus e mínimos", () => {
    expect(validarFaixa({ nome: " Azul ", cor: "#1E40AF", ordem: "2", max_graus: "4", min_meses: "24", min_aulas: "200" }))
      .toEqual({ ok: true, dados: { nome: "Azul", cor: "#1E40AF", ordem: 2, max_graus: 4, min_meses: 24, min_aulas: 200 } });
    expect(validarFaixa({ nome: "Azul", cor: "", ordem: "1", max_graus: "0", min_meses: "0", min_aulas: "0" }))
      .toMatchObject({ ok: true, dados: { cor: null, max_graus: 0 } });
    const v = validarFaixa({ nome: "A", cor: "azul", ordem: "0", max_graus: "13", min_meses: "-1", min_aulas: "x" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.erros).sort()).toEqual(["cor", "max_graus", "min_aulas", "min_meses", "nome", "ordem"]);
  });

  it("filtro: modalidade, alunos da turma e só aptos", () => {
    const p = (aluno_id: string, modalidade_id: string, apto: boolean): Progresso => ({
      aluno_id, aluno: aluno_id, modalidade_id, faixa_id: null, faixa: "Branca", cor: null, grau: 0, graduado_em: "2026-01-01",
      proximo_passo: "grau 1", aulas_desde: 0, min_aulas: 0, meses_desde: 0, min_meses: 0, apto,
    });
    const lista = [p("a1", "jj", true), p("a2", "jj", false), p("a1", "mt", false)];
    expect(filtrarProgresso(lista, { modalidadeId: "jj", alunosDaTurma: null, soAptos: false })).toHaveLength(2);
    expect(filtrarProgresso(lista, { modalidadeId: null, alunosDaTurma: new Set(["a1"]), soAptos: false })).toHaveLength(2);
    expect(filtrarProgresso(lista, { modalidadeId: null, alunosDaTurma: null, soAptos: true }).map((x) => x.aluno_id)).toEqual(["a1"]);
  });
});

// ------------------------------------------------------------------ com cliente Supabase (falso)

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

function clienteFalso(respostas: Record<string, Resposta>) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order", "range", "insert", "update", "maybeSingle"]) {
      q[metodo] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return q;
      };
    }
    q.then = (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(respostas[tabela] ?? { data: [], error: null }).then(ok, falha);
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
  return import("../lib/graduacoes");
}

const ACADEMIA = "acad-a";
const filtros = (chamadas: Chamada[], tabela: string) =>
  chamadas.filter((c) => c.tabela === tabela && c.metodo === "eq").map((c) => c.args);

describe("Dados (sempre filtrados pela academia selecionada)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("progresso: lê as duas views da academia e junta a cor da faixa atual", async () => {
    const cliente = clienteFalso({
      vw_progresso_graduacao: {
        data: [{ aluno_id: "a1", aluno: "Ana", modalidade_id: "jj", faixa: "Azul", grau: 2, graduado_em: "2026-03-01",
                 proximo_passo: "grau 3", aulas_desde: 30, min_aulas: 40, meses_desde: 5, min_meses: 6, apto: false }],
        error: null,
      },
      vw_graduacao_atual: { data: [{ aluno_id: "a1", modalidade_id: "jj", faixa_id: "f-azul", cor: "#1E40AF" }], error: null },
    });
    const lib = await carregarComCliente(cliente);

    const [p] = await lib.listarProgresso(ACADEMIA);

    expect(filtros(cliente.chamadas, "vw_progresso_graduacao")).toEqual([["academia_id", ACADEMIA]]);
    expect(filtros(cliente.chamadas, "vw_graduacao_atual")).toEqual([["academia_id", ACADEMIA]]);
    expect(p).toMatchObject({ aluno: "Ana", faixa: "Azul", faixa_id: "f-azul", cor: "#1E40AF", grau: 2, apto: false });
  });

  it("progresso: em páginas de 1.000 e propaga erro", async () => {
    const mil = Array.from({ length: 1000 }, (_, i) => ({ aluno_id: `a${i}`, aluno: "x", modalidade_id: "jj", apto: false }));
    const cliente = clienteFalso({});
    let n = 0;
    cliente.from.mockImplementation((tabela: string) => {
      const q: Record<string, unknown> = {};
      let inicio = 0;
      for (const metodo of ["select", "eq", "order", "range"]) {
        q[metodo] = (...args: unknown[]) => {
          cliente.chamadas.push({ tabela, metodo, args });
          if (metodo === "range") inicio = args[0] as number;
          return q;
        };
      }
      q.then = (ok: (r: Resposta) => unknown) => {
        n++;
        const data = tabela === "vw_progresso_graduacao" ? (inicio === 0 ? mil : [mil[0]]) : [];
        return Promise.resolve({ data, error: null }).then(ok);
      };
      return q;
    });
    const lib = await carregarComCliente(cliente);
    expect(await lib.listarProgresso(ACADEMIA)).toHaveLength(1001);
    expect(cliente.chamadas.filter((c) => c.tabela === "vw_progresso_graduacao" && c.metodo === "range").map((c) => c.args))
      .toEqual([[0, 999], [1000, 1999]]);
    expect(n).toBe(3);

    const comErro = await carregarComCliente(clienteFalso({ vw_progresso_graduacao: { data: null, error: { message: "rede" } } }));
    await expect(comErro.listarProgresso(ACADEMIA)).rejects.toMatchObject({ message: "rede" });
  });

  it("faixas: da academia, por modalidade e ordem", async () => {
    const cliente = clienteFalso({ faixas: { data: [], error: null } });
    const lib = await carregarComCliente(cliente);
    await lib.lerFaixas(ACADEMIA);
    expect(filtros(cliente.chamadas, "faixas")).toEqual([["academia_id", ACADEMIA]]);
  });

  it("registrar: chama a RPC com a academia e trata cada hint", async () => {
    const dados = { aluno_id: "a1", faixa_id: "f1", grau: 1, data: "2026-10-19", professor_id: null, observacao: null };
    const casos: Array<[unknown, unknown, object]> = [
      ["g1", null, { sucesso: true, id: "g1" }],
      [null, { hint: "grau_invalido" }, { sucesso: false, mensagem: "Esse grau passa do máximo da faixa." }],
      [null, { hint: "sem_permissao" }, { sucesso: false, mensagem: "Só o dono, a administração e os professores registram graduações, e só com a assinatura em dia." }],
      [null, { hint: "graduacao_repetida" }, { sucesso: false, mensagem: "Esta graduação já foi registrada para o aluno nesta data." }],
      [null, { hint: "dados_invalidos" }, { sucesso: false, mensagem: "Confira o aluno (ativo), a faixa, o professor e a data (não pode ser no futuro)." }],
      [null, { hint: null, message: "texto do banco" }, { sucesso: false, mensagem: "Não foi possível salvar. Verifique a conexão e tente de novo." }],
    ];
    for (const [data, error, esperado] of casos) {
      const cliente = clienteFalso({});
      cliente.rpc.mockResolvedValue({ data, error });
      const lib = await carregarComCliente(cliente);
      expect(await lib.registrarGraduacao(ACADEMIA, dados)).toEqual(esperado);
      expect(cliente.rpc).toHaveBeenCalledWith("registrar_graduacao", { p_academia_id: ACADEMIA, p_dados: dados });
    }
  });

  it("faixa: cria com academia e modalidade, edita filtrando por academia e id, e trata os erros", async () => {
    const dados = { nome: "Azul", cor: null, ordem: 2, max_graus: 4, min_meses: 24, min_aulas: 200 };
    const cliente = clienteFalso({ faixas: { data: { id: "f2" }, error: null } });
    let lib = await carregarComCliente(cliente);
    expect(await lib.salvarFaixa(ACADEMIA, "jj", dados)).toEqual({ sucesso: true, id: "f2" });
    expect(cliente.chamadas.find((c) => c.metodo === "insert")?.args[0]).toEqual({ ...dados, academia_id: ACADEMIA, modalidade_id: "jj" });
    await lib.salvarFaixa(ACADEMIA, "jj", dados, "f2");
    expect(filtros(cliente.chamadas, "faixas")).toEqual([["academia_id", ACADEMIA], ["modalidade_id", "jj"], ["id", "f2"]]);
    expect(cliente.chamadas.find((c) => c.metodo === "update")?.args[0]).toEqual(dados);

    for (const [erro, mensagem] of [
      [{ code: "23505" }, "Já existe uma faixa nessa ordem nesta modalidade."],
      [{ code: "23514" }, "Confira os números da faixa."],
      [{ code: "23503" }, "A modalidade da faixa não está mais disponível nesta academia."],
      [{ code: "XX000" }, "Não foi possível salvar. Verifique a conexão e tente de novo."],
    ] as const) {
      lib = await carregarComCliente(clienteFalso({ faixas: { data: null, error: erro } }));
      expect(await lib.salvarFaixa(ACADEMIA, "jj", dados)).toEqual({ sucesso: false, mensagem });
    }
    lib = await carregarComCliente(clienteFalso({ faixas: { data: null, error: null } }));
    expect(await lib.salvarFaixa(ACADEMIA, "jj", dados, "f2")).toMatchObject({ sucesso: false });
  });
});

describe("Cobertura pedida na primeira revisão", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("permissões: todos os papéis, com e sem a assinatura em dia", () => {
    expect(podeEditarFaixas("dono", true)).toBe(true);
    expect(podeEditarFaixas("recepcao", true)).toBe(false);
    expect(podeEditarFaixas("admin", false)).toBe(false);
    expect(podeRegistrarGraduacao("admin", false)).toBe(false);
    expect(podeRegistrarGraduacao("dono", false)).toBe(false);
  });

  it("vw_graduacao_atual e faixas também em páginas; erro em vw_graduacao_atual propaga", async () => {
    const mil = (tabela: string) => Array.from({ length: 1000 }, (_, i) => ({ aluno_id: `a${i}`, modalidade_id: "jj", id: `${tabela}${i}` }));
    const cliente = clienteFalso({});
    cliente.from.mockImplementation((tabela: string) => {
      const q: Record<string, unknown> = {};
      let inicio = 0;
      for (const metodo of ["select", "eq", "order", "range"]) {
        q[metodo] = (...args: unknown[]) => {
          cliente.chamadas.push({ tabela, metodo, args });
          if (metodo === "range") inicio = args[0] as number;
          return q;
        };
      }
      q.then = (ok: (r: Resposta) => unknown) =>
        Promise.resolve({ data: inicio === 0 ? mil(tabela) : [], error: null }).then(ok);
      return q;
    });
    const lib = await carregarComCliente(cliente);
    await lib.listarProgresso(ACADEMIA);
    expect(await lib.lerFaixas(ACADEMIA)).toHaveLength(1000);
    const paginas = (t: string) => cliente.chamadas.filter((c) => c.tabela === t && c.metodo === "range").length;
    expect(paginas("vw_graduacao_atual")).toBe(2);
    expect(paginas("faixas")).toBe(2);

    const comErro = await carregarComCliente(clienteFalso({ vw_graduacao_atual: { data: null, error: { message: "rede" } } }));
    await expect(comErro.listarProgresso(ACADEMIA)).rejects.toMatchObject({ message: "rede" });
  });

  it("faixa: a sequência de métodos de cada gravação", async () => {
    const dados = { nome: "Azul", cor: null, ordem: 2, max_graus: 4, min_meses: 24, min_aulas: 200 };
    let cliente = clienteFalso({ faixas: { data: { id: "f2" }, error: null } });
    let lib = await carregarComCliente(cliente);
    await lib.salvarFaixa(ACADEMIA, "jj", dados);
    expect(cliente.chamadas.map((c) => c.metodo)).toEqual(["insert", "select", "maybeSingle"]);

    cliente = clienteFalso({ faixas: { data: { id: "f2" }, error: null } });
    lib = await carregarComCliente(cliente);
    await lib.salvarFaixa(ACADEMIA, "jj", dados, "f2");
    expect(cliente.chamadas.map((c) => c.metodo)).toEqual(["update", "eq", "eq", "eq", "select", "maybeSingle"]);
  });
});
