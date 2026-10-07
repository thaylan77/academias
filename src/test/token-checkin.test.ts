import { describe, it, expect } from "vitest";
import {
  MARGEM_EXIBICAO_MS,
  prazoExibicaoToken,
  segundosAteRenovar,
  tokenAindaExibivel,
} from "../lib/token-checkin";
import { TokenCheckinInfo } from "../types/app";

const AGORA = Date.parse("2026-10-06T22:00:00Z");

function token(expiraEmMs: number, periodo = 30): TokenCheckinInfo {
  return { token: "tok", expira_em: new Date(expiraEmMs).toISOString(), periodo_segundos: periodo };
}

describe("Validade do token do totem (sem depender da hora do aparelho)", () => {
  it("exibe o QR por um período menos a margem, contado do pedido no relógio monotônico", () => {
    const prazo = prazoExibicaoToken(token(AGORA + 10_000), 1_000);
    expect(prazo).toBe(1_000 + 30_000 - MARGEM_EXIBICAO_MS);

    const recebido = { info: token(AGORA + 10_000), exibirAte: prazo };
    expect(tokenAindaExibivel(recebido, prazo - 1)).toBe(true);
    expect(tokenAindaExibivel(recebido, prazo)).toBe(false);
  });

  it("o prazo de exibição ignora expira_em: relógio do aparelho adiantado ou atrasado não muda nada", () => {
    const pedidoEm = 5_000;
    const adiantado = prazoExibicaoToken(token(AGORA - 3_600_000), pedidoEm);
    const atrasado = prazoExibicaoToken(token(AGORA + 3_600_000), pedidoEm);
    expect(adiantado).toBe(atrasado);
  });

  it("não exibe token ausente ou vazio", () => {
    expect(tokenAindaExibivel(undefined, 0)).toBe(false);
    expect(tokenAindaExibivel({ info: { ...token(AGORA), token: "" }, exibirAte: 10 }, 0)).toBe(false);
  });

  it("usa 30 s quando o período não vem preenchido", () => {
    expect(prazoExibicaoToken(token(AGORA, 0), 0)).toBe(30_000 - MARGEM_EXIBICAO_MS);
  });

  it("renova em expira_em quando a distância é plausível", () => {
    expect(segundosAteRenovar(token(AGORA + 12_000), AGORA)).toBe(12);
  });

  it("nunca espera mais que o período menos a folga, para renovar antes de o QR sair da tela", () => {
    expect(segundosAteRenovar(token(AGORA + 30_000), AGORA)).toBe(25);
    expect(segundosAteRenovar(token(AGORA + 60_000, 60), AGORA)).toBe(55);
  });

  it("relógio do aparelho adiantado (expira_em no passado): renova por período, não a cada segundo", () => {
    expect(segundosAteRenovar(token(AGORA - 3_600_000), AGORA)).toBe(25);
  });

  it("relógio do aparelho atrasado (expira_em muito no futuro): renova por período", () => {
    expect(segundosAteRenovar(token(AGORA + 3_600_000), AGORA)).toBe(25);
  });

  it("expira_em ilegível: renova por período", () => {
    expect(segundosAteRenovar({ token: "tok", expira_em: "não é data", periodo_segundos: 30 }, AGORA)).toBe(25);
  });
});
