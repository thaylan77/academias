import React, { useState, useEffect } from "react";
import { Header } from "./components/layout/header";
import { MatriculaPage } from "./pages/matricula/matricula-page";
import { TotemPage } from "./pages/checkin/totem-page";
import { CheckinPage } from "./pages/checkin/checkin-page";
import { Building2 } from "lucide-react";

function AcademiaNaoEncontrada() {
  return (
    <div className="container mx-auto max-w-md px-4 py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4 text-zinc-500">
        <Building2 className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Academia não encontrada</h1>
      <p className="text-xs text-zinc-400 leading-relaxed max-w-sm mx-auto mb-6">
        Para acessar os serviços de matrícula ou frequência, informe o endereço completo da sua academia (ex: <span className="font-mono text-red-400">/nome-da-academia/matricula</span>).
      </p>
      <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/60 text-[11px] text-zinc-500 font-mono">
        Honor Team SaaS • Gestão Profissional
      </div>
    </div>
  );
}

export function App() {
  // Slug de demo existe estritamente em ambiente de desenvolvimento local (DEV)
  const [slug, setSlug] = useState<string | null>(import.meta.env.DEV ? "honor-demo-a" : null);
  const [activeTab, setActiveTab] = useState<"matricula" | "totem" | "checkin">("matricula");
  const [turmaParam, setTurmaParam] = useState<string | null>(null);
  const [totemSessaoAtiva, setTotemSessaoAtiva] = useState<boolean>(false);

  // Lê parâmetros da URL na inicialização
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slugFromUrl = params.get("slug");
    const tabFromUrl = params.get("tab") as "matricula" | "totem" | "checkin" | null;
    const turmaFromUrl = params.get("turma");

    // Também verifica se o pathname tem formato /{slug} ou /{slug}/matricula ou /{slug}/totem ou /{slug}/checkin
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 1) {
      const pathSlug = pathParts[0];
      const action = pathParts[1];
      if (pathSlug && pathSlug !== "index.html") {
        setSlug(pathSlug);
      }
      if (action === "matricula") setActiveTab("matricula");
      if (action === "totem") setActiveTab("totem");
      if (action === "checkin") setActiveTab("checkin");
    } else {
      if (slugFromUrl) setSlug(slugFromUrl);
      if (tabFromUrl) setActiveTab(tabFromUrl);
    }

    if (turmaFromUrl) {
      setTurmaParam(turmaFromUrl);
      setActiveTab("checkin");
    }
  }, []);

  const handleTabChange = (tab: "matricula" | "totem" | "checkin") => {
    setActiveTab(tab);
    // Atualiza URL sem recarregar
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    if (slug) {
      url.searchParams.set("slug", slug);
    }
    if (tab !== "checkin") {
      url.searchParams.delete("turma");
      setTurmaParam(null);
    }
    window.history.pushState({}, "", url.toString());
  };

  const handleSlugChange = (newSlug: string) => {
    setSlug(newSlug);
    const url = new URL(window.location.href);
    url.searchParams.set("slug", newSlug);
    window.history.pushState({}, "", url.toString());
  };

  const isModoKiosk = activeTab === "totem" && totemSessaoAtiva;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      <Header
        currentSlug={slug || ""}
        onSlugChange={handleSlugChange}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        modoKiosk={isModoKiosk}
      />

      <main className="flex-1 pb-16">
        {!slug ? (
          <AcademiaNaoEncontrada />
        ) : (
          <>
            {activeTab === "matricula" && <MatriculaPage slug={slug} />}
            {activeTab === "totem" && (
              <TotemPage
                slug={slug}
                onSessionChange={(ativa) => setTotemSessaoAtiva(ativa)}
              />
            )}
            {activeTab === "checkin" && (
              <CheckinPage slug={slug} initialTurmaId={turmaParam} />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950/80 py-6 text-center text-xs text-zinc-500">
        <p>Honor Team SaaS • Gestão Profissional de Academias e Dojos de Artes Marciais</p>
        {import.meta.env.DEV && slug && (
          <p className="mt-1 text-[11px] text-zinc-600">
            Tenant: <span className="text-zinc-400 font-mono">{slug}</span> • Supabase Multi-tenant RLS Ativo
          </p>
        )}
      </footer>
    </div>
  );
}

export default App;
