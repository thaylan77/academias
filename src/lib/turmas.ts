import { supabase } from "./supabase";
import { PapelPainel } from "./painel";
import { telefoneE164 } from "./alunos";

/**
 * Turmas, horários e o catálogo que elas usam (modalidades e professores),
 * no painel da equipe. Toda consulta filtra pela academia selecionada; quem
 * protege é o RLS. Erro que a tela trata é decidido pelo `hint` (ou pelo
 * código do Postgres), nunca pelo texto.
 */

export type Publico = "adulto" | "infantil" | "misto" | "feminino";

export const ROTULO_PUBLICO: Record<Publico, string> = {
  adulto: "Adulto",
  infantil: "Infantil",
  misto: "Misto",
  feminino: "Feminino",
};

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export interface Horario {
  dia_semana: number; // 0 = domingo
  hora_inicio: string; // "HH:MM", hora local da academia
  hora_fim: string;
}

export interface Modalidade {
  id: string;
  nome: string;
  ativa: boolean;
}

export interface Professor {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
}

export interface Turma {
  id: string;
  nome: string;
  modalidade_id: string;
  modalidade: string;
  professor_id: string | null;
  professor: string | null;
  publico: Publico;
  capacidade: number | null;
  ativa: boolean;
  horarios: Horario[];
}

export interface MatriculadoNaTurma {
  matricula_id: string;
  aluno_id: string;
  nome: string;
  status: string;
  data_inicio: string;
  data_fim: string | null;
}

// ------------------------------------------------------------------ permissões (só o que a tela mostra)

/** Turmas e catálogo: só dono e admin gravam, com a assinatura em dia. */
export function podeGerirTurmas(papel: PapelPainel, academiaAtiva: boolean): boolean {
  return academiaAtiva && (papel === "dono" || papel === "admin");
}

// ------------------------------------------------------------------ horários

function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** "HH:MM:SS" do banco vira "HH:MM". */
export function horaCurta(hora: string): string {
  return hora.slice(0, 5);
}

export function ordenarHorarios(horarios: Horario[]): Horario[] {
  return [...horarios].sort((a, b) => a.dia_semana - b.dia_semana || minutos(a.hora_inicio) - minutos(b.hora_inicio));
}

export function descreverHorario(h: Horario): string {
  return `${DIAS_SEMANA[h.dia_semana]}, ${horaCurta(h.hora_inicio)} às ${horaCurta(h.hora_fim)}`;
}

/**
 * Mesmas regras da salvar_turma, para avisar antes de gravar: dia de 0 a 6,
 * "HH:MM", fim depois do início e sem sobreposição no mesmo dia. Devolve a
 * mensagem por linha (índice) ou null se estiver tudo certo.
 */
export function conferirHorarios(horarios: Horario[]): Record<number, string> | null {
  const erros: Record<number, string> = {};
  const formato = /^([01]\d|2[0-3]):[0-5]\d$/;
  horarios.forEach((h, i) => {
    if (!Number.isInteger(h.dia_semana) || h.dia_semana < 0 || h.dia_semana > 6) erros[i] = "Escolha o dia.";
    else if (!formato.test(h.hora_inicio) || !formato.test(h.hora_fim)) erros[i] = "Informe início e fim.";
    else if (minutos(h.hora_fim) <= minutos(h.hora_inicio)) erros[i] = "O fim precisa ser depois do início.";
  });
  // Só os erros de formato tiram a linha da comparação: uma linha marcada por
  // sobreposição continua sendo comparada com as seguintes.
  const comFormatoRuim = new Set(Object.keys(erros).map(Number));
  horarios.forEach((a, i) => {
    horarios.forEach((b, j) => {
      if (j <= i || comFormatoRuim.has(i) || comFormatoRuim.has(j) || a.dia_semana !== b.dia_semana) return;
      if (minutos(a.hora_inicio) < minutos(b.hora_fim) && minutos(b.hora_inicio) < minutos(a.hora_fim)) {
        erros[j] ??= `Sobrepõe o horário de ${DIAS_SEMANA[a.dia_semana].toLowerCase()} das ${a.hora_inicio}.`;
      }
    });
  });
  return Object.keys(erros).length ? erros : null;
}

// ------------------------------------------------------------------ leitura

export interface Catalogo {
  modalidades: Modalidade[];
  professores: Professor[];
}

export async function lerCatalogo(academiaId: string): Promise<Catalogo> {
  if (!supabase) return { modalidades: [], professores: [] };
  const [m, p] = await Promise.all([
    supabase.from("modalidades").select("id, nome, ativa").eq("academia_id", academiaId).order("nome"),
    supabase.from("professores").select("id, nome, telefone, email, ativo").eq("academia_id", academiaId).order("nome"),
  ]);
  if (m.error) throw m.error;
  if (p.error) throw p.error;
  return { modalidades: m.data ?? [], professores: p.data ?? [] };
}

