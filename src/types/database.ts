export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      academias: {
        Row: {
          cnpj: string | null
          configuracoes: Json
          created_at: string
          dias_tolerancia: number
          fuso: string
          id: string
          logo_url: string | null
          matricula_online_aberta: boolean
          nome: string
          plano_saas: string
          slug: string
          status: string
          telefone: string | null
          trial_ate: string
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          configuracoes?: Json
          created_at?: string
          dias_tolerancia?: number
          fuso?: string
          id?: string
          logo_url?: string | null
          matricula_online_aberta?: boolean
          nome: string
          plano_saas?: string
          slug: string
          status?: string
          telefone?: string | null
          trial_ate?: string
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          configuracoes?: Json
          created_at?: string
          dias_tolerancia?: number
          fuso?: string
          id?: string
          logo_url?: string | null
          matricula_online_aberta?: boolean
          nome?: string
          plano_saas?: string
          slug?: string
          status?: string
          telefone?: string | null
          trial_ate?: string
          updated_at?: string
        }
        Relationships: []
      }
      alunos: {
        Row: {
          academia_id: string
          contato_emergencia: string | null
          cpf: string | null
          created_at: string
          data_nascimento: string | null
          email: string | null
          foto_url: string | null
          id: string
          nome: string
          observacoes_medicas: string | null
          responsavel_cpf: string | null
          responsavel_nome: string | null
          responsavel_telefone: string | null
          status: string
          telefone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          academia_id: string
          contato_emergencia?: string | null
          cpf?: string | null
          created_at?: string
          data_nascimento?: string | null
          email?: string | null
          foto_url?: string | null
          id?: string
          nome: string
          observacoes_medicas?: string | null
          responsavel_cpf?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          status?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          academia_id?: string
          contato_emergencia?: string | null
          cpf?: string | null
          created_at?: string
          data_nascimento?: string | null
          email?: string | null
          foto_url?: string | null
          id?: string
          nome?: string
          observacoes_medicas?: string | null
          responsavel_cpf?: string | null
          responsavel_nome?: string | null
          responsavel_telefone?: string | null
          status?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alunos_academia_id_fkey"
            columns: ["academia_id"]
            isOneToOne: false
            referencedRelation: "academias"
            referencedColumns: ["id"]
          },
        ]
      }
      cobrancas: {
        Row: {
          academia_id: string
          aluno_id: string
          created_at: string
          descricao: string | null
          forma_pagamento: string | null
          gateway: string | null
          gateway_id: string | null
          id: string
          link_pagamento: string | null
          matricula_id: string | null
          pago_em: string | null
          status: string
          updated_at: string
          valor: number
          vencimento: string
        }
        Insert: {
          academia_id: string
          aluno_id: string
          created_at?: string
          descricao?: string | null
          forma_pagamento?: string | null
          gateway?: string | null
          gateway_id?: string | null
          id?: string
          link_pagamento?: string | null
          matricula_id?: string | null
          pago_em?: string | null
          status?: string
          updated_at?: string
          valor: number
          vencimento: string
        }
        Update: {
          academia_id?: string
          aluno_id?: string
          created_at?: string
          descricao?: string | null
          forma_pagamento?: string | null
          gateway?: string | null
          gateway_id?: string | null
          id?: string
          link_pagamento?: string | null
          matricula_id?: string | null
          pago_em?: string | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "cobrancas_academia_id_matricula_id_fkey"
            columns: ["academia_id", "matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      faixas: {
        Row: {
          academia_id: string
          cor: string | null
          created_at: string
          id: string
          max_graus: number
          min_aulas: number
          min_meses: number
          modalidade_id: string
          nome: string
          ordem: number
        }
        Insert: {
          academia_id: string
          cor?: string | null
          created_at?: string
          id?: string
          max_graus?: number
          min_aulas?: number
          min_meses?: number
          modalidade_id: string
          nome: string
          ordem: number
        }
        Update: {
          academia_id?: string
          cor?: string | null
          created_at?: string
          id?: string
          max_graus?: number
          min_aulas?: number
          min_meses?: number
          modalidade_id?: string
          nome?: string
          ordem?: number
        }
        Relationships: [
          {
            foreignKeyName: "faixas_academia_id_modalidade_id_fkey"
            columns: ["academia_id", "modalidade_id"]
            isOneToOne: false
            referencedRelation: "modalidades"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      graduacoes: {
        Row: {
          academia_id: string
          aluno_id: string
          created_at: string
          data: string
          faixa_id: string
          grau: number
          id: string
          observacao: string | null
          professor_id: string | null
        }
        Insert: {
          academia_id: string
          aluno_id: string
          created_at?: string
          data?: string
          faixa_id: string
          grau?: number
          id?: string
          observacao?: string | null
          professor_id?: string | null
        }
        Update: {
          academia_id?: string
          aluno_id?: string
          created_at?: string
          data?: string
          faixa_id?: string
          grau?: number
          id?: string
          observacao?: string | null
          professor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graduacoes_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "graduacoes_academia_id_faixa_id_fkey"
            columns: ["academia_id", "faixa_id"]
            isOneToOne: false
            referencedRelation: "faixas"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "graduacoes_academia_id_professor_id_fkey"
            columns: ["academia_id", "professor_id"]
            isOneToOne: false
            referencedRelation: "professores"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      matricula_turmas: {
        Row: {
          academia_id: string
          matricula_id: string
          turma_id: string
        }
        Insert: {
          academia_id: string
          matricula_id: string
          turma_id: string
        }
        Update: {
          academia_id?: string
          matricula_id?: string
          turma_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matricula_turmas_academia_id_matricula_id_fkey"
            columns: ["academia_id", "matricula_id"]
            isOneToOne: false
            referencedRelation: "matriculas"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "matricula_turmas_academia_id_turma_id_fkey"
            columns: ["academia_id", "turma_id"]
            isOneToOne: false
            referencedRelation: "turmas"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      matriculas: {
        Row: {
          academia_id: string
          aluno_id: string
          created_at: string
          data_fim: string | null
          data_inicio: string
          dia_vencimento: number | null
          id: string
          origem: string
          plano_id: string | null
          status: string
          termo_aceito_em: string | null
          updated_at: string
          valor: number | null
        }
        Insert: {
          academia_id: string
          aluno_id: string
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          dia_vencimento?: number | null
          id?: string
          origem?: string
          plano_id?: string | null
          status?: string
          termo_aceito_em?: string | null
          updated_at?: string
          valor?: number | null
        }
        Update: {
          academia_id?: string
          aluno_id?: string
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          dia_vencimento?: number | null
          id?: string
          origem?: string
          plano_id?: string | null
          status?: string
          termo_aceito_em?: string | null
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matriculas_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "matriculas_academia_id_plano_id_fkey"
            columns: ["academia_id", "plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      membros_academia: {
        Row: {
          academia_id: string
          ativo: boolean
          created_at: string
          papel: string
          user_id: string
        }
        Insert: {
          academia_id: string
          ativo?: boolean
          created_at?: string
          papel: string
          user_id: string
        }
        Update: {
          academia_id?: string
          ativo?: boolean
          created_at?: string
          papel?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membros_academia_academia_id_fkey"
            columns: ["academia_id"]
            isOneToOne: false
            referencedRelation: "academias"
            referencedColumns: ["id"]
          },
        ]
      }
      modalidades: {
        Row: {
          academia_id: string
          ativa: boolean
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          academia_id: string
          ativa?: boolean
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          academia_id?: string
          ativa?: boolean
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "modalidades_academia_id_fkey"
            columns: ["academia_id"]
            isOneToOne: false
            referencedRelation: "academias"
            referencedColumns: ["id"]
          },
        ]
      }
      planos: {
        Row: {
          academia_id: string
          ativo: boolean
          aulas_por_semana: number | null
          created_at: string
          id: string
          nome: string
          periodicidade: string
          valor: number
        }
        Insert: {
          academia_id: string
          ativo?: boolean
          aulas_por_semana?: number | null
          created_at?: string
          id?: string
          nome: string
          periodicidade?: string
          valor: number
        }
        Update: {
          academia_id?: string
          ativo?: boolean
          aulas_por_semana?: number | null
          created_at?: string
          id?: string
          nome?: string
          periodicidade?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "planos_academia_id_fkey"
            columns: ["academia_id"]
            isOneToOne: false
            referencedRelation: "academias"
            referencedColumns: ["id"]
          },
        ]
      }
      presencas: {
        Row: {
          academia_id: string
          aluno_id: string
          checkin_em: string
          data: string
          id: string
          origem: string
          registrado_por: string | null
          turma_id: string
        }
        Insert: {
          academia_id: string
          aluno_id: string
          checkin_em?: string
          data: string
          id?: string
          origem?: string
          registrado_por?: string | null
          turma_id: string
        }
        Update: {
          academia_id?: string
          aluno_id?: string
          checkin_em?: string
          data?: string
          id?: string
          origem?: string
          registrado_por?: string | null
          turma_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presencas_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "presencas_academia_id_turma_id_fkey"
            columns: ["academia_id", "turma_id"]
            isOneToOne: false
            referencedRelation: "turmas"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      professores: {
        Row: {
          academia_id: string
          ativo: boolean
          created_at: string
          email: string | null
          id: string
          nome: string
          telefone: string | null
          user_id: string | null
        }
        Insert: {
          academia_id: string
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          telefone?: string | null
          user_id?: string | null
        }
        Update: {
          academia_id?: string
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professores_academia_id_fkey"
            columns: ["academia_id"]
            isOneToOne: false
            referencedRelation: "academias"
            referencedColumns: ["id"]
          },
        ]
      }
      turma_horarios: {
        Row: {
          academia_id: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id: string
          turma_id: string
        }
        Insert: {
          academia_id: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id?: string
          turma_id: string
        }
        Update: {
          academia_id?: string
          dia_semana?: number
          hora_fim?: string
          hora_inicio?: string
          id?: string
          turma_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turma_horarios_academia_id_turma_id_fkey"
            columns: ["academia_id", "turma_id"]
            isOneToOne: false
            referencedRelation: "turmas"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      turmas: {
        Row: {
          academia_id: string
          ativa: boolean
          capacidade: number | null
          created_at: string
          id: string
          modalidade_id: string
          nome: string
          professor_id: string | null
          publico: string
        }
        Insert: {
          academia_id: string
          ativa?: boolean
          capacidade?: number | null
          created_at?: string
          id?: string
          modalidade_id: string
          nome: string
          professor_id?: string | null
          publico?: string
        }
        Update: {
          academia_id?: string
          ativa?: boolean
          capacidade?: number | null
          created_at?: string
          id?: string
          modalidade_id?: string
          nome?: string
          professor_id?: string | null
          publico?: string
        }
        Relationships: [
          {
            foreignKeyName: "turmas_academia_id_modalidade_id_fkey"
            columns: ["academia_id", "modalidade_id"]
            isOneToOne: false
            referencedRelation: "modalidades"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "turmas_academia_id_professor_id_fkey"
            columns: ["academia_id", "professor_id"]
            isOneToOne: false
            referencedRelation: "professores"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
    }
    Views: {
      vw_graduacao_atual: {
        Row: {
          academia_id: string | null
          aluno_id: string | null
          cor: string | null
          faixa: string | null
          faixa_id: string | null
          graduado_em: string | null
          grau: number | null
          modalidade_id: string | null
          ordem: number | null
        }
        Relationships: [
          {
            foreignKeyName: "graduacoes_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
          {
            foreignKeyName: "graduacoes_academia_id_faixa_id_fkey"
            columns: ["academia_id", "faixa_id"]
            isOneToOne: false
            referencedRelation: "faixas"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      vw_inadimplentes: {
        Row: {
          academia_id: string | null
          aluno_id: string | null
          cobrancas_atrasadas: number | null
          nome: string | null
          telefone: string | null
          total_atrasado: number | null
          vencimento_mais_antigo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
      vw_progresso_graduacao: {
        Row: {
          academia_id: string | null
          aluno: string | null
          aluno_id: string | null
          apto: boolean | null
          aulas_desde: number | null
          faixa: string | null
          graduado_em: string | null
          grau: number | null
          meses_desde: number | null
          min_aulas: number | null
          min_meses: number | null
          modalidade_id: string | null
          proximo_passo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graduacoes_academia_id_aluno_id_fkey"
            columns: ["academia_id", "aluno_id"]
            isOneToOne: false
            referencedRelation: "alunos"
            referencedColumns: ["academia_id", "id"]
          },
        ]
      }
    }
    Functions: {
      academia_ativa: { Args: { p_academia_id: string }; Returns: boolean }
      academia_publica: { Args: { p_slug: string }; Returns: Json }
      criar_academia: {
        Args: { p_nome: string; p_slug: string }
        Returns: string
      }
      fazer_checkin: {
        Args: { p_aluno_id?: string; p_turma_id: string }
        Returns: string
      }
      matricula_online: {
        Args: { p_dados: Json; p_slug: string }
        Returns: string
      }
      pode_gerir: {
        Args: { p_academia_id: string; p_papeis: string[] }
        Returns: boolean
      }
      sou_o_aluno: { Args: { p_aluno_id: string }; Returns: boolean }
      tem_papel: {
        Args: { p_academia_id: string; p_papeis?: string[] }
        Returns: boolean
      }
      vincular_meu_cadastro_aluno: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
