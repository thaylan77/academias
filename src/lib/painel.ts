import { criarClienteIsolado, supabase } from "./supabase";
import { MembroEquipePapel } from "../types/app";

/**
 * Painel da equipe: quem entra, em quais academias e o que vê.
 *
 * O banco protege tudo por RLS; aqui o front decide só o que mostrar. As
 * regras de papel seguem a tabela "Papéis e permissões" do AGENTS.md.
 */

export type PapelPainel = Exclude<MembroEquipePapel, "totem">;

export interface AcademiaDoMembro {
  academia_id: string;
  nome: string;
  slug: string;
  papel: PapelPainel;
  // Assinatura ativa ou trial válido (academia_ativa). Sem isso, a academia
  // lê, mas não altera.
  ativa: boolean;
}

export type SecaoPainel = "inicio" | "alunos" | "turmas" | "matriculas" | "cobrancas" | "graduacoes";

export interface ItemMenu {
  secao: SecaoPainel;
  rotulo: string;
}

const PAPEIS_PAINEL: PapelPainel[] = ["dono", "admin", "professor", "recepcao"];

// Quem vê cada seção (leitura), conforme a tabela de papéis do AGENTS.md.
const MENU: Array<ItemMenu & { papeis: PapelPainel[] }> = [
  { secao: "inicio", rotulo: "Início", papeis: PAPEIS_PAINEL },
  { secao: "alunos", rotulo: "Alunos", papeis: ["dono", "admin", "professor", "recepcao"] },
  { secao: "turmas", rotulo: "Turmas", papeis: ["dono", "admin", "professor", "recepcao"] },
  { secao: "matriculas", rotulo: "Matrículas", papeis: ["dono", "admin", "recepcao"] },
  { secao: "cobrancas", rotulo: "Cobranças", papeis: ["dono", "admin", "recepcao"] },
  { secao: "graduacoes", rotulo: "Graduações", papeis: ["dono", "admin", "professor", "recepcao"] },
];

export function itensDoMenu(papel: PapelPainel): ItemMenu[] {
  return MENU.filter((m) => m.papeis.includes(papel)).map(({ secao, rotulo }) => ({ secao, rotulo }));
}

export function papelPodeVer(papel: PapelPainel, secao: SecaoPainel): boolean {
  return itensDoMenu(papel).some((m) => m.secao === secao);
}

function ehPapelPainel(papel: unknown): papel is PapelPainel {
  return typeof papel === "string" && (PAPEIS_PAINEL as string[]).includes(papel);
}

// ------------------------------------------------------------------ dados

const ACADEMIAS_DEMO: AcademiaDoMembro[] = [
  { academia_id: "demo-a", nome: "Honor Team Demo A", slug: "honor-demo-a", papel: "dono", ativa: true },
  { academia_id: "demo-b", nome: "Honor Team Demo B", slug: "honor-demo-b", papel: "professor", ativa: false },
];
let sessaoDemo = false;

type ClienteSupabase = NonNullable<typeof supabase>;

/**
 * Academias em que o usuário é membro ativo da equipe, sem o papel `totem`
 * (o aparelho do totem não entra no painel), consultadas com o cliente dado.
 *
 * O filtro por `user_id` é obrigatório: a política de leitura de
 * `membros_academia` deixa dono e admin verem os vínculos de outras
 * pessoas da academia, e esses não são academias deste login.
 */
