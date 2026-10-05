import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CheckinPage } from "../pages/checkin/checkin-page";

describe("Tela de Check-in por QR Code", () => {
  it("deve renderizar o leitor e as instruções de check-in", () => {
    render(<CheckinPage slug="honor-demo-a" />);

    expect(screen.getByText("Check-in por QR Code")).toBeInTheDocument();
    expect(screen.getByText(/Ativar Câmera para Check-in/i)).toBeInTheDocument();
    expect(screen.getByText(/Instruções de Check-in/i)).toBeInTheDocument();
  });

  it("deve realizar check-in com sucesso e exibir confirmação verde", async () => {
    render(<CheckinPage slug="honor-demo-a" initialTurmaId="turma-jj-01" />);

    await waitFor(() => {
      expect(screen.getByText("Presença Confirmada")).toBeInTheDocument();
    });

    expect(screen.getByText(/Presença confirmada com sucesso! Oss!/i)).toBeInTheDocument();
    expect(screen.getByText(/Escanear Novo Check-in/i)).toBeInTheDocument();
  });

  it("deve exibir bloqueio quando aluno for inadimplente", async () => {
    render(<CheckinPage slug="honor-demo-a" />);

    // Clica no cenário 'Inadimplência'
    const btnInadimplente = screen.getByText("Inadimplência");
    fireEvent.click(btnInadimplente);

    // Clica em 'Simular Leitura'
    const btnSimular = screen.getByText("Simular Leitura");
    fireEvent.click(btnSimular);

    await waitFor(() => {
      expect(screen.getByText("Check-in Bloqueado")).toBeInTheDocument();
      expect(screen.getByText("Mensalidade em Atraso")).toBeInTheDocument();
    });

    expect(screen.getByText(/Falar com a Recepção no WhatsApp/i)).toBeInTheDocument();
  });

  it("deve exibir lista de dependentes quando houver múltiplos alunos no login", async () => {
    render(<CheckinPage slug="honor-demo-a" />);

    // Clica no cenário 'Dependentes'
    const btnMultiplos = screen.getByText("Dependentes");
    fireEvent.click(btnMultiplos);

    // Simula leitura
    const btnSimular = screen.getByText("Simular Leitura");
    fireEvent.click(btnSimular);

    await waitFor(() => {
      expect(screen.getByText(/Quem está participando do treino hoje?/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Lucas Silva (Filho)")).toBeInTheDocument();
    expect(screen.getByText("Mariana Silva (Filha)")).toBeInTheDocument();

    // Seleciona um dependente
    fireEvent.click(screen.getByText("Lucas Silva (Filho)"));

    await waitFor(() => {
      expect(screen.getByText("Presença Confirmada")).toBeInTheDocument();
    });
  });
});
