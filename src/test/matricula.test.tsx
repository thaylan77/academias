import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MatriculaPage } from "../pages/matricula/matricula-page";

describe("Tela de Matrícula Online", () => {
  it("deve carregar e renderizar os dados da academia", async () => {
    render(<MatriculaPage slug="honor-demo-a" />);

    expect(screen.getByText(/Carregando formulário/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Honor Team — Matriz Centro")).toBeInTheDocument();
    });

    expect(screen.getByText(/1. Escolha suas Turmas e Horários/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Dados Pessoais do Aluno/i)).toBeInTheDocument();
    expect(screen.getByText(/4. Termo de Responsabilidade/i)).toBeInTheDocument();
  });

  it("deve exibir aviso quando a academia estiver com matrículas online fechadas", async () => {
    render(<MatriculaPage slug="honor-demo-b" />);

    await waitFor(() => {
      expect(screen.getByText("Matrículas Online Indisponíveis")).toBeInTheDocument();
    });
  });

  it("deve exibir os campos do responsável quando o aluno for menor de idade", async () => {
    render(<MatriculaPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Honor Team — Matriz Centro")).toBeInTheDocument();
    });

    // Inicialmente não deve exibir os campos do responsável
    expect(screen.queryByText(/Dados do Responsável Legal/i)).not.toBeInTheDocument();

    // Insere data de nascimento de uma criança de 10 anos
    const dataNascInput = screen.getByLabelText(/Data de Nascimento/i);
    const anoAtual = new Date().getFullYear();
    fireEvent.change(dataNascInput, { target: { value: `${anoAtual - 10}-05-15` } });

    // Agora deve exibir o bloco de responsável legal
    await waitFor(() => {
      expect(screen.getByText(/Dados do Responsável Legal/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Nome Completo do Responsável/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/CPF do Responsável/i)).toBeInTheDocument();
    });
  });
});
