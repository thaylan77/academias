import { supabase } from "./supabase";
import { PapelPainel } from "./painel";

/**
 * Graduações no painel: progresso desde a última graduação, quem está apto,
 * registro de graduação e o catálogo de faixas. Toda consulta filtra pela
 * academia selecionada; quem protege é o RLS. Erro que a tela trata é
 * decidido pelo `hint` (ou pelo código do Postgres), nunca pelo texto.
 */

export interface Faixa {
  id: string;
  modalidade_id: string;
  nome: string;
  cor: string | null;
  ordem: number;
  max_graus: number;
  min_meses: number;
  min_aulas: number;
}

export interface Progresso {
  aluno_id: string;
  aluno: string;
  modalidade_id: string;
  faixa_id: string | null;
  faixa: string;
  cor: string | null;
  grau: number;
  graduado_em: string;
  proximo_passo: string;
  aulas_desde: number;
  min_aulas: number;
  meses_desde: number;
  min_meses: number;
  apto: boolean;
}

// ------------------------------------------------------------------ permissões (só o que a tela mostra)

/** Registrar graduação: dono, admin e professor, com a assinatura em dia. */
export function podeRegistrarGraduacao(papel: PapelPainel, academiaAtiva: boolean): boolean {
  return academiaAtiva && (papel === "dono" || papel === "admin" || papel === "professor");
}

/** Catálogo de faixas: dono e admin, com a assinatura em dia. */
export function podeEditarFaixas(papel: PapelPainel, academiaAtiva: boolean): boolean {
  return academiaAtiva && (papel === "dono" || papel === "admin");
}

// ------------------------------------------------------------------ leitura

// O PostgREST devolve no máximo 1.000 linhas por consulta.
const PAGINA = 1000;

async function emPaginas<T>(pagina: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const linhas: T[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await pagina(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas;
}

export async function lerFaixas(academiaId: string): Promise<Faixa[]> {
  if (!supabase) return [];
  const cliente = supabase;
  return emPaginas((inicio, fim) =>
    cliente
      .from("faixas")
      .select("id, modalidade_id, nome, cor, ordem, max_graus, min_meses, min_aulas")
      .eq("academia_id", academiaId)
      .order("modalidade_id")
      .order("ordem")
      .order("id")
      .range(inicio, fim)
  );
}

/**
 * Progresso de cada aluno ativo em cada modalidade em que já tem graduação
 * (vw_progresso_graduacao), com a cor da faixa atual (vw_graduacao_atual).
 * Aluno que nunca foi graduado não aparece: a tela registra a primeira.
 */
export async function listarProgresso(academiaId: string): Promise<Progresso[]> {
  if (!supabase) return [];
  const cliente = supabase;
  const [progresso, atuais] = await Promise.all([
    emPaginas((inicio, fim) =>
      cliente
        .from("vw_progresso_graduacao")
        .select("aluno_id, aluno, modalidade_id, faixa, grau, graduado_em, proximo_passo, aulas_desde, min_aulas, meses_desde, min_meses, apto")
        .eq("academia_id", academiaId)
        .order("aluno")
        .order("aluno_id")
        .order("modalidade_id")
        .range(inicio, fim)
    ),
    emPaginas((inicio, fim) =>
      cliente
        .from("vw_graduacao_atual")
        .select("aluno_id, modalidade_id, faixa_id, cor")
        .eq("academia_id", academiaId)
        .order("aluno_id")
        .order("modalidade_id")
        .range(inicio, fim)
    ),
  ]);
  const chave = (a: string | null, m: string | null) => `${a}|${m}`;
  const atual = new Map(atuais.map((g) => [chave(g.aluno_id, g.modalidade_id), g]));
  return progresso.map((p) => {
    const g = atual.get(chave(p.aluno_id, p.modalidade_id));
    return {
      aluno_id: p.aluno_id ?? "",
      aluno: p.aluno ?? "",
      modalidade_id: p.modalidade_id ?? "",
      faixa_id: g?.faixa_id ?? null,
      faixa: p.faixa ?? "",
      cor: g?.cor ?? null,
      grau: p.grau ?? 0,
      graduado_em: p.graduado_em ?? "",
      proximo_passo: p.proximo_passo ?? "",
      aulas_desde: p.aulas_desde ?? 0,
      min_aulas: p.min_aulas ?? 0,
      meses_desde: p.meses_desde ?? 0,
      min_meses: p.min_meses ?? 0,
      apto: p.apto === true,
    };
  });
}

export function filtrarProgresso(
  lista: Progresso[],
  filtro: { modalidadeId: string | null; alunosDaTurma: Set<string> | null; soAptos: boolean }
): Progresso[] {
  return lista.filter(
    (p) =>
      (!filtro.modalidadeId || p.modalidade_id === filtro.modalidadeId) &&
      (!filtro.alunosDaTurma || filtro.alunosDaTurma.has(p.aluno_id)) &&
      (!filtro.soAptos || p.apto)
  );
}

// ------------------------------------------------------------------ gravação

export type Resultado = { sucesso: true; id: string } | { sucesso: false; mensagem: string };

export interface DadosGraduacao {
  aluno_id: string;
  faixa_id: string;
  grau: number;
  data: string; // AAAA-MM-DD, dia da academia
  professor_id: string | null;
  observacao: string | null;
}

const MSG_REDE = "Não foi possível salvar. Verifique a conexão e tente de novo.";

export async function registrarGraduacao(academiaId: string, dados: DadosGraduacao): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const { data, error } = await supabase.rpc("registrar_graduacao", {
    p_academia_id: academiaId,
    p_dados: {
      aluno_id: dados.aluno_id,
      faixa_id: dados.faixa_id,
      grau: dados.grau,
      data: dados.data,
      professor_id: dados.professor_id,
      observacao: dados.observacao,
    },
  });
  if (!error && typeof data === "string") return { sucesso: true, id: data };
  switch (error?.hint) {
    case "sem_permissao":
      return { sucesso: false, mensagem: "Só o dono, a administração e os professores registram graduações, e só com a assinatura em dia." };
    case "grau_invalido":
      return { sucesso: false, mensagem: "Esse grau passa do máximo da faixa." };
    case "graduacao_repetida":
      return { sucesso: false, mensagem: "Esta graduação já foi registrada para o aluno nesta data." };
    case "dados_invalidos":
      return { sucesso: false, mensagem: "Confira o aluno (ativo), a faixa, o professor e a data (não pode ser no futuro)." };
    default:
      return { sucesso: false, mensagem: MSG_REDE };
  }
}

export type FormularioFaixa = { nome: string; cor: string; ordem: string; max_graus: string; min_meses: string; min_aulas: string };
export type ErrosFaixa = Partial<Record<keyof FormularioFaixa, string>>;

const inteiro = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : null);

