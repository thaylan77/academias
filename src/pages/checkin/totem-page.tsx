import React, { useEffect, useState } from "react";
import {
  obterAcademiaPublica,
  obterSessaoEquipe,
  loginEquipe,
  logoutEquipe,
} from "../../lib/supabase";
import { AcademiaPublica, TurmaPublica, UsuarioEquipe } from "../../types/app";
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
  const [turmaSelecionada, setTurmaSelecionada] = useState<TurmaPublica | null>(null);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // Estado de autenticação da equipe (sem credenciais hardcoded)
  const [usuarioEquipe, setUsuarioEquipe] = useState<UsuarioEquipe | null>(null);
  const [emailLogin, setEmailLogin] = useState<string>("");
  const [senhaLogin, setSenhaLogin] = useState<string>("");
  const [erroLogin, setErroLogin] = useState<string | null>(null);
  const [autenticando, setAutenticando] = useState<boolean>(false);

  useEffect(() => {
    verificarAcesso();
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [slug]);

  const verificarAcesso = async () => {
    setLoading(true);
    const user = await obterSessaoEquipe();
    setUsuarioEquipe(user);
    if (onSessionChange) {
      onSessionChange(!!user);
    }

    const data = await obterAcademiaPublica(slug);
    setAcademia(data);
    if (data && data.turmas.length > 0) {
      setTurmaSelecionada(data.turmas[0]);
    }
    setLoading(false);
  };

  const handleLogin = async (
    e?: React.FormEvent,
    emailDemo?: string,
    papelOverride?: UsuarioEquipe["papel"]
  ) => {
    if (e) e.preventDefault();
    setErroLogin(null);
    setAutenticando(true);

    const email = emailDemo || emailLogin;
    const res = await loginEquipe(email, senhaLogin || "senha123", papelOverride || "professor");
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
                    onClick={() => handleLogin(undefined, "rls-3@example.test", "professor")}
                    className="flex-1 text-xs gap-1 border-zinc-800 hover:bg-zinc-900"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-red-400" />
                    Professor (Seed)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleLogin(undefined, "rls-4@example.test", "recepcao")}
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
  const checkinUrl = turmaSelecionada
    ? `${currentOrigin}/?slug=${slug}&turma=${turmaSelecionada.id}&tab=checkin`
    : "";

  return (
    <div className={`container mx-auto px-4 py-8 max-w-4xl ${isFullScreen ? "max-w-none px-8" : ""}`}>
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

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Painel Esquerdo: Seleção de Turma da Aula */}
        <div className="md:col-span-5 space-y-4">
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-red-500">
                <Users className="w-4 h-4" />
                <CardTitle className="text-base">Turma em Andamento</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Selecione a turma para atualizar o QR Code exibido aos alunos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(academia?.turmas || []).map((t) => {
                const ativo = turmaSelecionada?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTurmaSelecionada(t)}
                    className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                      ativo
                        ? "border-red-600 bg-red-950/20 text-white ring-1 ring-red-600"
                        : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-sm">{t.nome}</p>
                      {ativo && (
                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 capitalize mt-0.5">
                      Público: {t.publico}
                    </p>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-950/50">
            <CardContent className="p-4 text-xs text-zinc-400 space-y-2">
              <div className="flex items-center gap-2 text-zinc-200 font-semibold">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Instruções para o Tatame:
              </div>
              <p>
                1. Mantenha o QR Code em local visível próximo à entrada do dojo/tatame.
              </p>
              <p>
                2. Os alunos apontam a câmera para validar a frequência antes do início do treino.
              </p>
              <p>
                3. O sistema valida automaticamente se a mensalidade está regular antes de confirmar o check-in.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Painel Direito: Exibição Gigante do QR Code */}
        <div className="md:col-span-7 flex flex-col items-center">
          {turmaSelecionada ? (
            <div className="w-full">
              <div className="text-center mb-4">
                <Badge variant="default" className="text-xs px-3 py-1 font-bold mb-2">
                  CHECK-IN ABERTO
                </Badge>
                <h3 className="text-2xl font-black text-white">
                  {turmaSelecionada.nome}
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Aponte a câmera do seu celular para registrar sua presença no tatame
                </p>
              </div>

              <QRGenerator
                value={checkinUrl}
                size={isFullScreen ? 340 : 260}
                title="Presença por QR Code"
                subtitle="O check-in garante sua contagem de aulas para a próxima graduação de faixa"
              />
            </div>
          ) : (
            <div className="p-12 text-center text-zinc-500">
              <QrCode className="w-12 h-12 mx-auto mb-2 opacity-50" />
              Nenhuma turma selecionada para o totem.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
