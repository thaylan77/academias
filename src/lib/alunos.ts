import { supabase } from "./supabase";
import { PapelPainel } from "./painel";

/**
 * Alunos no painel da equipe. Toda consulta filtra pela academia
 * selecionada (além do RLS, que é quem protege). Erro que a tela trata é
 * decidido pelo `hint` (ou pelo código do Postgres), nunca pelo texto.
 */

export type SituacaoAluno = "ativo" | "pendente" | "inativo" | "anonimizado";

export interface AlunoResumo {
  id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  situacao: SituacaoAluno;
}

export interface DadosAluno {
  nome: string;
  cpf: string | null;
  data_nascimento: string | null;
  telefone: string | null;
  email: string | null;
  responsavel_nome: string | null;
  responsavel_cpf: string | null;
  responsavel_telefone: string | null;
  responsavel_email: string | null;
  contato_emergencia: string | null;
  observacoes_medicas: string | null;
  status: "pendente" | "ativo" | "inativo";
}

export interface AlunoFicha extends DadosAluno {
  id: string;
  situacao: SituacaoAluno;
}

export interface MatriculaDoAluno {
  id: string;
  status: string;
  data_inicio: string;
  data_fim: string | null;
  valor: number | null;
  plano: string | null;
  turmas: string[];
}

export interface ResumoFinanceiro {
  pendentes: number;
  totalPendente: number;
  atrasadas: number;
  totalAtrasado: number;
}

export interface FichaDoAluno {
  aluno: AlunoFicha;
  matriculas: MatriculaDoAluno[];
  // null quando o papel não lê cobranças (professor).
  financeiro: ResumoFinanceiro | null;
}

// ------------------------------------------------------------------ permissões (só o que a tela mostra)

/** Cria e edita: dono, admin e recepção, com a assinatura em dia. */
export function podeEditarAlunos(papel: PapelPainel, academiaAtiva: boolean): boolean {
  return academiaAtiva && (papel === "dono" || papel === "admin" || papel === "recepcao");
}

/** Anonimiza: só dono e admin, mesmo com a academia suspensa (exceção LGPD do AGENTS.md). */
export function podeAnonimizar(papel: PapelPainel): boolean {
  return papel === "dono" || papel === "admin";
}

/** Situação financeira: quem lê cobranças (dono, admin, recepção). */
export function podeVerFinanceiro(papel: PapelPainel): boolean {
  return papel === "dono" || papel === "admin" || papel === "recepcao";
}

// ------------------------------------------------------------------ formatos

export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/**
 * Telefone em E.164 sem o "+": 55 + DDD + número. Aceita o que a pessoa
 * digita com máscara; sem o 55, acrescenta. Devolve null se não der.
 */
export function telefoneE164(valor: string): string | null {
  let d = soDigitos(valor);
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}

export function formatarCpf(cpf: string | null): string {
  if (!cpf || cpf.length !== 11) return cpf ?? "";
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function formatarTelefone(tel: string | null): string {
  if (!tel) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(tel);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : tel;
}

/** Idade completa em `hoje` (AAAA-MM-DD), ou null sem data. */
export function idadeEm(dataNascimento: string | null, hoje: string): number | null {
  if (!dataNascimento) return null;
  const [an, mn, dn] = dataNascimento.split("-").map(Number);
  const [ah, mh, dh] = hoje.split("-").map(Number);
  return ah - an - (mh < mn || (mh === mn && dh < dn) ? 1 : 0);
}

/**
 * Hoje no fuso da academia (academias.fuso), como AAAA-MM-DD: maioridade e
 * "data no futuro" seguem o dia de lá, não o do navegador. Fuso inválido
 * cai no relógio local.
 */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  } catch {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
  }
}

// AAAA-MM-DD que existe no calendário (sem 31/02, mês 13...), de 1900 em diante.
function dataExiste(data: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, me - 1, d));
  return a >= 1900 && dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d;
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ------------------------------------------------------------------ validação do formulário

export type FormularioAluno = Record<keyof DadosAluno, string>;
export type ErrosAluno = Partial<Record<keyof DadosAluno, string>>;

