import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cobranca,
  FormaPagamento,
  Inadimplente,
  MatriculaCobravel,
  ROTULO_FORMA,
  Situacao,
  aceitaAcaoManual,
  baixarCobranca,
  cancelarCobranca,
  estaVencida,
  filtrarCobrancas,
  gerarCobrancasAgora,
  listarCobrancas,
  listarInadimplentes,
  listarMatriculasAtivas,
  podeGerirCobrancas,
  podeVerCobrancas,
  reais,
  textoDivergencia,
  validarBaixa,
} from "../../lib/cobrancas";
import { formatarTelefone, hojeNoFuso } from "../../lib/alunos";
import { usarPainel } from "./contexto";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";

const SELECT = "flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100";
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const mesBr = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;

const ROTULO_STATUS: Record<Cobranca["status"], string> = {
  pendente: "Pendente",
  paga: "Paga",
  cancelada: "Cancelada",
  estornada: "Estornada",
};

type Dados = { cobrancas: Cobranca[]; inadimplentes: Inadimplente[]; matriculas: MatriculaCobravel[] };

/** Seção Cobranças do painel: inadimplentes, lista com baixa e cancelamento, e gerar agora. */
export const CobrancasSecao: React.FC = () => {
  const { academia } = usarPainel();
  // O menu e a URL já escondem a seção do professor; esta é a segunda barreira
  // na tela (a do banco é o RLS de cobrancas).
  if (!podeVerCobrancas(academia.papel)) {
    return (
      <Alert variant="warning" role="alert">
        <AlertDescription>Seu papel nesta academia não acessa o financeiro.</AlertDescription>
      </Alert>
    );
  }
  return <Financeiro />;
};

