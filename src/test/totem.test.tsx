import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TotemPage } from "../pages/checkin/totem-page";
import { logoutEquipe } from "../lib/supabase";

describe("Tela de Totem (Proteção de Equipe)", () => {
  beforeEach(async () => {
    await logoutEquipe();
  });

  it("deve bloquear acesso público e exigir login da equipe", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Acesso ao Totem de Presença")).toBeInTheDocument();
    });

    expect(screen.getByText(/Uso Restrito • Equipe da Academia/i)).toBeInTheDocument();
    expect(screen.getByText("Entrar no Totem")).toBeInTheDocument();
  });

  it("deve autenticar membro da equipe e liberar a projeção do QR code", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor Pedro")).toBeInTheDocument();
    });

    // Clica no atalho de demonstração do Professor Pedro
    fireEvent.click(screen.getByText("Professor Pedro"));

    await waitFor(() => {
      expect(screen.getByText(/Totem Ativo • Quiosque do Tatame/i)).toBeInTheDocument();
      expect(screen.getByText(/CHECK-IN ABERTO/i)).toBeInTheDocument();
      expect(screen.getByText("Professor Pedro")).toBeInTheDocument();
    });

    // Verifica presença do botão de encerrar sessão
    expect(screen.getByText(/Encerrar Sessão/i)).toBeInTheDocument();
  });

  it("deve permitir que o operador encerre a sessão do totem", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    // Autentica
    await waitFor(() => {
      expect(screen.getByText("Professor Pedro")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor Pedro"));

    await waitFor(() => {
      expect(screen.getByText(/Encerrar Sessão/i)).toBeInTheDocument();
    });

    // Encerra sessão
    fireEvent.click(screen.getByText(/Encerrar Sessão/i));

    // Volta para a tela de bloqueio
    await waitFor(() => {
      expect(screen.getByText("Acesso ao Totem de Presença")).toBeInTheDocument();
    });
  });
});
