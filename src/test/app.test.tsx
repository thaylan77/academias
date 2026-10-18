import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Registra quais bibliotecas de QR chegam a ser carregadas. A fábrica do
// vi.mock só roda quando o módulo é importado de verdade.
const carregados = vi.hoisted(() => new Set<string>());

vi.mock("html5-qrcode", async (original) => {
  carregados.add("html5-qrcode");
  return await original();
});
vi.mock("qrcode.react", async (original) => {
  carregados.add("qrcode.react");
  return await original();
});

function abrir(caminho: string) {
  window.history.pushState({}, "", caminho);
}

describe("Carregamento sob demanda das telas", () => {
  beforeEach(() => {
    carregados.clear();
    vi.resetModules();
  });

  it("a matrícula pública abre sem carregar as bibliotecas de QR", async () => {
    abrir("/honor-demo-a/matricula");
    const { App } = await import("../App");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Ficha de Matrícula|Matrícula Online|Dados do Aluno/i)).toBeInTheDocument();
    });
    expect(carregados.has("html5-qrcode")).toBe(false);
    expect(carregados.has("qrcode.react")).toBe(false);
  });

  it("o check-in carrega o leitor de QR quando é aberto", async () => {
    abrir("/honor-demo-a/checkin");
    const { App } = await import("../App");
    render(<App />);

    await waitFor(() => {
      expect(carregados.has("html5-qrcode")).toBe(true);
    });
  });

  it("enquanto a tela carrega, mostra um aviso", async () => {
    abrir("/honor-demo-a/matricula");
    const { App } = await import("../App");
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Carregando...");
    await waitFor(() => {
      expect(screen.queryByText("Carregando...")).not.toBeInTheDocument();
    });
  });
});
