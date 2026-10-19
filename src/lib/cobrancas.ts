import { supabase } from "./supabase";
import { PapelPainel } from "./painel";

/**
 * Cobranças no painel: lista, inadimplentes, baixa manual, cancelamento e
 * geração imediata. Toda consulta filtra pela academia selecionada; quem
 * protege é o RLS (professor não lê cobranças).
 *
 * As RPCs de baixa e cancelamento ainda não têm código no `hint` e o front
 * não decide pelo texto do erro. Por isso a tela só oferece cada ação quando
 * as condições do banco já valem (cobrança pendente e nunca emitida no
 * gateway, papel e assinatura em dia, dados da baixa conferidos aqui) e
 * qualquer recusa vira uma mensagem genérica com a lista recarregada.
 */

// "desconhecido": status que o banco passou a usar e a tela ainda não conhece.
// Nunca aceita ação manual.
export type StatusCobranca = "pendente" | "paga" | "cancelada" | "estornada" | "desconhecido";
export type FormaPagamento = "pix" | "boleto" | "cartao" | "dinheiro" | "outro";

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  pix: "Pix",
  boleto: "Boleto",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
  outro: "Outro",
};

// O banco guarda o código; o texto fica aqui.
export const TEXTO_DIVERGENCIA: Record<string, string> = {
  pagamento_duplicado: "Pagamento em duplicidade no gateway",
  cancelada_no_gateway: "Cancelada no gateway, mas paga aqui",
  estado_apos_estorno: "O estado mudou depois de um estorno",
  estorno_parcial: "Estorno parcial no gateway",
};

export function textoDivergencia(codigo: string): string {
  return TEXTO_DIVERGENCIA[codigo] ?? "Divergência com o gateway";
}

export interface Cobranca {
  id: string;
  aluno_id: string;
  aluno: string;
  matricula_id: string | null;
  competencia: string | null;
  descricao: string | null;
  valor: number;
  vencimento: string;
  status: StatusCobranca;
  pago_em: string | null;
  valor_pago: number | null;
  forma_pagamento: string | null;
  baixa_em: string | null;
  // Já foi (ou está indo) para o gateway: baixa e cancelamento são das Edge Functions.
  emitida: boolean;
  divergencia: string | null;
}

export interface Inadimplente {
  aluno_id: string;
  nome: string;
  telefone: string | null;
  cobrancas_atrasadas: number;
  total_atrasado: number;
  vencimento_mais_antigo: string;
}

// ------------------------------------------------------------------ regras de tela

/** Ver o financeiro: dono, admin e recepção (professor não). */
export function podeVerCobrancas(papel: PapelPainel): boolean {
  return papel === "dono" || papel === "admin" || papel === "recepcao";
}

/** Baixar, cancelar e gerar: dono, admin e recepção com a assinatura em dia (pode_gerir). */
export function podeGerirCobrancas(papel: PapelPainel, academiaAtiva: boolean): boolean {
  return academiaAtiva && podeVerCobrancas(papel);
}

/** Baixa e cancelamento manuais só valem para cobrança pendente que nunca foi para o gateway. */
export function aceitaAcaoManual(c: Cobranca): boolean {
  return c.status === "pendente" && !c.emitida;
}

export function estaVencida(c: Cobranca, hoje: string): boolean {
  return c.status === "pendente" && c.vencimento < hoje;
}

export type Situacao = StatusCobranca | "vencida" | "todas";

export function filtrarCobrancas(
  lista: Cobranca[],
  filtro: { situacao: Situacao; competencia: string; aluno: string },
  hoje: string
): Cobranca[] {
  const termo = filtro.aluno.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return lista.filter((c) => {
    if (filtro.situacao === "vencida" ? !estaVencida(c, hoje) : filtro.situacao !== "todas" && c.status !== filtro.situacao) return false;
    if (filtro.competencia && (c.competencia ?? "").slice(0, 7) !== filtro.competencia) return false;
    if (termo && !c.aluno.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(termo)) return false;
    return true;
  });
}

