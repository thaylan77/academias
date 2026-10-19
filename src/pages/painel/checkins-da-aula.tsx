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
  const geracao = useRef(0);

  const carregar = useCallback(() => {
    const minha = ++geracao.current;
    listarCheckinsDaAula(academia.academia_id, turmaId, hojeNoFuso(academia.fuso))
      .then((dados) => {
        if (minha !== geracao.current) return;
        setLista(dados);
        setFalhou(false);
        setAtualizadoEm(horaNoFuso(new Date().toISOString(), academia.fuso));
      })
      .catch(() => minha === geracao.current && setFalhou(true));
  }, [academia.academia_id, academia.fuso, turmaId]);

  useEffect(() => {
    carregar();
    const tique = () => {
      if (document.visibilityState === "visible") carregar();
    };
    const relogio = window.setInterval(tique, INTERVALO_ATUALIZACAO_MS);
    // Voltando para a aba, atualiza na hora (o intervalo pausou enquanto ela estava escondida).
    document.addEventListener("visibilitychange", tique);
    return () => {
      geracao.current++;
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", tique);
    };
  }, [carregar]);

  return (
    <section aria-label="Check-ins de hoje" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Check-ins de hoje{lista ? ` (${lista.length})` : ""}
        </h3>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {atualizadoEm && <span aria-live="polite">Atualizado às {atualizadoEm}</span>}
          <Button size="sm" variant="ghost" onClick={carregar}>Atualizar</Button>
        </span>
      </div>
      {falhou && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Não foi possível atualizar os check-ins. A lista tenta de novo sozinha.</AlertDescription>
        </Alert>
      )}
      {lista === null && !falhou && <p role="status" className="text-sm text-zinc-500">Carregando check-ins...</p>}
      {lista && lista.length === 0 && <p className="text-sm text-zinc-400">Nenhum check-in hoje nesta turma.</p>}
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
