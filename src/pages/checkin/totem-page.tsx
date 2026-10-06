import React, { useEffect, useState, useRef } from "react";
import {
  obterAcademiaPublica,
  obterSessaoEquipe,
  loginEquipe,
  logoutEquipe,
  renovarSessao,
  obterTurmasAbertasTotem,
  emitirTokenCheckin,
} from "../../lib/supabase";
import { mapearErroRpc, ErroRpcMapeado, isErroTransitorioTotem, isErroAutenticacao } from "../../lib/rpc-errors";
import { AcademiaPublica, TurmaAbertaTotem, TokenCheckinInfo, UsuarioEquipe } from "../../types/app";
import { QRGenerator } from "../../components/qr/qr-generator";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import {
  Maximize,
  Minimize,
  Clock,
  Sparkles,
  Lock,
  LogOut,
  ShieldCheck,
  UserCheck,
  AlertTriangle,
  RefreshCw,
  WifiOff,
} from "lucide-react";

interface TotemPageProps {
  slug: string;
  onSessionChange?: (autenticado: boolean) => void;
}

const INTERVALOS_BACKOFF = [5, 15, 30, 60];
const INTERVALO_ERRO_PERMANENTE = 60;

export const TotemPage: React.FC<TotemPageProps> = ({ slug, onSessionChange }) => {
  const [academia, setAcademia] = useState<AcademiaPublica | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [turmasAbertas, setTurmasAbertas] = useState<TurmaAbertaTotem[]>([]);
  const [tokens, setTokens] = useState<Record<string, TokenCheckinInfo>>({});
  const [currentTime, setCurrentTime] = useState<string>("");
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [segundosRestantes, setSegundosRestantes] = useState<number>(30);

  // Estados de erro e resiliência das RPCs do totem
  const [erroTotem, setErroTotem] = useState<ErroRpcMapeado | null>(null);
  const [errosTokens, setErrosTokens] = useState<Record<string, ErroRpcMapeado>>({});
  const [statusConexao, setStatusConexao] = useState<"conectado" | "reconectando" | "bloqueado">("conectado");
  const [tentativasFalhas, setTentativasFalhas] = useState<number>(0);
  const [carregandoCiclo, setCarregandoCiclo] = useState<boolean>(false);

  const tentativasFalhasRef = useRef<number>(0);
  tentativasFalhasRef.current = tentativasFalhas;
  const carregandoCicloRef = useRef<boolean>(false);
  carregandoCicloRef.current = carregandoCiclo;

  // Estado de autenticação da equipe (sem credenciais hardcoded)
  const [usuarioEquipe, setUsuarioEquipe] = useState<UsuarioEquipe | null>(null);
  const [emailLogin, setEmailLogin] = useState<string>("");
  const [senhaLogin, setSenhaLogin] = useState<string>("");
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [autenticando, setAutenticando] = useState<boolean>(false);

  useEffect(() => {
    verificarAcesso();
    const clockTimer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }, 1000);
    return () => clearInterval(clockTimer);
  }, [slug]);

  // Função centralizada para atualizar turmas abertas e tokens com controle de resiliência e renovação de sessão
  const atualizarCiclo = async (tentouRenovar = false) => {
    if (!academia || carregandoCicloRef.current) return;
    setCarregandoCiclo(true);
    try {
      const abertas = await obterTurmasAbertasTotem(academia.id);
      setTurmasAbertas(abertas);
      setErroTotem(null);
      setStatusConexao("conectado");
      setTentativasFalhas(0);

      if (abertas.length > 0) {
        const novoMapaTokens: Record<string, TokenCheckinInfo> = {};
        const novoMapaErros: Record<string, ErroRpcMapeado> = {};
        let menorTempoRestante = 30;

        for (const turma of abertas) {
          try {
            const info = await emitirTokenCheckin(turma.id);
            if (info && info.token) {
              novoMapaTokens[turma.id] = info;
              if (info.expira_em) {
                const ms = new Date(info.expira_em).getTime() - Date.now();
                const segs = Math.max(1, Math.floor(ms / 1000));
                menorTempoRestante = Math.min(menorTempoRestante, segs);
              } else if (info.periodo_segundos) {
                menorTempoRestante = Math.min(menorTempoRestante, info.periodo_segundos);
              }
            } else {
              novoMapaErros[turma.id] = {
                codigo: "GENERICO",
                titulo: "Token Indisponível",
                mensagem: "Não foi possível emitir o token de check-in para esta turma.",
                acaoSugerida: "Aguarde a próxima renovação.",
              };
            }
          } catch (errTurma: any) {
            if (isErroAutenticacao(errTurma)) {
              throw errTurma;
            }
            novoMapaErros[turma.id] = mapearErroRpc(errTurma);
          }
        }

        setTokens(novoMapaTokens);
        setErrosTokens(novoMapaErros);
        setSegundosRestantes(menorTempoRestante);
      } else {
        setTokens({});
        setErrosTokens({});
        setSegundosRestantes(30);
      }
    } catch (err: any) {
      const erroMapeado = mapearErroRpc(err);

      // Categoria 3: Erro de autenticação (sessão expirada/revogada, 401/JWT)
      // Dispositivo que acorda de repouso: tenta renovar via refresh token antes de deslogar.
      // Se a renovação tiver sucesso, repete a chamada que falhou.
      // Só realiza logoutEquipe() e exibe erro se a renovação falhar.
      if (isErroAutenticacao(err) || erroMapeado.codigo === "sessao_expirada") {
        if (!tentouRenovar) {
          const resRenovacao = await renovarSessao();
          if (resRenovacao.sucesso) {
            setCarregandoCiclo(false);
            return atualizarCiclo(true);
          }
        }

        await logoutEquipe();
        setUsuarioEquipe(null);
        if (onSessionChange) {
          onSessionChange(false);
        }
        setErroLogin("Sessão encerrada, faça login novamente.");
        setErroTotem(null);
        setStatusConexao("conectado");
        setTurmasAbertas([]);
        setTokens({});
        setErrosTokens({});
        return;
      }

      setErroTotem(erroMapeado);

      if (isErroTransitorioTotem(erroMapeado)) {
        // Categoria 1: Erro transitório (rede, timeout, 5xx): espera crescente 5 s, 15 s, 30 s, até 60 s
        const tentAtual = tentativasFalhasRef.current;
        const indexIntervalo = Math.min(tentAtual, INTERVALOS_BACKOFF.length - 1);
        const espera = INTERVALOS_BACKOFF[indexIntervalo];
        setStatusConexao("reconectando");
        setTentativasFalhas((prev) => prev + 1);
        setSegundosRestantes(espera);
      } else {
        // Categoria 2: Erro permanente (sem_permissao, academia_suspensa):
        // Checa novamente a cada 60 s para retornar sozinho quando a situação mudar
        setStatusConexao("bloqueado");
        setTurmasAbertas([]);
        setTokens({});
        setErrosTokens({});
        setSegundosRestantes(INTERVALO_ERRO_PERMANENTE);
      }
    } finally {
      setCarregandoCiclo(false);
    }
  };

  // Disparo inicial quando a sessão e a academia estão prontas
  useEffect(() => {
    if (!usuarioEquipe || !academia) return;
    atualizarCiclo();
  }, [usuarioEquipe, academia?.id]);

  // Temporizador regressivo puro: decrementa 1 segundo sem efeitos colaterais dentro do updater
  useEffect(() => {
    if (!usuarioEquipe || !academia) return;

    const timer = setInterval(() => {
      setSegundosRestantes((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [usuarioEquipe, academia?.id]);

  // Disparo reativo ao zerar o contador regressivo
  useEffect(() => {
    if (!usuarioEquipe || !academia) return;

    if (segundosRestantes === 0 && !carregandoCicloRef.current) {
      atualizarCiclo();
    }
  }, [segundosRestantes, usuarioEquipe, academia?.id]);

  const verificarAcesso = async () => {
    setLoading(true);
    const data = await obterAcademiaPublica(slug);
    setAcademia(data);

    // Consulta de papel da equipe com filtro obrigatório por academia_id (regra multi-tenant)
    const user = data?.id ? await obterSessaoEquipe(data.id) : null;
    setUsuarioEquipe(user);
    if (onSessionChange) {
      onSessionChange(!!user);
    }
    setLoading(false);
  };

  const handleLogin = async (
    e?: React.FormEvent,
    emailDemo?: string,
    senhaDemo?: string,
    papelOverride?: UsuarioEquipe["papel"]
  ) => {
    if (e) e.preventDefault();
    setErroLogin(null);
    setAutenticando(true);

    const email = emailDemo || emailLogin;
    const senha = senhaDemo !== undefined ? senhaDemo : senhaLogin;
    const res = await loginEquipe(email, senha, papelOverride || "professor", academia?.id);
    setAutenticando(false);

    if (res.sucesso && res.usuario) {
      setUsuarioEquipe(res.usuario);
      if (onSessionChange) {
        onSessionChange(true);
      }
    } else {
      setErroLogin(res.mensagem || "Não foi possível autenticar. Verifique suas credenciais.");
    }
  };

  const handleLogout = async () => {
    await logoutEquipe();
    setUsuarioEquipe(null);
    if (onSessionChange) {
      onSessionChange(false);
    }
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullScreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullScreen(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-zinc-400">
        Verificando permissões da equipe...
      </div>
    );
  }

  // 1. Tela de Bloqueio — Exige Login da Equipe
  if (!usuarioEquipe) {
    return (
      <div className="container mx-auto max-w-md px-4 py-16">
        <Card className="border-zinc-800 bg-zinc-950/90 shadow-2xl">
          <CardHeader className="text-center pb-4">
            <div className="w-16 h-16 rounded-2xl bg-red-600/10 border border-red-600/30 flex items-center justify-center mx-auto mb-3 text-red-500">
              <Lock className="w-8 h-8" />
            </div>
            <Badge variant="outline" className="mx-auto mb-2 text-[10px] border-zinc-700 text-zinc-400">
              Uso Restrito • Equipe da Academia
            </Badge>
            <CardTitle className="text-xl text-white">
              Acesso ao Totem de Presença
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Esta tela projeta o QR Code de check-in para os alunos e exige autenticação de um membro da equipe (dono, admin, professor ou recepção).
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {erroLogin && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{erroLogin}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <Label htmlFor="emailEquipe">E-mail da Equipe</Label>
                <Input
                  id="emailEquipe"
                  type="email"
                  value={emailLogin}
                  onChange={(e) => setEmailLogin(e.target.value)}
                  placeholder="equipe@suaacademia.com"
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="senhaEquipe">Senha de Acesso</Label>
                <Input
                  id="senhaEquipe"
                  type="password"
                  value={senhaLogin}
                  onChange={(e) => setSenhaLogin(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={autenticando}
                className="w-full gap-2 font-bold shadow-md shadow-red-900/30"
              >
                {autenticando ? "Autenticando..." : "Entrar no Totem"}
              </Button>
            </form>

            {/* Atalhos para o ambiente de desenvolvimento local (seed do banco) */}
            {import.meta.env.DEV && (
              <div className="pt-4 border-t border-zinc-800 text-center">
                <p className="text-[11px] text-zinc-500 mb-2 font-mono">
                  Atalhos de Dev (Seed Local):
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleLogin(
                        undefined,
                        import.meta.env.VITE_DEMO_PROFESSOR_EMAIL || "rls-3@example.test",
                        import.meta.env.VITE_DEMO_PROFESSOR_SENHA || "",
                        "professor"
                      )
                    }
                    className="flex-1 text-xs gap-1 border-zinc-800 hover:bg-zinc-900"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-red-400" />
                    Professor (Seed)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleLogin(
                        undefined,
                        import.meta.env.VITE_DEMO_RECEPCAO_EMAIL || "rls-4@example.test",
                        import.meta.env.VITE_DEMO_RECEPCAO_SENHA || "",
                        "recepcao"
                      )
                    }
                    className="flex-1 text-xs gap-1 border-zinc-800 hover:bg-zinc-900"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                    Recepção (Seed)
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2. Tela Liberada para a Equipe (Modo Totem Quiosque)
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "https://app.honorteam.com.br";

  return (
    <div className={`container mx-auto px-4 py-8 max-w-5xl ${isFullScreen ? "max-w-none px-8" : ""}`}>
      {/* Barra superior de controle do Totem */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
            <Badge variant="outline" className="border-emerald-800 text-emerald-400 bg-emerald-950/40">
              Totem Ativo • Quiosque do Tatame
            </Badge>
            <span className="text-xs text-zinc-400 flex items-center gap-1 ml-2 font-mono">
              <UserCheck className="w-3.5 h-3.5 text-red-500" />
              Operador: <strong className="text-white">{usuarioEquipe.nome}</strong> ({usuarioEquipe.papel})
            </span>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight mt-1">
            {academia?.nome || "Honor Team"}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-xl font-mono text-sm text-zinc-200">
            <Clock className="w-4 h-4 text-red-500" />
            <span>{currentTime || "--:--:--"}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullScreen}
            className="gap-1.5 border-zinc-700 bg-zinc-800/80"
          >
            {isFullScreen ? (
              <>
                <Minimize className="w-4 h-4" />
                Sair
              </>
            ) : (
              <>
                <Maximize className="w-4 h-4" />
                Tela Cheia
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-xs text-zinc-400 hover:text-red-400 gap-1"
            title="Desconectar equipe do totem"
          >
            <LogOut className="w-3.5 h-3.5" />
            Encerrar Sessão
          </Button>
        </div>
      </div>

      {/* Conteúdo do Totem: Turmas Abertas com QR Codes */}
      {statusConexao === "bloqueado" && erroTotem ? (
        <div className="py-16">
          <Card className="border-red-900/50 bg-red-950/20 p-12 text-center max-w-lg mx-auto shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-red-900/30 border border-red-800 flex items-center justify-center mx-auto mb-4 text-red-400">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              {erroTotem.titulo}
            </h3>
            <p className="text-sm text-zinc-300 max-w-sm mx-auto leading-relaxed mb-3">
              {erroTotem.mensagem}
            </p>
            {erroTotem.acaoSugerida && (
              <p className="text-xs text-zinc-400 max-w-sm mx-auto mb-6">
                {erroTotem.acaoSugerida}
              </p>
            )}
            <div className="mb-6 flex items-center justify-center gap-2 text-xs text-zinc-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Verificando novamente em {segundosRestantes}s...
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => atualizarCiclo()}
              disabled={carregandoCiclo}
              className="gap-2 border-red-800 bg-red-950/40 text-red-200 hover:bg-red-900/50"
            >
              <RefreshCw className={`w-4 h-4 ${carregandoCiclo ? "animate-spin" : ""}`} />
              Tentar Reconectar
            </Button>
          </Card>
        </div>
      ) : statusConexao === "reconectando" && turmasAbertas.length === 0 ? (
        <div className="py-16">
          <Card className="border-amber-800/50 bg-amber-950/20 p-12 text-center max-w-lg mx-auto shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-amber-900/30 border border-amber-800 flex items-center justify-center mx-auto mb-4 text-amber-400">
              <WifiOff className="w-8 h-8" />
            </div>
            <Badge variant="outline" className="mx-auto mb-2 text-xs border-amber-800 text-amber-400 bg-amber-950/40">
              Conexão Instável
            </Badge>
            <h3 className="text-xl font-bold text-white mb-2">
              Reconectando ao tatame...
            </h3>
            <p className="text-sm text-zinc-300 max-w-sm mx-auto leading-relaxed mb-4">
              Houve uma oscilação na rede ou no servidor. O totem tentará restabelecer a comunicação automaticamente.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-amber-300 font-mono mb-6">
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
              Reconectando em {segundosRestantes}s...
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => atualizarCiclo()}
              disabled={carregandoCiclo}
              className="gap-2 border-amber-800 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50"
            >
              <RefreshCw className={`w-4 h-4 ${carregandoCiclo ? "animate-spin" : ""}`} />
              Reconectar Agora
            </Button>
          </Card>
        </div>
      ) : turmasAbertas.length === 0 ? (
        <div className="py-16">
          <Card className="border-zinc-800 bg-zinc-950/70 p-12 text-center max-w-lg mx-auto shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4 text-zinc-500">
              <Clock className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              Nenhuma turma com check-in aberto no momento
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
              O check-in abre automaticamente minutos antes do início da aula.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-zinc-500 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Sincronizando com o tatame automaticamente
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {statusConexao === "reconectando" && (
            <div className="p-3.5 rounded-xl border border-amber-800/60 bg-amber-950/40 flex items-center justify-between text-xs text-amber-200 shadow-lg">
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Oscilação de rede detectada. <strong>Reconectando em {segundosRestantes}s...</strong></span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => atualizarCiclo()}
                disabled={carregandoCiclo}
                className="h-7 text-xs border-amber-700 bg-amber-900/50 hover:bg-amber-800 text-amber-100 gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${carregandoCiclo ? "animate-spin" : ""}`} />
                Reconectar Agora
              </Button>
            </div>
          )}
          <div className={`grid gap-6 ${turmasAbertas.length === 1 ? "max-w-md mx-auto" : "grid-cols-1 md:grid-cols-2"}`}>
            {turmasAbertas.map((turma) => {
              const tokenInfo = tokens[turma.id];
              const token = tokenInfo?.token;
              const erroToken = errosTokens[turma.id];
              const checkinUrl = `${currentOrigin}/?slug=${slug}&turma=${turma.id}&t=${token || ""}&tab=checkin`;

              return (
                <Card
                  key={turma.id}
                  className="border-zinc-800 bg-zinc-950/80 shadow-2xl p-6 flex flex-col items-center text-center"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="default" className="text-xs px-3 py-1 font-bold">
                      CHECK-IN ABERTO
                    </Badge>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2.5 py-0.5 rounded-full border border-zinc-800">
                      {turma.hora_inicio} às {turma.hora_fim}
                    </span>
                  </div>

                  <h3 className="text-xl font-black text-white mb-1">
                    {turma.nome}
                  </h3>

                  {token ? (
                    <>
                      <p className="text-xs text-zinc-400 mb-4">
                        Aponte a câmera do seu celular para registrar sua presença no tatame
                      </p>

                      <div className="bg-white p-4 rounded-2xl shadow-xl">
                        <QRGenerator
                          value={checkinUrl}
                          size={turmasAbertas.length === 1 ? 260 : 200}
                        />
                      </div>

                      <div className="mt-4 flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Token rotativo ativo • Renovando em {segundosRestantes}s
                      </div>
                    </>
                  ) : (
                    <div className="my-6 p-6 border border-amber-800/40 bg-amber-950/20 rounded-2xl max-w-xs flex flex-col items-center">
                      <AlertTriangle className="w-10 h-10 text-amber-500 mb-2" />
                      <h4 className="text-sm font-bold text-amber-300 mb-1">
                        {erroToken?.titulo || "QR Code Indisponível"}
                      </h4>
                      <p className="text-xs text-zinc-300 mb-3">
                        {erroToken?.mensagem || "Não foi possível gerar o código temporário desta turma."}
                      </p>
                      <p className="text-[11px] text-amber-400/80 font-mono flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        Tentando novo token no próximo ciclo ({segundosRestantes}s)...
                      </p>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="border-zinc-800 bg-zinc-950/50 max-w-xl mx-auto">
            <CardContent className="p-4 text-xs text-zinc-400 space-y-2">
              <div className="flex items-center gap-2 text-zinc-200 font-semibold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Instruções para o Tatame:
              </div>
              <p>
                1. Os alunos escaneiam o QR Code para registrar presença na aula aberta.
              </p>
              <p>
                2. O token de segurança é renovado automaticamente a cada ciclo para evitar check-ins fora do tatame.
              </p>
              <p>
                3. A presença garante a contagem de aulas para a próxima graduação de faixa do aluno.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