export function formularioVazio(): FormularioAluno {
  return {
    nome: "", cpf: "", data_nascimento: "", telefone: "", email: "",
    responsavel_nome: "", responsavel_cpf: "", responsavel_telefone: "", responsavel_email: "",
    contato_emergencia: "", observacoes_medicas: "", status: "ativo",
  };
}

export function formularioDoAluno(a: DadosAluno): FormularioAluno {
  return {
    nome: a.nome,
    cpf: a.cpf ?? "",
    data_nascimento: a.data_nascimento ?? "",
    telefone: a.telefone ?? "",
    email: a.email ?? "",
    responsavel_nome: a.responsavel_nome ?? "",
    responsavel_cpf: a.responsavel_cpf ?? "",
    responsavel_telefone: a.responsavel_telefone ?? "",
    responsavel_email: a.responsavel_email ?? "",
    contato_emergencia: a.contato_emergencia ?? "",
    observacoes_medicas: a.observacoes_medicas ?? "",
    status: a.status,
  };
}

/**
 * Confere e normaliza o formulário. CPF e telefone saem só com dígitos, o
 * telefone em E.164. Menor de 18 anos precisa de nome e CPF do responsável,
 * a mesma regra da matrícula online (hint menor_sem_responsavel).
 */
export function validarAluno(
  f: FormularioAluno,
  hoje: string
): { ok: true; dados: DadosAluno } | { ok: false; erros: ErrosAluno } {
  const erros: ErrosAluno = {};
  const texto = (v: string) => (v.trim() ? v.trim() : null);

  const nome = f.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2) erros.nome = "Informe o nome do aluno.";

  const cpf = soDigitos(f.cpf) || null;
  if (cpf && !cpfValido(cpf)) erros.cpf = "CPF inválido.";

  const data = f.data_nascimento.trim() || null;
  if (data && (!dataExiste(data) || data > hoje)) {
    erros.data_nascimento = "Data de nascimento inválida.";
  }

  let telefone: string | null = null;
  if (f.telefone.trim()) {
    telefone = telefoneE164(f.telefone);
    if (!telefone) erros.telefone = "Telefone com DDD, por exemplo (85) 99999-9999.";
  }

  const email = texto(f.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.email = "E-mail inválido.";

  const responsavelNome = texto(f.responsavel_nome);
  const responsavelCpf = soDigitos(f.responsavel_cpf) || null;
  if (responsavelCpf && !cpfValido(responsavelCpf)) erros.responsavel_cpf = "CPF do responsável inválido.";

  let responsavelTelefone: string | null = null;
  if (f.responsavel_telefone.trim()) {
    responsavelTelefone = telefoneE164(f.responsavel_telefone);
    if (!responsavelTelefone) erros.responsavel_telefone = "Telefone com DDD, por exemplo (85) 99999-9999.";
  }

  // O e-mail do responsável é o login dele no portal do aluno.
  const responsavelEmail = texto(f.responsavel_email)?.toLowerCase() ?? null;
  if (responsavelEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavelEmail)) {
    erros.responsavel_email = "E-mail do responsável inválido.";
  }

  const idade = !erros.data_nascimento ? idadeEm(data, hoje) : null;
  if (idade !== null && idade < 18) {
    if (!responsavelNome) erros.responsavel_nome = "Aluno menor de idade: informe o responsável.";
    if (!responsavelCpf) erros.responsavel_cpf ??= "Aluno menor de idade: informe o CPF do responsável.";
  }

  const status = f.status === "pendente" || f.status === "inativo" ? f.status : "ativo";

  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome,
      cpf,
      data_nascimento: data,
      telefone,
      email,
      responsavel_nome: responsavelNome,
      responsavel_cpf: responsavelCpf,
      responsavel_telefone: responsavelTelefone,
      responsavel_email: responsavelEmail,
      contato_emergencia: texto(f.contato_emergencia),
      observacoes_medicas: texto(f.observacoes_medicas),
      status,
    },
  };
}

// ------------------------------------------------------------------ lista

