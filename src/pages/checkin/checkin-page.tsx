import React, { useEffect, useState } from "react";
import { CheckinResultado, AlunoCheckinInfo } from "../../types/app";
import { realizarCheckin } from "../../lib/supabase";
import { QRScanner } from "../../components/qr/qr-scanner";
import { Card, CardContent, CardTitle, CardDescription } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "../../components/ui/alert";
import {
  CheckCircle,
  AlertOctagon,
  Users,
  RotateCcw,
  Sparkles,
  QrCode,
  ShieldAlert,
  Clock,
  MessageCircle,
} from "lucide-react";

interface CheckinPageProps {
  slug: string;
  initialTurmaId?: string | null;
  initialToken?: string | null;
}

export const CheckinPage: React.FC<CheckinPageProps> = ({
  slug,
  initialTurmaId,
  initialToken,
}) => {
  const [turmaId, setTurmaId] = useState<string | null>(initialTurmaId || null);
  const [token, setToken] = useState<string | null>(initialToken || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [resultado, setResultado] = useState<CheckinResultado | null>(null);
  const [cenarioSimulado, setCenarioSimulado] = useState<"sucesso" | "inadimplente" | "multiplos">("sucesso");

  useEffect(() => {
    let tId = initialTurmaId || null;
    let tToken = initialToken || null;

    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (!tId && urlParams.get("turma")) {
        tId = urlParams.get("turma");
      }
      if (!tToken && (urlParams.get("t") || urlParams.get("token"))) {
        tToken = urlParams.get("t") || urlParams.get("token");
      }
    }

    if (tId) {
      setTurmaId(tId);
      if (tToken) setToken(tToken);
      executarCheckin(tId, tToken || undefined);
    }
  }, [initialTurmaId, initialToken]);

  const executarCheckin = async (
    tId: string,
    tok?: string,
    alunoId?: string,
    cenarioOverride?: "sucesso" | "inadimplente" | "multiplos"
  ) => {
    setLoading(true);
    setResultado(null);
    try {
      const tokenEfetivo = tok || token || (import.meta.env.DEV ? "token-dev-simulado" : "");
      const cenario = import.meta.env.DEV ? (cenarioOverride || cenarioSimulado) : undefined;
      const res = await realizarCheckin(tId, tokenEfetivo, alunoId, cenario);
      setResultado(res);
    } catch (err) {
      setResultado({
        sucesso: false,
        codigo_erro: "GENERICO",
        mensagem: err instanceof Error && err.message ? err.message : "Erro inesperado ao registrar check-in.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    let parsedTurmaId = decodedText;
    let parsedToken = "";

    try {
      if (decodedText.includes("turma=") || decodedText.includes("t=") || decodedText.includes("token=")) {
        const urlObj = new URL(decodedText, window.location.origin);
        parsedTurmaId = urlObj.searchParams.get("turma") || decodedText;
        parsedToken = urlObj.searchParams.get("t") || urlObj.searchParams.get("token") || "";
      }
    } catch {
      const matchTurma = decodedText.match(/[?&]turma=([^&]+)/);
      const matchToken = decodedText.match(/[?&]t=([^&]+)/) || decodedText.match(/[?&]token=([^&]+)/);
      if (matchTurma) parsedTurmaId = matchTurma[1];
      if (matchToken) parsedToken = matchToken[1];
    }

    setTurmaId(parsedTurmaId);
    setToken(parsedToken);
    executarCheckin(parsedTurmaId, parsedToken);
  };

  const handleSelecionarDependente = (aluno: AlunoCheckinInfo) => {
    if (!turmaId) return;
    executarCheckin(turmaId, token || undefined, aluno.id);
  };

  const handleReset = () => {
    setTurmaId(null);
    setToken(null);
    setResultado(null);
  };

  return (
    <div className="container mx-auto max-w-xl px-4 py-8">
      {/* Cabeçalho do Check-in */}
      <div className="text-center mb-6">
        <Badge variant="secondary" className="mb-2 uppercase tracking-widest text-[10px]">
          Frequência no Tatame
        </Badge>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Check-in por QR Code
        </h1>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
          Registre sua presença na aula para pontuar graduações e confirmar seu histórico de treinos.
        </p>
      </div>

      {/* Barra de Simulação de Cenários para Testes Rápidos (Apenas em DEV) */}
      {import.meta.env.DEV && (
        <div className="mb-6 p-3 rounded-xl border border-zinc-800 bg-zinc-950/60 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-zinc-400 font-mono font-semibold">Simulação de Cenários:</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCenarioSimulado("sucesso");
                if (turmaId) executarCheckin(turmaId, undefined, "sucesso");
              }}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                cenarioSimulado === "sucesso"
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Sucesso
            </button>
            <button
              type="button"
              onClick={() => {
                setCenarioSimulado("inadimplente");
                if (turmaId) executarCheckin(turmaId, undefined, "inadimplente");
              }}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                cenarioSimulado === "inadimplente"
                  ? "bg-red-600 text-white"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Inadimplência
            </button>
            <button
              type="button"
              onClick={() => {
                setCenarioSimulado("multiplos");
                if (turmaId) executarCheckin(turmaId, undefined, "multiplos");
              }}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                cenarioSimulado === "multiplos"
                  ? "bg-amber-600 text-white"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Dependentes
            </button>
          </div>
        </div>
      )}

      {/* Estado: Processando Check-in */}
      {loading && (
        <Card className="border-zinc-800 bg-zinc-950/80 p-8 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-red-600/30 border-t-red-600 animate-spin mx-auto mb-4" />
          <p className="text-base font-bold text-white">Validando Presença...</p>
          <p className="text-xs text-zinc-400 mt-1">
            Consultando matrícula e regularidade financeira
          </p>
        </Card>
      )}

      {/* Estado: Resultado Sucesso */}
      {!loading && resultado && resultado.sucesso && (
        <Card className="border-emerald-600/60 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-2xl overflow-hidden animate-in zoom-in-95">
          <div className="h-2 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <CardContent className="pt-8 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center mx-auto mb-5 text-emerald-400 shadow-lg shadow-emerald-950/50">
              <CheckCircle className="w-12 h-12" />
            </div>

            <Badge variant="success" className="mb-2 text-xs uppercase tracking-wider">
              Presença Confirmada
            </Badge>

            <h3 className="text-2xl font-black text-white tracking-tight">
              {resultado.mensagem}
            </h3>

            <div className="mt-6 p-4 rounded-xl bg-zinc-950/80 border border-zinc-800/80 text-left space-y-2 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
                <span className="text-zinc-400">Aluno:</span>
                <span className="font-bold text-white">{resultado.aluno_nome || "Aluno Conectado"}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
                <span className="text-zinc-400">Turma:</span>
                <span className="font-semibold text-zinc-200">{resultado.turma_nome || "Turma do Dia"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400">Horário do Registro:</span>
                <span className="font-mono text-emerald-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {resultado.horario || "--:--"}
                </span>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-zinc-900/60 text-xs text-zinc-400 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Sua presença foi contabilizada para o progresso da sua faixa.</span>
            </div>

            <Button
              variant="outline"
              onClick={handleReset}
              className="mt-6 w-full gap-2 border-zinc-700 hover:bg-zinc-800 font-semibold"
            >
              <RotateCcw className="w-4 h-4" />
              Escanear Novo Check-in
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Estado: Bloqueio por Inadimplência */}
      {!loading && resultado && (resultado.codigo_erro === "checkin_inadimplente" || resultado.codigo_erro === "INADIMPLENTE") && (
        <Card className="border-red-600/60 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-2xl overflow-hidden animate-in zoom-in-95">
          <div className="h-2 bg-gradient-to-r from-red-600 to-red-800" />
          <CardContent className="pt-8 text-center">
            <div className="w-20 h-20 rounded-full bg-red-600/15 border-2 border-red-600/40 flex items-center justify-center mx-auto mb-5 text-red-500 shadow-lg shadow-red-950/50">
              <ShieldAlert className="w-12 h-12" />
            </div>

            <Badge variant="destructive" className="mb-2 text-xs uppercase tracking-wider">
              Check-in Bloqueado
            </Badge>

            <h3 className="text-xl font-bold text-white tracking-tight">
              {resultado.titulo || "Mensalidade em Atraso"}
            </h3>

            <p className="text-zinc-400 text-sm mt-2 max-w-sm mx-auto leading-relaxed">
              {resultado.mensagem}
            </p>

            <div className="mt-6 p-4 rounded-xl bg-zinc-950/90 border border-red-900/40 text-left text-xs text-zinc-300 space-y-2">
              <p className="font-semibold text-red-400">Como regularizar seu treino:</p>
              <p className="text-zinc-400">
                1. Acesse o portal do aluno para pagar sua fatura via Pix imediato.
              </p>
              <p className="text-zinc-400">
                2. Ou procure agora mesmo a recepção da academia para liberação imediata.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <Button
                className="w-full gap-2 font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => alert("Abrindo portal de cobranças do aluno...")}
              >
                <MessageCircle className="w-4 h-4" />
                Falar com a Recepção no WhatsApp
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                className="w-full gap-2 border-zinc-700 hover:bg-zinc-800"
              >
                <RotateCcw className="w-4 h-4" />
                Voltar ao Leitor
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado: Múltiplos Dependentes no Login */}
      {!loading && resultado && (resultado.codigo_erro === "checkin_multiplos_alunos" || resultado.codigo_erro === "MULTIPLOS_ALUNOS") && (
        <Card className="border-amber-600/60 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-2xl overflow-hidden animate-in zoom-in-95">
          <div className="h-2 bg-gradient-to-r from-amber-500 to-yellow-400" />
          <CardContent className="pt-8 text-center">
            <div className="w-20 h-20 rounded-full bg-amber-500/15 border-2 border-amber-500/40 flex items-center justify-center mx-auto mb-5 text-amber-400">
              <Users className="w-10 h-10" />
            </div>

            <Badge variant="outline" className="mb-2 text-xs border-amber-700 text-amber-300 bg-amber-950/30">
              Responsável com Múltiplos Filhos
            </Badge>

            <h3 className="text-xl font-bold text-white tracking-tight">
              Quem está participando do treino hoje?
            </h3>
            <p className="text-zinc-400 text-xs mt-1 mb-5">
              Selecione o aluno para registrar a presença individual:
            </p>

            <div className="space-y-2 text-left">
              {(resultado.alunos_disponiveis || []).map((aluno) => (
                <button
                  key={aluno.id}
                  type="button"
                  onClick={() => handleSelecionarDependente(aluno)}
                  className="w-full p-3.5 rounded-xl border border-zinc-800 bg-zinc-950 hover:border-red-600 hover:bg-red-950/20 text-white font-semibold text-sm flex items-center justify-between transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-red-400">
                      {aluno.nome[0]}
                    </div>
                    <span>{aluno.nome}</span>
                  </div>
                  <Badge variant="success" className="text-[10px]">
                    Matrícula Ativa
                  </Badge>
                </button>
              ))}
            </div>

            <Button
              variant="ghost"
              onClick={handleReset}
              className="mt-6 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancelar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Estado: Outros Erros (Token Inválido, Fora de Horário, Sem Matrícula, Suspenso, etc) */}
      {!loading &&
        resultado &&
        !resultado.sucesso &&
        resultado.codigo_erro !== "checkin_inadimplente" &&
        resultado.codigo_erro !== "INADIMPLENTE" &&
        resultado.codigo_erro !== "checkin_multiplos_alunos" &&
        resultado.codigo_erro !== "MULTIPLOS_ALUNOS" && (
          <Card className="border-red-600/60 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="h-2 bg-gradient-to-r from-red-600 to-amber-600" />
            <CardContent className="pt-8 text-center">
              <div className="w-20 h-20 rounded-full bg-red-600/15 border-2 border-red-600/40 flex items-center justify-center mx-auto mb-5 text-red-500 shadow-lg shadow-red-950/50">
                <AlertOctagon className="w-12 h-12" />
              </div>

              <Badge variant="destructive" className="mb-2 text-xs uppercase tracking-wider">
                {resultado.codigo_erro === "checkin_token_invalido"
                  ? "QR Code Expirado"
                  : resultado.codigo_erro === "checkin_fora_do_horario"
                  ? "Fora da Janela"
                  : resultado.codigo_erro === "checkin_sem_matricula"
                  ? "Sem Matrícula"
                  : "Check-in Recusado"}
              </Badge>

              <h3 className="text-xl font-bold text-white tracking-tight">
                {resultado.titulo || "Falha na Validação"}
              </h3>

              <p className="text-zinc-400 text-sm mt-2 max-w-sm mx-auto leading-relaxed">
                {resultado.mensagem}
              </p>

              {resultado.acao_sugerida && (
                <div className="mt-6 p-4 rounded-xl bg-zinc-950/90 border border-zinc-800 text-left text-xs text-zinc-300 space-y-1">
                  <p className="font-semibold text-amber-400">Como proceder:</p>
                  <p className="text-zinc-400">{resultado.acao_sugerida}</p>
                </div>
              )}

              <Button
                variant="outline"
                onClick={handleReset}
                className="mt-6 w-full gap-2 border-zinc-700 hover:bg-zinc-800"
              >
                <RotateCcw className="w-4 h-4" />
                Escanear Novamente
              </Button>
            </CardContent>
          </Card>
        )}

      {/* Estado: Scanner Aberto aguardando QR Code */}
      {!loading && !resultado && (
        <div className="space-y-6">
          <QRScanner
            onScanSuccess={handleScanSuccess}
            simulatedTurmaId={import.meta.env.DEV ? "?turma=turma-jj-01&t=tok_dev_simulado" : undefined}
          />

          <Card className="border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-400 space-y-2">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <QrCode className="w-4 h-4 text-red-500" />
              Instruções de Check-in:
            </div>
            <p>
              1. Enquadre o QR Code exibido no totem da academia ou no celular do professor no quadrado do leitor.
            </p>
            <p>
              2. Caso o aparelho não possua câmera, digite o código da turma manualmente no botão abaixo.
              {import.meta.env.DEV && (
                <span className="text-zinc-500 block mt-1 font-mono text-[11px]">
                  (Dev: utilize o botão "Simular Leitura" para teste rápido sem câmera)
                </span>
              )}
            </p>
          </Card>
        </div>
      )}
    </div>
  );
};
