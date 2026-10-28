import { supabase } from "./supabase";

/**
 * Acesso do aluno (ou do responsável) ao portal: login por link mágico no
 * e-mail (decisão do dono na #20). Depois do login, vincularCadastro liga o
 * login aos cadastros ativos com esse e-mail (do aluno ou do responsável); o
 * check-in usa essa sessão.
 */

export type Resultado = { sucesso: true } | { sucesso: false; mensagem: string };

const SEM_SERVIDOR = "O portal precisa de conexão com o servidor.";

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarEmail(texto: string): string | null {
  const email = texto.trim().toLowerCase();
  return EMAIL_VALIDO.test(email) ? email : null;
}

// Parâmetros que o Auth põe na URL de volta (erro de link vencido, código).
const PARAMETROS_DO_AUTH = ["error", "error_code", "error_description", "code"];

/**
 * Endereço de volta do link: a página do check-in com a turma e o token do QR,
 * sem o que um link anterior deixou na URL (fragmento e erros do Auth).
 */
export function enderecoDeVolta(atual: string): string {
  const url = new URL(atual);
  url.hash = "";
  for (const p of PARAMETROS_DO_AUTH) url.searchParams.delete(p);
  return url.toString();
}

/** E-mail do login atual, ou null sem sessão. */
export async function emailDaSessao(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user.email ?? null;
}

/** Avisa quando o login muda (entrou pelo link, saiu, outra aba). Devolve a função que para de observar. */
export function observarLogin(aoMudar: (email: string | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => {
    aoMudar(sessao?.user.email ?? null);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Manda o link de acesso. `voltarPara` é a página aberta (com a turma e o
 * token do QR), para o check-in seguir de onde parou.
 */
export async function enviarLinkDeAcesso(email: string, voltarPara: string): Promise<Resultado> {
  if (!supabase) return { sucesso: false, mensagem: SEM_SERVIDOR };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: voltarPara, shouldCreateUser: true },
  });
  if (!error) return { sucesso: true };
  // Decide pelo status, não pelo texto.
  if (error.status === 429) {
    return { sucesso: false, mensagem: "Muitos pedidos seguidos. Espere um minuto e peça o link de novo." };
  }
  return { sucesso: false, mensagem: "Não foi possível enviar o link. Confira o e-mail e tente de novo." };
}

/** Liga o login aos cadastros com esse e-mail. Devolve quantos cadastros novos foram ligados. */
export async function vincularCadastro(): Promise<{ sucesso: true; ligados: number } | { sucesso: false; mensagem: string }> {
  if (!supabase) return { sucesso: false, mensagem: SEM_SERVIDOR };
  const { data, error } = await supabase.rpc("vincular_meu_cadastro_aluno");
  if (error) {
    return {
      sucesso: false,
      mensagem:
        error.hint === "email_nao_confirmado"
          ? "Confirme o e-mail pelo link que enviamos antes de continuar."
          : "Não foi possível ligar seu cadastro agora. Tente de novo em instantes.",
    };
  }
  return { sucesso: true, ligados: typeof data === "number" ? data : 0 };
}

/** Sai só neste aparelho. */
export async function sairDoPortal(): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    return !error;
  } catch {
    return false;
  }
}
