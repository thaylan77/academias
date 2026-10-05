export type CodigoErroRpc =
  | "INADIMPLENTE"
  | "MULTIPLOS_ALUNOS"
  | "CPF_DUPLICADO"
  | "MENOR_SEM_RESPONSAVEL"
  | "NOME_OBRIGATORIO"
  | "TERMO_NAO_ACEITO"
  | "PLANO_INVALIDO"
  | "TURMA_NAO_ENCONTRADA"
  | "ACADEMIA_SUSPENSA"
  | "SEM_MATRICULA_ATIVA"
  | "MATRICULA_INDISPONIVEL"
  | "EMAIL_NAO_CONFIRMADO"
  | "ACESSO_NEGADO_EQUIPE"
  | "GENERICO";

export interface ErroRpcMapeado {
  codigo: CodigoErroRpc;
  titulo: string;
  mensagem: string;
  acaoSugerida?: string;
  detalhesOriginais?: any;
}

/**
 * Centralizador de tratamento de erros das RPCs do Supabase.
 *
 * REGRA DE NEGÓCIO:
 * No PostgreSQL/Supabase, todo `raise exception` emite o SQLSTATE genérico 'P0001' em error.code.
 * Portanto, error.code NÃO deve ser usado para distinguir erros de negócio.
 * O código canônico da regra de negócio é emitido pelo banco exclusivamente em `error.hint`.
 *
 * Ordem de prioridade:
 * 1. error.hint (código de negócio emitido pela RPC: ex. INADIMPLENTE, MULTIPLOS_ALUNOS)
 * 2. error.code exclusivamente para constraints do PostgreSQL (ex. 23505 = unique_violation)
 * 3. error.message (matching de texto em mensagens legadas)
 */
