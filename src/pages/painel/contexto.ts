import React, { useContext } from "react";
import { AcademiaDoMembro, SecaoPainel } from "../../lib/painel";

/**
 * Contexto que as telas do painel usam: academia selecionada e papel nela,
 * o registro aberto na seção (id ou "novo", pela URL) e como navegar.
 */
export interface PainelContextoValor {
  academia: AcademiaDoMembro;
  item: string | null;
  abrir: (secao: SecaoPainel, item?: string | null) => void;
}

export const PainelContexto = React.createContext<PainelContextoValor | null>(null);

export function usarPainel(): PainelContextoValor {
  const valor = useContext(PainelContexto);
  if (!valor) throw new Error("Tela do painel fora do PainelContexto.");
  return valor;
}
