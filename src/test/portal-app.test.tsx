import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

// Com servidor (o cliente é um objeto qualquer); as leituras são trocadas.
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../lib/portal-aluno", () => ({ meusAlunos: vi.fn(), minhaGraduacao: vi.fn(), minhasPresencas: vi.fn() }));

import * as dados from "../lib/portal-aluno";
import { PortalConteudo } from "../pages/portal/portal-app";

const m = dados as unknown as Record<string, ReturnType<typeof vi.fn>>;

const ana = { id: "a1", nome: "Ana", status: "ativo", academia_id: "acad-a", academia: "Dojo A", fuso: "America/Sao_Paulo" };
const beto = { id: "b1", nome: "Beto", status: "inativo", academia_id: "acad-b", academia: "Dojo B", fuso: "America/Sao_Paulo" };

const azul = {
  modalidade_id: "jj", modalidade: "Jiu-Jitsu", faixa: "Azul", cor: "#1E40AF", grau: 2, graduado_em: "2026-03-01",
  progresso: { proximo_passo: "grau 3", aulas_desde: 12, min_aulas: 40, meses_desde: 2, min_meses: 6, apto: false },
};

describe("Portal do aluno: tela", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.minhasPresencas.mockResolvedValue({ itens: [], temMais: false });
  });

  it("um cadastro: sem seletor, mostra faixa, grau, data e progresso", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([azul]);
    render(<PortalConteudo />);

    expect(await screen.findByText("Azul, grau 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ana" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Aluno")).not.toBeInTheDocument();
    expect(screen.getByText("desde 01/03/2026")).toBeInTheDocument();
    expect(screen.getByText(/12 de 40 aulas · 2 de 6 meses/)).toHaveTextContent("próximo: grau 3");
    expect(screen.queryByText("Tempo e aulas cumpridos")).not.toBeInTheDocument();
    expect(m.minhaGraduacao).toHaveBeenCalledWith({ id: "a1", academia_id: "acad-a" });
  });

  it("apto: avisa que cumpriu o tempo e as aulas, e que quem decide é o professor", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([{ ...azul, progresso: { ...azul.progresso, apto: true } }]);
    render(<PortalConteudo />);
    expect(await screen.findByText("Tempo e aulas cumpridos")).toBeInTheDocument();
    expect(screen.getByText(/decidida pelo professor/)).toBeInTheDocument();
  });

  it("vários cadastros: o seletor troca o aluno e a graduação dele", async () => {
    m.meusAlunos.mockResolvedValue([ana, beto]);
    m.minhaGraduacao.mockImplementation(async (a: { id: string }) =>
      a.id === "a1" ? [azul] : [{ ...azul, modalidade: "Judô", faixa: "Amarela", grau: 0, progresso: null }]);
    render(<PortalConteudo />);

    expect(await screen.findByText("Azul, grau 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "b1" } });
    expect(await screen.findByText("Amarela")).toBeInTheDocument();
    expect(screen.queryByText("Azul, grau 2")).not.toBeInTheDocument();
    expect(screen.getByText("Este cadastro não está ativo na academia.")).toBeInTheDocument();
    expect(m.minhaGraduacao).toHaveBeenLastCalledWith({ id: "b1", academia_id: "acad-b" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Beto");
  });

  it("troca rápida de aluno: a resposta atrasada do anterior é descartada", async () => {
    m.meusAlunos.mockResolvedValue([ana, beto]);
    let soltarAna: (v: unknown) => void = () => {};
    m.minhaGraduacao.mockImplementation((a: { id: string }) =>
      a.id === "a1"
        ? new Promise((r) => (soltarAna = r))
        : Promise.resolve([{ ...azul, faixa: "Amarela", grau: 0, progresso: null }]));
    render(<PortalConteudo />);
    fireEvent.change(await screen.findByLabelText("Aluno"), { target: { value: "b1" } });
    expect(await screen.findByText("Amarela")).toBeInTheDocument();
    await act(async () => soltarAna([azul]));
    expect(screen.queryByText("Azul, grau 2")).not.toBeInTheDocument();
    expect(screen.getByText("Amarela")).toBeInTheDocument();
  });

  it("erro na graduação de um aluno não fica ao trocar para outro", async () => {
    m.meusAlunos.mockResolvedValue([ana, beto]);
    m.minhaGraduacao.mockImplementation((a: { id: string }) =>
      a.id === "a1" ? Promise.reject(new Error("rede")) : Promise.resolve([azul]));
    render(<PortalConteudo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a graduação");
    fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "b1" } });
    expect(await screen.findByText("Azul, grau 2")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("nenhum cadastro ligado: explica o que conferir", async () => {
    m.meusAlunos.mockResolvedValue([]);
    render(<PortalConteudo />);
    expect(await screen.findByText(/Nenhum cadastro ligado a este e-mail/)).toBeInTheDocument();
    expect(m.minhaGraduacao).not.toHaveBeenCalled();
  });

  it("sem graduação registrada: avisa", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([]);
    render(<PortalConteudo />);
    expect(await screen.findByText("Nenhuma graduação registrada ainda.")).toBeInTheDocument();
  });

  it("falha nos cadastros: aviso e 'Tentar de novo' carrega", async () => {
    m.meusAlunos.mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce([ana]);
    m.minhaGraduacao.mockResolvedValue([azul]);
    render(<PortalConteudo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar seus cadastros");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Azul, grau 2")).toBeInTheDocument();
  });

  it("presenças: data, turma e como foi registrada", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([]);
    m.minhasPresencas.mockResolvedValue({
      itens: [
        { id: "p2", data: "2026-10-28", turma: "Adulto Noite", origem: "qrcode" },
        { id: "p1", data: "2026-10-21", turma: "Adulto Noite", origem: "recepcao" },
      ],
      temMais: false,
    });
    render(<PortalConteudo />);
    const lista = await screen.findByRole("list", { name: "Presenças" });
    expect(lista).toHaveTextContent("28/10/2026 · Adulto Noite");
    expect(lista).toHaveTextContent("check-in pelo QR");
    expect(lista).toHaveTextContent("21/10/2026 · Adulto Noite");
    expect(lista).toHaveTextContent("registrada pela recepção");
    expect(screen.queryByRole("button", { name: "Mostrar mais" })).not.toBeInTheDocument();
    expect(m.minhasPresencas).toHaveBeenCalledWith({ id: "a1", academia_id: "acad-a" });
  });

  it("presenças: sem nenhuma, avisa", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([]);
    render(<PortalConteudo />);
    expect(await screen.findByText("Nenhuma presença registrada ainda.")).toBeInTheDocument();
  });

  it("presenças: 'Mostrar mais' traz a próxima página uma vez só, sem repetir a da borda", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([]);
    let soltar: (v: unknown) => void = () => {};
    m.minhasPresencas
      .mockResolvedValueOnce({ itens: [{ id: "p3", data: "2026-10-28", turma: "T", origem: "qrcode" }], temMais: true })
      .mockReturnValueOnce(new Promise((r) => (soltar = r)));
    render(<PortalConteudo />);
    const botao = await screen.findByRole("button", { name: "Mostrar mais" });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await act(async () => soltar({
      itens: [{ id: "p3", data: "2026-10-28", turma: "T", origem: "qrcode" }, { id: "p2", data: "2026-10-21", turma: "T", origem: "professor" }],
      temMais: false,
    }));
    expect(m.minhasPresencas).toHaveBeenCalledTimes(2);
    expect(m.minhasPresencas).toHaveBeenLastCalledWith({ id: "a1", academia_id: "acad-a" }, 1);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("registrada pelo professor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mostrar mais" })).not.toBeInTheDocument();
  });

  it("presenças: falha ao trazer mais mantém a lista e deixa tentar de novo", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([]);
    m.minhasPresencas
      .mockResolvedValueOnce({ itens: [{ id: "p3", data: "2026-10-28", turma: "T", origem: "qrcode" }], temMais: true })
      .mockRejectedValueOnce(new Error("rede"));
    render(<PortalConteudo />);
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar mais" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar mais presenças");
    expect(screen.getByText("28/10/2026 · T")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostrar mais" })).toBeEnabled();
  });

  it("presenças: falha na primeira página, aviso e 'Tentar de novo' carrega", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockResolvedValue([]);
    m.minhasPresencas
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce({ itens: [{ id: "p1", data: "2026-10-28", turma: "T", origem: "qrcode" }], temMais: false });
    render(<PortalConteudo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar as presenças");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("28/10/2026 · T")).toBeInTheDocument();
  });

  it("presenças: ao trocar de aluno, a resposta atrasada do anterior é descartada", async () => {
    m.meusAlunos.mockResolvedValue([ana, beto]);
    m.minhaGraduacao.mockResolvedValue([]);
    let soltarAna: (v: unknown) => void = () => {};
    m.minhasPresencas.mockImplementation((a: { id: string }) =>
      a.id === "a1"
        ? new Promise((r) => (soltarAna = r))
        : Promise.resolve({ itens: [{ id: "pb", data: "2026-10-20", turma: "Judô", origem: "professor" }], temMais: false }));
    render(<PortalConteudo />);
    fireEvent.change(await screen.findByLabelText("Aluno"), { target: { value: "b1" } });
    expect(await screen.findByText("20/10/2026 · Judô")).toBeInTheDocument();
    await act(async () => soltarAna({ itens: [{ id: "pa", data: "2026-10-28", turma: "Adulto", origem: "qrcode" }], temMais: false }));
    expect(screen.queryByText("28/10/2026 · Adulto")).not.toBeInTheDocument();
  });

  it("falha na graduação: aviso e 'Tentar de novo' carrega", async () => {
    m.meusAlunos.mockResolvedValue([ana]);
    m.minhaGraduacao.mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce([azul]);
    render(<PortalConteudo />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a graduação");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Azul, grau 2")).toBeInTheDocument();
  });
});
