import { supabase } from "./supabase";
import { PapelPainel } from "./painel";

/**
 * Matrículas no painel: lista, aprovação das pendentes da matrícula online,
 * matrícula pela recepção, encerrar, trancar e destrancar. Toda consulta
 * filtra pela academia selecionada; quem protege é o RLS. Toda gravação é por
 * RPC (criar_matricula, aprovar_matricula, encerrar_matricula,
 * trancar_matricula, destrancar_matricula), e o erro que a tela trata é
 * decidido pelo `hint`, nunca pelo texto.
 */

// "desconhecido": status que o banco passou a usar e a tela ainda não conhece.
// Nunca aceita ação.
export type StatusMatricula = "pendente" | "ativa" | "trancada" | "cancelada" | "desconhecido";

export interface Matricula {
  id: string;
  aluno_id: string;
  aluno: string;
  plano_id: string | null;
  plano: string | null;
  status: StatusMatricula;
  origem: "recepcao" | "online";
  data_inicio: string;
  data_fim: string | null;
  dia_vencimento: number | null;
  valor: number | null;
  turmas: { id: string; nome: string }[];
}

export interface Plano {
  id: string;
  nome: string;
  valor: number;
  periodicidade: string;
}

// ------------------------------------------------------------------ regras de tela

/** Ver matrículas: dono, admin e recepção (o menu esconde do professor). */
export function podeVerMatriculas(papel: PapelPainel): boolean {
  return papel === "dono" || papel === "admin" || papel === "recepcao";
}

/** Gravar: dono, admin e recepção com a assinatura em dia (pode_gerir). */
export function podeGerirMatriculas(papel: PapelPainel, academiaAtiva: boolean): boolean {
  return academiaAtiva && podeVerMatriculas(papel);
}

/** Situação na tela: "encerrada" é ativa ou trancada com fim antes de hoje. */
export type SituacaoMatricula = "pendente" | "ativa" | "trancada" | "encerrada" | "cancelada" | "desconhecido";

export function situacaoDa(m: Matricula, hoje: string): SituacaoMatricula {
  if ((m.status === "ativa" || m.status === "trancada") && m.data_fim !== null && m.data_fim < hoje) return "encerrada";
  return m.status;
}

export const podeEncerrar = (m: Matricula) => m.status === "ativa" || m.status === "trancada";
export const podeTrancar = (m: Matricula, hoje: string) => m.status === "ativa" && situacaoDa(m, hoje) === "ativa";
// Trancada que já terminou não destranca (o banco recusa com matricula_nao_trancada).
export const podeDestrancar = (m: Matricula, hoje: string) => m.status === "trancada" && situacaoDa(m, hoje) === "trancada";

export type FiltroSituacao = SituacaoMatricula | "todas";

export function filtrarMatriculas(lista: Matricula[], filtro: { situacao: FiltroSituacao; aluno: string }, hoje: string): Matricula[] {
  const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const termo = sem(filtro.aluno.trim());
  return lista.filter((m) => {
    if (filtro.situacao !== "todas" && situacaoDa(m, hoje) !== filtro.situacao) return false;
    if (termo && !sem(m.aluno).includes(termo)) return false;
    return true;
  });
}

// ------------------------------------------------------------------ datas

// AAAA-MM-DD que existe no calendário (sem 31/02).
export function dataExiste(data: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toISOString().slice(0, 10) === data;
}

// ------------------------------------------------------------------ leitura

const PAGINA = 1000;

