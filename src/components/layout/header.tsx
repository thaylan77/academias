import React from "react";
import { Shield, QrCode, UserPlus, Monitor } from "lucide-react";
import { Badge } from "../ui/badge";

interface HeaderProps {
  currentSlug: string;
  onSlugChange?: (slug: string) => void;
  activeTab: "matricula" | "totem" | "checkin";
  onTabChange: (tab: "matricula" | "totem" | "checkin") => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentSlug,
  onSlugChange,
  activeTab,
  onTabChange,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Marca & Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white shadow-lg shadow-red-900/30">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight text-white">
                HONOR TEAM
              </span>
              <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-mono">
                SAAS
              </Badge>
            </div>
            <p className="text-[11px] text-zinc-400 -mt-0.5">
              Gestão de Artes Marciais
            </p>
          </div>
        </div>

        {/* Navegação entre telas de Antigravity */}
        <nav className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800">
          <button
            type="button"
            onClick={() => onTabChange("matricula")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "matricula"
                ? "bg-red-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Matrícula Pública</span>
            <span className="sm:hidden">Matrícula</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("totem")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "totem"
                ? "bg-red-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Totem QR da Turma</span>
            <span className="sm:hidden">Totem QR</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange("checkin")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "checkin"
                ? "bg-red-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Check-in Aluno</span>
            <span className="sm:hidden">Check-in</span>
          </button>
        </nav>

        {/* Seletor de Tenant / Academia para Sandbox e Testes */}
        {onSlugChange && (
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
    </header>
  );
};