// ------------------------------------------------------------------ dinheiro e datas

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Valor digitado em número com 2 casas, ou null. Aceita o jeito brasileiro
 * ("150", "150,5", "1.234,56") e o ponto decimal ("150.50"). Ponto só conta
 * como milhar quando separa grupos de 3 ("1.234"); senão, "150.50" viraria
 * 15050.
 */
export function lerValor(texto: string): number | null {
  const t = texto.trim();
  let normal: string;
  if (t.includes(",")) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(t)) return null;
    normal = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(t)) {
    normal = t;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    normal = t.replace(/\./g, "");
  } else if (/^\d+$/.test(t)) {
    normal = t;
  } else {
    return null;
  }
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(normal)) return null;
  const n = Number(normal);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

// AAAA-MM-DD que existe no calendário (sem 31/02).
function dataExiste(data: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.getUTCFullYear() === Number(m[1]) && dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]);
}

/** Dia (AAAA-MM-DD) de um instante no fuso da academia: pago_em vem em UTC. */
export function diaNoFuso(instante: string, fuso: string): string {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return instante.slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return instante.slice(0, 10);
  }
}

/**
 * Meio-dia do dia `data` (AAAA-MM-DD) no fuso da academia, em ISO com o
 * deslocamento certo. Mandar só a data faria o banco ler meia-noite em UTC,
 * que em Fortaleza ainda é o dia anterior.
 */
export function meioDiaNoFuso(data: string, fuso: string): string {
  const referencia = new Date(`${data}T12:00:00Z`);
  let deslocamento = "+00:00";
  try {
    const parte = new Intl.DateTimeFormat("en-US", { timeZone: fuso, timeZoneName: "longOffset" })
      .formatToParts(referencia)
      .find((p) => p.type === "timeZoneName")?.value;
    const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(parte ?? "");
    if (m) deslocamento = `${m[1]}:${m[2] ?? "00"}`;
  } catch {
    /* fuso inválido: UTC */
  }
  return `${data}T12:00:00${deslocamento}`;
}

// ------------------------------------------------------------------ leitura

const PAGINA = 1000;

export async function listarCobrancas(academiaId: string): Promise<Cobranca[]> {
  if (!supabase) return [];
  type Linha = {
    id: string; aluno_id: string; matricula_id: string | null; competencia: string | null; descricao: string | null;
    valor: number; vencimento: string; status: string; pago_em: string | null; valor_pago: number | null;
    forma_pagamento: string | null; baixa_em: string | null; gateway_id: string | null; emissao_iniciada_em: string | null;
    divergencia: string | null; alunos: { nome: string } | null;
  };
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("cobrancas")
      .select("id, aluno_id, matricula_id, competencia, descricao, valor, vencimento, status, pago_em, valor_pago, forma_pagamento, baixa_em, gateway_id, emissao_iniciada_em, divergencia, alunos(nome)")
      .eq("academia_id", academiaId)
      .order("vencimento", { ascending: false })
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas.map((c) => ({
    id: c.id,
    aluno_id: c.aluno_id,
    aluno: c.alunos?.nome ?? "",
    matricula_id: c.matricula_id,
    competencia: c.competencia,
    descricao: c.descricao,
    valor: Number(c.valor),
    vencimento: c.vencimento,
    status: (["pendente", "paga", "cancelada", "estornada"] as const).find((s) => s === c.status) ?? "desconhecido",
    pago_em: c.pago_em,
    valor_pago: c.valor_pago === null ? null : Number(c.valor_pago),
    forma_pagamento: c.forma_pagamento,
    baixa_em: c.baixa_em,
    emitida: c.gateway_id !== null || c.emissao_iniciada_em !== null,
    divergencia: c.divergencia,
  }));
}