async function academiasDoUsuario(cliente: ClienteSupabase, usuarioId: string): Promise<AcademiaDoMembro[]> {
  const { data, error } = await cliente
    .from("membros_academia")
    .select("academia_id, papel, academias(nome, slug)")
    .eq("user_id", usuarioId)
    .eq("ativo", true);
  if (error) throw error;

  const vinculos = (data ?? []).filter((v) => ehPapelPainel(v.papel) && v.academias);
  const lista = await Promise.all(
    vinculos.map(async (v) => {
      const { data: ativa, error: erroAtiva } = await cliente.rpc("academia_ativa", {
        p_academia_id: v.academia_id,
      });
      if (erroAtiva) throw erroAtiva;
      return {
        academia_id: v.academia_id,
        nome: v.academias!.nome,
        slug: v.academias!.slug,
        papel: v.papel as PapelPainel,
        ativa: ativa === true,
      };
    })
  );
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Academias do login da sessão guardada neste navegador. Lista vazia só
 * quando não há sessão. Sessão que não deu para confirmar (token vencido e
 * renovação falhando, Auth fora do ar) é erro: ela pode continuar guardada,
 * e a tela não pode tratar isso como "saiu".
 */
export async function listarMinhasAcademias(): Promise<AcademiaDoMembro[]> {
  if (supabase) {
    const { data: sessao, error: erroSessao } = await supabase.auth.getSession();
    if (erroSessao) throw erroSessao;
    if (!sessao?.session) return [];
    const { data: auth, error: erroUsuario } = await supabase.auth.getUser();
    if (erroUsuario) throw erroUsuario;
    if (!auth?.user) throw new Error("Sessão sem usuário.");
    return academiasDoUsuario(supabase, auth.user.id);
  }

  if (import.meta.env.DEV) return sessaoDemo ? ACADEMIAS_DEMO : [];
  return [];
}

export type ResultadoEntrada =
  // `usuarioId`: quem entrou, para a tela descartar o resultado se a sessão
  // mudar (saída ou outro login em outra aba) antes de ele chegar.
  | { sucesso: true; academias: AcademiaDoMembro[]; usuarioId: string }
  | { sucesso: false; mensagem: string };

// Só credencial recusada vira "senha incorreta"; limite de tentativas e falha de
// rede ou do servidor ganham mensagem própria, para ninguém trocar a senha à toa.
function mensagemDeFalhaNoLogin(erro: { status?: number; code?: string }): string {
  if (erro.code === "email_not_confirmed") return "Confirme o seu e-mail antes de entrar.";
  if (erro.code === "invalid_credentials" || erro.status === 400) return "E-mail ou senha incorretos.";
  if (erro.status === 429) return "Muitas tentativas. Espere um pouco e tente de novo.";
  return "Não foi possível entrar agora. Verifique a conexão e tente de novo.";
}

const MSG_FALHA_AO_CARREGAR = "Não foi possível carregar suas academias. Verifique a conexão e tente de novo.";
const MSG_SEM_VINCULO = "Este login não faz parte da equipe de nenhuma academia.";
const MSG_SESSAO_MUDOU = "A sessão deste navegador mudou em outra aba. Entre de novo.";

/**
 * Quem chama decide se a tentativa ainda vale. `podePublicar` é consultado
 * logo antes de gravar a sessão no navegador (e recebe o id de quem entrou,
 * para a tela reconhecer o aviso SIGNED_IN da própria tentativa);
 * `continuaValida`, logo depois.
 */
export interface ControleDaTentativa {
  podePublicar(usuarioId: string): boolean;
  continuaValida(): boolean;
}

/**
 * Login da equipe no painel. A senha e os vínculos são conferidos num cliente
 * isolado, sem sessão guardada; a sessão só vai para o navegador (e para as
 * outras abas) quando o login tem academia. Login recusado não chega a
 * existir no navegador, então não há o que desfazer nem sessão de outra aba
 * para derrubar por engano.
 */
export async function entrarNoPainel(
  email: string,
  senha: string,
  controle?: ControleDaTentativa
): Promise<ResultadoEntrada> {
  if (!supabase) {
    if (!import.meta.env.DEV) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
    sessaoDemo = true;
    return { sucesso: true, academias: ACADEMIAS_DEMO, usuarioId: "demo" };
  }

  const tentativa = criarClienteIsolado();
  if (!tentativa) return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };

  const { data, error } = await tentativa.auth.signInWithPassword({ email, password: senha });
  if (error || !data.session) {
    return { sucesso: false, mensagem: error ? mensagemDeFalhaNoLogin(error) : MSG_FALHA_AO_CARREGAR };
  }
  const usuarioId = data.user.id;

  let academias: AcademiaDoMembro[] | null;
  try {
    academias = await academiasDoUsuario(tentativa, usuarioId);
  } catch {
    academias = null;
  }

  if (!academias || academias.length === 0) {
    // Encerra no servidor a sessão da tentativa, que só existia em memória.
    // Falhar aqui não deixa nada guardado no navegador.
    await tentativa.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { sucesso: false, mensagem: academias ? MSG_SEM_VINCULO : MSG_FALHA_AO_CARREGAR };
  }

  // A sessão do navegador mudou enquanto a tentativa corria (entrada ou saída
  // em outra aba, saída aqui): a tentativa não grava nada.
  if (controle && !controle.podePublicar(usuarioId)) {
    await tentativa.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { sucesso: false, mensagem: MSG_SESSAO_MUDOU };
  }

  const { error: erroAoPublicar } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (erroAoPublicar) {
    return { sucesso: false, mensagem: "Não foi possível entrar agora. Verifique a conexão e tente de novo." };
  }
  // Mudou durante a própria gravação (o setSession confere o usuário na
  // rede antes de gravar): desfaz, para nenhum login ficar guardado sem que
  // ninguém o tenha pedido por último.
  if (controle && !controle.continuaValida()) {
    await sairDoPainel();
    return { sucesso: false, mensagem: MSG_SESSAO_MUDOU };
  }
  return { sucesso: true, academias, usuarioId };
}

