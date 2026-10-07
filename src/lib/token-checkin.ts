import { TokenCheckinInfo } from "../types/app";

/**
 * Validade do QR no totem sem depender do relógio de parede do aparelho.
 *
 * O banco aceita o token da janela atual e o da anterior (spec do check-in,
 * seção 4). Então um token emitido em qualquer ponto da janela vale, no
 * mínimo, por mais um período inteiro depois da emissão. O totem conta esse
 * prazo como tempo decorrido desde o pedido, em dois relógios:
 *
 * - o monotônico (`performance.now()`), que não muda quando a hora do
 *   aparelho é ajustada, mas pode ficar parado enquanto o aparelho dorme;
 * - o de parede (`Date.now()`), que continua andando durante o sono. Aqui
 *   ele só é comparado com ele mesmo (diferença entre duas leituras), então
 *   a hora estar errada não importa.
 *
 * O QR sai da tela quando o prazo passa em qualquer um dos dois.
 */

const PERIODO_PADRAO_SEGUNDOS = 30;

// Folga para o aluno apontar a câmera, o navegador do celular abrir a página
// e o check-in chegar ao banco.
export const MARGEM_EXIBICAO_MS = 5000;

// A renovação é pedida este tempo antes de o QR sair da tela, para caber a
// ida e a volta da rede.
const FOLGA_RENOVACAO_SEGUNDOS = 5;

export interface Instante {
  monotonico: number;
  parede: number;
}

export interface TokenRecebido {
  info: TokenCheckinInfo;
  // Até quando o QR pode ficar na tela, em cada relógio.
  exibirAte: Instante;
}

// Objeto para os testes poderem avançar o tempo sem mexer nos timers.
export const relogio = {
  agora: (): Instante => ({ monotonico: performance.now(), parede: Date.now() }),
};

function periodoSegundos(info: TokenCheckinInfo): number {
  return info.periodo_segundos > 0 ? info.periodo_segundos : PERIODO_PADRAO_SEGUNDOS;
}

/**
 * Até quando o QR pode ser exibido. `pedidoEm` é o instante em que o pedido
 * do token saiu do totem: a emissão no banco é posterior a ele, então contar
 * a partir dele é sempre conservador.
 */
export function prazoExibicaoToken(info: TokenCheckinInfo, pedidoEm: Instante): Instante {
  const duracao = Math.max(0, periodoSegundos(info) * 1000 - MARGEM_EXIBICAO_MS);
  return { monotonico: pedidoEm.monotonico + duracao, parede: pedidoEm.parede + duracao };
}

export function tokenAindaExibivel(token: TokenRecebido | undefined, agora: Instante): boolean {
  return (
    !!token?.info.token &&
    agora.monotonico < token.exibirAte.monotonico &&
    agora.parede < token.exibirAte.parede
  );
}

/**
 * Em quantos segundos buscar o próximo token.
 *
 * O teto é sempre o prazo de exibição deste token menos a folga, medido nos
 * mesmos relógios: a renovação é pedida antes de o QR sair da tela, por mais
 * que a resposta tenha demorado a chegar.
 *
 * Abaixo do teto, usa `expira_em` quando a distância até ele é plausível
 * (entre 1 s e um período). Fora disso não dá para distinguir relógio errado
 * de virada de janela, e o totem espera o teto: o token continua válido
 * nesse intervalo, e renovar a cada segundo num aparelho de relógio adiantado
 * seria só carga no banco.
 */
export function segundosAteRenovar(token: TokenRecebido, agora: Instante): number {
  const periodo = periodoSegundos(token.info);
  const ateSairDaTela = Math.floor(
    Math.min(token.exibirAte.monotonico - agora.monotonico, token.exibirAte.parede - agora.parede) / 1000
  );
  const teto = Math.max(1, ateSairDaTela - FOLGA_RENOVACAO_SEGUNDOS);
  const ateExpirar = Math.floor((new Date(token.info.expira_em).getTime() - agora.parede) / 1000);

  if (Number.isFinite(ateExpirar) && ateExpirar >= 1 && ateExpirar <= periodo) {
    return Math.min(ateExpirar, teto);
  }
  return teto;
}
