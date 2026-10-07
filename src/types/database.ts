
import { AcademiaPublica, MatriculaOnlinePayload, TurmaAbertaTotem, TokenCheckinInfo } from "./app";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "academias": {
                  Row: {
                    "checkin_antecedencia_min": number,"checkin_token_segundos": number,"cnpj": string | null,"configuracoes": NonNullable<Json>,"created_at": string,"dias_antecedencia_cobranca": number,"dias_tolerancia": number,"fuso": string,"id": string,"logo_url": string | null,"matricula_online_aberta": boolean,"nome": string,"plano_saas": string,"slug": string,"status": string,"telefone": string | null,"trial_ate": string,"updated_at": string
                  }
                  Insert: {
                    "checkin_antecedencia_min"?: number,"checkin_token_segundos"?: number,"cnpj"?: string | null,"configuracoes"?: NonNullable<Json>,"created_at"?: string,"dias_antecedencia_cobranca"?: number,"dias_tolerancia"?: number,"fuso"?: string,"id"?: string,"logo_url"?: string | null,"matricula_online_aberta"?: boolean,"nome": string,"plano_saas"?: string,"slug": string,"status"?: string,"telefone"?: string | null,"trial_ate"?: string,"updated_at"?: string
                  }
                  Update: {
                    "checkin_antecedencia_min"?: number,"checkin_token_segundos"?: number,"cnpj"?: string | null,"configuracoes"?: NonNullable<Json>,"created_at"?: string,"dias_antecedencia_cobranca"?: number,"dias_tolerancia"?: number,"fuso"?: string,"id"?: string,"logo_url"?: string | null,"matricula_online_aberta"?: boolean,"nome"?: string,"plano_saas"?: string,"slug"?: string,"status"?: string,"telefone"?: string | null,"trial_ate"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"alunos": {
                  Row: {
                    "academia_id": string,"anonimizado_em": string | null,"contato_emergencia": string | null,"cpf": string | null,"created_at": string,"data_nascimento": string | null,"email": string | null,"foto_url": string | null,"id": string,"nome": string,"observacoes_medicas": string | null,"responsavel_cpf": string | null,"responsavel_nome": string | null,"responsavel_telefone": string | null,"status": string,"telefone": string | null,"updated_at": string,"user_id": string | null,"aluno_sem_dados_pessoais": boolean | null
                  }
                  Insert: {
                    "academia_id": string,"anonimizado_em"?: string | null,"contato_emergencia"?: string | null,"cpf"?: string | null,"created_at"?: string,"data_nascimento"?: string | null,"email"?: string | null,"foto_url"?: string | null,"id"?: string,"nome": string,"observacoes_medicas"?: string | null,"responsavel_cpf"?: string | null,"responsavel_nome"?: string | null,"responsavel_telefone"?: string | null,"status"?: string,"telefone"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "academia_id"?: string,"anonimizado_em"?: string | null,"contato_emergencia"?: string | null,"cpf"?: string | null,"created_at"?: string,"data_nascimento"?: string | null,"email"?: string | null,"foto_url"?: string | null,"id"?: string,"nome"?: string,"observacoes_medicas"?: string | null,"responsavel_cpf"?: string | null,"responsavel_nome"?: string | null,"responsavel_telefone"?: string | null,"status"?: string,"telefone"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "alunos_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: false
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"checkin_segredos": {
                  Row: {
                    "academia_id": string,"created_at": string,"rotacionado_em": string | null,"segredo": string
                  }
                  Insert: {
                    "academia_id": string,"created_at"?: string,"rotacionado_em"?: string | null,"segredo"?: string
                  }
                  Update: {
                    "academia_id"?: string,"created_at"?: string,"rotacionado_em"?: string | null,"segredo"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkin_segredos_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: true
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"cobrancas": {
                  Row: {
                    "academia_id": string,"aluno_id": string,"baixa_em": string | null,"baixa_por": string | null,"competencia": string | null,"created_at": string,"descricao": string | null,"divergencia": string | null,"emissao_gateway_conta_id": string | null,"emissao_iniciada_em": string | null,"emissao_recusa": string | null,"emissao_tentativa": string | null,"forma_pagamento": string | null,"gateway_conta_id": string | null,"gateway_id": string | null,"id": string,"link_pagamento": string | null,"matricula_id": string | null,"pago_em": string | null,"status": string,"updated_at": string,"valor": number,"valor_pago": number | null,"vencimento": string
                  }
                  Insert: {
                    "academia_id": string,"aluno_id": string,"baixa_em"?: string | null,"baixa_por"?: string | null,"competencia"?: string | null,"created_at"?: string,"descricao"?: string | null,"divergencia"?: string | null,"emissao_gateway_conta_id"?: string | null,"emissao_iniciada_em"?: string | null,"emissao_recusa"?: string | null,"emissao_tentativa"?: string | null,"forma_pagamento"?: string | null,"gateway_conta_id"?: string | null,"gateway_id"?: string | null,"id"?: string,"link_pagamento"?: string | null,"matricula_id"?: string | null,"pago_em"?: string | null,"status"?: string,"updated_at"?: string,"valor": number,"valor_pago"?: number | null,"vencimento": string
                  }
                  Update: {
                    "academia_id"?: string,"aluno_id"?: string,"baixa_em"?: string | null,"baixa_por"?: string | null,"competencia"?: string | null,"created_at"?: string,"descricao"?: string | null,"divergencia"?: string | null,"emissao_gateway_conta_id"?: string | null,"emissao_iniciada_em"?: string | null,"emissao_recusa"?: string | null,"emissao_tentativa"?: string | null,"forma_pagamento"?: string | null,"gateway_conta_id"?: string | null,"gateway_id"?: string | null,"id"?: string,"link_pagamento"?: string | null,"matricula_id"?: string | null,"pago_em"?: string | null,"status"?: string,"updated_at"?: string,"valor"?: number,"valor_pago"?: number | null,"vencimento"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cobrancas_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "cobrancas_academia_id_emissao_gateway_conta_id_fkey"
      columns: ["academia_id","emissao_gateway_conta_id"]
isOneToOne: false
      referencedRelation: "gateway_contas"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "cobrancas_academia_id_gateway_conta_id_fkey"
      columns: ["academia_id","gateway_conta_id"]
isOneToOne: false
      referencedRelation: "gateway_contas"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "cobrancas_academia_id_matricula_id_fkey"
      columns: ["academia_id","matricula_id"]
isOneToOne: false
      referencedRelation: "matriculas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"faixas": {
                  Row: {
                    "academia_id": string,"cor": string | null,"created_at": string,"id": string,"max_graus": number,"min_aulas": number,"min_meses": number,"modalidade_id": string,"nome": string,"ordem": number
                  }
                  Insert: {
                    "academia_id": string,"cor"?: string | null,"created_at"?: string,"id"?: string,"max_graus"?: number,"min_aulas"?: number,"min_meses"?: number,"modalidade_id": string,"nome": string,"ordem": number
                  }
                  Update: {
                    "academia_id"?: string,"cor"?: string | null,"created_at"?: string,"id"?: string,"max_graus"?: number,"min_aulas"?: number,"min_meses"?: number,"modalidade_id"?: string,"nome"?: string,"ordem"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "faixas_academia_id_modalidade_id_fkey"
      columns: ["academia_id","modalidade_id"]
isOneToOne: false
      referencedRelation: "modalidades"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"gateway_clientes": {
                  Row: {
                    "academia_id": string,"aluno_id": string,"cpf_pagador": string,"created_at": string,"gateway_cliente_id": string,"gateway_conta_id": string
                  }
                  Insert: {
                    "academia_id": string,"aluno_id": string,"cpf_pagador": string,"created_at"?: string,"gateway_cliente_id": string,"gateway_conta_id": string
                  }
                  Update: {
                    "academia_id"?: string,"aluno_id"?: string,"cpf_pagador"?: string,"created_at"?: string,"gateway_cliente_id"?: string,"gateway_conta_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gateway_clientes_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "gateway_clientes_academia_id_gateway_conta_id_fkey"
      columns: ["academia_id","gateway_conta_id"]
isOneToOne: false
      referencedRelation: "gateway_contas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"gateway_contas": {
                  Row: {
                    "academia_id": string,"ambiente": string,"api_key_secret_id": string,"ativa": boolean,"conectada_em": string,"conta_externa_id": string,"created_at": string,"gateway": string,"id": string,"updated_at": string,"webhook_token_hash": string
                  }
                  Insert: {
                    "academia_id": string,"ambiente": string,"api_key_secret_id": string,"ativa"?: boolean,"conectada_em"?: string,"conta_externa_id": string,"created_at"?: string,"gateway": string,"id"?: string,"updated_at"?: string,"webhook_token_hash": string
                  }
                  Update: {
                    "academia_id"?: string,"ambiente"?: string,"api_key_secret_id"?: string,"ativa"?: boolean,"conectada_em"?: string,"conta_externa_id"?: string,"created_at"?: string,"gateway"?: string,"id"?: string,"updated_at"?: string,"webhook_token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gateway_contas_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: false
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"gateway_eventos": {
                  Row: {
                    "academia_id": string,"cobranca_id": string | null,"erro": string | null,"evento_id": string,"gateway_conta_id": string,"id": string,"payload": NonNullable<Json>,"processado_em": string | null,"recebido_em": string,"status": string,"tipo": string | null
                  }
                  Insert: {
                    "academia_id": string,"cobranca_id"?: string | null,"erro"?: string | null,"evento_id": string,"gateway_conta_id": string,"id"?: string,"payload"?: NonNullable<Json>,"processado_em"?: string | null,"recebido_em"?: string,"status"?: string,"tipo"?: string | null
                  }
                  Update: {
                    "academia_id"?: string,"cobranca_id"?: string | null,"erro"?: string | null,"evento_id"?: string,"gateway_conta_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"processado_em"?: string | null,"recebido_em"?: string,"status"?: string,"tipo"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "gateway_eventos_academia_id_cobranca_id_fkey"
      columns: ["academia_id","cobranca_id"]
isOneToOne: false
      referencedRelation: "cobrancas"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "gateway_eventos_academia_id_gateway_conta_id_fkey"
      columns: ["academia_id","gateway_conta_id"]
isOneToOne: false
      referencedRelation: "gateway_contas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"graduacoes": {
                  Row: {
                    "academia_id": string,"aluno_id": string,"created_at": string,"data": string,"faixa_id": string,"grau": number,"id": string,"observacao": string | null,"professor_id": string | null
                  }
                  Insert: {
                    "academia_id": string,"aluno_id": string,"created_at"?: string,"data"?: string,"faixa_id": string,"grau"?: number,"id"?: string,"observacao"?: string | null,"professor_id"?: string | null
                  }
                  Update: {
                    "academia_id"?: string,"aluno_id"?: string,"created_at"?: string,"data"?: string,"faixa_id"?: string,"grau"?: number,"id"?: string,"observacao"?: string | null,"professor_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "graduacoes_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "graduacoes_academia_id_faixa_id_fkey"
      columns: ["academia_id","faixa_id"]
isOneToOne: false
      referencedRelation: "faixas"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "graduacoes_academia_id_professor_id_fkey"
      columns: ["academia_id","professor_id"]
isOneToOne: false
      referencedRelation: "professores"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"matricula_turmas": {
                  Row: {
                    "academia_id": string,"matricula_id": string,"turma_id": string
                  }
                  Insert: {
                    "academia_id": string,"matricula_id": string,"turma_id": string
                  }
                  Update: {
                    "academia_id"?: string,"matricula_id"?: string,"turma_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "matricula_turmas_academia_id_matricula_id_fkey"
      columns: ["academia_id","matricula_id"]
isOneToOne: false
      referencedRelation: "matriculas"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "matricula_turmas_academia_id_turma_id_fkey"
      columns: ["academia_id","turma_id"]
isOneToOne: false
      referencedRelation: "turmas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"matriculas": {
                  Row: {
                    "academia_id": string,"aluno_id": string,"cobrar_a_partir": string,"created_at": string,"data_fim": string | null,"data_inicio": string,"dia_vencimento": number | null,"id": string,"origem": string,"plano_id": string | null,"status": string,"termo_aceito_em": string | null,"updated_at": string,"valor": number | null
                  }
                  Insert: {
                    "academia_id": string,"aluno_id": string,"cobrar_a_partir": string,"created_at"?: string,"data_fim"?: string | null,"data_inicio"?: string,"dia_vencimento"?: number | null,"id"?: string,"origem"?: string,"plano_id"?: string | null,"status"?: string,"termo_aceito_em"?: string | null,"updated_at"?: string,"valor"?: number | null
                  }
                  Update: {
                    "academia_id"?: string,"aluno_id"?: string,"cobrar_a_partir"?: string,"created_at"?: string,"data_fim"?: string | null,"data_inicio"?: string,"dia_vencimento"?: number | null,"id"?: string,"origem"?: string,"plano_id"?: string | null,"status"?: string,"termo_aceito_em"?: string | null,"updated_at"?: string,"valor"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "matriculas_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "matriculas_academia_id_plano_id_fkey"
      columns: ["academia_id","plano_id"]
isOneToOne: false
      referencedRelation: "planos"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"membros_academia": {
                  Row: {
                    "academia_id": string,"ativo": boolean,"created_at": string,"papel": string,"user_id": string
                  }
                  Insert: {
                    "academia_id": string,"ativo"?: boolean,"created_at"?: string,"papel": string,"user_id": string
                  }
                  Update: {
                    "academia_id"?: string,"ativo"?: boolean,"created_at"?: string,"papel"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membros_academia_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: false
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"modalidades": {
                  Row: {
                    "academia_id": string,"ativa": boolean,"created_at": string,"id": string,"nome": string
                  }
                  Insert: {
                    "academia_id": string,"ativa"?: boolean,"created_at"?: string,"id"?: string,"nome": string
                  }
                  Update: {
                    "academia_id"?: string,"ativa"?: boolean,"created_at"?: string,"id"?: string,"nome"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "modalidades_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: false
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"planos": {
                  Row: {
                    "academia_id": string,"ativo": boolean,"aulas_por_semana": number | null,"created_at": string,"id": string,"nome": string,"periodicidade": string,"valor": number
                  }
                  Insert: {
                    "academia_id": string,"ativo"?: boolean,"aulas_por_semana"?: number | null,"created_at"?: string,"id"?: string,"nome": string,"periodicidade"?: string,"valor": number
                  }
                  Update: {
                    "academia_id"?: string,"ativo"?: boolean,"aulas_por_semana"?: number | null,"created_at"?: string,"id"?: string,"nome"?: string,"periodicidade"?: string,"valor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "planos_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: false
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"presencas": {
                  Row: {
                    "academia_id": string,"aluno_id": string,"checkin_em": string,"data": string,"id": string,"origem": string,"registrado_por": string | null,"turma_id": string
                  }
                  Insert: {
                    "academia_id": string,"aluno_id": string,"checkin_em"?: string,"data": string,"id"?: string,"origem"?: string,"registrado_por"?: string | null,"turma_id": string
                  }
                  Update: {
                    "academia_id"?: string,"aluno_id"?: string,"checkin_em"?: string,"data"?: string,"id"?: string,"origem"?: string,"registrado_por"?: string | null,"turma_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "presencas_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "presencas_academia_id_turma_id_fkey"
      columns: ["academia_id","turma_id"]
isOneToOne: false
      referencedRelation: "turmas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"professores": {
                  Row: {
                    "academia_id": string,"ativo": boolean,"created_at": string,"email": string | null,"id": string,"nome": string,"telefone": string | null,"user_id": string | null
                  }
                  Insert: {
                    "academia_id": string,"ativo"?: boolean,"created_at"?: string,"email"?: string | null,"id"?: string,"nome": string,"telefone"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "academia_id"?: string,"ativo"?: boolean,"created_at"?: string,"email"?: string | null,"id"?: string,"nome"?: string,"telefone"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "professores_academia_id_fkey"
      columns: ["academia_id"]
isOneToOne: false
      referencedRelation: "academias"
      referencedColumns: ["id"]
    }
                  ]
                },"turma_horarios": {
                  Row: {
                    "academia_id": string,"dia_semana": number,"hora_fim": string,"hora_inicio": string,"id": string,"turma_id": string
                  }
                  Insert: {
                    "academia_id": string,"dia_semana": number,"hora_fim": string,"hora_inicio": string,"id"?: string,"turma_id": string
                  }
                  Update: {
                    "academia_id"?: string,"dia_semana"?: number,"hora_fim"?: string,"hora_inicio"?: string,"id"?: string,"turma_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "turma_horarios_academia_id_turma_id_fkey"
      columns: ["academia_id","turma_id"]
isOneToOne: false
      referencedRelation: "turmas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"turmas": {
                  Row: {
                    "academia_id": string,"ativa": boolean,"capacidade": number | null,"created_at": string,"id": string,"modalidade_id": string,"nome": string,"professor_id": string | null,"publico": string
                  }
                  Insert: {
                    "academia_id": string,"ativa"?: boolean,"capacidade"?: number | null,"created_at"?: string,"id"?: string,"modalidade_id": string,"nome": string,"professor_id"?: string | null,"publico"?: string
                  }
                  Update: {
                    "academia_id"?: string,"ativa"?: boolean,"capacidade"?: number | null,"created_at"?: string,"id"?: string,"modalidade_id"?: string,"nome"?: string,"professor_id"?: string | null,"publico"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "turmas_academia_id_modalidade_id_fkey"
      columns: ["academia_id","modalidade_id"]
isOneToOne: false
      referencedRelation: "modalidades"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "turmas_academia_id_professor_id_fkey"
      columns: ["academia_id","professor_id"]
isOneToOne: false
      referencedRelation: "professores"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                }
          }
          Views: {
            "vw_graduacao_atual": {
                  Row: {
                    "academia_id": string | null,"aluno_id": string | null,"cor": string | null,"faixa": string | null,"faixa_id": string | null,"graduado_em": string | null,"grau": number | null,"modalidade_id": string | null,"ordem": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "graduacoes_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    },{
      foreignKeyName: "graduacoes_academia_id_faixa_id_fkey"
      columns: ["academia_id","faixa_id"]
isOneToOne: false
      referencedRelation: "faixas"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"vw_inadimplentes": {
                  Row: {
                    "academia_id": string | null,"aluno_id": string | null,"cobrancas_atrasadas": number | null,"nome": string | null,"telefone": string | null,"total_atrasado": number | null,"vencimento_mais_antigo": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "cobrancas_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                },"vw_progresso_graduacao": {
                  Row: {
                    "academia_id": string | null,"aluno": string | null,"aluno_id": string | null,"apto": boolean | null,"aulas_desde": number | null,"faixa": string | null,"graduado_em": string | null,"grau": number | null,"meses_desde": number | null,"min_aulas": number | null,"min_meses": number | null,"modalidade_id": string | null,"proximo_passo": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "graduacoes_academia_id_aluno_id_fkey"
      columns: ["academia_id","aluno_id"]
isOneToOne: false
      referencedRelation: "alunos"
      referencedColumns: ["academia_id","id"]
    }
                  ]
                }
          }
          Functions: {
            "academia_ativa":
{ Args: { "p_academia_id": string }; Returns: boolean
                           },
"academia_publica":
{ Args: { "p_slug": string }; Returns: AcademiaPublica
                           },
"aluno_sem_dados_pessoais":
{ Args: { "p_aluno": Database["public"]['Tables']["alunos"]['Row'] }; Returns: boolean
                           },
"anonimizar_aluno":
{ Args: { "p_aluno_id": string }; Returns: undefined
                           },
"aplicar_pagamento_gateway":
{ Args: { "p_divergencia"?: string,"p_estado": string,"p_evento_id": string,"p_forma"?: string,"p_gateway_conta_id": string,"p_gateway_id": string,"p_pago_em"?: string,"p_referencia": string,"p_valor_pago"?: number }; Returns: string
                           },
"baixar_cobranca_interna":
{ Args: { "p_cobranca_id": string,"p_forma"?: string,"p_pago_em"?: string,"p_user_id": string,"p_valor_pago"?: number }; Returns: undefined
                           },
"baixar_cobranca_manual":
{ Args: { "p_cobranca_id": string,"p_forma"?: string,"p_pago_em"?: string,"p_valor_pago"?: number }; Returns: undefined
                           },
"cancelar_cobranca":
{ Args: { "p_cobranca_id": string }; Returns: undefined
                           },
"cancelar_cobranca_interna":
{ Args: { "p_cobranca_id": string,"p_user_id": string }; Returns: undefined
                           },
"checkin_aulas_abertas":
{ Args: { "p_academia_id": string }; Returns: {
              "dia": string,"hora_fim": string,"hora_inicio": string,"turma_id": string
            }[]
                           },
"checkin_data_aula":
{ Args: { "p_turma_id": string }; Returns: string
                           },
"checkin_janela_atual":
{ Args: { "p_academia_id": string }; Returns: number
                           },
"checkin_token_da_janela":
{ Args: { "p_janela": number,"p_turma_id": string }; Returns: string
                           },
"criar_academia":
{ Args: { "p_nome": string,"p_slug": string }; Returns: string
                           },
"emitir_token_checkin":
{ Args: { "p_turma_id": string }; Returns: TokenCheckinInfo
                           },
"fazer_checkin":
{ Args: { "p_aluno_id"?: string,"p_token": string,"p_turma_id": string }; Returns: string
                           },
"gateway_credencial":
{ Args: { "p_gateway_conta_id": string }; Returns: string
                           },
"gateway_salvar_conta":
{ Args: { "p_academia_id": string,"p_ambiente": string,"p_api_key": string,"p_conta_externa_id": string,"p_gateway": string,"p_user_id": string,"p_webhook_token_hash": string }; Returns: string
                           },
"gerar_cobrancas":
{ Args: { "p_academia_id"?: string,"p_matricula_id"?: string }; Returns: number
                           },
"gerar_cobrancas_matricula":
{ Args: { "p_matricula_id": string }; Returns: number
                           },
"hoje_academia":
{ Args: { "p_academia_id": string }; Returns: string
                           },
"liberar_emissao_interna":
{ Args: { "p_cobranca_id": string,"p_recusa": string,"p_tentativa": string }; Returns: undefined
                           },
"matricula_online":
{ Args: { "p_dados": MatriculaOnlinePayload,"p_slug": string }; Returns: string
                           },
"membro_pode_gerir":
{ Args: { "p_academia_id": string,"p_papeis": (string)[],"p_user_id": string }; Returns: boolean
                           },
"pode_gerir":
{ Args: { "p_academia_id": string,"p_papeis": (string)[] }; Returns: boolean
                           },
"registrar_emissao_interna":
{ Args: { "p_cobranca_id": string,"p_gateway_conta_id": string,"p_gateway_id": string,"p_link_pagamento": string,"p_tentativa": string }; Returns: undefined
                           },
"reservar_emissao_interna":
{ Args: { "p_cobranca_id": string,"p_gateway_conta_id": string,"p_tentativa_conferida"?: string,"p_user_id": string }; Returns: Json
                           },
"rotacionar_segredo_checkin":
{ Args: { "p_academia_id": string }; Returns: undefined
                           },
"sou_o_aluno":
{ Args: { "p_aluno_id": string }; Returns: boolean
                           },
"tem_papel":
{ Args: { "p_academia_id": string,"p_papeis"?: (string)[] }; Returns: boolean
                           },
"totem_turmas_agora":
{ Args: { "p_academia_id": string }; Returns: TurmaAbertaTotem[]
                           },
"vincular_meu_cadastro_aluno":
{ Args: Record<PropertyKey, never>; Returns: number
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
