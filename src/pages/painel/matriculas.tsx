import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiltroSituacao,
  FormNovaMatricula,
  Matricula,
  Plano,
  SituacaoMatricula,
  aprovarMatricula,
  criarMatricula,
  dataExiste,
  destrancarMatricula,
  encerrarMatricula,
  filtrarMatriculas,
  listarMatriculas,
  listarPlanos,
  podeDestrancar,
  podeEncerrar,
  podeGerirMatriculas,
  podeTrancar,
  podeVerMatriculas,
  situacaoDa,
  trancarMatricula,
  validarNovaMatricula,
} from "../../lib/matriculas";
import { AlunoResumo, hojeNoFuso, listarAlunos } from "../../lib/alunos";
import { Turma, listarTurmas } from "../../lib/turmas";
import { gerarCobrancasAgora, reais } from "../../lib/cobrancas";
import { usarPainel } from "./contexto";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";

const SELECT = "flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100";
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

const ROTULO_SITUACAO: Record<SituacaoMatricula, string> = {
  pendente: "Pendente",
  ativa: "Ativa",
  trancada: "Trancada",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
  desconhecido: "Outra situação",
};

type Dados = { matriculas: Matricula[]; alunos: AlunoResumo[]; turmas: Turma[]; planos: Plano[] };
type Aviso = { tipo: "ok" | "erro"; texto: string; verCobrancas?: boolean };

/**
 * Depois de aprovar ou destrancar matrícula com plano, gera na hora as
 * cobranças já elegíveis (não há geração automática ainda). Devolve o
 * complemento do aviso.
 */
async function gerarDepois(matriculaId: string): Promise<{ texto: string; verCobrancas?: boolean; falhou?: boolean }> {
  const g = await gerarCobrancasAgora(matriculaId);
  if (!g.sucesso) return { texto: " As cobranças não foram geradas: gere em Cobranças.", verCobrancas: true, falhou: true };
  if (g.geradas === 0) return { texto: " Nenhuma cobrança entra agora: a primeira sai perto do vencimento (gere em Cobranças)." };
  return { texto: ` ${g.geradas} ${g.geradas === 1 ? "cobrança gerada" : "cobranças geradas"}.`, verCobrancas: true };
}

/** Seção Matrículas do painel: pendentes da matrícula online, matrícula nova e a lista. */
export const MatriculasSecao: React.FC = () => {
  const { academia } = usarPainel();
  // O menu e a URL já escondem a seção do professor; esta é a segunda barreira.
  if (!podeVerMatriculas(academia.papel)) {
    return (
      <Alert variant="warning" role="alert">
        <AlertDescription>Seu papel nesta academia não acessa as matrículas.</AlertDescription>
      </Alert>
    );
  }
  return <Matriculas />;
};