/** Mesmas regras dos checks de `faixas`, para avisar antes de gravar. */
export function validarFaixa(
  f: FormularioFaixa
): { ok: true; dados: Omit<Faixa, "id" | "modalidade_id"> } | { ok: false; erros: ErrosFaixa } {
  const erros: ErrosFaixa = {};
  const nome = f.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2) erros.nome = "Informe o nome da faixa.";
  const cor = f.cor.trim() || null;
  if (cor && !/^#[0-9a-fA-F]{6}$/.test(cor)) erros.cor = "Cor no formato #RRGGBB.";
  const ordem = inteiro(f.ordem);
  if (ordem === null || ordem < 1) erros.ordem = "Ordem a partir de 1 (1 = primeira faixa).";
  const maxGraus = inteiro(f.max_graus);
  if (maxGraus === null || maxGraus > 12) erros.max_graus = "De 0 a 12 graus.";
  const minMeses = inteiro(f.min_meses);
  if (minMeses === null) erros.min_meses = "Número inteiro, 0 ou mais.";
  const minAulas = inteiro(f.min_aulas);
  if (minAulas === null) erros.min_aulas = "Número inteiro, 0 ou mais.";
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    dados: { nome, cor, ordem: ordem!, max_graus: maxGraus!, min_meses: minMeses!, min_aulas: minAulas! },
  };
}

const MSG_FAIXA_SEM_LINHA =
  "Não foi possível salvar: a faixa não está nesta academia, ou seu papel (ou a assinatura) não permite alterar o catálogo.";

export async function salvarFaixa(
  academiaId: string,
  modalidadeId: string,
  dados: Omit<Faixa, "id" | "modalidade_id">,
  id?: string
): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  // Na edição, a faixa precisa ser da academia e da modalidade em que a tela
  // está: um id defasado não altera faixa de outra modalidade.
  const consulta = id
    ? supabase.from("faixas").update(dados).eq("academia_id", academiaId).eq("modalidade_id", modalidadeId).eq("id", id)
    : supabase.from("faixas").insert({ ...dados, academia_id: academiaId, modalidade_id: modalidadeId });
  const { data, error } = await consulta.select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return { sucesso: false, mensagem: "Já existe uma faixa nessa ordem nesta modalidade." };
    if (error.code === "23514") return { sucesso: false, mensagem: "Confira os números da faixa." };
    if (error.code === "23503") return { sucesso: false, mensagem: "A modalidade da faixa não está mais disponível nesta academia." };
    if (error.code === "42501") return { sucesso: false, mensagem: MSG_FAIXA_SEM_LINHA };
    return { sucesso: false, mensagem: MSG_REDE };
  }
  if (!data) return { sucesso: false, mensagem: MSG_FAIXA_SEM_LINHA };
  return { sucesso: true, id: data.id };
}
