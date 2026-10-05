import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, RefreshCw, AlertCircle, Keyboard } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Alert, AlertDescription } from "../ui/alert";

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (errorMessage: string) => void;
  simulatedTurmaId?: string;
}

export const QRScanner: React.FC<QRScannerProps> = ({
  onScanSuccess,
  onScanError,
  simulatedTurmaId,
}) => {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState<string>("");
  const [showManualInput, setShowManualInput] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = "qr-code-reader-element";

  const startScanner = async () => {
    setCameraError(null);
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(readerElementId);
      }

      await scannerRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          stopScanner();
          onScanSuccess(decodedText);
        },
        (errorMessage) => {
          if (onScanError) onScanError(errorMessage);
        }
      );
      setIsScanning(true);
    } catch (err: any) {
      console.warn("Falha ao acessar câmera:", err);
      setCameraError(
        "Não foi possível acessar a câmera do aparelho. Verifique as permissões de acesso nas configurações do navegador ou utilize o código manual."
      );
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (err) {
        console.error("Erro ao pausar scanner:", err);
      }
    }
    setIsScanning(false);
  };

  useEffect(() => {
    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onScanSuccess(manualCode.trim());
    }
  };

  return (
    <div className="w-full flex flex-col items-center">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl relative">
        {/* Container do Vídeo da Câmera */}
        <div
          id={readerElementId}
          className={`w-full overflow-hidden rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center relative ${
            isScanning ? "min-h-[280px]" : "h-64"
          }`}
        >
          {!isScanning && (
            <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-400">
              <div className="w-16 h-16 rounded-full bg-zinc-800/80 flex items-center justify-center mb-3 text-red-500 border border-zinc-700">
                <Camera className="w-8 h-8" />
              </div>
              <p className="text-sm font-medium text-zinc-200">
                Câmera em espera
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-[220px]">
                Toque no botão abaixo para ativar a câmera e escanear o QR Code da academia
              </p>
            </div>
          )}
        </div>

        {/* Mensagem de Erro de Câmera */}
        {cameraError && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <AlertDescription className="text-xs">
              {cameraError}
            </AlertDescription>
          </Alert>
        )}

        {/* Controles de Câmera */}
        <div className="mt-4 flex flex-col gap-2">
          {!isScanning ? (
            <Button
              type="button"
              onClick={startScanner}
              className="w-full gap-2 font-semibold"
            >
              <Camera className="w-4 h-4" />
              Ativar Câmera para Check-in
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={stopScanner}
              className="w-full gap-2 border-zinc-700 hover:bg-zinc-800"
            >
              <CameraOff className="w-4 h-4 text-red-400" />
              Pausar Câmera
            </Button>
          )}

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={() => setShowManualInput(!showManualInput)}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
            >
              <Keyboard className="w-3.5 h-3.5" />
              {showManualInput ? "Ocultar digitação" : "Digitar código manualmente"}
            </button>

            {simulatedTurmaId && (
              <button
                type="button"
                onClick={() => onScanSuccess(simulatedTurmaId)}
                className="text-xs text-red-400 hover:text-red-300 font-medium flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Simular Leitura
              </button>
            )}
          </div>

          {/* Entrada Manual de Código */}
          {showManualInput && (
            <form onSubmit={handleManualSubmit} className="mt-3 flex gap-2">
              <Input
                placeholder="Ex: turma-jj-01 ou Cole a URL"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="text-xs h-9"
              />
              <Button type="submit" size="sm" className="h-9 px-3 shrink-0">
                Confirmar
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
