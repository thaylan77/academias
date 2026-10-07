export type CodigoErroRpc =
  | "checkin_token_invalido"
  | "academia_suspensa"
  | "checkin_fora_do_horario"
  | "checkin_sem_matricula"
  | "checkin_multiplos_alunos"
  | "checkin_inadimplente"
  | "matricula_fechada"
  | "cpf_duplicado"
  | "menor_sem_responsavel"
  | "dados_invalidos"
  | "sem_permissao"
  | "sessao_expirada"
  | "GENERICO";

export interface CandidatoDependente {
  id: string;
  nome: string;
}

export interface ErroRpcMapeado {
  codigo: CodigoErroRpc;
  titulo: string;
  mensagem: string;
  acaoSugerida?: string;
  candidatosDependentes?: CandidatoDependente[];
  detalhesOriginais?: any;
}

// Códigos com que o PostgREST e o Supabase Auth recusam um JWT ou uma sessão.
// O erro de RPC (PostgrestError) não traz o status HTTP: a decisão é pelo código.
const CODIGOS_ERRO_AUTENTICACAO = new Set([
  "pgrst301", // PostgREST: JWT expirado ou inválido
  "pgrst302", // PostgREST: requisição sem autenticação
  "pgrst303", // PostgREST: claims do JWT recusadas
  "bad_jwt",
  "no_authorization",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
]);

/**
 * Detecta sessão expirada, revogada ou JWT inválido, por status, código ou
 * tipo do erro, nunca pelo texto da mensagem.
 *
 * Os códigos da lista vêm do PostgREST e do Auth, nunca de um `raise
 * exception` nosso, então valem mesmo que o erro traga `hint`. Fora deles,
 * erro com `hint` é erro de negócio de uma RPC e é decidido pelo hint: não
 * conta como falha de autenticação, mesmo com status 401 ou texto
 * "unauthorized".
 */
export function isErroAutenticacao(error: any): boolean {
  if (!error || typeof error !== "object") return false;

  const code = typeof error.code === "string" ? error.code.trim().toLowerCase() : error.code;
  if (CODIGOS_ERRO_AUTENTICACAO.has(code)) return true;
  if (typeof error.hint === "string" && error.hint.trim()) return false;

  if (error.name === "AuthSessionMissingError") return true;
  const status = Number(error.status ?? error.statusCode);
  return status === 401 || Number(code) === 401;
}

/**
 * Retorna true se o erro do totem é transitório (rede, timeout, 5xx, erro não identificado),
 * permitindo retentativa automática com espera crescente.
 */
export function isErroTransitorioTotem(erro: ErroRpcMapeado): boolean {
  return (
    erro.codigo !== "academia_suspensa" &&
    erro.codigo !== "sem_permissao" &&
    erro.codigo !== "sessao_expirada"
  );
}

/**
 * Centralizador de tratamento de erros das RPCs do Supabase.
 *
 * REGRA DE NEGÓCIO:
 * No PostgreSQL/Supabase, todo `raise exception` emite o SQLSTATE genérico 'P0001' em error.code.
 * O código canônico da regra de negócio é emitido pelo banco exclusivamente em `error.hint`.
 *
 * Ordem de prioridade:
 * 1. error.hint (código canônico emitido pela RPC via using hint = '<codigo>')
 * 2. Erro de autenticação (401, PGRST301, sessão ausente) -> sessão encerrada.
 *    Só vale para erro sem hint (ver isErroAutenticacao).
 * 3. error.code para constraints do PostgreSQL (ex. 23505 = unique_violation)
 * 4. Fallback genérico para erros de rede, timeout ou não mapeados.
 */