export async function listarMatriculas(academiaId: string): Promise<Matricula[]> {
  if (!supabase) return [];
  type Linha = {
    id: string; aluno_id: string; plano_id: string | null; status: string; origem: string; data_inicio: string;
    data_fim: string | null; dia_vencimento: number | null; valor: number | null;
    alunos: { nome: string } | null; planos: { nome: string } | null;
    matricula_turmas: { turma_id: string; turmas: { nome: string } | null }[] | null;
  };
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("matriculas")
      .select("id, aluno_id, plano_id, status, origem, data_inicio, data_fim, dia_vencimento, valor, alunos(nome), planos(nome), matricula_turmas(turma_id, turmas(nome))")
      .eq("academia_id", academiaId)
      .order("data_inicio", { ascending: false })
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas.map((m) => ({
    id: m.id,
    aluno_id: m.aluno_id,
    aluno: m.alunos?.nome ?? "",
    plano_id: m.plano_id,
    plano: m.planos?.nome ?? null,
    status: (["pendente", "ativa", "trancada", "cancelada"] as const).find((s) => s === m.status) ?? "desconhecido",
    origem: m.origem === "online" ? "online" : "recepcao",
    data_inicio: m.data_inicio,
    data_fim: m.data_fim,
    dia_vencimento: m.dia_vencimento,
    valor: m.valor === null ? null : Number(m.valor),
    turmas: (m.matricula_turmas ?? [])
      .map((t) => ({ id: t.turma_id, nome: t.turmas?.nome ?? "" }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
  }));
}

/** Planos ativos da academia, para a matrícula nova. */
export async function listarPlanos(academiaId: string): Promise<Plano[]> {
  if (!supabase) return [];
  const linhas: Plano[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("planos")
      .select("id, nome, valor, periodicidade")
      .eq("academia_id", academiaId)
      .eq("ativo", true)
      .order("nome")
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []).map((p) => ({ id: p.id, nome: p.nome, valor: Number(p.valor), periodicidade: p.periodicidade })));
    if (!data || data.length < PAGINA) break;
  }
  return linhas;
}

// ------------------------------------------------------------------ gravação

const MSG_REDE = "Não foi possível salvar. Verifique a conexão e tente de novo.";
const MSG_SEM_PERMISSAO =
  "Só o dono, a administração e a recepção alteram matrículas desta academia, e só com a assinatura em dia.";
const MSG_DUPLICADA =
  "O aluno já tem matrícula nesta turma no mesmo período. Para trocar de plano, encerre a antiga na véspera e abra a nova.";
const MSG_DIA_VENCIMENTO = "Com plano, informe o dia de vencimento (1 a 28): sem ele a matrícula nunca seria cobrada.";

/** Mensagem do erro de RPC pelo `hint`; o que a tela não conhece vira falha de rede/genérica. */
function mensagem(hint: string | null | undefined, dadosInvalidos: string): string {
  switch (hint) {
    case "sem_permissao":
      return MSG_SEM_PERMISSAO;
    case "dados_invalidos":
      return dadosInvalidos;
    case "matricula_duplicada":
      return MSG_DUPLICADA;
    case "dia_vencimento_obrigatorio":
      return MSG_DIA_VENCIMENTO;
    case "cobrar_a_partir_invalido":
      return "O mês inicial de cobrança precisa ser o mês atual ou depois, e não antes do mês de início das aulas.";
    case "matricula_nao_pendente":
      return "Esta matrícula não está mais pendente (já foi aprovada ou cancelada). A lista foi atualizada.";
    case "matricula_nao_encerravel":
      return "Só matrícula ativa ou trancada pode ser encerrada. A lista foi atualizada.";
    case "matricula_nao_ativa":
      return "Só matrícula ativa e em andamento pode ser trancada. A lista foi atualizada.";
    case "matricula_nao_trancada":
      return "Esta matrícula não está trancada, ou já terminou. A lista foi atualizada.";
    default:
      return MSG_REDE;
  }
}

export interface FormNovaMatricula {
  aluno_id: string;
  plano_id: string; // "" = sem plano
  turma_ids: string[];
  data_inicio: string;
  dia_vencimento: string;
  valor: string; // "" = valor do plano
  cobrar_a_partir: string; // "AAAA-MM" ou ""
}

export interface DadosNovaMatricula {
  aluno_id: string;
  plano_id: string | null;
  turma_ids: string[];
  data_inicio: string;
  dia_vencimento: number | null;
  valor: number | null;
  cobrar_a_partir: string | null; // AAAA-MM-01
}

/** Valor em reais com até 2 casas ("150", "150,50", "150.50"); null se inválido. */
export function lerValorMatricula(texto: string): number | null {
  const t = texto.trim();
  let normal: string;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(t)) normal = t.replace(",", ".");
  else if (/^\d+(\.\d{1,2})?$/.test(t)) normal = t;
  else return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(normal)) return null;
  return Math.round(Number(normal) * 100) / 100;
}