export function mapearErroRpc(error: any): ErroRpcMapeado {
  if (!error) {
    return {
      codigo: "GENERICO",
      titulo: "Erro Inesperado",
      mensagem: "Ocorreu uma falha na comunicação com o servidor.",
    };
  }

  const rawHint = typeof error?.hint === "string" ? error.hint.trim().toUpperCase() : "";
  const rawCode = typeof error?.code === "string" ? error.code.trim().toUpperCase() : "";
  const rawMessage = (typeof error === "string" ? error : error?.message || "").toLowerCase();

  // 1. PRIORIDADE MÁXIMA: Código de negócio semântico vindo em error.hint
  if (rawHint) {
    if (rawHint.includes("INADIMPLENTE") || rawHint.includes("DEBT")) {
      return {
        codigo: "INADIMPLENTE",
        titulo: "Mensalidade em Atraso",
        mensagem: "Check-in bloqueado: mensalidade em atraso.",
        acaoSugerida: "Procure a recepção ou acerte sua fatura pelo portal do aluno.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("MULTIPLOS_ALUNOS") || rawHint.includes("AMBIGUOUS_STUDENT")) {
      return {
        codigo: "MULTIPLOS_ALUNOS",
        titulo: "Múltiplos Alunos no Acesso",
        mensagem: "Mais de um aluno associado a este cadastro para esta turma.",
        acaoSugerida: "Selecione qual dependente está presente no treino.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("CPF_DUPLICADO")) {
      return {
        codigo: "CPF_DUPLICADO",
        titulo: "CPF Já Cadastrado",
        mensagem: "Já existe um cadastro com esse CPF nesta academia.",
        acaoSugerida: "Procure a recepção da academia para reativar ou atualizar sua matrícula.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("MENOR_SEM_RESPONSAVEL")) {
      return {
        codigo: "MENOR_SEM_RESPONSAVEL",
        titulo: "Responsável Obrigatório",
        mensagem: "Menores de 18 anos precisam dos dados do responsável legal.",
        acaoSugerida: "Preencha o nome completo e o CPF do pai, mãe ou responsável legal.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("MATRICULA_INDISPONIVEL")) {
      return {
        codigo: "MATRICULA_INDISPONIVEL",
        titulo: "Matrículas Online Suspensas",
        mensagem: "Matrícula online indisponível. Procure a direção da escola.",
        acaoSugerida: "Entre em contato diretamente pelos canais oficiais da academia.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("TURMA_NAO_ENCONTRADA")) {
      return {
        codigo: "TURMA_NAO_ENCONTRADA",
        titulo: "Turma Não Localizada",
        mensagem: "A turma especificada não foi encontrada ou foi inativada.",
        acaoSugerida: "Verifique o QR Code ou selecione outra turma ativa no totem.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("PLANO_INVALIDO")) {
      return {
        codigo: "PLANO_INVALIDO",
        titulo: "Plano Inválido",
        mensagem: "O plano selecionado não está disponível para esta academia.",
        acaoSugerida: "Escolha outro plano disponível na lista.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("ACADEMIA_SUSPENSA")) {
      return {
        codigo: "ACADEMIA_SUSPENSA",
        titulo: "Acesso Suspenso",
        mensagem: "A academia está com acesso suspenso temporariamente.",
        acaoSugerida: "Procure a administração da unidade.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("SEM_MATRICULA_ATIVA")) {
      return {
        codigo: "SEM_MATRICULA_ATIVA",
        titulo: "Sem Matrícula Nesta Turma",
        mensagem: "Nenhuma matrícula ativa nesta turma para este login.",
        acaoSugerida: "Verifique se você está matriculado nesta modalidade ou fale com seu instrutor.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("EMAIL_NAO_CONFIRMADO")) {
      return {
        codigo: "EMAIL_NAO_CONFIRMADO",
        titulo: "Confirmação de E-mail Pendente",
        mensagem: "Confirme seu e-mail antes de acessar o portal do aluno.",
        acaoSugerida: "Verifique a caixa de entrada do seu e-mail para ativar seu acesso.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("NOME_OBRIGATORIO")) {
      return {
        codigo: "NOME_OBRIGATORIO",
        titulo: "Nome Incompleto",
        mensagem: "Por favor, informe seu nome e sobrenome completo.",
        detalhesOriginais: error,
      };
    }

    if (rawHint.includes("TERMO_NAO_ACEITO")) {
      return {
        codigo: "TERMO_NAO_ACEITO",
        titulo: "Termo de Responsabilidade",
        mensagem: "É obrigatório aceitar o termo de responsabilidade para prosseguir.",
        detalhesOriginais: error,
      };
    }
  }

  // 2. PRIORIDADE SECUNDÁRIA: SQLSTATE de violação de constraint do PostgreSQL
  // Atenção: ignora 'P0001' (raise exception) pois não é específico
  if (rawCode === "23505") {
    return {
      codigo: "CPF_DUPLICADO",
      titulo: "CPF Já Cadastrado",
      mensagem: "Já existe um cadastro com esse CPF nesta academia. Procure a recepção.",
      acaoSugerida: "Se já foi nosso aluno, seu histórico pode ser reativado na recepção.",
      detalhesOriginais: error,
    };
  }

  // 3. PRIORIDADE TERCIÁRIA: Mensagens legadas via matching de texto
  if (rawMessage.includes("mensalidade em atraso") || rawMessage.includes("check-in bloqueado")) {
    return {
      codigo: "INADIMPLENTE",
      titulo: "Mensalidade em Atraso",
      mensagem: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
      acaoSugerida: "Acesse o portal do aluno para regularizar sua pendência ou fale com a recepção.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("mais de um aluno neste login")) {
    return {
      codigo: "MULTIPLOS_ALUNOS",
      titulo: "Múltiplos Alunos Encontrados",
      mensagem: "Mais de um aluno neste login: informe qual está no treino.",
      acaoSugerida: "Selecione o dependente desejado na lista abaixo.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("já existe um cadastro com esse cpf")) {
    return {
      codigo: "CPF_DUPLICADO",
      titulo: "CPF Já Cadastrado",
      mensagem: "Já existe um cadastro com esse CPF nesta academia. Procure a recepção.",
      acaoSugerida: "Se já foi nosso aluno, seu histórico pode ser reativado na recepção.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("menores de idade precisam de responsável")) {
    return {
      codigo: "MENOR_SEM_RESPONSAVEL",
      titulo: "Dados do Responsável Necessários",
      mensagem: "Menores de idade precisam de responsável (nome e CPF).",
      acaoSugerida: "Informe os dados completos do responsável pelo aluno.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("matrícula online indisponível")) {
    return {
      codigo: "MATRICULA_INDISPONIVEL",
      titulo: "Matrículas Online Suspensas",
      mensagem: "Matrícula online indisponível. Procure a direção da escola.",
      acaoSugerida: "Entre em contato diretamente pelos canais oficiais da academia.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("informe o nome completo")) {
    return {
      codigo: "NOME_OBRIGATORIO",
      titulo: "Nome Incompleto",
      mensagem: "Por favor, informe seu nome e sobrenome completo.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("aceitar o termo de responsabilidade")) {
    return {
      codigo: "TERMO_NAO_ACEITO",
      titulo: "Termo de Responsabilidade",
      mensagem: "É obrigatório aceitar o termo de responsabilidade para prosseguir.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("plano inválido")) {
    return {
      codigo: "PLANO_INVALIDO",
      titulo: "Plano Inválido",
      mensagem: "O plano selecionado não está disponível para esta academia.",
      acaoSugerida: "Escolha outro plano disponível na lista.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("turma não encontrada")) {
    return {
      codigo: "TURMA_NAO_ENCONTRADA",
      titulo: "Turma Não Localizada",
      mensagem: "A turma especificada não foi encontrada ou foi inativada.",
      acaoSugerida: "Verifique o QR Code ou selecione outra turma ativa no totem.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("academia com acesso suspenso")) {
    return {
      codigo: "ACADEMIA_SUSPENSA",
      titulo: "Acesso Suspenso",
      mensagem: "A academia está com acesso suspenso temporariamente.",
      acaoSugerida: "Procure a administração da unidade.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("nenhuma matrícula ativa nesta turma")) {
    return {
      codigo: "SEM_MATRICULA_ATIVA",
      titulo: "Sem Matrícula Nesta Turma",
      mensagem: "Nenhuma matrícula ativa nesta turma para este login.",
      acaoSugerida: "Verifique se você está matriculado nesta modalidade ou fale com seu instrutor.",
      detalhesOriginais: error,
    };
  }

  if (rawMessage.includes("confirme seu e-mail")) {
    return {
      codigo: "EMAIL_NAO_CONFIRMADO",
      titulo: "Confirmação de E-mail Pendente",
      mensagem: "Confirme seu e-mail antes de acessar o portal do aluno.",
      acaoSugerida: "Verifique a caixa de entrada do seu e-mail para ativar seu acesso.",
      detalhesOriginais: error,
    };
  }

  return {
    codigo: "GENERICO",
    titulo: "Aviso",
    mensagem: error.message || "Não foi possível concluir a operação.",
    detalhesOriginais: error,
  };
}
