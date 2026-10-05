import React, { useState, useEffect } from "react";
import { Header } from "./components/layout/header";
import { MatriculaPage } from "./pages/matricula/matricula-page";
import { TotemPage } from "./pages/checkin/totem-page";
import { CheckinPage } from "./pages/checkin/checkin-page";

export function App() {
  const [slug, setSlug] = useState<string>("honor-demo-a");
  const [activeTab, setActiveTab] = useState<"matricula" | "totem" | "checkin">("matricula");
  const [turmaParam, setTurmaParam] = useState<string | null>(null);
  const [totemSessaoAtiva, setTotemSessaoAtiva] = useState<boolean>(false);

  // Lê parâmetros da URL na inicialização
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slugFromUrl = params.get("slug");
    const tabFromUrl = params.get("tab") as "matricula" | "totem" | "checkin" | null;
    const turmaFromUrl = params.get("turma");

    // Também verifica se o pathname tem formato /{slug}/matricula ou /{slug}/checkin
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 2) {
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
    url.searchParams.set("slug", slug);
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
        currentSlug={slug}
        onSlugChange={handleSlugChange}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        modoKiosk={isModoKiosk}
      />

      <main className="flex-1 pb-16">
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
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950/80 py-6 text-center text-xs text-zinc-500">
        <p>Honor Team SaaS • Gestão Profissional de Academias e Dojos de Artes Marciais</p>
        <p className="mt-1 text-[11px] text-zinc-600">
          Tenant: <span className="text-zinc-400 font-mono">{slug}</span> • Supabase Multi-tenant RLS Ativo
        </p>
      </footer>
    </div>
  );
}

export default App;