const Financeiro: React.FC = () => {
  const { academia } = usarPainel();
  const [estado, setEstado] = useState<{ fase: "carregando" } | { fase: "erro" } | { fase: "pronto"; dados: Dados }>({ fase: "carregando" });
  const [falhaRecarga, setFalhaRecarga] = useState(false);
  const geracao = useRef(0);

  // Depois de uma ação, recarrega sem tirar a tela do lugar.
  const carregar = useCallback((emSegundoPlano = false) => {
    const minha = ++geracao.current;
    setFalhaRecarga(false);
    if (!emSegundoPlano) setEstado({ fase: "carregando" });
    Promise.all([
      listarCobrancas(academia.academia_id),
      listarInadimplentes(academia.academia_id),
      listarMatriculasAtivas(academia.academia_id),
    ])
      .then(([cobrancas, inadimplentes, matriculas]) => {
        if (minha === geracao.current) setEstado({ fase: "pronto", dados: { cobrancas, inadimplentes, matriculas } });
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

  if (estado.fase === "carregando") return <p role="status" className="text-sm text-zinc-500">Carregando cobranças...</p>;
  if (estado.fase === "erro") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          Não foi possível carregar as cobranças.{" "}
          <button type="button" className="underline" onClick={() => carregar()}>Tentar de novo</button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-10">
      {!academia.ativa && (
        <p className="text-sm text-zinc-400">Com a assinatura suspensa, as cobranças podem ser consultadas, mas não baixadas, canceladas nem geradas.</p>
      )}
      {falhaRecarga && (
        <Alert variant="warning" role="alert">
          <AlertDescription>
            Feito, mas não foi possível atualizar a lista.{" "}
            <button type="button" className="underline" onClick={recarregar}>Atualizar</button>
          </AlertDescription>
        </Alert>
      )}
      <Inadimplentes lista={estado.dados.inadimplentes} />
      <ListaDeCobrancas cobrancas={estado.dados.cobrancas} aoMudar={recarregar} />
      {podeGerirCobrancas(academia.papel, academia.ativa) && (
        <GerarAgora matriculas={estado.dados.matriculas} aoMudar={recarregar} />
      )}
    </div>
  );
};

// ------------------------------------------------------------------ inadimplentes

const Inadimplentes: React.FC<{ lista: Inadimplente[] }> = ({ lista }) => (
  <section aria-label="Inadimplentes" className="space-y-2">
    <h2 className="text-lg font-bold text-white">Inadimplentes</h2>
    {lista.length === 0 ? (
      <p className="text-sm text-zinc-400">Nenhum aluno com cobrança vencida.</p>
    ) : (
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {lista.map((i) => (
          <li key={i.aluno_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
            <span>
              <span className="block font-medium text-white">{i.nome}</span>
              {i.telefone && <span className="block text-xs text-zinc-500">{formatarTelefone(i.telefone)}</span>}
            </span>
            <span className="text-right">
              <span className="block font-semibold text-red-300">{reais(i.total_atrasado)}</span>
              <span className="block text-xs text-zinc-400">
                {i.cobrancas_atrasadas} {i.cobrancas_atrasadas === 1 ? "cobrança" : "cobranças"} · desde {dataBr(i.vencimento_mais_antigo)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

// ------------------------------------------------------------------ lista, baixa e cancelamento

const ListaDeCobrancas: React.FC<{ cobrancas: Cobranca[]; aoMudar: () => void }> = ({ cobrancas, aoMudar }) => {
  const { academia } = usarPainel();
  const hoje = hojeNoFuso(academia.fuso);
  const [situacao, setSituacao] = useState<Situacao>("todas");
  const [competencia, setCompetencia] = useState("");
  const [aluno, setAluno] = useState("");
  const [aberta, setAberta] = useState<{ id: string; acao: "baixa" | "cancelar" } | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const gerir = podeGerirCobrancas(academia.papel, academia.ativa);

  const competencias = useMemo(
    () => [...new Set(cobrancas.map((c) => (c.competencia ?? "").slice(0, 7)).filter(Boolean))].sort().reverse(),
    [cobrancas]
  );
  const visiveis = filtrarCobrancas(cobrancas, { situacao, competencia, aluno }, hoje);

  const terminar = (res: { sucesso: boolean; mensagem?: string }, ok: string) => {
    setAberta(null);
    setAviso(res.sucesso ? { tipo: "ok", texto: ok } : { tipo: "erro", texto: res.mensagem ?? "" });
    // Deu certo ou não, a lista recarrega: a recusa quase sempre é porque a cobrança mudou.
    aoMudar();
  };

  return (
    <section aria-label="Cobranças" className="space-y-4">
      <h2 className="text-lg font-bold text-white">Cobranças</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cob-situacao">Situação</Label>
          <select id="cob-situacao" className={SELECT} value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao)}>
            <option value="todas">Todas</option>
            <option value="pendente">Pendentes</option>
            <option value="vencida">Vencidas</option>
            <option value="paga">Pagas</option>
            <option value="cancelada">Canceladas</option>
            <option value="estornada">Estornadas</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cob-competencia">Competência</Label>
          <select id="cob-competencia" className={SELECT} value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
            <option value="">Todas</option>
            {competencias.map((c) => <option key={c} value={c}>{mesBr(c)}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cob-aluno">Aluno</Label>
          <Input id="cob-aluno" type="search" value={aluno} onChange={(e) => setAluno(e.target.value)} />
        </div>
      </div>

      {aviso && (
        <Alert variant={aviso.tipo === "ok" ? "success" : "destructive"} role={aviso.tipo === "ok" ? "status" : "alert"}>
          <AlertDescription>{aviso.texto}</AlertDescription>
        </Alert>
      )}

      {visiveis.length === 0 ? (
        <p className="text-sm text-zinc-400">{cobrancas.length === 0 ? "Nenhuma cobrança ainda." : "Nenhuma cobrança com esses filtros."}</p>
      ) : (
        <ul aria-label="Lista de cobranças" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {visiveis.map((c) => {
            const vencida = estaVencida(c, hoje);
            const acoes = gerir && aceitaAcaoManual(c) && aberta === null;
            return (
              <li key={c.id} className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span>
                    <span className="block font-medium text-white">{c.aluno}</span>
                    <span className="block text-xs text-zinc-400">
                      {c.descricao ?? "Cobrança"} · vence {dataBr(c.vencimento)}
                      {c.status === "paga" && c.pago_em ? ` · paga em ${dataBr(c.pago_em)}` : ""}
                      {c.forma_pagamento && c.status === "paga" ? ` (${ROTULO_FORMA[c.forma_pagamento as FormaPagamento] ?? c.forma_pagamento})` : ""}
                    </span>
                    {c.divergencia && (
                      <span className="block text-xs text-amber-300">Revisar: {textoDivergencia(c.divergencia)}</span>
                    )}
                    {c.emitida && c.status === "pendente" && (
                      <span className="block text-xs text-zinc-500">Emitida no gateway: baixa e cancelamento acontecem por lá.</span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{reais(c.status === "paga" && c.valor_pago !== null ? c.valor_pago : c.valor)}</span>
                    <Badge variant={c.status === "paga" ? "success" : vencida ? "destructive" : "outline"}>
                      {vencida ? "Vencida" : ROTULO_STATUS[c.status]}
                    </Badge>
                    {acoes && (
                      <>
                        <Button size="sm" variant="outline" aria-label={`Dar baixa na cobrança de ${c.aluno} de ${dataBr(c.vencimento)}`}
                          onClick={() => { setAviso(null); setAberta({ id: c.id, acao: "baixa" }); }}>
                          Dar baixa
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Cancelar a cobrança de ${c.aluno} de ${dataBr(c.vencimento)}`}
                          onClick={() => { setAviso(null); setAberta({ id: c.id, acao: "cancelar" }); }}>
                          Cancelar
                        </Button>
                      </>
                    )}
                  </span>
                </div>
                {aberta?.id === c.id && aberta.acao === "baixa" && (
                  <FormularioBaixa cobranca={c} aoTerminar={(res) => (res ? terminar(res, "Baixa registrada.") : setAberta(null))} />
                )}
                {aberta?.id === c.id && aberta.acao === "cancelar" && (
                  <ConfirmacaoCancelamento cobranca={c} aoTerminar={(res) => (res ? terminar(res, "Cobrança cancelada.") : setAberta(null))} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

type Fim = (res: { sucesso: boolean; mensagem?: string } | null) => void;

const FormularioBaixa: React.FC<{ cobranca: Cobranca; aoTerminar: Fim }> = ({ cobranca, aoTerminar }) => {
  const { academia } = usarPainel();
  const hoje = hojeNoFuso(academia.fuso);
  const [forma, setForma] = useState<FormaPagamento>("pix");
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validarBaixa({ forma, data, valor }, hoje);
    if (!v.ok) return setErro(v.mensagem);
    setErro(null);
    setSalvando(true);
    const res = await baixarCobranca(cobranca.id, v.dados, academia.fuso);
    setSalvando(false);
    aoTerminar(res);
  };

  return (
    <form onSubmit={enviar} noValidate aria-label="Dar baixa" className="grid gap-3 rounded-xl border border-zinc-800 p-3 sm:grid-cols-4 items-end">
      <div className="space-y-1">
        <Label htmlFor={`baixa-forma-${cobranca.id}`}>Forma</Label>
        <select id={`baixa-forma-${cobranca.id}`} className={SELECT} value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)}>
          {(Object.keys(ROTULO_FORMA) as FormaPagamento[]).map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`baixa-data-${cobranca.id}`}>Pago em</Label>
        <Input id={`baixa-data-${cobranca.id}`} type="date" max={hoje} value={data} onChange={(e) => setData(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`baixa-valor-${cobranca.id}`}>Valor pago</Label>
        <Input id={`baixa-valor-${cobranca.id}`} inputMode="decimal" placeholder={reais(cobranca.valor)} value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvando}>{salvando ? "Salvando..." : "Confirmar baixa"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={() => aoTerminar(null)}>Voltar</Button>
      </div>
      {erro && <p role="alert" className="text-xs text-red-400 sm:col-span-4">{erro}</p>}
      <p className="text-xs text-zinc-500 sm:col-span-4">Sem valor, a baixa usa o valor da cobrança ({reais(cobranca.valor)}).</p>
    </form>
  );
};

const ConfirmacaoCancelamento: React.FC<{ cobranca: Cobranca; aoTerminar: Fim }> = ({ cobranca, aoTerminar }) => {
  const [salvando, setSalvando] = useState(false);
  const voltar = useRef<HTMLButtonElement>(null);
  useEffect(() => voltar.current?.focus(), []);
  const confirmar = async () => {
    setSalvando(true);
    const res = await cancelarCobranca(cobranca.id);
    setSalvando(false);
    aoTerminar(res);
  };
  return (
    <div role="alertdialog" aria-labelledby={`cancelar-${cobranca.id}`} aria-describedby={`cancelar-texto-${cobranca.id}`}
      onKeyDown={(e) => e.key === "Escape" && !salvando && aoTerminar(null)}
      className="space-y-2 rounded-xl border border-red-900/60 bg-red-950/30 p-3">
      <p id={`cancelar-${cobranca.id}`} className="font-semibold text-white">Cancelar a cobrança de {reais(cobranca.valor)}?</p>
      <p id={`cancelar-texto-${cobranca.id}`} className="text-sm text-zinc-300">
        A cobrança continua no histórico como cancelada e não volta a ser gerada para a mesma competência.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={salvando} onClick={confirmar}>{salvando ? "Cancelando..." : "Confirmar cancelamento"}</Button>
        <Button ref={voltar} size="sm" variant="outline" disabled={salvando} onClick={() => aoTerminar(null)}>Voltar</Button>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ gerar agora

const GerarAgora: React.FC<{ matriculas: MatriculaCobravel[]; aoMudar: () => void }> = ({ matriculas, aoMudar }) => {
  const [matriculaId, setMatriculaId] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [gerando, setGerando] = useState(false);
  const escolhida = matriculas.find((m) => m.id === matriculaId);

  const gerar = async () => {
    if (!escolhida) return;
    setGerando(true);
    setAviso(null);
    const res = await gerarCobrancasAgora(escolhida.id);
    setGerando(false);
    if (!res.sucesso) return setAviso({ tipo: "erro", texto: res.mensagem });
    setAviso({
      tipo: "ok",
      texto: res.geradas
        ? `${res.geradas} ${res.geradas === 1 ? "cobrança gerada" : "cobranças geradas"}.`
        : "Nenhuma cobrança a gerar agora: só entram a competência atual e a seguinte, perto do vencimento, e a matrícula precisa de plano com valor e dia de vencimento.",
    });
    if (res.geradas) aoMudar();
  };

  return (
    <section aria-label="Gerar cobranças" className="space-y-3">
      <h2 className="text-lg font-bold text-white">Gerar cobranças de uma matrícula</h2>
      <p className="text-sm text-zinc-400">As cobranças são geradas sozinhas; aqui é para adiantar a de uma matrícula.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1 space-y-1.5">
          <Label htmlFor="gerar-matricula">Matrícula ativa</Label>
          <select id="gerar-matricula" className={SELECT} value={matriculaId} onChange={(e) => { setMatriculaId(e.target.value); setAviso(null); }}>
            <option value="">Escolha...</option>
            {matriculas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.aluno}{m.plano ? ` · ${m.plano}` : " · sem plano"}{m.dia_vencimento ? ` · vence dia ${m.dia_vencimento}` : ""}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" disabled={!escolhida || gerando} onClick={gerar}>{gerando ? "Gerando..." : "Gerar agora"}</Button>
      </div>
      {aviso && (
        <Alert variant={aviso.tipo === "ok" ? "success" : "destructive"} role={aviso.tipo === "ok" ? "status" : "alert"}>
          <AlertDescription>{aviso.texto}</AlertDescription>
        </Alert>
      )}
    </section>
  );
};
