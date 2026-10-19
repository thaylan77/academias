import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CobrancasSecao } from "../pages/painel/cobrancas";
import { PainelContexto } from "../pages/painel/contexto";
import * as lib from "../lib/cobrancas";
import { AcademiaDoMembro, PapelPainel } from "../lib/painel";

const cob = (extra: Partial<lib.Cobranca> = {}): lib.Cobranca => ({
  id: "c1", aluno_id: "a1", aluno: "Ana Souza", matricula_id: "m1", competencia: "2026-10-01", descricao: "Mensal — 10/2026",
  valor: 150, vencimento: "2020-01-10", status: "pendente", pago_em: null, valor_pago: null, forma_pagamento: null,
  baixa_em: null, emitida: false, divergencia: null, ...extra,
});

function montar(papel: PapelPainel, ativa = true) {
  const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "A", slug: "a", papel, ativa, fuso: "America/Fortaleza" };
  render(
    <PainelContexto.Provider value={{ academia, item: null, abrir: vi.fn() }}>
      <CobrancasSecao />
    </PainelContexto.Provider>
  );
}

describe("Painel: cobranças", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(lib, "listarInadimplentes").mockResolvedValue([
      { aluno_id: "a1", nome: "Ana Souza", telefone: "5585999991234", cobrancas_atrasadas: 2, total_atrasado: 300, vencimento_mais_antigo: "2026-08-10" },
    ]);
    vi.spyOn(lib, "listarMatriculasAtivas").mockResolvedValue([{ id: "m1", aluno: "Ana Souza", plano: "Mensal", dia_vencimento: 10 }]);
  });

  it("professor não vê nada do financeiro, nem carrega os dados", () => {
    const listar = vi.spyOn(lib, "listarCobrancas");
    montar("professor");
    expect(screen.getByRole("alert")).toHaveTextContent("não acessa o financeiro");
    expect(listar).not.toHaveBeenCalled();
    expect(lib.listarInadimplentes).not.toHaveBeenCalled();
  });

  it("mostra inadimplentes e cobranças em reais, com vencida, paga e divergência", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([
      cob(),
      cob({ id: "c2", status: "paga", valor_pago: 145.5, pago_em: "2026-09-12T15:00:00Z", forma_pagamento: "pix", vencimento: "2026-09-10" }),
      cob({ id: "c3", status: "paga", divergencia: "pagamento_duplicado", vencimento: "2026-08-10" }),
    ]);
    montar("recepcao");

    const inad = await screen.findByRole("region", { name: "Inadimplentes" });
    expect(lib.listarCobrancas).toHaveBeenCalledWith("acad-a");
    expect(inad).toHaveTextContent("R$ 300,00");
    expect(inad).toHaveTextContent("2 cobranças · desde 10/08/2026");
    const lista = screen.getByRole("list", { name: "Lista de cobranças" });
    const [vencida, paga, divergente] = within(lista).getAllByRole("listitem");
    expect(vencida).toHaveTextContent("R$ 150,00");
    expect(within(vencida).getByText("Vencida")).toBeInTheDocument();
    expect(paga).toHaveTextContent("R$ 145,50");
    expect(paga).toHaveTextContent("paga em 12/09/2026 (Pix)");
    expect(divergente).toHaveTextContent("Revisar: Pagamento em duplicidade no gateway");
  });

  it("baixa e cancelamento só em pendente nunca emitida; emitida explica por quê", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([
      cob(),
      cob({ id: "c2", aluno: "Bruno Lima", emitida: true }),
      cob({ id: "c3", aluno: "Caio Paes", status: "paga" }),
    ]);
    montar("recepcao");
    const lista = await screen.findByRole("list", { name: "Lista de cobranças" });
    const [pendente, emitida, paga] = within(lista).getAllByRole("listitem");
    expect(within(pendente).getByRole("button", { name: /Dar baixa/ })).toBeInTheDocument();
    expect(within(pendente).getByRole("button", { name: /Cancelar/ })).toBeInTheDocument();
    expect(within(emitida).queryByRole("button")).not.toBeInTheDocument();
    expect(emitida).toHaveTextContent("Emitida no gateway");
    expect(within(paga).queryByRole("button")).not.toBeInTheDocument();
  });

  it("academia suspensa lê, mas não baixa, cancela nem gera", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    montar("dono", false);
    await screen.findByRole("list", { name: "Lista de cobranças" });
    expect(screen.getByText(/podem ser consultadas, mas não baixadas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dar baixa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Gerar cobranças" })).not.toBeInTheDocument();
  });

  it("filtros por situação, competência e aluno", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([
      cob(),
      cob({ id: "c2", aluno: "Bruno Araújo", status: "paga", competencia: "2026-09-01" }),
    ]);
    montar("admin");
    await screen.findByRole("list", { name: "Lista de cobranças" });
    const itens = () => within(screen.getByRole("list", { name: "Lista de cobranças" })).getAllByRole("listitem");

    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "paga" } });
    expect(itens()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "todas" } });
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "2026-10" } });
    expect(itens().map((i) => i.textContent)).toEqual([expect.stringContaining("Ana Souza")]);
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "araujo" } });
    expect(itens().map((i) => i.textContent)).toEqual([expect.stringContaining("Bruno Araújo")]);
  });

  it("dar baixa: confere antes de enviar, manda no fuso da academia e recarrega a lista", async () => {
    const listar = vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    const baixar = vi.spyOn(lib, "baixarCobranca").mockResolvedValue({ sucesso: true });
    montar("recepcao");

    fireEvent.click(await screen.findByRole("button", { name: /Dar baixa/ }));
    const form = screen.getByRole("form", { name: "Dar baixa" });
    fireEvent.change(within(form).getByLabelText("Valor pago"), { target: { value: "-1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar baixa" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Valor pago inválido.");
    expect(baixar).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("Forma"), { target: { value: "dinheiro" } });
    fireEvent.change(within(form).getByLabelText("Valor pago"), { target: { value: "140,00" } });
    const data = (within(form).getByLabelText("Pago em") as HTMLInputElement).value;
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar baixa" }));

    expect(await screen.findByText("Baixa registrada.")).toBeInTheDocument();
    expect(baixar).toHaveBeenCalledWith("c1", { forma: "dinheiro", data, valorPago: 140 }, "America/Fortaleza");
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("recusa do banco aparece e a lista recarrega", async () => {
    const listar = vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    vi.spyOn(lib, "baixarCobranca").mockResolvedValue({ sucesso: false, mensagem: "Não foi possível concluir: a cobrança pode ter mudado. A lista foi atualizada." });
    montar("recepcao");
    fireEvent.click(await screen.findByRole("button", { name: /Dar baixa/ }));
    fireEvent.click(within(screen.getByRole("form", { name: "Dar baixa" })).getByRole("button", { name: "Confirmar baixa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A lista foi atualizada.");
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("cancelar pede confirmação (foco em Voltar, Esc fecha) e cancela", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    const cancelar = vi.spyOn(lib, "cancelarCobranca").mockResolvedValue({ sucesso: true });
    montar("admin");

    fireEvent.click(await screen.findByRole("button", { name: /Cancelar a cobrança/ }));
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByRole("button", { name: "Voltar" })).toHaveFocus();
    fireEvent.keyDown(dialogo, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(cancelar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Cancelar a cobrança/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("Cobrança cancelada.")).toBeInTheDocument();
    expect(cancelar).toHaveBeenCalledWith("c1");
  });

  it("gerar agora: mostra quantas, e explica quando nenhuma entra", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([]);
    const gerar = vi.spyOn(lib, "gerarCobrancasAgora")
      .mockResolvedValueOnce({ sucesso: true, geradas: 0 })
      .mockResolvedValueOnce({ sucesso: true, geradas: 2 });
    montar("recepcao");

    const secao = await screen.findByRole("region", { name: "Gerar cobranças" });
    expect(within(secao).getByRole("button", { name: "Gerar agora" })).toBeDisabled();
    fireEvent.change(within(secao).getByLabelText("Matrícula ativa"), { target: { value: "m1" } });
    fireEvent.click(within(secao).getByRole("button", { name: "Gerar agora" }));
    expect(await within(secao).findByText(/Nenhuma cobrança a gerar agora/)).toBeInTheDocument();
    fireEvent.click(within(secao).getByRole("button", { name: "Gerar agora" }));
    expect(await within(secao).findByText("2 cobranças geradas.")).toBeInTheDocument();
    expect(gerar).toHaveBeenCalledWith("m1");
  });

  it("falha ao carregar: aviso com nova tentativa", async () => {
    const listar = vi.spyOn(lib, "listarCobrancas").mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce([cob()]);
    montar("recepcao");
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("list", { name: "Lista de cobranças" });
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("recarga que falha depois de uma ação mantém a tela e avisa", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValueOnce([cob()]).mockRejectedValueOnce(new Error("rede"));
    vi.spyOn(lib, "cancelarCobranca").mockResolvedValue({ sucesso: true });
    montar("admin");
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar a cobrança/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText(/Feito, mas não foi possível atualizar a lista/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("list", { name: "Lista de cobranças" })).toBeInTheDocument());
  });
});

describe("Painel: cobranças (cobertura pedida na primeira revisão)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.spyOn(lib, "listarInadimplentes").mockResolvedValue([]);
    vi.spyOn(lib, "listarMatriculasAtivas").mockResolvedValue([{ id: "m1", aluno: "Ana Souza", plano: "Mensal", dia_vencimento: 10 }]);
  });

  it("data padrão da baixa é o dia da academia (relógio fixo na virada UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T01:30:00Z")); // ainda dia 19 em Fortaleza
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    montar("recepcao");
    fireEvent.click(await screen.findByRole("button", { name: /Dar baixa/ }));
    expect(within(screen.getByRole("form", { name: "Dar baixa" })).getByLabelText("Pago em")).toHaveValue("2026-10-19");
  });

  it("pago_em perto da meia-noite aparece no dia da academia", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([
      cob({ status: "paga", pago_em: "2026-09-13T01:30:00+00:00", forma_pagamento: "pix", valor_pago: 150 }),
    ]);
    montar("recepcao");
    const lista = await screen.findByRole("list", { name: "Lista de cobranças" });
    expect(lista).toHaveTextContent("paga em 12/09/2026");
  });

  it("depois de uma ação, inadimplentes também recarregam", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    vi.spyOn(lib, "cancelarCobranca").mockResolvedValue({ sucesso: true });
    montar("admin");
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar a cobrança/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await screen.findByText("Cobrança cancelada.");
    await waitFor(() => expect(lib.listarInadimplentes).toHaveBeenCalledTimes(2));
    expect(lib.listarCobrancas).toHaveBeenCalledTimes(2);
  });

  it("recusa ao cancelar aparece e recarrega; recusa ao gerar também recarrega", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    vi.spyOn(lib, "cancelarCobranca").mockResolvedValue({ sucesso: false, mensagem: "Não foi possível concluir. A lista foi atualizada." });
    vi.spyOn(lib, "gerarCobrancasAgora").mockResolvedValue({ sucesso: false, mensagem: "Não foi possível gerar." });
    montar("admin");
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar a cobrança/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(await screen.findByText("Não foi possível concluir. A lista foi atualizada.")).toBeInTheDocument();
    await waitFor(() => expect(lib.listarCobrancas).toHaveBeenCalledTimes(2));

    const secao = screen.getByRole("region", { name: "Gerar cobranças" });
    fireEvent.change(within(secao).getByLabelText("Matrícula ativa"), { target: { value: "m1" } });
    fireEvent.click(within(secao).getByRole("button", { name: "Gerar agora" }));
    expect(await screen.findByText("Não foi possível gerar.")).toBeInTheDocument();
    await waitFor(() => expect(lib.listarCobrancas).toHaveBeenCalledTimes(3));
  });

  it("clique duplo na baixa envia uma vez só, e o botão trava enquanto envia", async () => {
    vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    let terminar: (r: { sucesso: true }) => void = () => {};
    const baixar = vi.spyOn(lib, "baixarCobranca").mockImplementation(() => new Promise((r) => (terminar = r)));
    montar("recepcao");
    fireEvent.click(await screen.findByRole("button", { name: /Dar baixa/ }));
    const form = screen.getByRole("form", { name: "Dar baixa" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(baixar).toHaveBeenCalledTimes(1);
    expect(await within(form).findByRole("button", { name: "Salvando..." })).toBeDisabled();
    await act(async () => terminar({ sucesso: true }));
  });

  it("trocar a academia do contexto recarrega o financeiro da academia nova", async () => {
    const listar = vi.spyOn(lib, "listarCobrancas").mockResolvedValue([cob()]);
    const academia = (id: string): AcademiaDoMembro => ({ academia_id: id, nome: id, slug: id, papel: "admin", ativa: true, fuso: "America/Fortaleza" });
    const { rerender } = render(
      <PainelContexto.Provider value={{ academia: academia("acad-a"), item: null, abrir: vi.fn() }}>
        <CobrancasSecao />
      </PainelContexto.Provider>
    );
    await screen.findByRole("list", { name: "Lista de cobranças" });
    rerender(
      <PainelContexto.Provider value={{ academia: academia("acad-b"), item: null, abrir: vi.fn() }}>
        <CobrancasSecao />
      </PainelContexto.Provider>
    );
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith("acad-b"));
    expect(lib.listarInadimplentes).toHaveBeenLastCalledWith("acad-b");
    expect(lib.listarMatriculasAtivas).toHaveBeenLastCalledWith("acad-b");
  });
});
