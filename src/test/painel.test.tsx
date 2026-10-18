import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PainelApp } from "../pages/painel/painel-app";
import * as painel from "../lib/painel";
import { AcademiaDoMembro } from "../lib/painel";

const A: AcademiaDoMembro = { academia_id: "a", nome: "Academia Alpha", slug: "alpha", papel: "dono", ativa: true };
const B: AcademiaDoMembro = { academia_id: "b", nome: "Academia Beta", slug: "beta", papel: "professor", ativa: false };

function abrir(caminho: string) {
  window.history.pushState({}, "", caminho);
}

describe("Painel da equipe: entrada e escolha de academia", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    abrir("/painel");
  });

  it("sem sessão, mostra o login; login sem academia mostra a recusa", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([]);
    vi.spyOn(painel, "entrarNoPainel").mockResolvedValue({
      sucesso: false,
      mensagem: "Este login não faz parte da equipe de nenhuma academia.",
    });
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "x@a.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Este login não faz parte da equipe de nenhuma academia.")
    );
  });

  it("com uma academia só, entra direto e a URL ganha o slug", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/alpha");
    expect(screen.queryByText(/Trocar de academia/)).not.toBeInTheDocument();
  });

  it("com várias, pergunta; a escolha fica guardada para a próxima vez", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A, B]);
    const { unmount } = render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Em qual academia você quer entrar?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Academia Beta/ }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/beta");
    unmount();

    // Voltando ao painel sem slug, abre a guardada.
    abrir("/painel");
    render(<PainelApp />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
  });

  it("troca de academia sem sair", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A, B]);
    abrir("/painel/alpha");
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Trocar de academia/ }));
    await waitFor(() => expect(screen.getByText("Em qual academia você quer entrar?")).toBeInTheDocument());
  });

  it("usuário da academia A não abre o painel da B trocando a URL", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    abrir("/painel/beta");
    render(<PainelApp />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Você não faz parte da equipe da academia beta")
    );
    expect(screen.queryByRole("navigation", { name: "Menu do painel" })).not.toBeInTheDocument();
  });

  it("academia suspensa ou com teste vencido mostra o aviso de só leitura", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([B]);
    render(<PainelApp />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Você pode consultar os dados, mas não alterar")
    );
  });

  it("o menu mostra só o que o papel pode ver; seção proibida pela URL cai no início", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([B]);
    abrir("/painel/beta/cobrancas");
    render(<PainelApp />);

    const menu = await screen.findByRole("navigation", { name: "Menu do painel" });
    const itens = within(menu).getAllByRole("link").map((l) => l.textContent);
    expect(itens).toEqual(["Início", "Alunos", "Turmas", "Graduações"]);
    expect(within(menu).getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  });

  it("navega pelo menu e a URL acompanha", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    abrir("/painel/alpha");
    render(<PainelApp />);

    const menu = await screen.findByRole("navigation", { name: "Menu do painel" });
    fireEvent.click(within(menu).getByRole("link", { name: "Turmas" }));
    await waitFor(() => expect(window.location.pathname).toBe("/painel/alpha/turmas"));
    expect(screen.getByText(/issue #27/)).toBeInTheDocument();
  });

  it("sair volta ao login e esquece a escolha", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A, B]);
    const sair = vi.spyOn(painel, "sairDoPainel").mockResolvedValue();
    localStorage.setItem("honorteam.painel.academia", "alpha");
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sair/ }));

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    expect(sair).toHaveBeenCalled();
    expect(localStorage.getItem("honorteam.painel.academia")).toBeNull();
    expect(window.location.pathname).toBe("/painel");
  });
});
