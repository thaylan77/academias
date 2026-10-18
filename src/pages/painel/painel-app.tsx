import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AcademiaDoMembro,
  SecaoPainel,
  caminhoPainel,
  entrarNoPainel,
  escolherAcademia,
  guardarAcademia,
  itensDoMenu,
  lerAcademiaGuardada,
  lerCaminhoPainel,
  listarMinhasAcademias,
  observarSessao,
  papelPodeVer,
  sairDoPainel,
} from "../../lib/painel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Shield, LogOut, Building2 } from "lucide-react";

const ROTULO_PAPEL: Record<AcademiaDoMembro["papel"], string> = {
  dono: "Dono",
  admin: "Administração",
  professor: "Professor",
  recepcao: "Recepção",
};

/** Contexto que as telas do painel usam: academia selecionada e papel nela. */
export interface PainelContextoValor {
  academia: AcademiaDoMembro;
}
export const PainelContexto = React.createContext<PainelContextoValor | null>(null);

// Caminho atual do navegador, atualizado por navegação do painel e pelo voltar/avançar.
// `substituir` corrige o endereço sem criar entrada no histórico; o estado acompanha
// sempre a URL, senão uma navegação seguinte para o caminho antigo não redesenha.
function usarCaminho(): [string, (novo: string) => void, (novo: string) => void] {
  const [caminho, setCaminho] = useState(window.location.pathname);
  useEffect(() => {
    const aoVoltar = () => setCaminho(window.location.pathname);
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);
  const navegar = useCallback((novo: string) => {
    if (novo !== window.location.pathname) window.history.pushState({}, "", novo);
    setCaminho(novo);
  }, []);
  const substituir = useCallback((novo: string) => {
    if (novo !== window.location.pathname) window.history.replaceState({}, "", novo);
    setCaminho(novo);
  }, []);
  return [caminho, navegar, substituir];
}

// Clique com o botão do meio ou com Ctrl/Cmd/Shift abre em outra aba: deixa o navegador agir.
function ehCliqueSimples(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type Estado =
  | { fase: "carregando" }
  | { fase: "login"; aviso?: string }
  | { fase: "falha_ao_sair" }
  | { fase: "pronto"; academias: AcademiaDoMembro[] };

export const PainelApp: React.FC = () => {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [caminho, navegar, substituir] = usarCaminho();
  // Cada carga de academias tem um número; resposta de carga antiga (de outro
  // usuário, ou de antes de sair) é descartada.
  const geracao = useRef(0);
  const usuarioAtual = useRef<string | null | undefined>(undefined);

  const carregar = useCallback(() => {
    const minha = ++geracao.current;
    listarMinhasAcademias()
      .then((academias) => {
        if (minha !== geracao.current) return;
        setEstado(academias.length ? { fase: "pronto", academias } : { fase: "login" });
      })
      .catch(() => {
        if (minha !== geracao.current) return;
        setEstado({ fase: "login", aviso: "Não foi possível carregar suas academias. Entre de novo." });
      });
  }, []);

  useEffect(() => {
    carregar();
    return () => {
      geracao.current++;
    };
  }, [carregar]);

  // Saída ou troca de login em outra aba: a tela não fica com academias,
  // papel e menu do usuário anterior.
  useEffect(
    () =>
      observarSessao((usuarioId) => {
        const anterior = usuarioAtual.current;
        usuarioAtual.current = usuarioId;
        if (anterior === undefined || anterior === usuarioId) return;
        if (usuarioId === null) {
          geracao.current++;
          setEstado({ fase: "login" });
          return;
        }
        // Entrada a partir do login (desta aba ou de outra): quem cuida é o
        // formulário. Só a troca de um usuário por outro recarrega aqui.
        if (anterior === null) return;
        geracao.current++;
        setEstado({ fase: "carregando" });
        // Fora do callback do Auth: chamar o cliente dentro dele trava a fila de sessão.
        setTimeout(carregar, 0);
      }),
    [carregar]
  );

  // A URL mostra o que está na tela: sem slug (uma academia só, ou a guardada),
  // ganha o slug; seção que o papel não vê volta para o início.
  useEffect(() => {
    if (estado.fase !== "pronto") return;
    const { slug, secao } = lerCaminhoPainel(caminho);
    const escolha = escolherAcademia(estado.academias, slug, lerAcademiaGuardada());
    if (escolha.tipo !== "academia") return;
    const { academia } = escolha;
    const correto = caminhoPainel(academia.slug, papelPodeVer(academia.papel, secao) ? secao : "inicio");
    if (correto !== caminho) substituir(correto);
  }, [estado, caminho, substituir]);

  const sair = async () => {
    geracao.current++;
    const saiu = await sairDoPainel();
    guardarAcademia(null);
    navegar("/painel");
    // Se a sessão pode ter ficado guardada, não finge que saiu: esconde a
    // academia e pede nova tentativa (computador compartilhado da recepção).
    setEstado(saiu ? { fase: "login" } : { fase: "falha_ao_sair" });
  };

  if (estado.fase === "carregando") {
    return <p className="py-16 text-center text-sm text-zinc-500" role="status">Carregando o painel...</p>;
  }

  if (estado.fase === "falha_ao_sair") {
    return (
      <Moldura aoSair={sair}>
        <Alert variant="destructive" role="alert" className="max-w-lg mx-auto">
          <AlertDescription>
            Não foi possível encerrar a sessão neste aparelho, e ela pode continuar ativa. Verifique a conexão
            e tente sair de novo antes de deixar o computador.
          </AlertDescription>
        </Alert>
        <div className="text-center mt-6">
          <Button onClick={sair}>Tentar sair de novo</Button>
        </div>
      </Moldura>
    );
  }

  if (estado.fase === "login") {
    return (
      <LoginPainel
        aviso={estado.aviso}
        aoEntrar={(academias) => setEstado({ fase: "pronto", academias })}
      />
    );
  }

  const { slug, secao } = lerCaminhoPainel(caminho);
  const escolha = escolherAcademia(estado.academias, slug, lerAcademiaGuardada());

  if (escolha.tipo === "sem_acesso") {
    return (
      <Moldura aoSair={sair}>
        <Alert variant="destructive" role="alert" className="max-w-lg mx-auto">
          <AlertDescription>
            Você não faz parte da equipe da academia <strong>{escolha.slug}</strong>.
          </AlertDescription>
        </Alert>
        <div className="text-center mt-6">
          <Button variant="outline" onClick={() => navegar("/painel")}>Ver minhas academias</Button>
        </div>
      </Moldura>
    );
  }

  if (escolha.tipo === "escolher") {
    return (
      <Moldura aoSair={sair}>
        <EscolhaDeAcademia
          academias={estado.academias}
          aoEscolher={(a) => {
            guardarAcademia(a.slug);
            navegar(caminhoPainel(a.slug));
          }}
        />
      </Moldura>
    );
  }

  const academia = escolha.academia;
  const secaoVisivel: SecaoPainel = papelPodeVer(academia.papel, secao) ? secao : "inicio";

  return (
    <PainelContexto.Provider value={{ academia }}>
      <Moldura aoSair={sair}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-white">{academia.nome}</h1>
            <p className="text-xs text-zinc-400">
              Você entrou como <strong>{ROTULO_PAPEL[academia.papel]}</strong>
            </p>
          </div>
          {estado.academias.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                guardarAcademia(null);
                navegar("/painel");
              }}
            >
              <Building2 className="w-4 h-4 mr-1.5" /> Trocar de academia
            </Button>
          )}
        </div>

        {!academia.ativa && (
          <Alert variant="warning" role="alert" className="mb-6">
            <AlertDescription>
              A assinatura desta academia está suspensa ou o período de teste acabou. Você pode consultar os
              dados, mas não alterar.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 md:grid-cols-[200px_1fr]">
          <nav aria-label="Menu do painel">
            <ul className="space-y-1">
              {itensDoMenu(academia.papel).map((item) => (
                <li key={item.secao}>
                  <a
                    href={caminhoPainel(academia.slug, item.secao)}
                    aria-current={item.secao === secaoVisivel ? "page" : undefined}
                    onClick={(e) => {
                      if (!ehCliqueSimples(e)) return;
                      e.preventDefault();
                      navegar(caminhoPainel(academia.slug, item.secao));
                    }}
                    className={`block rounded-lg px-3 py-2 text-sm ${
                      item.secao === secaoVisivel
                        ? "bg-red-950/40 text-white border border-red-900/60"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                    }`}
                  >
                    {item.rotulo}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <section>
            <SecaoEmConstrucao secao={secaoVisivel} />
          </section>
        </div>
      </Moldura>
    </PainelContexto.Provider>
  );
};

const Moldura: React.FC<{ aoSair: () => void; children: React.ReactNode }> = ({ aoSair, children }) => (
  <div className="min-h-screen bg-zinc-950 text-zinc-100">
    <header className="border-b border-zinc-800">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <span className="flex items-center gap-2 font-extrabold text-white">
          <Shield className="w-5 h-5 text-red-500" /> HONOR TEAM <Badge variant="secondary">Painel</Badge>
        </span>
        <Button variant="ghost" size="sm" onClick={aoSair}>
          <LogOut className="w-4 h-4 mr-1.5" /> Sair
        </Button>
      </div>
    </header>
    <main className="container mx-auto px-4 py-8">{children}</main>
  </div>
);

const ISSUE_DA_SECAO: Partial<Record<SecaoPainel, number>> = {
  alunos: 26,
  turmas: 27,
  matriculas: 28,
  cobrancas: 29,
  graduacoes: 30,
};

const SecaoEmConstrucao: React.FC<{ secao: SecaoPainel }> = ({ secao }) => {
  if (secao === "inicio") {
    return <p className="text-sm text-zinc-400">Escolha uma seção no menu.</p>;
  }
  return (
    <p className="text-sm text-zinc-400">
      Esta tela ainda não existe. Ela chega com a issue #{ISSUE_DA_SECAO[secao]}.
    </p>
  );
};

const EscolhaDeAcademia: React.FC<{
  academias: AcademiaDoMembro[];
  aoEscolher: (a: AcademiaDoMembro) => void;
}> = ({ academias, aoEscolher }) => (
  <div className="max-w-lg mx-auto">
    <h1 className="text-xl font-bold text-white mb-4">Em qual academia você quer entrar?</h1>
    <ul className="space-y-2">
      {academias.map((a) => (
        <li key={a.academia_id}>
          <button
            type="button"
            onClick={() => aoEscolher(a)}
            className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-zinc-600"
          >
            <span className="block font-semibold text-white">{a.nome}</span>
            <span className="block text-xs text-zinc-400">
              {ROTULO_PAPEL[a.papel]}
              {!a.ativa && " • assinatura suspensa ou teste vencido"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  </div>
);

const LoginPainel: React.FC<{
  aviso?: string;
  aoEntrar: (academias: AcademiaDoMembro[]) => void;
}> = ({ aviso, aoEntrar }) => {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(aviso ?? null);
  const [entrando, setEntrando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEntrando(true);
    const res = await entrarNoPainel(email.trim(), senha);
    setEntrando(false);
    if (res.sucesso) aoEntrar(res.academias);
    else setErro(res.mensagem);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-950/90">
        <CardHeader>
          <CardTitle className="text-white">Painel da equipe</CardTitle>
          <CardDescription>Entre com o e-mail e a senha da sua conta da academia.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={enviar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="painel-email">E-mail</Label>
              <Input id="painel-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="painel-senha">Senha</Label>
              <Input id="painel-senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
            </div>
            {erro && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{erro}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={entrando}>
              {entrando ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