type LinhaTurma = {
  id: string;
  nome: string;
  modalidade_id: string;
  professor_id: string | null;
  publico: string;
  capacidade: number | null;
  ativa: boolean;
  modalidades: { nome: string } | null;
  professores: { nome: string } | null;
  turma_horarios: Array<{ dia_semana: number; hora_inicio: string; hora_fim: string }>;
};

function paraTurma(t: LinhaTurma): Turma {
  const publico = (["adulto", "infantil", "misto", "feminino"] as const).find((p) => p === t.publico) ?? "adulto";
  return {
    id: t.id,
    nome: t.nome,
    modalidade_id: t.modalidade_id,
    modalidade: t.modalidades?.nome ?? "",
    professor_id: t.professor_id,
    professor: t.professores?.nome ?? null,
    publico,
    capacidade: t.capacidade,
    ativa: t.ativa,
    horarios: ordenarHorarios(
      (t.turma_horarios ?? []).map((h) => ({
        dia_semana: h.dia_semana,
        hora_inicio: horaCurta(h.hora_inicio),
        hora_fim: horaCurta(h.hora_fim),
      }))
    ),
  };
}

const COLUNAS_TURMA =
  "id, nome, modalidade_id, professor_id, publico, capacidade, ativa, modalidades(nome), professores(nome), turma_horarios(dia_semana, hora_inicio, hora_fim)" as const;

export async function listarTurmas(academiaId: string): Promise<Turma[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("turmas")
    .select(COLUNAS_TURMA)
    .eq("academia_id", academiaId)
    .order("nome");
  if (error) throw error;
  return (data ?? []).map(paraTurma);
}

export class TurmaNaoEncontrada extends Error {
  constructor() {
    super("Turma não encontrada nesta academia.");
    this.name = "TurmaNaoEncontrada";
  }
}

// O PostgREST devolve no máximo 1.000 linhas por consulta.
const PAGINA = 1000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turma e as matrículas que valem no dia `hoje` (AAAA-MM-DD, no fuso da
 * academia): não canceladas, já começadas e não terminadas. O filtro roda no
 * servidor, em páginas, para uma turma com histórico longo não mostrar só
 * matrículas antigas.
 */
