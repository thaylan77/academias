import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Header } from "../components/layout/header";

describe("Cabeçalho das páginas públicas", () => {
  it("abas de demonstração têm nome acessível mesmo só com o ícone, e trocam a aba", () => {
    const trocar = vi.fn();
    render(<Header currentSlug="honor-demo-a" activeTab="matricula" onTabChange={trocar} />);
    const nav = screen.getByRole("navigation", { name: "Páginas de demonstração" });
    for (const [nome, aba] of [["Matrícula Pública", "matricula"], ["Totem QR da Turma", "totem"], ["Check-in Aluno", "checkin"]] as const) {
      const botao = within(nav).getByRole("button", { name: nome });
      // Abaixo de md o texto some e fica o ícone; o nome vem do aria-label, que
      // é igual ao rótulo visível a partir de md.
      expect(within(botao).getByText(nome)).toHaveClass("hidden", "md:inline", "whitespace-nowrap");
      expect(botao).toHaveAttribute("aria-label", nome);
      // Alvo de toque de 40 x 40 px no celular.
      expect(botao).toHaveClass("min-h-10", "min-w-10");
      fireEvent.click(botao);
      expect(trocar).toHaveBeenLastCalledWith(aba);
    }
  });

  it("no celular, a marca não quebra e o que é secundário some", () => {
    render(<Header currentSlug="honor-demo-a" activeTab="checkin" onTabChange={vi.fn()} />);
    expect(screen.getByText("HONOR TEAM")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("SAAS")).toHaveClass("hidden", "sm:inline-flex");
    expect(screen.getByText("Gestão de Artes Marciais")).toHaveClass("hidden", "sm:block");
  });

  it("totem: sem abas, e o selo tem texto curto para o celular", () => {
    const { rerender } = render(<Header currentSlug="honor-demo-a" activeTab="totem" onTabChange={vi.fn()} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("Totem de Presença")).toHaveClass("hidden", "sm:inline");
    expect(screen.getByText("Totem")).toHaveClass("sm:hidden");

    rerender(<Header currentSlug="honor-demo-a" activeTab="totem" onTabChange={vi.fn()} modoKiosk />);
    expect(screen.getByText("Modo Quiosque Tatame • Navegação Bloqueada")).toHaveClass("hidden", "sm:inline");
    expect(screen.getByText("Quiosque")).toHaveClass("sm:hidden");
  });
});
