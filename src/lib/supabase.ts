import { createClient } from "@supabase/supabase-js";
import { Database } from "../types/database";
import {
  AcademiaPublica,
  MatriculaOnlinePayload,
  CheckinResultado,
  UsuarioEquipe,
} from "../types/app";
import { ACADEMIA_DEMO_A, ACADEMIA_DEMO_B } from "./mock-data";
import { mapearErroRpc } from "./rpc-errors";

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || "";

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient<Database>(supabaseUrl, supabaseAnonKey)
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
        throw error;
      }
      return data as unknown as AcademiaPublica;
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
  return {
    ...ACADEMIA_DEMO_A,
    nome: `Academia ${slug.toUpperCase()}`,
  };
}

// Helper unificado para realizar matrícula online
export async function submeterMatriculaOnline(
  slug: string,
  dados: MatriculaOnlinePayload
): Promise<{ sucesso: boolean; matricula_id?: string; mensagem?: string; titulo?: string; acao?: string }> {
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("matricula_online", {
        p_slug: slug.toLowerCase().trim(),
        p_dados: dados as any,
      });
      if (error) {
        const erroMapeado = mapearErroRpc(error);
        return {
          sucesso: false,
          titulo: erroMapeado.titulo,
          mensagem: erroMapeado.mensagem,
          acao: erroMapeado.acaoSugerida,
        };
      }
      return { sucesso: true, matricula_id: data as string };
    } catch (err: any) {
      const erroMapeado = mapearErroRpc(err);
      return {
        sucesso: false,
        titulo: erroMapeado.titulo,
        mensagem: erroMapeado.mensagem,
        acao: erroMapeado.acaoSugerida,
      };
    }
  }

  // Simulação local para demonstração
  await new Promise((r) => setTimeout(r, 600));

  const cpfLimpo = (dados.cpf || "").replace(/\D/g, "");
  if (cpfLimpo === "11111111111") {
    const erroMapeado = mapearErroRpc({
      message: "Já existe um cadastro com esse CPF nesta academia. Procure a recepção.",
      code: "23505",
      hint: "CPF_DUPLICADO",
    });
    return {
      sucesso: false,
      titulo: erroMapeado.titulo,
      mensagem: erroMapeado.mensagem,
      acao: erroMapeado.acaoSugerida,
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
  simulacaoCenario?: "sucesso" | "inadimplente" | "multiplos"
): Promise<CheckinResultado> {
  if (supabase && !simulacaoCenario) {
    try {
      const { data, error } = await supabase.rpc("fazer_checkin", {
        p_turma_id: turmaId,
        p_aluno_id: alunoId || null,
      });

      if (error) {
        const erroMapeado = mapearErroRpc(error);
        const resultado: CheckinResultado = {
          sucesso: false,
          codigo_erro: erroMapeado.codigo,
          titulo: erroMapeado.titulo,
          mensagem: erroMapeado.mensagem,
          acao_sugerida: erroMapeado.acaoSugerida,
        };

        if (erroMapeado.codigo === "MULTIPLOS_ALUNOS") {
          resultado.alunos_disponiveis = [
            { id: "aluno-1", nome: "Lucas Silva (Filho)", status: "ativo" },
            { id: "aluno-2", nome: "Mariana Silva (Filha)", status: "ativo" },
          ];
        }

        return resultado;
      }

      return {
        sucesso: true,
        presenca_id: data as string,
        mensagem: "Presença confirmada com sucesso! Bom treino!",
        horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };
    } catch (err: any) {
      const erroMapeado = mapearErroRpc(err);
      return {
        sucesso: false,
        codigo_erro: erroMapeado.codigo,
        titulo: erroMapeado.titulo,
        mensagem: erroMapeado.mensagem,
        acao_sugerida: erroMapeado.acaoSugerida,
      };
    }
  }

  // Simulação interativa
  await new Promise((r) => setTimeout(r, 400));

  if (simulacaoCenario === "inadimplente") {
    const erroMapeado = mapearErroRpc({
      message: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
      hint: "INADIMPLENTE",
    });
    return {
      sucesso: false,
      codigo_erro: erroMapeado.codigo,
      titulo: erroMapeado.titulo,
      mensagem: erroMapeado.mensagem,
      acao_sugerida: erroMapeado.acaoSugerida,
    };
  }

  if (simulacaoCenario === "multiplos" && !alunoId) {
    const erroMapeado = mapearErroRpc({
      message: "Mais de um aluno neste login: informe qual (p_aluno_id)",
      hint: "MULTIPLOS_ALUNOS",
    });
    return {
      sucesso: false,
      codigo_erro: erroMapeado.codigo,
      titulo: erroMapeado.titulo,
      mensagem: erroMapeado.mensagem,
      acao_sugerida: erroMapeado.acaoSugerida,
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

// Controle de sessão da equipe para o Totem
let sessaoEquipeMock: UsuarioEquipe | null = null;

export async function obterSessaoEquipe(): Promise<UsuarioEquipe | null> {
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return {
      id: user.id,
      nome: user.user_metadata?.nome || user.email?.split("@")[0] || "Membro da Equipe",
      email: user.email || "",
      papel: (user.user_metadata?.papel as any) || "professor",
    };
  }
  return sessaoEquipeMock;
}

export async function loginEquipe(
  email: string,
  senha?: string,
  papel: UsuarioEquipe["papel"] = "professor"
): Promise<{ sucesso: boolean; usuario?: UsuarioEquipe; mensagem?: string }> {
  if (supabase && senha) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      return { sucesso: false, mensagem: error.message };
    }
    const user = data.user;
    return {
      sucesso: true,
      usuario: {
        id: user.id,
        nome: user.user_metadata?.nome || email.split("@")[0],
        email: user.email || email,
        papel,
      },
    };
  }

  // Mock login da equipe para sandbox
  sessaoEquipeMock = {
    id: "equipe-demo-01",
    nome: email.includes("recepcao") ? "Recepção Central" : "Professor Pedro",
    email,
    papel,
  };

  return { sucesso: true, usuario: sessaoEquipeMock };
}

export async function logoutEquipe(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut();
  }
  sessaoEquipeMock = null;
}
