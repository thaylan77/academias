import { describe, it, expect } from "vitest";
import { mapearErroRpc } from "../lib/rpc-errors";

describe("Centralizador de Tratamento de Erros de RPC (mapearErroRpc)", () => {
  it("deve mapear inadimplência por texto e código/hint", () => {
    // Por mensagem de texto da PL/pgSQL
    const erroTexto = mapearErroRpc({
      message: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
    });
    expect(erroTexto.codigo).toBe("INADIMPLENTE");
    expect(erroTexto.titulo).toBe("Mensalidade em Atraso");

    // Por hint/código estruturado
    const erroHint = mapearErroRpc({
      message: "Qualquer mensagem",
      hint: "INADIMPLENTE",
    });
    expect(erroHint.codigo).toBe("INADIMPLENTE");
  });

  it("deve mapear múltiplos alunos no login", () => {
    const erro = mapearErroRpc({
      message: "Mais de um aluno neste login: informe qual (p_aluno_id)",
    });
    expect(erro.codigo).toBe("MULTIPLOS_ALUNOS");
    expect(erro.titulo).toBe("Múltiplos Alunos Encontrados");
  });

  it("deve mapear CPF duplicado", () => {
    const erro = mapearErroRpc({
      message: "Já existe um cadastro com esse CPF nesta academia. Procure a recepção.",
      code: "23505",
    });
    expect(erro.codigo).toBe("CPF_DUPLICADO");
    expect(erro.titulo).toBe("CPF Já Cadastrado");
  });

  it("deve mapear menor de idade sem dados do responsável", () => {
    const erro = mapearErroRpc({
      message: "Menores de idade precisam de responsável (nome e CPF)",
    });
    expect(erro.codigo).toBe("MENOR_SEM_RESPONSAVEL");
    expect(erro.titulo).toBe("Dados do Responsável Necessários");
  });

  it("deve mapear matrícula indisponível", () => {
    const erro = mapearErroRpc({
      message: "Matrícula online indisponível. Procure a direção da escola.",
    });
    expect(erro.codigo).toBe("MATRICULA_INDISPONIVEL");
  });

  it("deve retornar GENERICO para erros não mapeados sem quebrar", () => {
    const erro = mapearErroRpc({
      message: "Falha de rede ou timeout temporário",
    });
    expect(erro.codigo).toBe("GENERICO");
    expect(erro.mensagem).toBe("Falha de rede ou timeout temporário");
  });
});
