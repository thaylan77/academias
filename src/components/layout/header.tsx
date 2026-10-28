import React from "react";
import { Shield, QrCode, UserPlus, Monitor, Lock } from "lucide-react";
import { Badge } from "../ui/badge";

interface HeaderProps {
  currentSlug: string;
  onSlugChange?: (slug: string) => void;
  activeTab: "matricula" | "totem" | "checkin";
  onTabChange: (tab: "matricula" | "totem" | "checkin") => void;
  modoKiosk?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentSlug,
  onSlugChange,
  activeTab,
  onTabChange,
  modoKiosk = false,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Marca & Logo: não encolhe nem quebra; no celular só o nome fica */}
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white shadow-lg shadow-red-900/30">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap font-extrabold text-base tracking-tight text-white">
                HONOR TEAM
              </span>
              <Badge variant="secondary" className="hidden sm:inline-flex text-[10px] py-0 px-1.5 font-mono">
                SAAS
              </Badge>
            </div>
            <p className="hidden sm:block text-[11px] text-zinc-400 -mt-0.5">
              Gestão de Artes Marciais
            </p>
          </div>
        </div>

        {/* Abas: só o ícone abaixo de md (o nome vai no aria-label); os rótulos inteiros só cabem a partir de 768 px. */}
        {/* Totem nunca exibe menu de navegação em nenhum estado (login ou quiosque ativo) */}
        {activeTab === "totem" ? (
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="outline" className="border-red-800/80 bg-red-950/40 text-red-300 gap-1.5 px-3 py-1 text-xs whitespace-nowrap">
              <Lock className="w-3.5 h-3.5 shrink-0 text-red-500" />
              {modoKiosk ? (
                <>
                  <span className="hidden sm:inline">Modo Quiosque Tatame • Navegação Bloqueada</span>
                  <span className="sm:hidden">Quiosque</span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">Totem de Presença</span>
                  <span className="sm:hidden">Totem</span>
                </>
              )}
            </Badge>
          </div>
        ) : (
          /* Em produção, páginas públicas não têm menu de abas; abas só aparecem em DEV */
          import.meta.env.DEV && (
            <div className="flex min-w-0 items-center gap-3">
              <nav aria-label="Páginas de demonstração" className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800">
                <button
                  type="button"
                  onClick={() => onTabChange("matricula")}
                  aria-label={"Matrícula Pública"}
                  className={`flex min-h-10 min-w-10 items-center justify-center gap-1.5 px-2.5 md:min-h-0 md:min-w-0 md:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === "matricula"
                      ? "bg-red-600 text-white shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                >
                  <UserPlus className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  <span className="hidden md:inline whitespace-nowrap">Matrícula Pública</span>
                </button>

                <button
                  type="button"
                  onClick={() => onTabChange("totem")}
                  aria-label={"Totem QR da Turma"}
                  className="flex min-h-10 min-w-10 items-center justify-center gap-1.5 px-2.5 md:min-h-0 md:min-w-0 md:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <Monitor className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  <span className="hidden md:inline whitespace-nowrap">Totem QR da Turma</span>
                </button>

                <button
                  type="button"
                  onClick={() => onTabChange("checkin")}
                  aria-label={"Check-in Aluno"}
                  className={`flex min-h-10 min-w-10 items-center justify-center gap-1.5 px-2.5 md:min-h-0 md:min-w-0 md:px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === "checkin"
                      ? "bg-red-600 text-white shadow-sm"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                >
                  <QrCode className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  <span className="hidden md:inline whitespace-nowrap">Check-in Aluno</span>
                </button>
              </nav>

              {onSlugChange && currentSlug && (
                <div className="hidden lg:flex items-center gap-2">
                  <span className="text-xs text-zinc-500 font-mono">Unidade:</span>
                  <select
                    value={currentSlug}
                    onChange={(e) => onSlugChange(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-red-600 cursor-pointer"
                  >
                    <option value="honor-demo-a">honor-demo-a (Aberta)</option>
                    <option value="honor-demo-b">honor-demo-b (Suspensa)</option>
                  </select>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </header>
  );
};
