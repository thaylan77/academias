import { supabase } from "./supabase";

/**
 * Check-ins do dia numa turma, para a ficha da turma no painel (#16). A
 * leitura filtra pela academia e pela turma; quem protege é o RLS de
 * `presencas` (equipe da academia e o próprio aluno).
 */

export type OrigemPresenca = "qrcode" | "recepcao" | "professor";

export const ROTULO_ORIGEM: Record<OrigemPresenca, string> = {
  qrcode: "QR",
  recepcao: "Recepção",
  professor: "Professor",
};

export interface CheckinDaAula {
  id: string;
  aluno_id: string;
  aluno: string;
  checkin_em: string; // instante (timestamptz)
  origem: OrigemPresenca;
}

/** Intervalo da atualização automática da lista. */
export const INTERVALO_ATUALIZACAO_MS = 15_000;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Check-ins da turma no dia `hoje` (AAAA-MM-DD, no fuso da academia), mais recentes primeiro. */
export async function listarCheckinsDaAula(academiaId: string, turmaId: string, hoje: string): Promise<CheckinDaAula[]> {
  if (!DATA.test(hoje)) throw new Error("Data inválida.");
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("presencas")
    .select("id, aluno_id, checkin_em, origem, alunos(nome)")
    .eq("academia_id", academiaId)
    .eq("turma_id", turmaId)
    .eq("data", hoje)
    .order("checkin_em", { ascending: false })
    .order("id")
    // Uma aula não passa de algumas centenas; o limite evita resposta enorme.
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    aluno_id: p.aluno_id,
    aluno: p.alunos?.nome ?? "",
    checkin_em: p.checkin_em,
    origem: (["qrcode", "recepcao", "professor"] as const).find((o) => o === p.origem) ?? "recepcao",
  }));
}

/** Hora (HH:MM) de um instante no fuso da academia. */
export function horaNoFuso(instante: string, fuso: string): string {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  }
}
