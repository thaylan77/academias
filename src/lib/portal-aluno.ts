import { supabase } from "./supabase";

/**
 * Leituras do portal do aluno: os cadastros ligados ao login (do próprio aluno
 * ou dos filhos, em qualquer academia) e o que cada um vê. Quem protege é o
 * RLS (sou_o_aluno); os filtros por login, academia e aluno evitam misturar
 * dados na tela, por exemplo quando o login também é da equipe e o RLS deixa
 * ler todos os alunos da academia.
 */

export interface MeuAluno {
  id: string;
  nome: string;
  status: string;
  academia_id: string;
  academia: string;
  fuso: string;
}

export interface MinhaGraduacao {
  modalidade_id: string;
  modalidade: string;
  faixa: string;
  cor: string | null;
  grau: number;
  graduado_em: string;
  // Progresso: só para aluno ativo (vw_progresso_graduacao).
  progresso: {
    proximo_passo: string;
    aulas_desde: number;
    min_aulas: number;
    meses_desde: number;
    min_meses: number;
    apto: boolean;
  } | null;
}

/** Cadastros ligados ao login da sessão, em ordem de nome. Sem sessão, lista vazia. */
export async function meusAlunos(): Promise<MeuAluno[]> {
  if (!supabase) return [];
  const { data: auth, error: erroUsuario } = await supabase.auth.getUser();
  if (erroUsuario) throw erroUsuario;
  if (!auth?.user) return [];
  const { data, error } = await supabase
    .from("alunos")
    .select("id, nome, status, academia_id, academias(nome, fuso)")
    .eq("user_id", auth.user.id)
    .order("nome")
    .order("id");
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id,
    nome: a.nome,
    status: a.status,
    academia_id: a.academia_id,
    academia: a.academias?.nome ?? "",
    fuso: a.academias?.fuso ?? "America/Sao_Paulo",
  }));
}

/**
 * Faixa e grau atuais do aluno em cada modalidade (vw_graduacao_atual), com o
 * progresso desde a última graduação quando o aluno está ativo.
 */
export async function minhaGraduacao(aluno: Pick<MeuAluno, "id" | "academia_id">): Promise<MinhaGraduacao[]> {
  if (!supabase) return [];
  const [atuais, progressos, modalidades] = await Promise.all([
    supabase
      .from("vw_graduacao_atual")
      .select("modalidade_id, faixa, cor, grau, graduado_em")
      .eq("academia_id", aluno.academia_id)
      .eq("aluno_id", aluno.id)
      .order("modalidade_id"),
    supabase
      .from("vw_progresso_graduacao")
      .select("modalidade_id, proximo_passo, aulas_desde, min_aulas, meses_desde, min_meses, apto")
      .eq("academia_id", aluno.academia_id)
      .eq("aluno_id", aluno.id),
    supabase.from("modalidades").select("id, nome").eq("academia_id", aluno.academia_id),
  ]);
  if (atuais.error) throw atuais.error;
  if (progressos.error) throw progressos.error;
  if (modalidades.error) throw modalidades.error;

  const nome = new Map((modalidades.data ?? []).map((m) => [m.id, m.nome]));
  const progresso = new Map((progressos.data ?? []).map((p) => [p.modalidade_id, p]));
  return (atuais.data ?? [])
    .map((g) => {
      const p = progresso.get(g.modalidade_id);
      return {
        modalidade_id: g.modalidade_id ?? "",
        modalidade: nome.get(g.modalidade_id ?? "") ?? "",
        faixa: g.faixa ?? "",
        cor: g.cor ?? null,
        grau: g.grau ?? 0,
        graduado_em: g.graduado_em ?? "",
        progresso: p
          ? {
              proximo_passo: p.proximo_passo ?? "",
              aulas_desde: p.aulas_desde ?? 0,
              min_aulas: p.min_aulas ?? 0,
              meses_desde: p.meses_desde ?? 0,
              min_meses: p.min_meses ?? 0,
              apto: p.apto === true,
            }
          : null,
      };
    })
    .sort((a, b) => a.modalidade.localeCompare(b.modalidade, "pt-BR"));
}
