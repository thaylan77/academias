import { describe, it, expect } from "vitest";
import { mapearErroRpc } from "../lib/rpc-errors";

describe("Centralizador de Tratamento de Erros de RPC (mapearErroRpc)", () => {
  it("deve priorizar error.hint sobre o SQLSTATE genérico P0001 de raise exception", () => {
    // Simula a resposta do PostgreSQL/PostgREST para raise exception '...' using hint = 'checkin_inadimplente'
    const erroComHint = {
      message: "Check-in bloqueado: procure a recepção",
      code: "P0001", // SQLSTATE emitido para todo raise exception no Postgres
      hint: "checkin_inadimplente",
    };

    const mapeado = mapearErroRpc(erroComHint);
    expect(mapeado.codigo).toBe("checkin_inadimplente");
    expect(mapeado.titulo).toBe("Mensalidade em Atraso");
    expect(mapeado.acaoSugerida).toBeDefined();
  });

  it("deve mapear checkin_multiplos_alunos e extrair a lista de dependentes de error.details", () => {
    const candidatosMock = [
      { id: "aluno-1", nome: "Lucas Silva" },
      { id: "aluno-2", nome: "Mariana Silva" },
    ];
    const erro = {
      message: "Mais de um aluno associado a este login",
      code: "P0001",
      hint: "checkin_multiplos_alunos",
      details: JSON.stringify(candidatosMock),
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("checkin_multiplos_alunos");
    expect(mapeado.titulo).toBe("Múltiplos Alunos no Acesso");
    expect(mapeado.candidatosDependentes).toEqual(candidatosMock);
  });

  it("deve mapear checkin_token_invalido e sugerir novo escaneamento", () => {
    const erro = {
      message: "Token inválido ou expirado",
      code: "P0001",
      hint: "checkin_token_invalido",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("checkin_token_invalido");
    expect(mapeado.titulo).toBe("QR Code Expirado ou Inválido");
    expect(mapeado.acaoSugerida).toContain("totem");
  });

  it("deve mapear checkin_fora_do_horario", () => {
    const erro = {
      message: "Fora do horário permitido",
      code: "P0001",
      hint: "checkin_fora_do_horario",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("checkin_fora_do_horario");
    expect(mapeado.titulo).toBe("Fora da Janela da Aula");
  });

  it("deve mapear menor_sem_responsavel usando error.hint", () => {
    const erro = {
      message: "Menores de 18 anos precisam de responsável legal",
      code: "P0001",
      hint: "menor_sem_responsavel",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("menor_sem_responsavel");
    expect(mapeado.titulo).toBe("Responsável Obrigatório");
  });

  it("deve mapear SQLSTATE 23505 como chave duplicada (CPF)", () => {
    const erro = {
      message: "duplicate key value violates unique constraint 'alunos_academia_id_cpf_key'",
      code: "23505",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("cpf_duplicado");
    expect(mapeado.titulo).toBe("CPF Já Cadastrado");
  });

  it("deve mapear matricula_fechada via hint", () => {
    const erro = {
      message: "Matrícula online encerrada nesta unidade",
      hint: "matricula_fechada",
    };

    const mapeado = mapearErroRpc(erro);
    expect(mapeado.codigo).toBe("matricula_fechada");
    expect(mapeado.titulo).toBe("Matrículas Online Suspensas");
  });

  it("deve fazer fallback por texto para mensagens legadas sem hint", () => {
    const erroTexto = {
      message: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
      code: "P0001",
    };

    const mapeado = mapearErroRpc(erroTexto);
    expect(mapeado.codigo).toBe("checkin_inadimplente");
  });

  it("deve retornar GENERICO para erros não mapeados sem quebrar", () => {
    const erro = {
      message: "Falha de rede ou timeout temporário",
    };
    expect(mapearErroRpc(erro).codigo).toBe("GENERICO");
  });
});
