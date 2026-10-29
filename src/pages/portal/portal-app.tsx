import React, { useEffect, useRef, useState } from "react";
import { Shield } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  MeuAluno,
  MinhaGraduacao,
  MinhaPresenca,
  meusAlunos,
  minhaGraduacao,
  minhasPresencas,
} from "../../lib/portal-aluno";
import { AcessoDoAluno } from "../checkin/acesso-do-aluno";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Alert, AlertDescription } from "../../components/ui/alert";

const SELECT = "flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100";
const dataBr = (d: string) => d.slice(0, 10).split("-").reverse().join("/");

const TEXTOS = {
  titulo: "Entrar no portal do aluno",
  explicacao: "Mandamos um link de acesso: abra no mesmo aparelho para ver a graduação e as presenças.",
};

/**
 * Portal do aluno (/portal): o aluno ou o responsável entra pelo link mágico
 * (mesmo portão do check-in) e vê os cadastros ligados ao login, em qualquer
 * academia.
 */
export const PortalApp: React.FC = () => (
  <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
    <header className="border-b border-zinc-800 bg-zinc-950/80">
      <div className="container mx-auto flex h-16 items-center gap-2.5 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-red-800 text-white">
          <Shield className="h-5 w-5" />
        </div>
        <span className="whitespace-nowrap text-base font-extrabold tracking-tight text-white">HONOR TEAM</span>
        <span className="text-sm text-zinc-400">Portal do aluno</span>
      </div>
    </header>
    <main className="flex-1 pb-16">
      <AcessoDoAluno textos={TEXTOS}>
        <PortalConteudo />
      </AcessoDoAluno>
    </main>
  </div>
);

type Lista = { fase: "carregando" } | { fase: "erro" } | { fase: "pronta"; alunos: MeuAluno[] };

export const PortalConteudo: React.FC = () => {
  const [lista, setLista] = useState<Lista>({ fase: "carregando" });
  const [escolhido, setEscolhido] = useState<string>("");
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vale = true;
    setLista({ fase: "carregando" });
    meusAlunos()
      .then((alunos) => {
        if (!vale) return;
        setLista({ fase: "pronta", alunos });
        setEscolhido((atual) => (alunos.some((a) => a.id === atual) ? atual : alunos[0]?.id ?? ""));
      })
      .catch(() => vale && setLista({ fase: "erro" }));
    return () => {
      vale = false;
    };
  }, [tentativa]);

  if (!supabase) {
    return <p className="container mx-auto px-4 py-16 text-center text-sm text-zinc-400">O portal precisa de conexão com o servidor.</p>;
  }
  if (lista.fase === "carregando") {
    return <p role="status" className="container mx-auto px-4 py-16 text-center text-sm text-zinc-500">Carregando seus cadastros...</p>;
  }
  if (lista.fase === "erro") {
    return (
      <div className="container mx-auto max-w-xl px-4 py-8">
        <Alert variant="destructive" role="alert">
          <AlertDescription>Não foi possível carregar seus cadastros. Verifique a conexão.</AlertDescription>
        </Alert>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setTentativa((t) => t + 1)}>Tentar de novo</Button>
      </div>
    );
  }
  if (lista.alunos.length === 0) {
    return (
      <p className="container mx-auto max-w-xl px-4 py-16 text-center text-sm text-zinc-400">
        Nenhum cadastro ligado a este e-mail. Confira com a academia se o seu e-mail (ou o do responsável) está certo no
        cadastro do aluno.
      </p>
    );
  }

  const aluno = lista.alunos.find((a) => a.id === escolhido) ?? lista.alunos[0];
  return (
    <div className="container mx-auto max-w-xl space-y-6 px-4 py-6">
      {lista.alunos.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="portal-aluno">Aluno</Label>
          <select id="portal-aluno" className={SELECT} value={aluno.id} onChange={(e) => setEscolhido(e.target.value)}>
            {lista.alunos.map((a) => (
              <option key={a.id} value={a.id}>{a.nome} · {a.academia}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <h1 className="text-lg font-bold text-white">{aluno.nome}</h1>
        <p className="text-xs text-zinc-400">{aluno.academia}</p>
      </div>
      {aluno.status !== "ativo" && (
        <p className="text-xs text-zinc-400">Este cadastro não está ativo na academia.</p>
      )}
      <Graduacao key={aluno.id} aluno={aluno} />
      <Presencas key={`presencas-${aluno.id}`} aluno={aluno} />
    </div>
  );
};

const ORIGEM: Record<MinhaPresenca["origem"], string> = {
  qrcode: "check-in pelo QR",
  recepcao: "registrada pela recepção",
  professor: "registrada pelo professor",
};

type Historico =
  | { fase: "carregando" }
  | { fase: "erro" }
  | { fase: "pronta"; itens: MinhaPresenca[]; temMais: boolean; maisFalhou: boolean };

const Presencas: React.FC<{ aluno: MeuAluno }> = ({ aluno }) => {
  const [historico, setHistorico] = useState<Historico>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [buscandoMais, setBuscandoMais] = useState(false);
  // Trava síncrona contra clique duplo em "Mostrar mais".
  const emAndamento = useRef(false);
  // Cada carga do início abre uma geração; resposta de geração antiga (inclusive
  // de "Mostrar mais") é descartada.
  const geracao = useRef(0);
  const { id, academia_id } = aluno;

  useEffect(() => {
    const minha = ++geracao.current;
    setHistorico({ fase: "carregando" });
    minhasPresencas({ id, academia_id })
      .then((r) => geracao.current === minha && setHistorico({ fase: "pronta", ...r, maisFalhou: false }))
      .catch(() => geracao.current === minha && setHistorico({ fase: "erro" }));
    return () => {
      geracao.current += 1;
    };
  }, [id, academia_id, tentativa]);

  const mostrarMais = async () => {
    if (historico.fase !== "pronta" || emAndamento.current) return;
    emAndamento.current = true;
    setBuscandoMais(true);
    const minha = geracao.current;
    const atuais = historico.itens;
    try {
      const r = await minhasPresencas({ id, academia_id }, atuais.length);
      if (geracao.current !== minha) return;
      // Uma presença registrada no meio da leitura pode repetir a da borda.
      const vistas = new Set(atuais.map((p) => p.id));
      setHistorico({ fase: "pronta", itens: [...atuais, ...r.itens.filter((p) => !vistas.has(p.id))], temMais: r.temMais, maisFalhou: false });
    } catch {
      if (geracao.current === minha) setHistorico({ fase: "pronta", itens: atuais, temMais: true, maisFalhou: true });
    } finally {
      emAndamento.current = false;
      setBuscandoMais(false);
    }
  };

  return (
    <section aria-labelledby="portal-presencas" className="space-y-3">
      <h2 id="portal-presencas" className="text-base font-semibold text-white">Presenças</h2>
      {historico.fase === "carregando" && <p role="status" className="text-sm text-zinc-500">Carregando as presenças...</p>}
      {historico.fase === "erro" && (
        <div>
          <Alert variant="destructive" role="alert">
            <AlertDescription>Não foi possível carregar as presenças.</AlertDescription>
          </Alert>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setTentativa((t) => t + 1)}>Tentar de novo</Button>
        </div>
      )}
      {historico.fase === "pronta" &&
        (historico.itens.length === 0 ? (
          <p className="text-sm text-zinc-400">Nenhuma presença registrada ainda.</p>
        ) : (
          <>
            <ul aria-label="Presenças" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
              {historico.itens.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5">
                  <span className="text-sm text-white">{dataBr(p.data)} · {p.turma}</span>
                  <span className="text-xs text-zinc-500">{ORIGEM[p.origem] ?? ""}</span>
                </li>
              ))}
            </ul>
            {historico.maisFalhou && (
              <p role="alert" className="text-xs text-red-400">Não foi possível carregar mais presenças. Tente de novo.</p>
            )}
            {historico.temMais && (
              <Button size="sm" variant="outline" disabled={buscandoMais} onClick={mostrarMais}>
                {buscandoMais ? "Carregando..." : "Mostrar mais"}
              </Button>
            )}
          </>
        ))}
    </section>
  );
};

