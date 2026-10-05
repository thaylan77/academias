import React, { useEffect, useState } from "react";
import { obterAcademiaPublica } from "../../lib/supabase";
import { AcademiaPublica, TurmaPublica } from "../../types/database";
import { QRGenerator } from "../../components/qr/qr-generator";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Maximize,
  Minimize,
  Clock,
  Sparkles,
  QrCode,
  Users,
} from "lucide-react";

interface TotemPageProps {
  slug: string;
}

export const TotemPage: React.FC<TotemPageProps> = ({ slug }) => {
  const [academia, setAcademia] = useState<AcademiaPublica | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [turmaSelecionada, setTurmaSelecionada] = useState<TurmaPublica | null>(null);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  useEffect(() => {
    carregarAcademia();
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

  const carregarAcademia = async () => {
    setLoading(false);
    const data = await obterAcademiaPublica(slug);
    setAcademia(data);
    if (data && data.turmas.length > 0) {
      setTurmaSelecionada(data.turmas[0]);
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

  if (loading || !academia) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-zinc-400">
        Carregando totem da academia...
      </div>
    );
  }

  // Gera a URL direta que o aluno abrirá ao escanear
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
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight mt-1">
            {academia.nome}
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
              {academia.turmas.map((t) => {
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
                Como o aluno faz check-in?
              </div>
              <p>
                1. O aluno abre a câmera do próprio celular ou o app Honor Team.
              </p>
              <p>
                2. Ao apontar para este QR Code, o sistema registra a presença automaticamente na RPC.
              </p>
              <p>
                3. O sistema valida se o aluno está ativo e com a mensalidade em dia.
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