function situacaoDe(a: { status: string; anonimizado_em: string | null }): SituacaoAluno {
  if (a.anonimizado_em) return "anonimizado";
  return a.status === "pendente" || a.status === "inativo" ? a.status : "ativo";
}

// O PostgREST devolve no máximo 1.000 linhas por consulta: a lista vem em
// páginas, para a busca no aparelho não perder os alunos do fim.
const PAGINA = 1000;

export async function listarAlunos(academiaId: string): Promise<AlunoResumo[]> {
  if (!supabase) return [];
  type Linha = { id: string; nome: string; cpf: string | null; telefone: string | null;
                 data_nascimento: string | null; status: string; anonimizado_em: string | null };
  const linhas: Linha[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supabase
      .from("alunos")
      .select("id, nome, cpf, telefone, data_nascimento, status, anonimizado_em")
      .eq("academia_id", academiaId)
      .order("nome")
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas.map((a) => ({
    id: a.id,
    nome: a.nome,
    cpf: a.cpf,
    telefone: a.telefone,
    data_nascimento: a.data_nascimento,
    situacao: situacaoDe(a),
  }));
}

/**
 * Busca por nome (sem acento, sem maiúsculas) ou por CPF (só os dígitos
 * digitados). Filtra no aparelho: a lista da academia já veio inteira.
 */
export function filtrarAlunos(
  lista: AlunoResumo[],
  busca: string,
  situacao: SituacaoAluno | "todas"
): AlunoResumo[] {
  const termo = semAcento(busca.trim());
  const digitos = soDigitos(busca);
  return lista.filter((a) => {
    if (situacao !== "todas" && a.situacao !== situacao) return false;
    if (!termo) return true;
    if (semAcento(a.nome).includes(termo)) return true;
    return digitos.length >= 3 && !!a.cpf && a.cpf.includes(digitos);
  });
}

// ------------------------------------------------------------------ ficha

export class AlunoNaoEncontrado extends Error {
  constructor() {
    super("Aluno não encontrado nesta academia.");
    this.name = "AlunoNaoEncontrado";
  }
}

export async function lerFichaDoAluno(academiaId: string, alunoId: string, verFinanceiro: boolean): Promise<FichaDoAluno> {
  if (!supabase) throw new AlunoNaoEncontrado();

  const { data: a, error } = await supabase
    .from("alunos")
    .select(
      "id, nome, cpf, data_nascimento, telefone, email, responsavel_nome, responsavel_cpf, responsavel_telefone, responsavel_email, contato_emergencia, observacoes_medicas, status, anonimizado_em"
    )
    .eq("academia_id", academiaId)
    .eq("id", alunoId)
    .maybeSingle();
  if (error) throw error;
  if (!a) throw new AlunoNaoEncontrado();

  const { data: ms, error: erroMatriculas } = await supabase
    .from("matriculas")
    .select("id, status, data_inicio, data_fim, valor, planos(nome), matricula_turmas(turmas(nome))")
    .eq("academia_id", academiaId)
    .eq("aluno_id", alunoId)
    .order("data_inicio", { ascending: false });
  if (erroMatriculas) throw erroMatriculas;

  let financeiro: ResumoFinanceiro | null = null;
  if (verFinanceiro) {
    const [pendentes, atraso] = await Promise.all([
      supabase
        .from("cobrancas")
        .select("valor")
        .eq("academia_id", academiaId)
        .eq("aluno_id", alunoId)
        .eq("status", "pendente"),
      // "Atrasada" é calculada no servidor, no fuso da academia.
      supabase
        .from("vw_inadimplentes")
        .select("cobrancas_atrasadas, total_atrasado")
        .eq("academia_id", academiaId)
        .eq("aluno_id", alunoId)
        .maybeSingle(),
    ]);
    if (pendentes.error) throw pendentes.error;
    if (atraso.error) throw atraso.error;
    financeiro = {
      pendentes: pendentes.data?.length ?? 0,
      totalPendente: (pendentes.data ?? []).reduce((s, c) => s + Number(c.valor), 0),
      atrasadas: Number(atraso.data?.cobrancas_atrasadas ?? 0),
      totalAtrasado: Number(atraso.data?.total_atrasado ?? 0),
    };
  }

  const status = a.status === "pendente" || a.status === "inativo" ? a.status : "ativo";
  return {
    aluno: {
      id: a.id,
      nome: a.nome,
      cpf: a.cpf,
      data_nascimento: a.data_nascimento,
      telefone: a.telefone,
      email: a.email,
      responsavel_nome: a.responsavel_nome,
      responsavel_cpf: a.responsavel_cpf,
      responsavel_telefone: a.responsavel_telefone,
      responsavel_email: a.responsavel_email,
      contato_emergencia: a.contato_emergencia,
      observacoes_medicas: a.observacoes_medicas,
      status,
      situacao: situacaoDe(a),
    },
    matriculas: (ms ?? []).map((m) => ({
      id: m.id,
      status: m.status,
      data_inicio: m.data_inicio,
      data_fim: m.data_fim,
      valor: m.valor === null ? null : Number(m.valor),
      plano: m.planos?.nome ?? null,
      turmas: (m.matricula_turmas ?? []).map((mt) => mt.turmas?.nome).filter((n): n is string => !!n),
    })),
    financeiro,
  };
}

// ------------------------------------------------------------------ gravação

export type ResultadoGravacao = { sucesso: true; id: string } | { sucesso: false; mensagem: string };

const MSG_SEM_PERMISSAO =
  "Não foi possível salvar: seu papel não altera alunos, ou a assinatura da academia está suspensa.";

function mensagemDeErroAoSalvar(erro: { hint?: string | null; code?: string | null }): string {
  if (erro.hint === "cpf_duplicado") return "Já existe um aluno com esse CPF nesta academia.";
  if (erro.hint === "aluno_anonimizado") return "Este cadastro foi anonimizado e não pode mais ser alterado.";
  // 42501: o RLS ou o grant recusou (papel sem escrita, academia suspensa).
  if (erro.code === "42501") return MSG_SEM_PERMISSAO;
  // 23505 sem hint: duas gravações simultâneas do mesmo CPF (o índice único segurou).
  if (erro.code === "23505") return "Já existe um aluno com esse CPF nesta academia.";
  return "Não foi possível salvar o aluno. Verifique a conexão e tente de novo.";
}

export async function salvarAluno(academiaId: string, dados: DadosAluno, alunoId?: string): Promise<ResultadoGravacao> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };

  if (!alunoId) {
    const { data, error } = await supabase
      .from("alunos")
      .insert({ ...dados, academia_id: academiaId })
      .select("id")
      .single();
    if (error) return { sucesso: false, mensagem: mensagemDeErroAoSalvar(error) };
    return { sucesso: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("alunos")
    .update(dados)
    .eq("academia_id", academiaId)
    .eq("id", alunoId)
    .select("id")
    .maybeSingle();
  if (error) return { sucesso: false, mensagem: mensagemDeErroAoSalvar(error) };
  // Sem linha devolvida: o aluno não é desta academia, ou o RLS o escondeu da
  // gravação (papel ou assinatura). O banco não diz qual dos dois.
  if (!data) {
    return {
      sucesso: false,
      mensagem: "Não foi possível salvar: o aluno não está nesta academia, seu papel não altera alunos, ou a assinatura está suspensa.",
    };
  }
  return { sucesso: true, id: data.id };
}

export async function anonimizarAluno(alunoId: string): Promise<{ sucesso: true } | { sucesso: false; mensagem: string }> {
  if (!supabase) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  const { error } = await supabase.rpc("anonimizar_aluno", { p_aluno_id: alunoId });
  if (!error) return { sucesso: true };
  if (error.hint === "anonimizar_cobranca_pendente") {
    return { sucesso: false, mensagem: "Cancele ou dê baixa nas cobranças pendentes do aluno antes de anonimizar." };
  }
  if (error.hint === "sem_permissao") {
    return { sucesso: false, mensagem: "Só o dono e a administração podem anonimizar alunos." };
  }
  return { sucesso: false, mensagem: "Não foi possível anonimizar. Verifique a conexão e tente de novo." };
}
