import { describe, it, expect } from "vitest";
import {
  cn,
  formatarCPF,
  formatarTelefone,
  formatarMoeda,
  calcularIdade,
  formatarDiaSemana,
} from "../lib/utils";

describe("Funções Utilitárias e Validações", () => {
  describe("cn", () => {
    it("deve mesclar classes simples", () => {
      expect(cn("class1", "class2")).toBe("class1 class2");
    });

    it("deve ignorar valores falsy", () => {
      expect(cn("class1", false, null, undefined, "", "class2")).toBe("class1 class2");
    });

    it("deve lidar com arrays e objetos", () => {
      expect(cn(["class1", "class2"])).toBe("class1 class2");
      expect(cn({ class1: true, class2: false, class3: true })).toBe("class1 class3");
    });

    it("deve resolver conflitos do Tailwind", () => {
      expect(cn("p-4", "p-2")).toBe("p-2");
      expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
      expect(cn("text-sm", "text-lg")).toBe("text-lg");
    });
  });

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

  it("deve retornar o dia da semana correto baseado no índice", () => {
    expect(formatarDiaSemana(0)).toBe("Domingo");
    expect(formatarDiaSemana(3)).toBe("Quarta-feira");
    expect(formatarDiaSemana(6)).toBe("Sábado");

    // Invalid days
    expect(formatarDiaSemana(7)).toBe("");
    expect(formatarDiaSemana(-1)).toBe("");
  });
});
