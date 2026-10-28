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
      // No celular o texto some (hidden sm:inline); o nome vem do aria-label.
      expect(within(botao).getByText(nome)).toHaveClass("hidden", "sm:inline");
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