export function mapearErroRpc(error: any): ErroRpcMapeado {
  if (!error) {
    return {
      codigo: "GENERICO",
      titulo: "Erro Inesperado",
      mensagem: "Ocorreu uma falha na comunicação com o servidor.",
    };
  }

  // Sessão/JWT expirado ou revogado. isErroAutenticacao devolve false para
  // erro com hint, então o código de negócio da RPC sempre prevalece.
  if (isErroAutenticacao(error)) {
    return {
      codigo: "sessao_expirada",
      titulo: "Sessão Encerrada",
      mensagem: "Sessão encerrada, faça login novamente.",
      acaoSugerida: "Informe suas credenciais para continuar operando o totem.",
      detalhesOriginais: error,
    };
  }

  const rawHint = typeof error?.hint === "string" ? error.hint.trim().toLowerCase() : "";
  const rawCode = typeof error?.code === "string" ? error.code.trim().toUpperCase() : "";
  const rawMessage = (typeof error === "string" ? error : error?.message || "").toLowerCase();

  // 1. PRIORIDADE MÁXIMA: Código de negócio canônico emitido no hint pelo PostgreSQL
  if (rawHint) {
    if (rawHint === "checkin_token_invalido") {
      return {
        codigo: "checkin_token_invalido",
        titulo: "QR Code Expirado ou Inválido",
        mensagem: "O token do check-in expirou ou a turma selecionada não está ativa.",
        acaoSugerida: "Aponte sua câmera novamente para o QR Code atualizado no totem da academia.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "checkin_inadimplente") {
      return {
        codigo: "checkin_inadimplente",
        titulo: "Mensalidade em Atraso",
        mensagem: "Check-in bloqueado: mensalidade em atraso.",
        acaoSugerida: "Procure a recepção ou acerte sua fatura pelo portal do aluno.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "checkin_multiplos_alunos") {
      let candidatos: CandidatoDependente[] = [];
      try {
        const detailsValue = error?.details || error?.detail;
        if (typeof detailsValue === "string" && detailsValue.trim()) {
          candidatos = JSON.parse(detailsValue);
        } else if (Array.isArray(detailsValue)) {
          candidatos = detailsValue;
        }
      } catch {
        candidatos = [];
      }

      return {
        codigo: "checkin_multiplos_alunos",
        titulo: "Múltiplos Alunos no Acesso",
        mensagem: "Mais de um aluno associado a este cadastro para esta turma.",
        acaoSugerida: "Selecione qual dependente está presente no treino.",
        candidatosDependentes: candidatos,
        detalhesOriginais: error,
      };
    }

    if (rawHint === "checkin_fora_do_horario") {
      return {
        codigo: "checkin_fora_do_horario",
        titulo: "Fora da Janela da Aula",
        mensagem: "O check-in para esta aula ainda não abriu ou já foi encerrado.",
        acaoSugerida: "O check-in fica disponível minutos antes do treino e encerra ao final da aula.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "checkin_sem_matricula") {
      return {
        codigo: "checkin_sem_matricula",
        titulo: "Sem Matrícula na Turma",
        mensagem: "Você não possui matrícula ativa nesta turma.",
        acaoSugerida: "Verifique se está na turma correta ou procure a recepção para ajustar sua matrícula.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "academia_suspensa") {
      return {
        codigo: "academia_suspensa",
        titulo: "Acesso da academia suspenso",
        mensagem: "A academia está com acesso suspenso temporariamente.",
        acaoSugerida: "Procure a administração da unidade para regularização.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "matricula_fechada") {
      return {
        codigo: "matricula_fechada",
        titulo: "Matrículas Online Suspensas",
        mensagem: "Matrícula online indisponível para esta unidade no momento.",
        acaoSugerida: "Entre em contato diretamente pelos canais oficiais da academia.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "cpf_duplicado") {
      return {
        codigo: "cpf_duplicado",
        titulo: "CPF Já Cadastrado",
        mensagem: "Já existe um cadastro com esse CPF nesta academia.",
        acaoSugerida: "Procure a recepção da academia para reativar ou atualizar sua matrícula.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "menor_sem_responsavel") {
      return {
        codigo: "menor_sem_responsavel",
        titulo: "Responsável Obrigatório",
        mensagem: "Menores de 18 anos precisam dos dados do responsável legal.",
        acaoSugerida: "Preencha o nome completo e o CPF do pai, mãe ou responsável legal.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "dados_invalidos") {
      return {
        codigo: "dados_invalidos",
        titulo: "Dados Incompletos ou Inválidos",
        mensagem: "Os dados informados contêm erros ou campos obrigatórios não preenchidos.",
        acaoSugerida: "Revise os campos do formulário e tente novamente.",
        detalhesOriginais: error,
      };
    }

    if (rawHint === "sem_permissao") {
      return {
        codigo: "sem_permissao",
        titulo: "Acesso Não Permitido",
        mensagem: "Este login não pode operar o totem.",
        acaoSugerida: "Verifique suas credenciais ou solicite acesso à administração da academia.",
        detalhesOriginais: error,
      };
    }
  }

  // 2. Constraint violation do PostgreSQL (CPF duplicado)
  if (rawCode === "23505") {
    return {
      codigo: "cpf_duplicado",
      titulo: "CPF Já Cadastrado",
      mensagem: "Já existe um cadastro com esse CPF nesta academia. Procure a recepção.",
      acaoSugerida: "Se já foi nosso aluno, seu histórico pode ser reativado na recepção.",
      detalhesOriginais: error,
    };
  }

  // 3. Fallback restrito para mensagens legadas sem hint
  if (rawMessage.includes("mensalidade em atraso") || rawMessage.includes("inadimplente")) {
    return {
      codigo: "checkin_inadimplente",
      titulo: "Mensalidade em Atraso",
      mensagem: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
      acaoSugerida: "Acesse o portal do aluno para regularizar sua pendência ou fale com a recepção.",
      detalhesOriginais: error,
    };
  }

  return {
    codigo: "GENERICO",
    titulo: "Falha na Operação",
    mensagem: error?.message || "Não foi possível concluir a solicitação. Tente novamente.",
    acaoSugerida: "Se o problema persistir, entre em contato com a equipe da academia.",
    detalhesOriginais: error,
  };
}
