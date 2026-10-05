import { Database } from "./database";

export interface HorarioTurma {
  dia_semana: number; // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab
  inicio: string;     // '18:00'
  fim: string;        // '19:00'
}

export interface TurmaPublica {
  id: string;
  nome: string;
  modalidade_id: string;
  publico: string; // 'adulto' | 'infantil' | 'todos'
  horarios: HorarioTurma[];
}

export interface ModalidadePublica {
  id: string;
  nome: string;
}

export interface PlanoPublico {
  id: string;
  nome: string;
  valor: number;
  periodicidade: string; // 'mensal' | 'trimestral' | 'semestral' | 'anual'
}

export interface AcademiaPublica {
  id: string;
  nome: string;
  logo_url: string | null;
  matricula_online_aberta: boolean;
  modalidades: ModalidadePublica[];
  turmas: TurmaPublica[];
  planos: PlanoPublico[];
}

export interface MatriculaOnlinePayload {
  nome: string;
  cpf?: string;
  data_nascimento?: string; // YYYY-MM-DD
  telefone?: string;
  email?: string;
  responsavel_nome?: string;
  responsavel_cpf?: string;
  responsavel_telefone?: string;
  contato_emergencia?: string;
  observacoes_medicas?: string;
  aceite_termo: boolean;
  plano_id?: string;
  turma_ids?: string[];
}

export interface AlunoCheckinInfo {
  id: string;
  nome: string;
  status: string;
}

export interface CheckinResultado {
  sucesso: boolean;
  presenca_id?: string;
  mensagem: string;
  titulo?: string;
  aluno_nome?: string;
  turma_nome?: string;
  horario?: string;
  codigo_erro?: string;
  acao_sugerida?: string;
  alunos_disponiveis?: AlunoCheckinInfo[];
}

export type MembroEquipePapel = "dono" | "admin" | "professor" | "recepcao" | "totem";

export interface UsuarioEquipe {
  id: string;
  nome: string;
  email: string;
  papel: MembroEquipePapel;
}
