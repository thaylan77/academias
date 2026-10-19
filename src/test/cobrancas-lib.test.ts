import { describe, it, expect, afterEach, vi } from "vitest";
import {
  Cobranca,
  aceitaAcaoManual,
  diaNoFuso,
  estaVencida,
  filtrarCobrancas,
  lerValor,
  meioDiaNoFuso,
  podeGerirCobrancas,
  podeVerCobrancas,
  textoDivergencia,
  validarBaixa,
} from "../lib/cobrancas";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const cob = (extra: Partial<Cobranca> = {}): Cobranca => ({
  id: "c1", aluno_id: "a1", aluno: "Ana Souza", matricula_id: "m1", competencia: "2026-10-01", descricao: "Mensal — 10/2026",
  valor: 150, vencimento: "2026-10-10", status: "pendente", pago_em: null, valor_pago: null, forma_pagamento: null,
  baixa_em: null, emitida: false, divergencia: null, ...extra,
});

describe("Regras de tela", () => {
  it("financeiro: dono, admin e recepção; professor não", () => {
    for (const papel of ["dono", "admin", "recepcao"] as const) expect(podeVerCobrancas(papel)).toBe(true);
    expect(podeVerCobrancas("professor")).toBe(false);
  });

  it("baixar, cancelar e gerar: só com a assinatura em dia", () => {
    expect(podeGerirCobrancas("recepcao", true)).toBe(true);
    expect(podeGerirCobrancas("dono", false)).toBe(false);
    expect(podeGerirCobrancas("professor", true)).toBe(false);
  });

  it("ação manual só para pendente nunca emitida no gateway", () => {
    expect(aceitaAcaoManual(cob())).toBe(true);
    expect(aceitaAcaoManual(cob({ emitida: true }))).toBe(false);
    expect(aceitaAcaoManual(cob({ status: "paga" }))).toBe(false);
    expect(aceitaAcaoManual(cob({ status: "cancelada" }))).toBe(false);
  });

  it("vencida: pendente com vencimento antes de hoje (dia da academia)", () => {
    expect(estaVencida(cob({ vencimento: "2026-10-18" }), "2026-10-19")).toBe(true);
    expect(estaVencida(cob({ vencimento: "2026-10-19" }), "2026-10-19")).toBe(false);
    expect(estaVencida(cob({ vencimento: "2026-10-01", status: "paga" }), "2026-10-19")).toBe(false);
  });

  it("filtros: situação (inclusive vencida), competência e aluno sem acento", () => {
    const lista = [
      cob(),
      cob({ id: "c2", aluno: "Bruno Araújo", status: "paga", competencia: "2026-09-01" }),
      cob({ id: "c3", vencimento: "2026-10-30" }),
    ];
    const hoje = "2026-10-19";
    expect(filtrarCobrancas(lista, { situacao: "vencida", competencia: "", aluno: "" }, hoje).map((c) => c.id)).toEqual(["c1"]);
    expect(filtrarCobrancas(lista, { situacao: "paga", competencia: "", aluno: "" }, hoje).map((c) => c.id)).toEqual(["c2"]);
    expect(filtrarCobrancas(lista, { situacao: "todas", competencia: "2026-09", aluno: "" }, hoje).map((c) => c.id)).toEqual(["c2"]);
    expect(filtrarCobrancas(lista, { situacao: "todas", competencia: "", aluno: "araujo" }, hoje).map((c) => c.id)).toEqual(["c2"]);
  });

  it("divergência: texto pelo código, com padrão para código novo", () => {
    expect(textoDivergencia("pagamento_duplicado")).toBe("Pagamento em duplicidade no gateway");
    expect(textoDivergencia("codigo_novo")).toBe("Divergência com o gateway");
  });
});

describe("Dinheiro e datas", () => {
  it("valor digitado com vírgula e milhar vira número com 2 casas", () => {
    expect(lerValor("150")).toBe(150);
    expect(lerValor("150,5")).toBe(150.5);
    expect(lerValor("1.234,56")).toBe(1234.56);
    expect(lerValor("0")).toBeNull();
    expect(lerValor("12,345")).toBeNull();
    expect(lerValor("abc")).toBeNull();
  });

  it("meio-dia no fuso da academia, para o banco não ler o dia anterior", () => {
    expect(meioDiaNoFuso("2026-10-19", "America/Fortaleza")).toBe("2026-10-19T12:00:00-03:00");
    expect(meioDiaNoFuso("2026-10-19", "UTC")).toBe("2026-10-19T12:00:00+00:00");
    expect(meioDiaNoFuso("2026-10-19", "Fuso/Inexistente")).toBe("2026-10-19T12:00:00+00:00");
  });

  it("baixa: forma, data não futura e valor opcional", () => {
    const hoje = "2026-10-19";
    expect(validarBaixa({ forma: "pix", data: "2026-10-19", valor: "" }, hoje)).toEqual({ ok: true, dados: { forma: "pix", data: "2026-10-19", valorPago: null } });
    expect(validarBaixa({ forma: "pix", data: "2026-10-18", valor: "140,00" }, hoje)).toMatchObject({ ok: true, dados: { valorPago: 140 } });
    expect(validarBaixa({ forma: "cheque", data: hoje, valor: "" }, hoje)).toEqual({ ok: false, mensagem: "Escolha a forma de pagamento." });
    expect(validarBaixa({ forma: "pix", data: "", valor: "" }, hoje)).toEqual({ ok: false, mensagem: "Informe a data do pagamento." });
    expect(validarBaixa({ forma: "pix", data: "2026-10-20", valor: "" }, hoje)).toEqual({ ok: false, mensagem: "A data do pagamento não pode ser no futuro." });
    expect(validarBaixa({ forma: "pix", data: hoje, valor: "-5" }, hoje)).toEqual({ ok: false, mensagem: "Valor pago inválido." });
  });
});

