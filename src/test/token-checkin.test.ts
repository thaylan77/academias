import { describe, it, expect } from "vitest";
import {
  Instante,
  MARGEM_EXIBICAO_MS,
  prazoExibicaoToken,
  segundosAteRenovar,
  tokenAindaExibivel,
} from "../lib/token-checkin";
import { TokenCheckinInfo } from "../types/app";

// Hora "certa" (a do banco) no momento do pedido.
const AGORA = Date.parse("2026-10-06T22:00:00Z");

function token(expiraEmMs: number, periodo = 30): TokenCheckinInfo {
  return { token: "tok", expira_em: new Date(expiraEmMs).toISOString(), periodo_segundos: periodo };
}

// Instante `ms` depois do pedido. `erroDoRelogio` desloca só o relógio de parede.
function depois(ms: number, erroDoRelogio = 0): Instante {
  return { monotonico: 1_000 + ms, parede: AGORA + erroDoRelogio + ms };
}

// Token pedido no instante zero e válido no banco até `expiraEmMs`.
function recebido(expiraEmMs: number, periodo = 30, erroDoRelogio = 0) {
  const info = token(expiraEmMs, periodo);
  return { info, exibirAte: prazoExibicaoToken(info, depois(0, erroDoRelogio)) };
}

describe("Validade do token do totem (sem depender da hora do aparelho)", () => {
  it("exibe o QR por um período menos a margem, contado do pedido", () => {
    expect(MARGEM_EXIBICAO_MS).toBe(5000);
    const t = recebido(AGORA + 10_000);

    expect(t.exibirAte).toEqual(depois(25_000));
    expect(tokenAindaExibivel(t, depois(24_999))).toBe(true);
    expect(tokenAindaExibivel(t, depois(25_000))).toBe(false);
  });

  it("hora do aparelho errada não muda o prazo: só o tempo decorrido conta", () => {
    for (const erro of [-3_600_000, 3_600_000]) {
      // Para um aparelho adiantado, o expira_em do banco "já passou"; para um atrasado, está longe.
      const t = recebido(AGORA + 10_000, 30, erro);
      expect(tokenAindaExibivel(t, depois(24_999, erro))).toBe(true);
      expect(tokenAindaExibivel(t, depois(25_000, erro))).toBe(false);
    }
  });

  it("aparelho que dormiu: o relógio monotônico parou, mas o de parede tira o QR da tela", () => {
    const t = recebido(AGORA + 10_000);
    const aoAcordar: Instante = { monotonico: 1_000 + 2_000, parede: AGORA + 8 * 3_600_000 };
    expect(tokenAindaExibivel(t, aoAcordar)).toBe(false);
  });

  it("hora do aparelho ajustada para trás no meio do período: o monotônico tira o QR da tela", () => {
    const t = recebido(AGORA + 10_000);
    const depoisDoAjuste: Instante = { monotonico: 1_000 + 26_000, parede: AGORA - 3_600_000 };
    expect(tokenAindaExibivel(t, depoisDoAjuste)).toBe(false);
  });

  it("não exibe token ausente ou vazio", () => {
    expect(tokenAindaExibivel(undefined, depois(0))).toBe(false);
    const vazio = recebido(AGORA + 10_000);
    vazio.info.token = "";
    expect(tokenAindaExibivel(vazio, depois(0))).toBe(false);
  });

  it("usa 30 s quando o período não vem preenchido", () => {
    expect(recebido(AGORA, 0).exibirAte).toEqual(depois(25_000));
  });

  it("renova em expira_em quando a distância é plausível", () => {
    expect(segundosAteRenovar(recebido(AGORA + 12_000), depois(0))).toBe(12);
  });

  it("nunca espera além do prazo de exibição menos a folga", () => {
    // período 30: sai da tela em 25 s, renova em até 20 s
    expect(segundosAteRenovar(recebido(AGORA + 30_000), depois(0))).toBe(20);
    // período 60: sai da tela em 55 s, renova em até 50 s
    expect(segundosAteRenovar(recebido(AGORA + 60_000, 60), depois(0))).toBe(50);
  });

  it("resposta lenta encurta a espera: a renovação continua antes de o QR sair da tela", () => {
    // A resposta levou 4 s. O QR sai da tela 25 s depois do pedido, ou seja, em 21 s.
    const t = recebido(AGORA + 30_000);
    const espera = segundosAteRenovar(t, depois(4_000));
    expect(espera).toBe(16);
    expect(tokenAindaExibivel(t, depois(4_000 + espera * 1000))).toBe(true);
  });

  it("resposta muito lenta: tenta de novo em 1 s, nunca em zero ou negativo", () => {
    expect(segundosAteRenovar(recebido(AGORA + 30_000), depois(24_000))).toBe(1);
    expect(segundosAteRenovar(recebido(AGORA + 30_000), depois(40_000))).toBe(1);
  });

  it("token recebido na virada da janela (expira_em já passou por frações de segundo): espera o teto", () => {
    // Não dá para distinguir de relógio adiantado, e o token ainda vale por toda a janela seguinte.
    const t = recebido(AGORA - 200);
    const espera = segundosAteRenovar(t, depois(300));
    expect(espera).toBe(19);
    expect(tokenAindaExibivel(t, depois(300 + espera * 1000))).toBe(true);
    expect(segundosAteRenovar(recebido(AGORA), depois(0))).toBe(20);
    expect(segundosAteRenovar(recebido(AGORA + 900), depois(0))).toBe(20);
  });

  it("relógio do aparelho adiantado ou atrasado: renova por período, não a cada segundo", () => {
    expect(segundosAteRenovar(recebido(AGORA, 30, 3_600_000), depois(0, 3_600_000))).toBe(20);
    expect(segundosAteRenovar(recebido(AGORA + 30_000, 30, -3_600_000), depois(0, -3_600_000))).toBe(20);
  });

  it("expira_em ilegível: renova por período", () => {
    const info = { token: "tok", expira_em: "não é data", periodo_segundos: 30 };
    const t = { info, exibirAte: prazoExibicaoToken(info, depois(0)) };
    expect(segundosAteRenovar(t, depois(0))).toBe(20);
  });
});
