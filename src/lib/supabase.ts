import { createClient } from "@supabase/supabase-js";
import { Database } from "../types/database";
import {
  AcademiaPublica,
  MatriculaOnlinePayload,
  CheckinResultado,
  UsuarioEquipe,
  TurmaAbertaTotem,
  TokenCheckinInfo,
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
      const { data, error } = await (supabase.rpc as any)("academia_publica", {
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

  // Fallback para simulação local / preview (apenas DEV)
  if (import.meta.env.DEV) {
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

  return null;
}

// Helper unificado para realizar matrícula online
export async function submeterMatriculaOnline(
  slug: string,
  dados: MatriculaOnlinePayload
): Promise<{ sucesso: boolean; matricula_id?: string; mensagem?: string; titulo?: string; acao?: string }> {
  if (supabase) {
    try {
      const { data, error } = await (supabase.rpc as any)("matricula_online", {
        p_slug: slug.toLowerCase().trim(),
        p_dados: dados,
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

  // Simulação local para demonstração (somente DEV)
  if (import.meta.env.DEV) {
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

  return {
    sucesso: false,
    mensagem: "Supabase não conectado em ambiente de produção.",
  };
}

// Helper para buscar turmas com check-in aberto neste momento para o Totem
export async function obterTurmasAbertasTotem(academiaId: string): Promise<TurmaAbertaTotem[]> {
  if (supabase) {
    const { data, error } = await (supabase.rpc as any)("totem_turmas_agora", {
      p_academia_id: academiaId,
    });
    if (error) {
      throw error;
    }
    return (data as TurmaAbertaTotem[]) || [];
  }

  // Fallback para simulação local / dev apenas sem cliente supabase configurado
  if (import.meta.env.DEV) {
    return [
      {
        id: "turma-jj-01",
        nome: "Jiu-Jitsu Adulto — Noite",
        hora_inicio: "19:00",
        hora_fim: "20:30",
        modalidade_nome: "Jiu-Jitsu",
      },
      {
        id: "turma-mt-01",
        nome: "Muay Thai Geral",
        hora_inicio: "19:30",
        hora_fim: "21:00",
        modalidade_nome: "Muay Thai",
      },
    ];
  }

  return [];
}

// Helper para emitir token HMAC rotativo de check-in para uma turma
export async function emitirTokenCheckin(turmaId: string): Promise<TokenCheckinInfo | null> {
  if (supabase) {
    const { data, error } = await (supabase.rpc as any)("emitir_token_checkin", {
      p_turma_id: turmaId,
    });
    if (error) {
      throw error;
    }
    return data as TokenCheckinInfo;
  }

  // Mock em ambiente DEV apenas sem cliente supabase configurado
  if (import.meta.env.DEV) {
    const randomHex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    return {
      token: `tok_${randomHex}`,
      expira_em: new Date(Date.now() + 30000).toISOString(),
      periodo_segundos: 30,
    };
  }

  return null;
}

// Helper unificado para realização de check-in por QR Code com token obrigatório
export async function realizarCheckin(
  turmaId: string,
  token?: string,
  alunoId?: string,
  simulacaoCenario?: "sucesso" | "inadimplente" | "multiplos"
): Promise<CheckinResultado> {
  const tokenEfetivo = token || (import.meta.env.DEV ? "token-dev-simulado" : "");

  if (supabase && (!import.meta.env.DEV || !simulacaoCenario)) {
    try {
      const { data, error } = await (supabase.rpc as any)("fazer_checkin", {
        p_turma_id: turmaId,
        p_token: tokenEfetivo,
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
          alunos_disponiveis: erroMapeado.candidatosDependentes?.map((c) => ({
            id: c.id,
            nome: c.nome,
            status: "ativo",
          })),
        };

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
        alunos_disponiveis: erroMapeado.candidatosDependentes?.map((c) => ({
          id: c.id,
          nome: c.nome,
          status: "ativo",
        })),
      };
    }
  }

  // Simulação interativa estritamente para DEV
  if (import.meta.env.DEV) {
    await new Promise((r) => setTimeout(r, 400));

    if (simulacaoCenario === "inadimplente") {
      const erroMapeado = mapearErroRpc({
        message: "Check-in bloqueado: mensalidade em atraso. Procure a recepção.",
        hint: "checkin_inadimplente",
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
      const dependentesMock = [
        { id: "aluno-1", nome: "Lucas Silva (Filho)" },
        { id: "aluno-2", nome: "Mariana Silva (Filha)" },
      ];
      const erroMapeado = mapearErroRpc({
        message: "Mais de um aluno associado a este login para esta turma",
        hint: "checkin_multiplos_alunos",
        details: JSON.stringify(dependentesMock),
      });
      return {
        sucesso: false,
        codigo_erro: erroMapeado.codigo,
        titulo: erroMapeado.titulo,
        mensagem: erroMapeado.mensagem,
        acao_sugerida: erroMapeado.acaoSugerida,
        alunos_disponiveis: dependentesMock.map((d) => ({
          id: d.id,
          nome: d.nome,
          status: "ativo",
        })),
      };
    }

    if (!token && !simulacaoCenario) {
      const erroMapeado = mapearErroRpc({
        message: "Token do check-in ausente ou inválido",
        hint: "checkin_token_invalido",
      });
      return {
        sucesso: false,
        codigo_erro: erroMapeado.codigo,
        titulo: erroMapeado.titulo,
        mensagem: erroMapeado.mensagem,
        acao_sugerida: erroMapeado.acaoSugerida,
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

  return {
    sucesso: false,
    codigo_erro: "CONFIG_AUSENTE",
    mensagem: "Supabase não configurado no ambiente de produção.",
  };
}

export type VinculoEquipe =
  | { tipo: "membro"; papel: UsuarioEquipe["papel"] }
  | { tipo: "sem_vinculo" }
  | { tipo: "erro"; erro: unknown };

/**
 * Lê o papel da equipe em membros_academia, sempre filtrando por academia_id.
 * Não há papel por omissão: quem não tem vínculo ativo naquela academia não
 * recebe papel nenhum, e falha de consulta não é tratada como vínculo.
 * (O banco recusa de qualquer jeito com `sem_permissao`; isto evita que o
 * front trate como equipe quem não é.)
 */
export async function resolverPapelEquipe(
  client: any,
  userId: string,
  academiaId: string
): Promise<VinculoEquipe> {
  if (!client || !academiaId) {
    return { tipo: "erro", erro: new Error("Cliente ou academia ausente") };
  }
  try {
    const { data: membro, error } = await client
      .from("membros_academia")
      .select("papel")
      .eq("user_id", userId)
      .eq("ativo", true)
      .eq("academia_id", academiaId)
      .maybeSingle();

    if (error) {
      return { tipo: "erro", erro: error };
    }
    if (membro?.papel) {
      return { tipo: "membro", papel: membro.papel as UsuarioEquipe["papel"] };
    }
    return { tipo: "sem_vinculo" };
  } catch (e) {
    return { tipo: "erro", erro: e };
  }
}

// Controle de sessão da equipe para o Totem
let sessaoEquipeMock: UsuarioEquipe | null = null;

export async function obterSessaoEquipe(academiaId: string): Promise<UsuarioEquipe | null> {
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Sem vínculo confirmado nesta academia, o totem pede login.
    const vinculo = await resolverPapelEquipe(supabase, user.id, academiaId);
    if (vinculo.tipo !== "membro") {
      if (vinculo.tipo === "erro") {
        console.warn("Falha ao consultar papel em membros_academia:", vinculo.erro);
      }
      return null;
    }

    return {
      id: user.id,
      nome: user.user_metadata?.nome || user.email?.split("@")[0] || "Membro da Equipe",
      email: user.email || "",
      papel: vinculo.papel,
    };
  }
  // Em desenvolvimento local, permite resgatar sessão do mock se estiver ativo
  if (import.meta.env.DEV) {
    return sessaoEquipeMock;
  }
  return null;
}

export async function loginEquipe(
  email: string,
  senha?: string,
  papel: UsuarioEquipe["papel"] = "professor",
  academiaId?: string
): Promise<{ sucesso: boolean; usuario?: UsuarioEquipe; mensagem?: string }> {
  if (supabase && senha) {
    if (!academiaId) {
      return { sucesso: false, mensagem: "A academia ainda não foi carregada. Recarregue a página e tente de novo." };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      return { sucesso: false, mensagem: error.message };
    }
    const user = data.user;
    const vinculo = await resolverPapelEquipe(supabase, user.id, academiaId);

    if (vinculo.tipo !== "membro") {
      // A senha confere, mas o login não é da equipe desta academia (ou não deu
      // para confirmar): desfaz a sessão só neste aparelho e recusa.
      await supabase.auth.signOut({ scope: "local" });
      return {
        sucesso: false,
        mensagem:
          vinculo.tipo === "sem_vinculo"
            ? "Este login não faz parte da equipe desta academia."
            : "Não foi possível confirmar seu vínculo com a academia. Verifique a conexão e tente de novo.",
      };
    }

    return {
      sucesso: true,
      usuario: {
        id: user.id,
        nome: user.user_metadata?.nome || email.split("@")[0],
        email: user.email || email,
        papel: vinculo.papel,
      },
    };
  }

  // Mock login da equipe estritamente para desenvolvimento local (import.meta.env.DEV)
  if (import.meta.env.DEV) {
    sessaoEquipeMock = {
      id: "equipe-dev-01",
      nome: email.includes("recepcao") ? "Recepção" : "Professor",
      email,
      papel,
    };
    return { sucesso: true, usuario: sessaoEquipeMock };
  }

  return { sucesso: false, mensagem: "Ambiente de produção exige conexão ativa com o Supabase." };
}

export async function logoutEquipe(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut();
  }
  sessaoEquipeMock = null;
}

// Códigos com que o Supabase Auth diz que o refresh token ou a sessão não
// valem mais. Só eles (e os status abaixo) justificam deslogar o totem.
const CODIGOS_REFRESH_DEFINITIVOS = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "user_banned",
  "bad_jwt",
  "invalid_grant",
]);

/**
 * A falha ao renovar a sessão é definitiva (credencial recusada) ou pode
 * passar sozinha? Na dúvida é transitória: limite de requisições (429),
 * tempo esgotado (408), 5xx, queda de rede e erro desconhecido mantêm a
 * sessão e o totem tenta de novo com espera crescente.
 */
export function falhaDeRenovacaoEhDefinitiva(error: any): boolean {
  if (!error || typeof error !== "object") return false;
  if (error.name === "AuthSessionMissingError") return true;

  const code = typeof error.code === "string" ? error.code.trim().toLowerCase() : "";
  if (CODIGOS_REFRESH_DEFINITIVOS.has(code)) return true;

  const status = error.status ?? error.statusCode;
  return status === 400 || status === 401 || status === 403;
}

/**
 * Tenta renovar a sessão atual via refresh token (supabase.auth.refreshSession).
 * Evita deslogar o quiosque/totem quando o dispositivo acorda do modo de repouso (suspensão noturna).
 * Retorna ehTransitorio: true para toda falha que não seja recusa de credencial.
 */
export async function renovarSessao(): Promise<{
  sucesso: boolean;
  ehTransitorio?: boolean;
  erro?: any;
}> {
  if (supabase?.auth?.refreshSession) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        return { sucesso: false, ehTransitorio: !falhaDeRenovacaoEhDefinitiva(error), erro: error };
      }
      if (!data?.session) {
        return { sucesso: false, ehTransitorio: false, erro: new Error("Sessão não retornada após renovação") };
      }
      return { sucesso: true };
    } catch (e: any) {
      return { sucesso: false, ehTransitorio: !falhaDeRenovacaoEhDefinitiva(e), erro: e };
    }
  }

  // Em modo de desenvolvimento / testes com sessão simulada
  if (import.meta.env.DEV && sessaoEquipeMock) {
    return { sucesso: true };
  }

  return { sucesso: false, ehTransitorio: false, erro: new Error("Supabase não inicializado ou sem sessão ativa") };
}
