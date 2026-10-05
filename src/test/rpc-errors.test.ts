import { describe, it, expect } from "vitest";
import { mapearErroRpc } from "../lib/rpc-errors";

describe("Centralizador de Tratamento de Erros de RPC (mapearErroRpc)", () => {
  it("deve priorizar error.hint sobre o SQLSTATE genérico P0001 de raise exception", () => {
    // Simula a resposta típica do PostgreSQL/PostgREST para raise exception '...' using hint = 'INADIMPLENTE'
    const erroComHint = {
      message: "Check-in bloqueado: procure a recepção",
      code: "P0001", // SQLSTATE emitido para todo raise exception no Postgres
      hint: "INADIMPLENTE",
    };

    const mapeado = mapearErroRpc(erroComHint);
    expect(mapeado.codigo).toBe("INADIMPLENTE");
    expect(mapeado.titulo).toBe("Mensalidade em Atraso");
  });

  it("deve mapear múltiplos alunos usando error.hint mesmo com code P0001", () => {
    const erro = {
      message: "Qualquer mensagem customizada da procedure",
      code: "P0001",
      hint: "MULTIPLOS_ALUNOS",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("MULTIPLOS_ALUNOS");
    expect(mapeado.titulo).toBe("Múltiplos Alunos no Acesso");
  });

  it("deve mapear menor sem responsável usando error.hint com code P0001", () => {
    const erro = {
      message: "Menores de 18 anos precisam de responsável legal",
      code: "P0001",
      hint: "MENOR_SEM_RESPONSAVEL",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("MENOR_SEM_RESPONSAVEL");
    expect(mapeado.titulo).toBe("Responsável Obrigatório");
  });

  it("deve mapear SQLSTATE 23505 como chave duplicada (CPF)", () => {
    const erro = {
      message: "duplicate key value violates unique constraint 'alunos_academia_id_cpf_key'",
      code: "23505",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("CPF_DUPLICADO");
    expect(mapeado.titulo).toBe("CPF Já Cadastrado");
  });

  it("deve fazer fallback por texto para mensagens legadas sem hint", () => {
    const erroTexto = {
      message: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
      code: "P0001",
    };

    const mapeado = mapearErroRpc(erroTexto);
    expect(mapeado.codigo).toBe("INADIMPLENTE");
  });

  it("deve mapear matrícula indisponível", () => {
    const erro = {
      message: "Matrícula online indisponível. Procure a direção da escola.",
    };
    expect(mapearErroRpc(erro).codigo).toBe("MATRICULA_INDISPONIVEL");
  });

  it("deve retornar GENERICO para erros não mapeados sem quebrar", () => {
    const erro = {
      message: "Falha de rede ou timeout temporário",
    };
    expect(mapearErroRpc(erro).codigo).toBe("GENERICO");
  });
});
