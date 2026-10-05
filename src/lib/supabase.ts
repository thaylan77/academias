import { createClient } from "@supabase/supabase-js";
import {
  AcademiaPublica,
  MatriculaOnlinePayload,
  CheckinResultado,
} from "../types/database";
import { ACADEMIA_DEMO_A, ACADEMIA_DEMO_B } from "./mock-data";

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || "";

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Helper unificado para buscar dados públicos da academia
export async function obterAcademiaPublica(slug: string): Promise<AcademiaPublica | null> {
  const slugNormalizado = slug.toLowerCase().trim();

  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("academia_publica", {
        p_slug: slugNormalizado,
      });
      if (error) {
        console.error("Erro na RPC academia_publica:", error);
        throw error;
      }
      return data as AcademiaPublica;
    } catch (e) {
      console.warn("Falha ao consultar Supabase, caindo no mock se disponível:", e);
    }
  }

  // Fallback para simulação local / preview
  if (slugNormalizado === "honor-demo-a" || slugNormalizado === "demo") {
    return ACADEMIA_DEMO_A;
  }
  if (slugNormalizado === "honor-demo-b") {
    return ACADEMIA_DEMO_B;
  }
  // Se for qualquer outro slug em modo mock, devolve modelo padrão ativo
  return {
    ...ACADEMIA_DEMO_A,
    nome: `Academia ${slug.toUpperCase()}`,
  };
}

// Helper unificado para realizar matrícula online
export async function submeterMatriculaOnline(
  slug: string,
  dados: MatriculaOnlinePayload
): Promise<{ sucesso: boolean; matricula_id?: string; mensagem?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("matricula_online", {
        p_slug: slug.toLowerCase().trim(),
        p_dados: dados,
      });
      if (error) {
        return {
          sucesso: false,
          mensagem: error.message || "Erro ao realizar matrícula online.",
        };
      }
      return { sucesso: true, matricula_id: data as string };
    } catch (err: any) {
      return {
        sucesso: false,
        mensagem: err.message || "Falha na conexão com o servidor.",
      };
    }
  }

  // Simulação local para demonstração
  await new Promise((r) => setTimeout(r, 600)); // Simula latência de rede

  // Simular validação de CPF repetido se CPF for '111.111.111-11'
  const cpfLimpo = (dados.cpf || "").replace(/\D/g, "");
  if (cpfLimpo === "11111111111") {
    return {
      sucesso: false,
      mensagem: "Já existe um cadastro com esse CPF nesta academia. Procure a recepção.",
    };
  }

  return {
    sucesso: true,
    matricula_id: "demo-matricula-" + Math.floor(Math.random() * 100000),
  };
}

// Helper unificado para realização de check-in por QR Code
export async function realizarCheckin(
  turmaId: string,
  alunoId?: string,
  simulacaoCenario?: 'sucesso' | 'inadimplente' | 'multiplos'
): Promise<CheckinResultado> {
  if (supabase && !simulacaoCenario) {
    try {
      const { data, error } = await supabase.rpc("fazer_checkin", {
        p_turma_id: turmaId,
        p_aluno_id: alunoId || null,
      });

      if (error) {
        const msg = error.message;
        if (msg.includes("mensalidade em atraso")) {
          return {
            sucesso: false,
            codigo_erro: "INADIMPLENTE",
            mensagem: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
          };
        }
        if (msg.includes("Mais de um aluno")) {
          return {
            sucesso: false,
            codigo_erro: "MULTIPLOS_ALUNOS",
            mensagem: "Mais de um aluno encontrado neste cadastro. Selecione quem está no treino.",
            alunos_disponiveis: [
              { id: "aluno-1", nome: "Lucas Silva (Filho)", status: "ativo" },
              { id: "aluno-2", nome: "Mariana Silva (Filha)", status: "ativo" },
            ],
          };
        }
        return {
          sucesso: false,
          codigo_erro: "GENERICO",
          mensagem: error.message || "Não foi possível confirmar o check-in.",
        };
      }

      return {
        sucesso: true,
        presenca_id: data as string,
        mensagem: "Presença confirmada com sucesso! Bom treino!",
        horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };
    } catch (err: any) {
      return {
        sucesso: false,
        codigo_erro: "GENERICO",
        mensagem: err.message || "Erro inesperado ao registrar check-in.",
      };
    }
  }

  // Simulação interativa
  await new Promise((r) => setTimeout(r, 500));

  if (simulacaoCenario === "inadimplente") {
    return {
      sucesso: false,
      codigo_erro: "INADIMPLENTE",
      mensagem: "Check-in bloqueado: mensalidade em atraso. Procure a recepção para regularizar.",
    };
  }

  if (simulacaoCenario === "multiplos" && !alunoId) {
    return {
      sucesso: false,
      codigo_erro: "MULTIPLOS_ALUNOS",
      mensagem: "Mais de um dependente encontrado neste acesso. Selecione o aluno:",
      alunos_disponiveis: [
        { id: "aluno-1", nome: "Lucas Silva (Filho)", status: "ativo" },
        { id: "aluno-2", nome: "Mariana Silva (Filha)", status: "ativo" },
      ],
    };
  }

  return {
    sucesso: true,
    presenca_id: "presenca-" + Math.floor(Math.random() * 100000),
    aluno_nome: alunoId === "aluno-2" ? "Mariana Silva" : "Lucas Silva",
    turma_nome: "Jiu-Jitsu Adulto — Noite",
    horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    mensagem: "Presença confirmada com sucesso! Oss!",
  };
}