/**
 * Sai só neste aparelho: não derruba a sessão do mesmo login em outro lugar
 * (um totem, por exemplo). Devolve `false` se a sessão pode ter ficado
 * guardada: com o token vencido e a renovação falhando (rede), o SDK devolve
 * erro antes de remover a sessão, e ela voltaria ao reabrir o painel.
 */
export async function sairDoPainel(): Promise<boolean> {
  sessaoDemo = false;
  if (!supabase) return true;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Avisa quando o usuário da sessão muda (saída ou entrada em outra aba,
 * troca de login). Recebe o id do usuário, ou `null` sem sessão. Devolve a
 * função que para de observar.
 */
export function observarSessao(aoMudar: (usuarioId: string | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_evento, sessao) => {
    aoMudar(sessao?.user.id ?? null);
  });
  return () => data.subscription.unsubscribe();
}

// ------------------------------------------------------------------ escolha da academia

const CHAVE_ESCOLHA = "honorteam.painel.academia";

export function lerAcademiaGuardada(): string | null {
  try {
    return localStorage.getItem(CHAVE_ESCOLHA);
  } catch {
    return null;
  }
}

export function guardarAcademia(slug: string | null): void {
  try {
    if (slug) localStorage.setItem(CHAVE_ESCOLHA, slug);
    else localStorage.removeItem(CHAVE_ESCOLHA);
  } catch {
    /* sem armazenamento: só não lembra a escolha */
  }
}

export type Escolha =
  | { tipo: "academia"; academia: AcademiaDoMembro }
  | { tipo: "escolher" }
  | { tipo: "sem_acesso"; slug: string };

/**
 * Qual academia abrir. O slug da URL manda; ele só vale se for de uma
 * academia deste login. Sem slug: com uma academia só, ela; com várias, a
 * guardada da última vez, se ainda for do login; senão, perguntar.
 */
export function escolherAcademia(
  academias: AcademiaDoMembro[],
  slugDaUrl: string | null,
  slugGuardado: string | null
): Escolha {
  if (slugDaUrl) {
    const daUrl = academias.find((a) => a.slug === slugDaUrl);
    return daUrl ? { tipo: "academia", academia: daUrl } : { tipo: "sem_acesso", slug: slugDaUrl };
  }
  if (academias.length === 1) return { tipo: "academia", academia: academias[0] };
  const guardada = academias.find((a) => a.slug === slugGuardado);
  return guardada ? { tipo: "academia", academia: guardada } : { tipo: "escolher" };
}

// ------------------------------------------------------------------ caminho

export interface CaminhoPainel {
  slug: string | null;
  secao: SecaoPainel;
}

const SECOES: SecaoPainel[] = ["inicio", "alunos", "turmas", "matriculas", "cobrancas", "graduacoes"];

/** Lê `/painel`, `/painel/<slug>` e `/painel/<slug>/<seção>`. */
export function lerCaminhoPainel(pathname: string): CaminhoPainel {
  const partes = pathname.split("/").filter(Boolean);
  const slug = partes[1] ?? null;
  const secao = SECOES.find((s) => s === partes[2]) ?? "inicio";
  return { slug, secao };
}

export function caminhoPainel(slug: string | null, secao: SecaoPainel = "inicio"): string {
  if (!slug) return "/painel";
  return secao === "inicio" ? `/painel/${slug}` : `/painel/${slug}/${secao}`;
}
