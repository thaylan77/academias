import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "../ui/button";

interface QRGeneratorProps {
  value: string;
  size?: number;
  title?: string;
  subtitle?: string;
  showCopyButton?: boolean;
}

export const QRGenerator: React.FC<QRGeneratorProps> = ({
  value,
  size = 260,
  title,
  subtitle,
  showCopyButton = true,
}) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl">
      {title && (
        <h4 className="text-lg font-bold text-white mb-1 text-center tracking-tight">
          {title}
        </h4>
      )}
      {subtitle && (
        <p className="text-xs text-zinc-400 mb-5 text-center max-w-xs">
          {subtitle}
        </p>
      )}

      <div className="relative p-4 bg-white rounded-xl shadow-inner border border-zinc-200">
        <QRCodeSVG
          value={value}
          size={size}
          level="H"
          includeMargin={false}
        />
      </div>

      {showCopyButton && (
        <div className="mt-5 flex gap-2 w-full max-w-xs">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="flex-1 text-xs gap-1.5 border-zinc-700 bg-zinc-800/80"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar Link
              </>
            )}
          </Button>
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="inline-flex"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs px-2.5 border-zinc-700 bg-zinc-800/80"
              title="Abrir destino em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </a>
        </div>
      )}
    </div>
  );
};