/** Atraso calculado no servidor, no fuso da academia (vw_inadimplentes). */
export async function listarInadimplentes(academiaId: string): Promise<Inadimplente[]> {
  if (!supabase) return [];
  type Linha = { aluno_id: string | null; nome: string | null; telefone: string | null; cobrancas_atrasadas: number | null;
                 total_atrasado: number | null; vencimento_mais_antigo: string | null };
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("vw_inadimplentes")
      .select("aluno_id, nome, telefone, cobrancas_atrasadas, total_atrasado, vencimento_mais_antigo")
      .eq("academia_id", academiaId)
      .order("vencimento_mais_antigo")
      .order("aluno_id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas.map((i) => ({
    aluno_id: i.aluno_id ?? "",
    nome: i.nome ?? "",
    telefone: i.telefone,
    cobrancas_atrasadas: Number(i.cobrancas_atrasadas ?? 0),
    total_atrasado: Number(i.total_atrasado ?? 0),
    vencimento_mais_antigo: i.vencimento_mais_antigo ?? "",
  }));
}

export interface MatriculaCobravel {
  id: string;
  aluno: string;
  plano: string | null;
  dia_vencimento: number | null;
}

/** Matrículas ativas da academia, para "gerar agora". */
export async function listarMatriculasAtivas(academiaId: string): Promise<MatriculaCobravel[]> {
  if (!supabase) return [];
  type Linha = { id: string; dia_vencimento: number | null; alunos: { nome: string } | null; planos: { nome: string } | null };
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("matriculas")
      .select("id, dia_vencimento, alunos(nome), planos(nome)")
      .eq("academia_id", academiaId)
      .eq("status", "ativa")
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas
    .map((m) => ({ id: m.id, aluno: m.alunos?.nome ?? "", plano: m.planos?.nome ?? null, dia_vencimento: m.dia_vencimento }))
    .sort((a, b) => a.aluno.localeCompare(b.aluno, "pt-BR"));
}

// ------------------------------------------------------------------ ações

export type Resultado = { sucesso: true } | { sucesso: false; mensagem: string };

const MSG_RECUSA =
  "Não foi possível concluir: a cobrança pode ter mudado (paga, cancelada ou emitida no gateway) ou a assinatura da academia está suspensa. A lista foi atualizada.";

export interface DadosBaixa {
  forma: FormaPagamento;
  data: string; // AAAA-MM-DD, dia da academia
  valorPago: number | null; // null: o valor da cobrança
}

export function validarBaixa(
  form: { forma: string; data: string; valor: string },
  hoje: string
): { ok: true; dados: DadosBaixa } | { ok: false; mensagem: string } {
  const forma = (Object.keys(ROTULO_FORMA) as FormaPagamento[]).find((f) => f === form.forma);
  if (!forma) return { ok: false, mensagem: "Escolha a forma de pagamento." };
  if (!dataExiste(form.data)) return { ok: false, mensagem: "Informe a data do pagamento." };
  if (form.data > hoje) return { ok: false, mensagem: "A data do pagamento não pode ser no futuro." };
  let valorPago: number | null = null;
  if (form.valor.trim()) {
    valorPago = lerValor(form.valor);
    if (valorPago === null) return { ok: false, mensagem: "Valor pago inválido." };
  }
  return { ok: true, dados: { forma, data: form.data, valorPago } };
}

export async function baixarCobranca(cobrancaId: string, dados: DadosBaixa, fuso: string): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const { error } = await supabase.rpc("baixar_cobranca_manual", {
    p_cobranca_id: cobrancaId,
    p_forma: dados.forma,
    p_pago_em: meioDiaNoFuso(dados.data, fuso),
    ...(dados.valorPago !== null ? { p_valor_pago: dados.valorPago } : {}),
  });
  return error ? { sucesso: false, mensagem: MSG_RECUSA } : { sucesso: true };
}

export async function cancelarCobranca(cobrancaId: string): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const { error } = await supabase.rpc("cancelar_cobranca", { p_cobranca_id: cobrancaId });
  return error ? { sucesso: false, mensagem: MSG_RECUSA } : { sucesso: true };
}

export async function gerarCobrancasAgora(
  matriculaId: string
): Promise<{ sucesso: true; geradas: number } | { sucesso: false; mensagem: string }> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const { data, error } = await supabase.rpc("gerar_cobrancas_matricula", { p_matricula_id: matriculaId });
  if (error || typeof data !== "number") {
    return {
      sucesso: false,
      mensagem: "Não foi possível gerar: a matrícula pode ter mudado ou a assinatura da academia está suspensa.",
    };
  }
  return { sucesso: true, geradas: data };
}
