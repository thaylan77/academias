import { describe, it, expect } from "vitest";
import { mapearErroRpc, isErroAutenticacao } from "../lib/rpc-errors";

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

  it("deve mapear erros de autenticação (401 / JWT expirado) para sessao_expirada", () => {
    const erroJwt = {
      status: 401,
      message: "JWT expired",
    };
    const mapeado = mapearErroRpc(erroJwt);
    expect(mapeado.codigo).toBe("sessao_expirada");
    expect(mapeado.titulo).toBe("Sessão Encerrada");
    expect(mapeado.mensagem).toBe("Sessão encerrada, faça login novamente.");
  });

  it("deve retornar GENERICO para erros não mapeados sem quebrar", () => {
    const erro = {
      message: "Falha de rede ou timeout temporário",
    };
    expect(mapearErroRpc(erro).codigo).toBe("GENERICO");
  });

  it("deve mapear JWT expirado do PostgREST pelo código PGRST301", () => {
    const resultado = mapearErroRpc({ code: "PGRST301", message: "JWT expired" });
    expect(resultado.codigo).toBe("sessao_expirada");
    expect(isErroAutenticacao({ code: "PGRST301", message: "JWT expired" })).toBe(true);
  });

  it("deve mapear sessão ausente do Supabase Auth pelo tipo do erro", () => {
    expect(isErroAutenticacao({ name: "AuthSessionMissingError", message: "Auth session missing!" })).toBe(true);
    expect(isErroAutenticacao({ status: 400, code: "refresh_token_not_found" })).toBe(true);
  });

  it("o hint da RPC prevalece sobre qualquer sinal de autenticação", () => {
    const erro = {
      code: "P0001",
      status: 401,
      hint: "sem_permissao",
      message: "Unauthorized: sessão expirada, JWT expired",
    };
    expect(isErroAutenticacao(erro)).toBe(false);
    expect(mapearErroRpc(erro).codigo).toBe("sem_permissao");
  });

  it("não decide autenticação pelo texto da mensagem", () => {
    for (const message of ["JWT expired", "Unauthorized", "Sessão expirada", "invalid refresh token"]) {
      expect(isErroAutenticacao({ message })).toBe(false);
      expect(isErroAutenticacao(new Error(message))).toBe(false);
    }
    expect(isErroAutenticacao("JWT expired")).toBe(false);
    expect(mapearErroRpc({ message: "Unauthorized" }).codigo).toBe("GENERICO");
  });

  it("erro de rede, 429 e 5xx não são erro de autenticação", () => {
    expect(isErroAutenticacao(new TypeError("Failed to fetch"))).toBe(false);
    expect(isErroAutenticacao({ status: 429 })).toBe(false);
    expect(isErroAutenticacao({ status: 503 })).toBe(false);
    expect(isErroAutenticacao(null)).toBe(false);
  });

  it("código de autenticação do PostgREST vale mesmo que o erro traga hint", () => {
    // O PostgREST pode mandar hint próprio; esses códigos nunca vêm de raise exception nosso.
    const erro = { code: "PGRST301", message: "JWT expired", hint: "Faça login de novo" };
    expect(isErroAutenticacao(erro)).toBe(true);
    expect(mapearErroRpc(erro).codigo).toBe("sessao_expirada");
  });

  it("requisição sem autenticação (PGRST302) é erro de autenticação; PGRST300 não", () => {
    expect(isErroAutenticacao({ code: "PGRST302", message: "Anonymous access is disabled" })).toBe(true);
    expect(isErroAutenticacao({ code: "PGRST300", message: "Server lacks JWT secret" })).toBe(false);
  });

  it("aceita status 401 como número ou texto", () => {
    expect(isErroAutenticacao({ status: "401" })).toBe(true);
    expect(isErroAutenticacao({ statusCode: 401 })).toBe(true);
  });

  it("hint que não é código conhecido cai no genérico, sem virar código", () => {
    const resultado = mapearErroRpc({ code: "42883", message: "function does not exist", hint: "No function matches" });
    expect(resultado.codigo).toBe("GENERICO");
  });
});
