import React, { useEffect, useState } from "react";
import {
  obterAcademiaPublica,
  obterSessaoEquipe,
  loginEquipe,
  logoutEquipe,
  obterTurmasAbertasTotem,
  emitirTokenCheckin,
} from "../../lib/supabase";
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
  QrCode,
  Users,
  Lock,
  LogOut,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

interface TotemPageProps {
  slug: string;
  onSessionChange?: (autenticado: boolean) => void;
}

export const TotemPage: React.FC<TotemPageProps> = ({ slug, onSessionChange }) => {
  const [academia, setAcademia] = useState<AcademiaPublica | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [turmasAbertas, setTurmasAbertas] = useState<TurmaAbertaTotem[]>([]);
  const [tokens, setTokens] = useState<Record<string, TokenCheckinInfo>>({});
  const [currentTime, setCurrentTime] = useState<string>("");
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [segundosRestantes, setSegundosRestantes] = useState<number>(30);

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

  // Efeito para ciclo de rotação do token e atualização de turmas abertas
  useEffect(() => {
    if (!usuarioEquipe || !academia) return;

    let cicloTimer: NodeJS.Timeout | null = null;
    const atualizarCiclo = async () => {
      try {
        const abertas = await obterTurmasAbertasTotem(academia.id);
        setTurmasAbertas(abertas);

        if (abertas.length > 0) {
          const novoMapa: Record<string, TokenCheckinInfo> = {};
          let menorTempoRestante = 30;

          for (const turma of abertas) {
            const info = await emitirTokenCheckin(turma.id);
            if (info) {
              novoMapa[turma.id] = info;
              if (info.expira_em) {
                const ms = new Date(info.expira_em).getTime() - Date.now();
                const segs = Math.max(1, Math.floor(ms / 1000));
                menorTempoRestante = Math.min(menorTempoRestante, segs);
              } else if (info.periodo_segundos) {
                menorTempoRestante = Math.min(menorTempoRestante, info.periodo_segundos);
              }
            }
          }
          setTokens(novoMapa);
          setSegundosRestantes(menorTempoRestante);
        }
      } catch (err) {
        console.warn("Erro ao sincronizar turmas e tokens do totem:", err);
      }
    };

    // Executa imediatamente
    atualizarCiclo();

    // Cronômetro regressivo segundo a segundo
    const intervalTimer = setInterval(() => {
      setSegundosRestantes((prev) => {
        if (prev <= 1) {
          atualizarCiclo();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(intervalTimer);
      if (cicloTimer) clearTimeout(cicloTimer);
    };
  }, [usuarioEquipe, academia?.id]);

  const verificarAcesso = async () => {
    setLoading(true);
    const user = await obterSessaoEquipe();
    setUsuarioEquipe(user);
    if (onSessionChange) {
      onSessionChange(!!user);
    }

    const data = await obterAcademiaPublica(slug);
    setAcademia(data);

    if (user && data) {
      try {
        const abertas = await obterTurmasAbertasTotem(data.id);
        setTurmasAbertas(abertas);
        if (abertas.length > 0) {
          const novoMapa: Record<string, TokenCheckinInfo> = {};
          for (const turma of abertas) {
            const info = await emitirTokenCheckin(turma.id);
            if (info) novoMapa[turma.id] = info;
          }
          setTokens(novoMapa);
        }
      } catch (e) {
        console.warn("Falha ao inicializar turmas do totem:", e);
      }
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
    const res = await loginEquipe(email, senha, papelOverride || "professor");
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
      {turmasAbertas.length === 0 ? (
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
          <div className={`grid gap-6 ${turmasAbertas.length === 1 ? "max-w-md mx-auto" : "grid-cols-1 md:grid-cols-2"}`}>
            {turmasAbertas.map((turma) => {
              const tokenInfo = tokens[turma.id];
              const token = tokenInfo?.token || "";
              const checkinUrl = `${currentOrigin}/?slug=${slug}&turma=${turma.id}&t=${token}&tab=checkin`;

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