type Leitura = { fase: "carregando" } | { fase: "erro" } | { fase: "pronta"; itens: MinhaGraduacao[] };

const Graduacao: React.FC<{ aluno: MeuAluno }> = ({ aluno }) => {
  const [leitura, setLeitura] = useState<Leitura>({ fase: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const { id, academia_id } = aluno;
  useEffect(() => {
    let vale = true;
    setLeitura({ fase: "carregando" });
    minhaGraduacao({ id, academia_id })
      .then((itens) => vale && setLeitura({ fase: "pronta", itens }))
      .catch(() => vale && setLeitura({ fase: "erro" }));
    return () => {
      vale = false;
    };
  }, [id, academia_id, tentativa]);

  return (
    <section aria-labelledby="portal-graduacao" className="space-y-3">
      <h2 id="portal-graduacao" className="text-base font-semibold text-white">Graduação</h2>
      {leitura.fase === "carregando" && <p role="status" className="text-sm text-zinc-500">Carregando a graduação...</p>}
      {leitura.fase === "erro" && (
        <div>
          <Alert variant="destructive" role="alert">
            <AlertDescription>Não foi possível carregar a graduação.</AlertDescription>
          </Alert>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setTentativa((t) => t + 1)}>Tentar de novo</Button>
        </div>
      )}
      {leitura.fase === "pronta" &&
        (leitura.itens.length === 0 ? (
          <p className="text-sm text-zinc-400">Nenhuma graduação registrada ainda.</p>
        ) : (
          <ul aria-label="Graduação por modalidade" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {leitura.itens.map((g) => (
              <li key={g.modalidade_id} className="space-y-1 px-4 py-3">
                <span className="block text-xs text-zinc-400">{g.modalidade}</span>
                <span className="flex items-center gap-2 font-medium text-white">
                  <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-zinc-600"
                    style={{ backgroundColor: g.cor ?? "transparent" }} />
                  {g.faixa}{g.grau ? `, grau ${g.grau}` : ""}
                </span>
                <span className="block text-xs text-zinc-500">desde {dataBr(g.graduado_em)}</span>
                {g.progresso && (
                  <span className="block text-xs text-zinc-300">
                    {g.progresso.aulas_desde} de {g.progresso.min_aulas} aulas · {g.progresso.meses_desde} de {g.progresso.min_meses} meses
                    · próximo: {g.progresso.proximo_passo}
                  </span>
                )}
                {g.progresso?.apto && (
                  <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
                    <Badge variant="success">Tempo e aulas cumpridos</Badge>
                    A próxima graduação é decidida pelo professor.
                  </span>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
};
