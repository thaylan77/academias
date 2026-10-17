import { describe, it, expect } from "vitest";
import {
  RespostaRpcInvalida,
  lerAcademiaPublica,
  lerTokenCheckin,
  lerTurmasAbertasTotem,
} from "../lib/leitura-rpc";
import { Json } from "../types/database";

// Respostas no formato que as funções SQL montam (jsonb_build_object).
const ACADEMIA: Json = {
  id: "a1",
  nome: "Honor Team",
  logo_url: null,
  matricula_online_aberta: true,
  modalidades: [{ id: "m1", nome: "Jiu-Jitsu" }],
  turmas: [
    {
      id: "t1",
      nome: "Adulto noite",
      modalidade_id: "m1",
      publico: "adulto",
      horarios: [{ dia_semana: 1, inicio: "19:00:00", fim: "20:30:00" }],
    },
  ],
  planos: [{ id: "p1", nome: "Mensal", valor: 150, periodicidade: "mensal" }],
};

const comCampo = (base: Json, caminho: (string | number)[], valor: Json | undefined): Json => {
  const copia = JSON.parse(JSON.stringify(base));
  let alvo = copia;
  for (const passo of caminho.slice(0, -1)) alvo = alvo[passo];
  const ultimo = caminho[caminho.length - 1];
  if (valor === undefined) delete alvo[ultimo];
  else alvo[ultimo] = valor;
  return copia;
};

describe("lerAcademiaPublica", () => {
  it("devolve a academia no formato do app", () => {
    expect(lerAcademiaPublica(ACADEMIA)).toEqual(ACADEMIA);
  });

  it("slug inexistente (resposta nula) devolve nulo", () => {
    expect(lerAcademiaPublica(null)).toBeNull();
  });

  it("listas vazias são aceitas", () => {
    const vazia = { ...(ACADEMIA as object), modalidades: [], turmas: [], planos: [] } as Json;
    expect(lerAcademiaPublica(vazia)?.turmas).toEqual([]);
  });

  it.each([
    ["campo faltando", ["nome"], undefined, /nome deveria ser texto/],
    ["tipo errado", ["matricula_online_aberta"], "sim", /matricula_online_aberta deveria ser verdadeiro ou falso/],
    ["lista que não é lista", ["turmas"], {}, /turmas deveria ser uma lista/],
    ["campo aninhado faltando", ["turmas", 0, "horarios", 0, "fim"], undefined, /turmas\[0\]\.horarios\[0\]\.fim deveria ser texto/],
    ["valor do plano como texto", ["planos", 0, "valor"], "150.00", /planos\[0\]\.valor deveria ser número/],
    ["logo com tipo errado", ["logo_url"], 10, /logo_url deveria ser texto ou nulo/],
  ])("%s gera RespostaRpcInvalida com o caminho do campo", (_nome, caminho, valor, mensagem) => {
    const ler = () => lerAcademiaPublica(comCampo(ACADEMIA, caminho as (string | number)[], valor as Json | undefined));
    expect(ler).toThrow(RespostaRpcInvalida);
    expect(ler).toThrow(mensagem);
    expect(ler).toThrow(/academia_publica/);
  });

  it("resposta que não é objeto é recusada", () => {
    expect(() => lerAcademiaPublica([] as Json)).toThrow(/a resposta deveria ser um objeto/);
    expect(() => lerAcademiaPublica("texto")).toThrow(RespostaRpcInvalida);
  });
});

describe("lerTurmasAbertasTotem", () => {
  const TURMAS: Json = [
    { id: "t1", nome: "Adulto", hora_inicio: "19:00:00", hora_fim: "20:30:00" },
    { id: "t2", nome: "Kids", hora_inicio: "18:00:00", hora_fim: "19:00:00" },
  ];

  it("devolve as turmas no formato do app", () => {
    expect(lerTurmasAbertasTotem(TURMAS)).toEqual(TURMAS);
  });

  it("lista vazia é aceita", () => {
    expect(lerTurmasAbertasTotem([])).toEqual([]);
  });

  it("campo faltando ou com tipo errado é recusado", () => {
    expect(() => lerTurmasAbertasTotem(comCampo(TURMAS, [1, "hora_fim"], undefined))).toThrow(/\[1\]\.hora_fim deveria ser texto/);
    expect(() => lerTurmasAbertasTotem(comCampo(TURMAS, [0, "id"], 7))).toThrow(/\[0\]\.id deveria ser texto/);
  });

  it("resposta nula ou que não é lista é recusada", () => {
    expect(() => lerTurmasAbertasTotem(null)).toThrow(/totem_turmas_agora: a resposta deveria ser uma lista/);
    expect(() => lerTurmasAbertasTotem({})).toThrow(RespostaRpcInvalida);
  });
});

describe("lerTokenCheckin", () => {
  const TOKEN: Json = { token: "abc", expira_em: "2026-10-17T22:00:30Z", periodo_segundos: 30 };

  it("devolve o token no formato do app", () => {
    expect(lerTokenCheckin(TOKEN)).toEqual(TOKEN);
  });

  it("campo faltando ou com tipo errado é recusado", () => {
    expect(() => lerTokenCheckin(comCampo(TOKEN, ["token"], undefined))).toThrow(/token deveria ser texto/);
    expect(() => lerTokenCheckin(comCampo(TOKEN, ["periodo_segundos"], "30"))).toThrow(/periodo_segundos deveria ser número/);
    expect(() => lerTokenCheckin(comCampo(TOKEN, ["periodo_segundos"], null))).toThrow(/periodo_segundos deveria ser número/);
  });

  it("resposta nula é recusada", () => {
    expect(() => lerTokenCheckin(null)).toThrow(/emitir_token_checkin: a resposta deveria ser um objeto/);
  });
});