// ------------------------------------------------------------------ com cliente Supabase (falso)

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

function clienteFalso(respostas: Record<string, Resposta>) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order", "range"]) {
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
  return import("../lib/cobrancas");
}

const ACADEMIA = "acad-a";
const filtros = (chamadas: Chamada[], tabela: string) =>
  chamadas.filter((c) => c.tabela === tabela && c.metodo === "eq").map((c) => c.args);

describe("Dados (sempre filtrados pela academia selecionada)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cobranças: da academia, com valor numérico e 'emitida' pelo gateway_id ou pela emissão iniciada", async () => {
    const linha = { id: "c1", aluno_id: "a1", matricula_id: null, competencia: "2026-10-01", descricao: null, valor: "150.00",
      vencimento: "2026-10-10", status: "pendente", pago_em: null, valor_pago: null, forma_pagamento: null, baixa_em: null,
      gateway_id: null, emissao_iniciada_em: null, divergencia: null, alunos: { nome: "Ana" } };
    const cliente = clienteFalso({ cobrancas: { data: [linha, { ...linha, id: "c2", gateway_id: "pay_1" }, { ...linha, id: "c3", emissao_iniciada_em: "2026-10-01T10:00:00Z" }], error: null } });
    const lib = await carregarComCliente(cliente);

    const lista = await lib.listarCobrancas(ACADEMIA);

    expect(filtros(cliente.chamadas, "cobrancas")).toEqual([["academia_id", ACADEMIA]]);
    expect(lista.map((c) => [c.valor, c.emitida])).toEqual([[150, false], [150, true], [150, true]]);
    expect(lista[0].aluno).toBe("Ana");
  });

  it("inadimplentes e matrículas ativas: da academia; erro propaga", async () => {
    const cliente = clienteFalso({});
    const lib = await carregarComCliente(cliente);
    await lib.listarInadimplentes(ACADEMIA);
    await lib.listarMatriculasAtivas(ACADEMIA);
    expect(filtros(cliente.chamadas, "vw_inadimplentes")).toEqual([["academia_id", ACADEMIA]]);
    expect(filtros(cliente.chamadas, "matriculas")).toEqual([["academia_id", ACADEMIA], ["status", "ativa"]]);

    const comErro = await carregarComCliente(clienteFalso({ cobrancas: { data: null, error: { message: "rede" } } }));
    await expect(comErro.listarCobrancas(ACADEMIA)).rejects.toMatchObject({ message: "rede" });
  });

  it("baixa: manda forma, meio-dia no fuso e valor só quando informado; recusa vira mensagem genérica", async () => {
    const cliente = clienteFalso({});
    cliente.rpc.mockResolvedValue({ data: null, error: null });
    let lib = await carregarComCliente(cliente);

    expect(await lib.baixarCobranca("c1", { forma: "pix", data: "2026-10-19", valorPago: null }, "America/Fortaleza")).toEqual({ sucesso: true });
    expect(cliente.rpc).toHaveBeenLastCalledWith("baixar_cobranca_manual", {
      p_cobranca_id: "c1", p_forma: "pix", p_pago_em: "2026-10-19T12:00:00-03:00",
    });
    await lib.baixarCobranca("c1", { forma: "dinheiro", data: "2026-10-19", valorPago: 140 }, "America/Fortaleza");
    expect(cliente.rpc).toHaveBeenLastCalledWith("baixar_cobranca_manual", expect.objectContaining({ p_valor_pago: 140 }));

    const recusa = clienteFalso({});
    recusa.rpc.mockResolvedValue({ data: null, error: { message: "Cobrança emitida no gateway: a baixa precisa..." } });
    lib = await carregarComCliente(recusa);
    const res = await lib.baixarCobranca("c1", { forma: "pix", data: "2026-10-19", valorPago: null }, "America/Fortaleza");
    expect(res.sucesso).toBe(false);
    if (!res.sucesso) expect(res.mensagem).toContain("A lista foi atualizada");
  });

  it("cancelar e gerar: chamam a RPC certa; gerar devolve quantas", async () => {
    const cliente = clienteFalso({});
    cliente.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: 2, error: null });
    const lib = await carregarComCliente(cliente);
    expect(await lib.cancelarCobranca("c1")).toEqual({ sucesso: true });
    expect(cliente.rpc).toHaveBeenLastCalledWith("cancelar_cobranca", { p_cobranca_id: "c1" });
    expect(await lib.gerarCobrancasAgora("m1")).toEqual({ sucesso: true, geradas: 2 });
    expect(cliente.rpc).toHaveBeenLastCalledWith("gerar_cobrancas_matricula", { p_matricula_id: "m1" });
  });
});