export async function lerTurma(
  academiaId: string,
  turmaId: string,
  hoje: string
): Promise<{ turma: Turma; matriculados: MatriculadoNaTurma[] }> {
  if (!DATA.test(hoje)) throw new Error("Data inválida.");
  if (!supabase) throw new TurmaNaoEncontrada();
  const { data, error } = await supabase
    .from("turmas")
    .select(COLUNAS_TURMA)
    .eq("academia_id", academiaId)
    .eq("id", turmaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TurmaNaoEncontrada();

  type Vinculo = {
    matricula_id: string;
    matriculas: { id: string; status: string; data_inicio: string; data_fim: string | null; aluno_id: string; alunos: { nome: string } | null } | null;
  };
  const vinculos: Vinculo[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data: mt, error: erroMt } = await supabase
      .from("matricula_turmas")
      .select("matricula_id, matriculas!inner(id, status, data_inicio, data_fim, aluno_id, alunos(nome))")
      .eq("academia_id", academiaId)
      .eq("turma_id", turmaId)
      .neq("matriculas.status", "cancelada")
      .lte("matriculas.data_inicio", hoje)
      .or(`data_fim.is.null,data_fim.gte.${hoje}`, { referencedTable: "matriculas" })
      .order("matricula_id")
      .range(inicio, inicio + PAGINA - 1);
    if (erroMt) throw erroMt;
    vinculos.push(...(mt ?? []));
    if (!mt || mt.length < PAGINA) break;
  }

  const matriculados = vinculos
    .map((linha) => linha.matriculas)
    .filter((m): m is NonNullable<typeof m> => !!m && m.status !== "cancelada")
    .map((m) => ({
      matricula_id: m.id,
      aluno_id: m.aluno_id,
      nome: m.alunos?.nome ?? "",
      status: m.status,
      data_inicio: m.data_inicio,
      data_fim: m.data_fim,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return { turma: paraTurma(data), matriculados };
}

/**
 * Matrícula que vale hoje: não cancelada, começou e não terminou. `hoje` é o
 * dia no fuso da academia. O servidor já filtra assim; a tela confere de novo.
 */
export function matriculaVigente(m: MatriculadoNaTurma, hoje: string): boolean {
  return m.data_inicio <= hoje && (!m.data_fim || m.data_fim >= hoje);
}

// ------------------------------------------------------------------ gravação

export type Resultado = { sucesso: true; id: string } | { sucesso: false; mensagem: string };

export interface DadosTurma {
  nome: string;
  modalidade_id: string;
  professor_id: string | null;
  publico: Publico;
  capacidade: number | null;
  ativa: boolean;
  horarios: Horario[];
}

const MSG_REDE = "Não foi possível salvar. Verifique a conexão e tente de novo.";
const MSG_SEM_PERMISSAO = "Só o dono e a administração alteram turmas, e só com a assinatura da academia em dia.";
const MSG_CATALOGO_SEM_PERMISSAO = "Só o dono e a administração alteram o catálogo, e só com a assinatura da academia em dia.";
// Edição sem linha devolvida: o registro não é desta academia, ou o RLS o
// escondeu da gravação. O banco não diz qual dos dois.
const MSG_CATALOGO_SEM_LINHA =
  "Não foi possível salvar: o registro não está nesta academia, ou seu papel (ou a assinatura) não permite alterar o catálogo.";

export async function salvarTurma(academiaId: string, dados: DadosTurma, turmaId?: string): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const { data, error } = await supabase.rpc("salvar_turma", {
    p_academia_id: academiaId,
    ...(turmaId ? { p_turma_id: turmaId } : {}),
    p_dados: {
      nome: dados.nome.trim(),
      modalidade_id: dados.modalidade_id,
      professor_id: dados.professor_id,
      publico: dados.publico,
      capacidade: dados.capacidade,
      ativa: dados.ativa,
      horarios: dados.horarios.map((h) => ({ dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fim: h.hora_fim })),
    },
  });
  if (!error && typeof data === "string") return { sucesso: true, id: data };
  switch (error?.hint) {
    case "sem_permissao":
      return { sucesso: false, mensagem: MSG_SEM_PERMISSAO };
    case "horario_invalido":
      return { sucesso: false, mensagem: "Há horário inválido: confira o dia e se o fim é depois do início." };
    case "horario_sobreposto":
      return { sucesso: false, mensagem: "Há horários que se sobrepõem no mesmo dia." };
    case "turma_com_presencas":
      return {
        sucesso: false,
        mensagem: "Esta turma já tem presenças e não pode mudar de modalidade (isso mudaria o progresso de graduação dos alunos). Crie uma turma nova na outra modalidade e desative esta.",
      };
    case "turma_nao_encontrada":
      return { sucesso: false, mensagem: "Turma não encontrada nesta academia." };
    case "dados_invalidos":
      return { sucesso: false, mensagem: "Confira os dados da turma: nome, modalidade, professor, público e capacidade." };
    default:
      return { sucesso: false, mensagem: MSG_REDE };
  }
}

function mensagemCatalogo(erro: { code?: string | null }, duplicado: string): string {
  if (erro.code === "23505") return duplicado;
  if (erro.code === "42501") return MSG_CATALOGO_SEM_PERMISSAO;
  return MSG_REDE;
}

export async function salvarModalidade(
  academiaId: string,
  dados: { nome: string; ativa: boolean },
  id?: string
): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const nome = dados.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2) return { sucesso: false, mensagem: "Informe o nome da modalidade." };
  const consulta = id
    ? supabase.from("modalidades").update({ nome, ativa: dados.ativa }).eq("academia_id", academiaId).eq("id", id)
    : supabase.from("modalidades").insert({ academia_id: academiaId, nome, ativa: dados.ativa });
  const { data, error } = await consulta.select("id").maybeSingle();
  if (error) return { sucesso: false, mensagem: mensagemCatalogo(error, "Já existe uma modalidade com esse nome.") };
  if (!data) return { sucesso: false, mensagem: MSG_CATALOGO_SEM_LINHA };
  return { sucesso: true, id: data.id };
}

export async function salvarProfessor(
  academiaId: string,
  dados: { nome: string; telefone: string; email: string; ativo: boolean },
  id?: string
): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const nome = dados.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2) return { sucesso: false, mensagem: "Informe o nome do professor." };
  let telefone: string | null = null;
  if (dados.telefone.trim()) {
    telefone = telefoneE164(dados.telefone);
    if (!telefone) return { sucesso: false, mensagem: "Telefone com DDD, por exemplo (85) 99999-9999." };
  }
  const email = dados.email.trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { sucesso: false, mensagem: "E-mail inválido." };

  const linha = { nome, telefone, email, ativo: dados.ativo };
  const consulta = id
    ? supabase.from("professores").update(linha).eq("academia_id", academiaId).eq("id", id)
    : supabase.from("professores").insert({ ...linha, academia_id: academiaId });
  const { data, error } = await consulta.select("id").maybeSingle();
  if (error) return { sucesso: false, mensagem: mensagemCatalogo(error, MSG_REDE) };
  if (!data) return { sucesso: false, mensagem: MSG_CATALOGO_SEM_LINHA };
  return { sucesso: true, id: data.id };
}
