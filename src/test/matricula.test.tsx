import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MatriculaPage } from "../pages/matricula/matricula-page";
import * as supabaseLib from "../lib/supabase";

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
      // O e-mail do responsável é o login dele no portal do aluno.
      expect(screen.getByLabelText(/E-mail do Responsável/i)).toHaveAttribute("type", "email");
    });
  });

  it("envia o e-mail do responsável do aluno menor", async () => {
    const enviar = vi.spyOn(supabaseLib, "submeterMatriculaOnline").mockResolvedValue({ sucesso: true, matricula_id: "m1" } as never);
    render(<MatriculaPage slug="honor-demo-a" />);
    await screen.findByText("Honor Team — Matriz Centro");

    const anoAtual = new Date().getFullYear();
    fireEvent.change(screen.getByLabelText(/Nome Completo do Aluno/i), { target: { value: "Pedro Souza" } });
    fireEvent.change(screen.getByLabelText(/Data de Nascimento/i), { target: { value: `${anoAtual - 10}-05-15` } });
    fireEvent.change(await screen.findByLabelText(/Nome Completo do Responsável/i), { target: { value: "Maria Souza" } });
    fireEvent.change(screen.getByLabelText(/CPF do Responsável/i), { target: { value: "11144477735" } });
    fireEvent.change(screen.getByLabelText(/E-mail do Responsável/i), { target: { value: " maria@exemplo.com " } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Li e concordo/i }));
    fireEvent.submit(screen.getByLabelText(/Nome Completo do Aluno/i).closest("form")!);

    await waitFor(() => expect(enviar).toHaveBeenCalled());
    expect(enviar.mock.calls[0][1]).toMatchObject({ responsavel_email: "maria@exemplo.com" });
    vi.restoreAllMocks();
  });
});
