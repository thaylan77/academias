import { TokenCheckinInfo } from "../types/app";

/**
 * Validade do QR no totem sem depender do relógio de parede do aparelho.
 *
 * O banco aceita o token da janela atual e o da anterior (spec do check-in,
 * seção 4). Então um token emitido em qualquer ponto da janela vale, no
 * mínimo, por mais um período inteiro depois da emissão. O totem conta esse
 * prazo com um relógio monotônico (`performance.now()`), que não muda quando
 * a hora do aparelho está errada ou é ajustada.
 */

const PERIODO_PADRAO_SEGUNDOS = 30;

// Folga para o aluno apontar a câmera e o check-in chegar ao banco.
export const MARGEM_EXIBICAO_MS = 3000;

// A renovação acontece antes de o QR sair da tela.
const FOLGA_RENOVACAO_SEGUNDOS = 5;

export interface TokenRecebido {
  info: TokenCheckinInfo;
  // Instante, no relógio monotônico, até o qual o QR pode ficar na tela.
  exibirAte: number;
}

// Objeto para os testes poderem avançar o tempo sem mexer nos timers.
export const relogio = {
  agora: (): number => performance.now(),
};

function periodoSegundos(info: TokenCheckinInfo): number {
  return info.periodo_segundos > 0 ? info.periodo_segundos : PERIODO_PADRAO_SEGUNDOS;
}

/**
 * Até quando o QR pode ser exibido. `pedidoEm` é o instante monotônico em
 * que o pedido do token saiu do totem: a emissão no banco é posterior a ele,
 * então contar a partir dele é sempre conservador.
 */
export function prazoExibicaoToken(info: TokenCheckinInfo, pedidoEm: number): number {
  return pedidoEm + Math.max(0, periodoSegundos(info) * 1000 - MARGEM_EXIBICAO_MS);
}

export function tokenAindaExibivel(token: TokenRecebido | undefined, agora: number): boolean {
  return !!token?.info.token && agora < token.exibirAte;
}

/**
 * Em quantos segundos buscar o próximo token. Usa `expira_em` quando a
 * distância até ele é plausível (entre 1 s e um período). Fora disso o
 * relógio do aparelho está errado, e o totem renova por período.
 */
export function segundosAteRenovar(info: TokenCheckinInfo, agoraRelogioParede: number): number {
  const periodo = periodoSegundos(info);
  const teto = Math.max(1, periodo - FOLGA_RENOVACAO_SEGUNDOS);
  const ateExpirar = Math.floor((new Date(info.expira_em).getTime() - agoraRelogioParede) / 1000);

  if (Number.isFinite(ateExpirar) && ateExpirar >= 1 && ateExpirar <= periodo) {
    return Math.min(ateExpirar, teto);
  }
  return teto;
}