export function validarNovaMatricula(
  f: FormNovaMatricula,
  hoje: string
): { ok: true; dados: DadosNovaMatricula } | { ok: false; mensagem: string } {
  if (!f.aluno_id) return { ok: false, mensagem: "Escolha o aluno." };
  if (f.turma_ids.length === 0) return { ok: false, mensagem: "Escolha pelo menos uma turma." };
  if (!dataExiste(f.data_inicio)) return { ok: false, mensagem: "Informe a data de início." };
  let dia: number | null = null;
  if (f.dia_vencimento.trim()) {
    dia = Number(f.dia_vencimento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 28) return { ok: false, mensagem: "O dia de vencimento vai de 1 a 28." };
  }
  if (f.plano_id && dia === null) return { ok: false, mensagem: MSG_DIA_VENCIMENTO };
  let valor: number | null = null;
  if (f.valor.trim()) {
    valor = lerValorMatricula(f.valor);
    if (valor === null) return { ok: false, mensagem: "Valor inválido." };
  }
  let cobrar: string | null = null;
  if (f.cobrar_a_partir) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.cobrar_a_partir)) return { ok: false, mensagem: "Mês inicial de cobrança inválido." };
    cobrar = `${f.cobrar_a_partir}-01`;
    if (cobrar < `${hoje.slice(0, 7)}-01` || cobrar < `${f.data_inicio.slice(0, 7)}-01`) {
      return { ok: false, mensagem: "O mês inicial de cobrança precisa ser o mês atual ou depois, e não antes do mês de início das aulas." };
    }
  }
  return {
    ok: true,
    dados: {
      aluno_id: f.aluno_id,
      plano_id: f.plano_id || null,
      turma_ids: [...new Set(f.turma_ids)],
      data_inicio: f.data_inicio,
      dia_vencimento: dia,
      valor,
      cobrar_a_partir: cobrar,
    },
  };
}

export type Resultado<T = undefined> = { sucesso: true; valor: T } | { sucesso: false; mensagem: string };

const SEM_CONEXAO = { sucesso: false as const, mensagem: "O painel precisa de conexão com o servidor." };

export async function criarMatricula(academiaId: string, d: DadosNovaMatricula): Promise<Resultado<string>> {
  if (!supabase) return SEM_CONEXAO;
  const { data, error } = await supabase.rpc("criar_matricula", {
    p_academia_id: academiaId,
    p_dados: {
      aluno_id: d.aluno_id,
      plano_id: d.plano_id,
      turma_ids: d.turma_ids,
      data_inicio: d.data_inicio,
      dia_vencimento: d.dia_vencimento,
      valor: d.valor,
      cobrar_a_partir: d.cobrar_a_partir,
    },
  });
  if (!error && typeof data === "string") return { sucesso: true, valor: data };
  return { sucesso: false, mensagem: mensagem(error?.hint, "Confira os dados: aluno ativo, plano e turmas ativos desta academia, e as datas.") };
}

export async function aprovarMatricula(matriculaId: string, diaVencimento: number | null): Promise<Resultado> {
  if (!supabase) return SEM_CONEXAO;
  const { error } = await supabase.rpc("aprovar_matricula", {
    p_matricula_id: matriculaId,
    ...(diaVencimento !== null ? { p_dia_vencimento: diaVencimento } : {}),
  });
  if (!error) return { sucesso: true, valor: undefined };
  return { sucesso: false, mensagem: mensagem(error.hint, "O dia de vencimento vai de 1 a 28.") };
}

/** Devolve quantas cobranças pendentes vencem depois do fim (nenhuma é cancelada). */
export async function encerrarMatricula(matriculaId: string, dataFim: string): Promise<Resultado<number>> {
  if (!supabase) return SEM_CONEXAO;
  const { data, error } = await supabase.rpc("encerrar_matricula", { p_matricula_id: matriculaId, p_data_fim: dataFim });
  if (!error && typeof data === "number") return { sucesso: true, valor: data };
  return { sucesso: false, mensagem: mensagem(error?.hint, "A data de fim não pode ser antes do início da matrícula.") };
}

/** Devolve quantas cobranças pendentes vencem de hoje em diante (nenhuma é cancelada). */
export async function trancarMatricula(matriculaId: string): Promise<Resultado<number>> {
  if (!supabase) return SEM_CONEXAO;
  const { data, error } = await supabase.rpc("trancar_matricula", { p_matricula_id: matriculaId });
  if (!error && typeof data === "number") return { sucesso: true, valor: data };
  return { sucesso: false, mensagem: mensagem(error?.hint, MSG_REDE) };
}

export async function destrancarMatricula(matriculaId: string): Promise<Resultado> {
  if (!supabase) return SEM_CONEXAO;
  const { error } = await supabase.rpc("destrancar_matricula", { p_matricula_id: matriculaId });
  if (!error) return { sucesso: true, valor: undefined };
  return { sucesso: false, mensagem: mensagem(error.hint, MSG_REDE) };
}
