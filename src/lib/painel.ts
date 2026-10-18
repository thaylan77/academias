import { supabase } from "./supabase";
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

/**
 * Academias em que o login atual é membro ativo da equipe, sem o papel
 * `totem` (o aparelho do totem não entra no painel).
 *
 * O filtro por `user_id` é obrigatório: a política de leitura de
 * `membros_academia` deixa dono e admin verem os vínculos de outras
 * pessoas da academia, e esses não são academias deste login.
 */
export async function listarMinhasAcademias(): Promise<AcademiaDoMembro[]> {
  if (supabase) {
    // Sem sessão guardada, não há academia. Com sessão, falha ao confirmar o
    // usuário (rede, Auth fora do ar) é erro, não "login sem academia".
    const { data: sessao } = await supabase.auth.getSession();
    if (!sessao?.session) return [];
    const { data: auth, error: erroUsuario } = await supabase.auth.getUser();
    if (erroUsuario) throw erroUsuario;
    const usuario = auth?.user;
    if (!usuario) return [];

    const { data, error } = await supabase
      .from("membros_academia")
      .select("academia_id, papel, academias(nome, slug)")
      .eq("user_id", usuario.id)
      .eq("ativo", true);
    if (error) throw error;

    const vinculos = (data ?? []).filter((v) => ehPapelPainel(v.papel) && v.academias);
    return Promise.all(
      vinculos.map(async (v) => {
        const { data: ativa, error: erroAtiva } = await supabase!.rpc("academia_ativa", {
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
    ).then((lista) => lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
  }

  if (import.meta.env.DEV) return sessaoDemo ? ACADEMIAS_DEMO : [];
  return [];
}

export type ResultadoEntrada =
  // `usuarioId`: quem entrou, para a tela descartar o resultado se a sessão
  // mudar (saída ou outro login em outra aba) antes de ele chegar.
  | { sucesso: true; academias: AcademiaDoMembro[]; usuarioId: string }
  // `sessaoPodeTerFicado`: a senha conferiu, o login foi recusado e não deu
  // para desfazer a sessão; a tela trata como saída que falhou.
  | { sucesso: false; mensagem: string; sessaoPodeTerFicado?: true };

const MSG_SESSAO_MUDOU = "A sessão deste navegador mudou em outra aba. Entre de novo.";

// Id do usuário da sessão guardada neste navegador, ou null.
async function usuarioDaSessao(): Promise<string | null> {
  if (!supabase) return sessaoDemo ? "demo" : null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.user.id ?? null;
}

/**
 * Desfaz o login recusado, mas só se a sessão ainda for dele: se outro
 * usuário entrou em outra aba nesse meio-tempo, a sessão é desse outro e
 * fica. Devolve `false` se a sessão do login recusado pode ter ficado.
 */
async function desfazerLoginRecusado(usuarioId: string): Promise<boolean> {
  try {
    if ((await usuarioDaSessao()) !== usuarioId) return true;
  } catch {
    // Sem como conferir: tenta sair, que só mexe na sessão deste aparelho.
  }
  return sairDoPainel();
}

// Só credencial recusada vira "senha incorreta"; limite de tentativas e falha de
// rede ou do servidor ganham mensagem própria, para ninguém trocar a senha à toa.
function mensagemDeFalhaNoLogin(erro: { status?: number; code?: string }): string {
  if (erro.code === "email_not_confirmed") return "Confirme o seu e-mail antes de entrar.";
  if (erro.code === "invalid_credentials" || erro.status === 400) return "E-mail ou senha incorretos.";
  if (erro.status === 429) return "Muitas tentativas. Espere um pouco e tente de novo.";
  return "Não foi possível entrar agora. Verifique a conexão e tente de novo.";
}

/** Login da equipe no painel. Sem vínculo em nenhuma academia, recusa. */
export async function entrarNoPainel(email: string, senha: string): Promise<ResultadoEntrada> {
  let usuarioId: string;
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      return { sucesso: false, mensagem: mensagemDeFalhaNoLogin(error) };
    }
    usuarioId = data.user.id;
  } else if (import.meta.env.DEV) {
    sessaoDemo = true;
    usuarioId = "demo";
  } else {
    return { sucesso: false, mensagem: "O painel precisa de conexão com o servidor." };
  }

  let academias: AcademiaDoMembro[] | null;
  try {
    academias = await listarMinhasAcademias();
  } catch {
    academias = null;
  }

  // A lista vem da sessão atual. Se ela já não é deste login (outra aba
  // entrou com outro usuário), nem o resultado nem a recusa valem: não
  // mostra as academias de outro e não derruba a sessão dele.
  let sessaoAtual: string | null | undefined;
  try {
    sessaoAtual = await usuarioDaSessao();
  } catch {
    sessaoAtual = undefined;
  }
  if (sessaoAtual !== undefined && sessaoAtual !== usuarioId) {
    return { sucesso: false, mensagem: MSG_SESSAO_MUDOU };
  }

  if (academias && academias.length > 0) {
    return { sucesso: true, academias, usuarioId };
  }

  const mensagem = academias
    ? "Este login não faz parte da equipe de nenhuma academia."
    : "Não foi possível carregar suas academias. Verifique a conexão e tente de novo.";
  if (!(await desfazerLoginRecusado(usuarioId))) {
    return { sucesso: false, mensagem, sessaoPodeTerFicado: true };
  }
  return { sucesso: false, mensagem };
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
