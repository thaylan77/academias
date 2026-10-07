import { describe, it, expect } from "vitest";
import {
  formatarCPF,
  formatarTelefone,
  formatarMoeda,
  calcularIdade,
  formatarDiaSemana,
} from "../lib/utils";

describe("Funções Utilitárias e Validações", () => {
  it("deve formatar CPF corretamente com máscara", () => {
    expect(formatarCPF("12345678901")).toBe("123.456.789-01");
    expect(formatarCPF("123.456.789-01")).toBe("123.456.789-01");
    expect(formatarCPF("12345")).toBe("123.45");
  });

  it("deve formatar telefone celular brasileiro com DDD", () => {
    expect(formatarTelefone("11987654321")).toBe("(11) 98765-4321");
    expect(formatarTelefone("2188887777")).toBe("(21) 8888-7777");
  });

  it("deve formatar valores monetários em Real (BRL)", () => {
    const formatted = formatarMoeda(149.9);
    expect(formatted).toContain("149,90");
    expect(formatted).toContain("R$");
  });

  it("deve calcular a idade corretamente", () => {
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();

    // 25 anos atrás
    const dataNascMaior = `${anoAtual - 25}-01-01`;
    expect(calcularIdade(dataNascMaior)).toBeGreaterThanOrEqual(24);

    // 10 anos atrás (menor de idade)
    const dataNascMenor = `${anoAtual - 10}-01-01`;
    const idadeMenor = calcularIdade(dataNascMenor);
    expect(idadeMenor).toBeLessThan(18);
  });

  it("deve formatar o dia da semana corretamente", () => {
    // Happy paths
    expect(formatarDiaSemana(0)).toBe("Domingo");
    expect(formatarDiaSemana(1)).toBe("Segunda-feira");
    expect(formatarDiaSemana(6)).toBe("Sábado");

    // Edge cases and error conditions
    expect(formatarDiaSemana(-1)).toBe("");
    expect(formatarDiaSemana(7)).toBe("");
  });
});