const Matriculas: React.FC = () => {
  const { academia, abrir } = usarPainel();
  const [estado, setEstado] = useState<{ fase: "carregando" } | { fase: "erro" } | { fase: "pronto"; dados: Dados }>({ fase: "carregando" });
  const [falhaRecarga, setFalhaRecarga] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [nova, setNova] = useState(false);
  const geracao = useRef(0);
  const gerir = podeGerirMatriculas(academia.papel, academia.ativa);

  // Depois de uma ação, recarrega sem tirar a tela do lugar.
  const carregar = useCallback((emSegundoPlano = false) => {
    const minha = ++geracao.current;
    setFalhaRecarga(false);
    if (!emSegundoPlano) setEstado({ fase: "carregando" });
    Promise.all([
      listarMatriculas(academia.academia_id),
      listarAlunos(academia.academia_id),
      listarTurmas(academia.academia_id),
      listarPlanos(academia.academia_id),
    ])
      .then(([matriculas, alunos, turmas, planos]) => {
        if (minha === geracao.current) setEstado({ fase: "pronto", dados: { matriculas, alunos, turmas, planos } });
      })
      .catch(() => {
        if (minha !== geracao.current) return;
        if (emSegundoPlano) setFalhaRecarga(true);
        else setEstado({ fase: "erro" });
      });
  }, [academia.academia_id]);
  useEffect(() => {
    carregar();
    return () => {
      geracao.current++;
    };
  }, [carregar]);
  const recarregar = useCallback(() => carregar(true), [carregar]);
  const avisar = useCallback((a: Aviso) => {
    setAviso(a);
    recarregar();
  }, [recarregar]);

  if (estado.fase === "carregando") return <p role="status" className="text-sm text-zinc-500">Carregando matrículas...</p>;
  if (estado.fase === "erro") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          Não foi possível carregar as matrículas.{" "}
          <button type="button" className="underline" onClick={() => carregar()}>Tentar de novo</button>
        </AlertDescription>
      </Alert>
    );
  }
  const { dados } = estado;
  const pendentes = dados.matriculas.filter((m) => m.status === "pendente");

  return (
    <div className="space-y-10">
      {!academia.ativa && (
        <p className="text-sm text-zinc-400">Com a assinatura suspensa, as matrículas podem ser consultadas, mas não criadas, aprovadas nem alteradas.</p>
      )}
      {falhaRecarga && (
        <Alert variant="warning" role="alert">
          <AlertDescription>
            Feito, mas não foi possível atualizar a lista.{" "}
            <button type="button" className="underline" onClick={recarregar}>Atualizar</button>
          </AlertDescription>
        </Alert>
      )}
      {aviso && (
        <Alert variant={aviso.tipo === "ok" ? "success" : "destructive"} role={aviso.tipo === "ok" ? "status" : "alert"}>
          <AlertDescription>
            {aviso.texto}
            {aviso.verCobrancas && (
              <>
                {" "}
                <button type="button" className="underline" onClick={() => abrir("cobrancas")}>Ver cobranças</button>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Pendentes lista={pendentes} gerir={gerir} avisar={avisar} aoMudar={recarregar} />

      {gerir && (
        nova ? (
          <NovaMatricula
            dados={dados}
            aoFechar={() => setNova(false)}
            aoCriar={(a) => {
              setNova(false);
              avisar(a);
            }}
          />
        ) : (
          <Button size="sm" onClick={() => { setNova(true); setAviso(null); }}>Nova matrícula</Button>
        )
      )}

      <Lista matriculas={dados.matriculas} gerir={gerir} avisar={avisar} aoMudar={recarregar} />
    </div>
  );
};

// ------------------------------------------------------------------ pendentes

type Acoes = { gerir: boolean; avisar: (a: Aviso) => void; aoMudar: () => void };

const Pendentes: React.FC<{ lista: Matricula[] } & Acoes> = ({ lista, ...acoes }) => (
  <section aria-label="Pendentes" className="space-y-2">
    <h2 className="text-lg font-bold text-white">Pendentes da matrícula online ({lista.length})</h2>
    {lista.length === 0 ? (
      <p className="text-sm text-zinc-400">Nenhuma matrícula esperando aprovação.</p>
    ) : (
      <ul className="divide-y divide-zinc-800 rounded-xl border border-amber-700/60">
        {lista.map((m) => (
          <LinhaPendente key={m.id} m={m} {...acoes} />
        ))}
      </ul>
    )}
  </section>
);

const LinhaPendente: React.FC<{ m: Matricula } & Acoes> = ({ m, gerir, avisar, aoMudar }) => {
  const [dia, setDia] = useState(m.dia_vencimento ? String(m.dia_vencimento) : "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const trava = useRef(false);
  const pedeDia = m.plano_id !== null && m.dia_vencimento === null;

  const aprovar = async () => {
    if (trava.current) return;
    let diaNum: number | null = null;
    if (dia.trim()) {
      diaNum = Number(dia);
      if (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 28) {
        setErro("O dia de vencimento vai de 1 a 28.");
        return;
      }
    } else if (pedeDia) {
      setErro("Com plano, informe o dia de vencimento (1 a 28).");
      return;
    }
    trava.current = true;
    setEnviando(true);
    setErro(null);
    const r = await aprovarMatricula(m.id, diaNum);
    if (!r.sucesso) {
      trava.current = false;
      setEnviando(false);
      // O erro fica na linha; a lista recarrega porque a matrícula pode ter mudado.
      setErro(r.mensagem);
      aoMudar();
      return;
    }
    const base = `Matrícula de ${m.aluno} aprovada: o aluno já pode fazer check-in nas turmas dela.`;
    const g = m.plano_id ? await gerarDepois(m.id) : null;
    trava.current = false;
    setEnviando(false);
    avisar({ tipo: g?.falhou ? "erro" : "ok", texto: base + (g?.texto ?? ""), verCobrancas: g?.verCobrancas });
  };

  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block font-medium text-white">{m.aluno}</span>
          <span className="text-xs text-zinc-400">
            {m.plano ?? "Sem plano"} · {m.turmas.map((t) => t.nome).join(", ") || "sem turma"} · pedido para {dataBr(m.data_inicio)}
          </span>
        </span>
        {gerir && (
          <span className="flex flex-wrap items-end gap-2">
            <span className="w-28 space-y-1">
              <Label htmlFor={`dia-${m.id}`} className="text-xs">Dia de vencimento</Label>
              <Input id={`dia-${m.id}`} inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} placeholder={pedeDia ? "obrigatório" : ""} />
            </span>
            <Button size="sm" disabled={enviando} onClick={aprovar} aria-label={`Aprovar matrícula de ${m.aluno}`}>
              {enviando ? "Aprovando..." : "Aprovar"}
            </Button>
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500">Na aprovação, o início e a cobrança passam a contar a partir de hoje, se o pedido for anterior.</p>
      {erro && (
        <p role="alert" className="text-xs text-red-400">{erro}</p>
      )}
    </li>
  );
};

// ------------------------------------------------------------------ matrícula nova

const NovaMatricula: React.FC<{ dados: Dados; aoFechar: () => void; aoCriar: (a: Aviso) => void }> = ({ dados, aoFechar, aoCriar }) => {
  const { academia } = usarPainel();
  const hoje = hojeNoFuso(academia.fuso);
  const [f, setF] = useState<FormNovaMatricula>({
    aluno_id: "", plano_id: "", turma_ids: [], data_inicio: hoje, dia_vencimento: "", valor: "", cobrar_a_partir: "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const trava = useRef(false);
  const alunos = useMemo(() => dados.alunos.filter((a) => a.situacao !== "anonimizado"), [dados.alunos]);
  const turmas = useMemo(() => dados.turmas.filter((t) => t.ativa), [dados.turmas]);
  const plano = dados.planos.find((p) => p.id === f.plano_id);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (trava.current) return;
    const v = validarNovaMatricula(f, hoje);
    if (!v.ok) {
      setErro(v.mensagem);
      return;
    }
    trava.current = true;
    setEnviando(true);
    setErro(null);
    const r = await criarMatricula(academia.academia_id, v.dados);
    if (!r.sucesso) {
      trava.current = false;
      setEnviando(false);
      setErro(r.mensagem);
      return;
    }
    const nome = alunos.find((a) => a.id === v.dados.aluno_id)?.nome ?? "o aluno";
    // Sem plano não há cobrança. Com plano, as cobranças já elegíveis saem agora.
    if (!v.dados.plano_id) {
      aoCriar({ tipo: "ok", texto: `Matrícula de ${nome} criada, sem plano (não gera cobrança).` });
      return;
    }
    const g = await gerarCobrancasAgora(r.valor);
    if (!g.sucesso) {
      aoCriar({ tipo: "erro", texto: `Matrícula de ${nome} criada, mas as cobranças não foram geradas. Gere em Cobranças.`, verCobrancas: true });
      return;
    }
    aoCriar({
      tipo: "ok",
      texto: g.geradas
        ? `Matrícula de ${nome} criada e ${g.geradas} ${g.geradas === 1 ? "cobrança gerada" : "cobranças geradas"}.`
        : `Matrícula de ${nome} criada. Nenhuma cobrança entra agora: a primeira sai perto do vencimento (gere em Cobranças).`,
      verCobrancas: g.geradas > 0 ? true : undefined,
    });
  };

  const muda = (campo: keyof FormNovaMatricula) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [campo]: e.target.value }));

  return (
    <form aria-label="Nova matrícula" onSubmit={salvar} className="space-y-4 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-lg font-bold text-white">Nova matrícula</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="nm-aluno">Aluno</Label>
          <select id="nm-aluno" className={SELECT} value={f.aluno_id} onChange={muda("aluno_id")}>
            <option value="">Escolha...</option>
            {alunos.map((a) => (
              <option key={a.id} value={a.id}>{a.nome}{a.situacao !== "ativo" ? ` (${a.situacao})` : ""}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nm-plano">Plano</Label>
          <select id="nm-plano" className={SELECT} value={f.plano_id} onChange={muda("plano_id")}>
            <option value="">Sem plano (bolsista ou isento)</option>
            {dados.planos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome} · {reais(p.valor)} ({p.periodicidade})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nm-inicio">Início das aulas</Label>
          <Input id="nm-inicio" type="date" value={f.data_inicio} onChange={muda("data_inicio")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nm-dia">Dia de vencimento{f.plano_id ? "" : " (só com plano)"}</Label>
          <Input id="nm-dia" inputMode="numeric" value={f.dia_vencimento} onChange={muda("dia_vencimento")} placeholder="1 a 28" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nm-valor">Valor negociado (opcional)</Label>
          <Input id="nm-valor" inputMode="decimal" value={f.valor} onChange={muda("valor")} placeholder={plano ? reais(plano.valor) : ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nm-cobrar">Cobrar a partir de (opcional)</Label>
          <Input id="nm-cobrar" type="month" value={f.cobrar_a_partir} onChange={muda("cobrar_a_partir")} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zinc-200">Turmas</legend>
        {turmas.length === 0 ? (
          <p className="text-sm text-zinc-400">Nenhuma turma ativa. Cadastre em Turmas.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {turmas.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={f.turma_ids.includes(t.id)}
                  onChange={(e) =>
                    setF((x) => ({ ...x, turma_ids: e.target.checked ? [...x.turma_ids, t.id] : x.turma_ids.filter((id) => id !== t.id) }))
                  }
                />
                {t.nome} <span className="text-xs text-zinc-500">({t.modalidade})</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {erro && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={enviando}>{enviando ? "Salvando..." : "Matricular"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={aoFechar} disabled={enviando}>Cancelar</Button>
      </div>
    </form>
  );
};

// ------------------------------------------------------------------ lista

const Lista: React.FC<{ matriculas: Matricula[] } & Acoes> = ({ matriculas, ...acoes }) => {
  const { academia } = usarPainel();
  const hoje = hojeNoFuso(academia.fuso);
  const [situacao, setSituacao] = useState<FiltroSituacao>("ativa");
  const [aluno, setAluno] = useState("");
  const visiveis = filtrarMatriculas(matriculas, { situacao, aluno }, hoje);

  return (
    <section aria-label="Matrículas" className="space-y-3">
      <h2 className="text-lg font-bold text-white">Matrículas</h2>
      <div className="flex flex-wrap gap-3">
        <div className="w-44 space-y-1.5">
          <Label htmlFor="filtro-situacao">Situação</Label>
          <select id="filtro-situacao" className={SELECT} value={situacao} onChange={(e) => setSituacao(e.target.value as FiltroSituacao)}>
            <option value="todas">Todas</option>
            {(["pendente", "ativa", "trancada", "encerrada", "cancelada"] as const).map((s) => (
              <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="filtro-aluno">Aluno</Label>
          <Input id="filtro-aluno" value={aluno} onChange={(e) => setAluno(e.target.value)} placeholder="Buscar pelo nome" />
        </div>
      </div>
      {visiveis.length === 0 ? (
        <p className="text-sm text-zinc-400">Nenhuma matrícula com esses filtros.</p>
      ) : (
        <ul aria-label="Lista de matrículas" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {visiveis.map((m) => (
            <LinhaMatricula key={m.id} m={m} hoje={hoje} {...acoes} />
          ))}
        </ul>
      )}
    </section>
  );
};

type Acao = null | "encerrar" | "trancar";

const LinhaMatricula: React.FC<{ m: Matricula; hoje: string } & Acoes> = ({ m, hoje, gerir, avisar, aoMudar }) => {
  const [acao, setAcao] = useState<Acao>(null);
  const [fim, setFim] = useState(hoje);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const trava = useRef(false);
  const situacao = situacaoDa(m, hoje);

  const executar = async (
    fn: () => Promise<{ sucesso: true; texto: string; verCobrancas?: boolean; falhou?: boolean } | { sucesso: false; mensagem: string }>
  ) => {
    if (trava.current) return;
    trava.current = true;
    setEnviando(true);
    setErro(null);
    const r = await fn();
    trava.current = false;
    setEnviando(false);
    if (!r.sucesso) {
      // O erro fica na linha, com a confirmação aberta; a lista recarrega porque a matrícula pode ter mudado.
      setErro(r.mensagem);
      aoMudar();
      return;
    }
    setAcao(null);
    avisar({ tipo: r.falhou ? "erro" : "ok", texto: r.texto, verCobrancas: r.verCobrancas });
  };

  const pendentesTexto = (n: number, quando: string) =>
    n > 0
      ? ` ${n} ${n === 1 ? "cobrança pendente vence" : "cobranças pendentes vencem"} ${quando} e ${n === 1 ? "continua" : "continuam"} em aberto: cancele em Cobranças as que não valem.`
      : "";

  const encerrar = () => {
    if (!dataExiste(fim)) {
      setErro("Informe a data de fim.");
      return;
    }
    if (fim < m.data_inicio) {
      setErro("A data de fim não pode ser antes do início da matrícula.");
      return;
    }
    void executar(async () => {
      const r = await encerrarMatricula(m.id, fim);
      if (!r.sucesso) return r;
      return {
        sucesso: true,
        texto: `Matrícula de ${m.aluno} encerrada em ${dataBr(fim)}.${pendentesTexto(r.valor, "depois do fim")}`,
        verCobrancas: r.valor > 0 || undefined,
      };
    });
  };
  const trancar = () =>
    void executar(async () => {
      const r = await trancarMatricula(m.id);
      if (!r.sucesso) return r;
      return {
        sucesso: true,
        texto: `Matrícula de ${m.aluno} trancada: sem check-in e sem cobranças novas até destrancar.${pendentesTexto(r.valor, "de hoje em diante")}`,
        verCobrancas: r.valor > 0 || undefined,
      };
    });
  const destrancar = () =>
    void executar(async () => {
      const r = await destrancarMatricula(m.id);
      if (!r.sucesso) return r;
      const base = `Matrícula de ${m.aluno} destrancada: check-in e cobranças voltam a valer.`;
      const g = m.plano_id ? await gerarDepois(m.id) : null;
      return { sucesso: true, texto: base + (g?.texto ?? ""), verCobrancas: g?.verCobrancas, falhou: g?.falhou };
    });

  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <span className="block font-medium text-white">{m.aluno}</span>
          <span className="text-xs text-zinc-400">
            {m.plano ?? "Sem plano"}
            {m.valor !== null ? ` · ${reais(m.valor)}` : ""}
            {m.dia_vencimento ? ` · vence dia ${m.dia_vencimento}` : ""} · {m.turmas.map((t) => t.nome).join(", ") || "sem turma"} ·{" "}
            {dataBr(m.data_inicio)}
            {m.data_fim ? ` a ${dataBr(m.data_fim)}` : " em diante"}
            {m.origem === "online" ? " · online" : ""}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={situacao === "ativa" ? "success" : situacao === "pendente" ? "secondary" : "outline"}>{ROTULO_SITUACAO[situacao]}</Badge>
          {gerir && acao === null && (
            <>
              {podeEncerrar(m) && (
                <Button size="sm" variant="ghost" onClick={() => { setAcao("encerrar"); setFim(m.data_fim ?? hoje); setErro(null); }} aria-label={`Encerrar matrícula de ${m.aluno}`}>
                  {m.data_fim ? "Mudar fim" : "Encerrar"}
                </Button>
              )}
              {podeTrancar(m, hoje) && (
                <Button size="sm" variant="ghost" onClick={() => { setAcao("trancar"); setErro(null); }} aria-label={`Trancar matrícula de ${m.aluno}`}>
                  Trancar
                </Button>
              )}
              {podeDestrancar(m, hoje) && (
                <Button size="sm" variant="ghost" disabled={enviando} onClick={destrancar} aria-label={`Destrancar matrícula de ${m.aluno}`}>
                  Destrancar
                </Button>
              )}
            </>
          )}
        </span>
      </div>
      {acao === "encerrar" && (
        <div role="group" aria-label={`Encerrar matrícula de ${m.aluno}`} className="flex flex-wrap items-end gap-2">
          <span className="space-y-1">
            <Label htmlFor={`fim-${m.id}`} className="text-xs">Último dia</Label>
            <Input id={`fim-${m.id}`} type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </span>
          <Button size="sm" disabled={enviando} onClick={encerrar}>{enviando ? "Salvando..." : "Confirmar fim"}</Button>
          <Button size="sm" variant="ghost" disabled={enviando} onClick={() => setAcao(null)}>Voltar</Button>
          <p className="w-full text-xs text-zinc-500">Nenhuma cobrança é cancelada sozinha: as pendentes depois do fim continuam em Cobranças.</p>
        </div>
      )}
      {acao === "trancar" && (
        <div role="group" aria-label={`Trancar matrícula de ${m.aluno}`} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">Trancada, a matrícula para o check-in e as cobranças novas, mas continua ocupando a vaga na turma.</span>
          <Button size="sm" disabled={enviando} onClick={trancar}>{enviando ? "Salvando..." : "Confirmar trancamento"}</Button>
          <Button size="sm" variant="ghost" disabled={enviando} onClick={() => setAcao(null)}>Voltar</Button>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-xs text-red-400">{erro}</p>
      )}
    </li>
  );
};