describe("Cobertura pedida na primeira revisão", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("valor com ponto decimal não vira cem vezes maior", () => {
    expect(lerValor("150.50")).toBe(150.5);
    expect(lerValor("150.00")).toBe(150);
    expect(lerValor("99.99")).toBe(99.99);
    expect(lerValor("1.234")).toBe(1234);
    expect(lerValor("1.234.567")).toBe(1234567);
    expect(lerValor(" 150,00 ")).toBe(150);
    expect(lerValor("0,01")).toBe(0.01);
    expect(lerValor("0,00")).toBeNull();
    expect(lerValor("12.34,56")).toBeNull();
    expect(lerValor("1,234.56")).toBeNull();
  });

  it("dia do pagamento no fuso da academia, não em UTC", () => {
    // 01:30 de 13/09 em UTC ainda é 22:30 de 12/09 em Fortaleza.
    expect(diaNoFuso("2026-09-13T01:30:00+00:00", "America/Fortaleza")).toBe("2026-09-12");
    expect(diaNoFuso("2026-09-13T01:30:00+00:00", "UTC")).toBe("2026-09-13");
  });

  it("data de pagamento que não existe no calendário é recusada antes de enviar", () => {
    expect(validarBaixa({ forma: "pix", data: "2026-02-31", valor: "" }, "2026-10-19"))
      .toEqual({ ok: false, mensagem: "Informe a data do pagamento." });
  });

  it("status que a tela não conhece nunca aceita ação manual", async () => {
    const linha = { id: "c1", aluno_id: "a1", matricula_id: null, competencia: null, descricao: null, valor: "150.00",
      vencimento: "2026-10-10", status: "em_disputa", pago_em: null, valor_pago: "145.50", forma_pagamento: null, baixa_em: null,
      gateway_id: null, emissao_iniciada_em: null, divergencia: null, alunos: null };
    const lib = await carregarComCliente(clienteFalso({ cobrancas: { data: [linha], error: null } }));
    const [c] = await lib.listarCobrancas(ACADEMIA);
    expect(c.status).toBe("desconhecido");
    expect(lib.aceitaAcaoManual(c)).toBe(false);
    expect(c.valor_pago).toBe(145.5);
  });

  it("inadimplentes: números da view convertidos; inadimplentes e matrículas em páginas", async () => {
    let lib = await carregarComCliente(clienteFalso({
      vw_inadimplentes: { data: [{ aluno_id: "a1", nome: "Ana", telefone: null, cobrancas_atrasadas: "2", total_atrasado: "299.90", vencimento_mais_antigo: "2026-08-10" }], error: null },
    }));
    expect(await lib.listarInadimplentes(ACADEMIA)).toEqual([
      { aluno_id: "a1", nome: "Ana", telefone: null, cobrancas_atrasadas: 2, total_atrasado: 299.9, vencimento_mais_antigo: "2026-08-10" },
    ]);

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
        Promise.resolve({ data: inicio === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, aluno_id: `a${i}` })) : [], error: null }).then(ok);
      return q;
    });
    lib = await carregarComCliente(cliente);
    await lib.listarInadimplentes(ACADEMIA);
    await lib.listarMatriculasAtivas(ACADEMIA);
    const paginas = (t: string) => cliente.chamadas.filter((c) => c.tabela === t && c.metodo === "range").length;
    expect(paginas("vw_inadimplentes")).toBe(2);
    expect(paginas("matriculas")).toBe(2);
  });

  it("recusa de cancelar e de gerar vira mensagem genérica", async () => {
    const cliente = clienteFalso({});
    cliente.rpc.mockResolvedValue({ data: null, error: { message: "texto do banco" } });
    const lib = await carregarComCliente(cliente);
    const cancelar = await lib.cancelarCobranca("c1");
    expect(cancelar.sucesso).toBe(false);
    if (!cancelar.sucesso) expect(cancelar.mensagem).not.toContain("texto do banco");
    const gerar = await lib.gerarCobrancasAgora("m1");
    expect(gerar.sucesso).toBe(false);
    if (!gerar.sucesso) expect(gerar.mensagem).not.toContain("texto do banco");
  });

  it("gerir: admin e recepção só com a assinatura em dia", () => {
    expect(podeGerirCobrancas("admin", true)).toBe(true);
    expect(podeGerirCobrancas("admin", false)).toBe(false);
    expect(podeGerirCobrancas("recepcao", false)).toBe(false);
    expect(estaVencida(cob({ status: "cancelada", vencimento: "2020-01-01" }), "2026-10-19")).toBe(false);
  });
});
