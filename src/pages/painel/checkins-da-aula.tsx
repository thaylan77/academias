import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckinDaAula,
  INTERVALO_ATUALIZACAO_MS,
  ROTULO_ORIGEM,
  horaNoFuso,
  listarCheckinsDaAula,
} from "../../lib/checkins-da-aula";
import { hojeNoFuso } from "../../lib/alunos";
import { usarPainel } from "./contexto";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";

/**
 * Check-ins de hoje na turma, atualizados sozinhos a cada 15 s enquanto a
 * aba está visível (consulta periódica: o RLS vale como em qualquer
 * leitura, sem precisar publicar a tabela no Realtime).
 */
export const CheckinsDaAula: React.FC<{ turmaId: string }> = ({ turmaId }) => {
  const { academia } = usarPainel();
  const [lista, setLista] = useState<CheckinDaAula[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const geracao = useRef(0);
  // Início (ms) da consulta em andamento, ou null.
  const emAndamento = useRef<number | null>(null);
  // Dia (no fuso da academia) da lista que está na tela.
  const diaDaLista = useRef<string | null>(null);

  const carregar = useCallback(() => {
    const minha = ++geracao.current;
    emAndamento.current = Date.now();
    setCarregando(true);
    // O dia é recalculado a cada busca. Virou o dia (no fuso da academia): a lista de
    // ontem sai da tela na hora, para não aparecer como "de hoje" se a busca falhar.
    const hoje = hojeNoFuso(academia.fuso);
    if (diaDaLista.current !== null && diaDaLista.current !== hoje) {
      diaDaLista.current = null;
      setLista(null);
      setAtualizadoEm(null);
    }
    listarCheckinsDaAula(academia.academia_id, turmaId, hoje)
      .then((dados) => {
        if (minha !== geracao.current) return;
        diaDaLista.current = hoje;
        setLista(dados);
        setFalhou(false);
        setAtualizadoEm(horaNoFuso(new Date().toISOString(), academia.fuso));
      })
      .catch(() => {
        if (minha === geracao.current) setFalhou(true);
      })
      .finally(() => {
        if (minha !== geracao.current) return;
        emAndamento.current = null;
        setCarregando(false);
      });
  }, [academia.academia_id, academia.fuso, turmaId]);

  useEffect(() => {
    // Outra turma ou academia: nada da anterior fica na tela enquanto a nova chega.
    diaDaLista.current = null;
    setLista(null);
    setFalhou(false);
    setAtualizadoEm(null);
    carregar();
    const tique = () => {
      // Aba escondida pausa. Consulta em andamento não ganha outra por cima, a não ser
      // que já dure um intervalo inteiro (assim uma resposta que nunca chega não para a lista).
      if (document.visibilityState !== "visible") return;
      const inicio = emAndamento.current;
      if (inicio !== null && Date.now() - inicio < INTERVALO_ATUALIZACAO_MS) return;
      carregar();
    };
    const relogio = window.setInterval(tique, INTERVALO_ATUALIZACAO_MS);
    // Voltando para a aba, atualiza na hora (o intervalo pausou enquanto ela estava escondida).
    document.addEventListener("visibilitychange", tique);
    return () => {
      geracao.current++;
      emAndamento.current = null;
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", tique);
    };
  }, [carregar]);

  return (
    <section aria-label="Check-ins de hoje" aria-busy={carregando} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Check-ins de hoje{lista ? ` (${lista.length})` : ""}
        </h3>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {atualizadoEm && <span aria-live="polite">Atualizado às {atualizadoEm}</span>}
          <Button size="sm" variant="ghost" onClick={carregar} disabled={carregando}>
            {carregando ? "Atualizando..." : "Atualizar"}
          </Button>
        </span>
      </div>
      {falhou && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Não foi possível atualizar os check-ins. A lista tenta de novo sozinha.</AlertDescription>
        </Alert>
      )}
      {lista === null && !falhou && <p role="status" className="text-sm text-zinc-500">Carregando check-ins...</p>}
      {lista && lista.length === 0 && <p role="status" className="text-sm text-zinc-400">Nenhum check-in hoje nesta turma.</p>}
      {lista && lista.length > 0 && (
        <ul aria-label="Check-ins da aula" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {lista.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="text-white">{c.aluno}</span>
              <span className="flex items-center gap-2 text-xs text-zinc-400">
                <Badge variant="outline">{ROTULO_ORIGEM[c.origem]}</Badge>
                {horaNoFuso(c.checkin_em, academia.fuso)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
