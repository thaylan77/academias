import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TotemPage } from "../pages/checkin/totem-page";
import * as supabaseModule from "../lib/supabase";

describe("Tela de Totem (Proteção de Equipe e Token Rotativo)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await supabaseModule.logoutEquipe();
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
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });

    // Clica no atalho de dev para o usuário do seed
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText(/Totem Ativo • Quiosque do Tatame/i)).toBeInTheDocument();
      expect(screen.getAllByText(/CHECK-IN ABERTO/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Professor")).toBeInTheDocument();
    });

    // Verifica presença do botão de encerrar sessão
    expect(screen.getByText(/Encerrar Sessão/i)).toBeInTheDocument();
  });

  it("deve exibir mensagem neutra quando não houver nenhuma turma aberta", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([]);

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText(/Nenhuma turma com check-in aberto no momento/i)).toBeInTheDocument();
      expect(screen.getByText(/O check-in abre automaticamente minutos antes do início da aula/i)).toBeInTheDocument();
    });
  });

  it("deve permitir que o operador encerre a sessão do totem", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    // Autentica
    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

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
