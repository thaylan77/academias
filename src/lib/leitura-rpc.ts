import { Json } from "../types/database";
import {
  AcademiaPublica,
  HorarioTurma,
  ModalidadePublica,
  PlanoPublico,
  TokenCheckinInfo,
  TurmaAbertaTotem,
  TurmaPublica,
} from "../types/app";

/**
 * Leitura das respostas `jsonb` das RPCs.
 *
 * O tipo gerado do banco (`src/types/database.ts`) descreve essas respostas
 * só como `Json`: o Postgres não diz o formato de um `jsonb`. Estas funções
 * conferem os campos que o app usa e devolvem o tipo do app. Resposta em
 * outro formato vira `RespostaRpcInvalida`, em vez de seguir pela tela com
 * campos faltando.
 *
 * O formato esperado é o que as funções SQL montam com `jsonb_build_object`
 * (migrations `schema_inicial` e `checkin_seguranca`).
 */

export class RespostaRpcInvalida extends Error {
  constructor(rpc: string, detalhe: string) {
    super(`Resposta inesperada de ${rpc}: ${detalhe}`);
    this.name = "RespostaRpcInvalida";
  }
}

type Objeto = { [chave: string]: Json | undefined };

function objeto(valor: Json | undefined, rpc: string, onde: string): Objeto {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new RespostaRpcInvalida(rpc, `${onde} deveria ser um objeto`);
  }
  return valor;
}

function lista(valor: Json | undefined, rpc: string, onde: string): Json[] {
  if (!Array.isArray(valor)) {
    throw new RespostaRpcInvalida(rpc, `${onde} deveria ser uma lista`);
  }
  return valor;
}

function texto(o: Objeto, campo: string, rpc: string, onde: string): string {
  const v = o[campo];
  if (typeof v !== "string") throw new RespostaRpcInvalida(rpc, `${onde}.${campo} deveria ser texto`);
  return v;
}

function textoOuNulo(o: Objeto, campo: string, rpc: string, onde: string): string | null {
  // A chave sempre vem (jsonb_build_object), mesmo com valor nulo: ausente é erro.
  if (!(campo in o)) throw new RespostaRpcInvalida(rpc, `${onde}.${campo} está faltando`);
  const v = o[campo];
  if (v === null) return null;
  if (typeof v !== "string") throw new RespostaRpcInvalida(rpc, `${onde}.${campo} deveria ser texto ou nulo`);
  return v;
}

function numero(o: Objeto, campo: string, rpc: string, onde: string): number {
  const v = o[campo];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new RespostaRpcInvalida(rpc, `${onde}.${campo} deveria ser número`);
  }
  return v;
}

function booleano(o: Objeto, campo: string, rpc: string, onde: string): boolean {
  const v = o[campo];
  if (typeof v !== "boolean") throw new RespostaRpcInvalida(rpc, `${onde}.${campo} deveria ser verdadeiro ou falso`);
  return v;
}

/** `academia_publica(p_slug)`: nulo quando o slug não existe. */
export function lerAcademiaPublica(valor: Json): AcademiaPublica | null {
  const rpc = "academia_publica";
  if (valor === null) return null;
  const a = objeto(valor, rpc, "a resposta");

  const modalidades: ModalidadePublica[] = lista(a.modalidades, rpc, "modalidades").map((m, i) => {
    const o = objeto(m, rpc, `modalidades[${i}]`);
    return { id: texto(o, "id", rpc, `modalidades[${i}]`), nome: texto(o, "nome", rpc, `modalidades[${i}]`) };
  });

  const turmas: TurmaPublica[] = lista(a.turmas, rpc, "turmas").map((t, i) => {
    const onde = `turmas[${i}]`;
    const o = objeto(t, rpc, onde);
    const horarios: HorarioTurma[] = lista(o.horarios, rpc, `${onde}.horarios`).map((h, j) => {
      const ondeH = `${onde}.horarios[${j}]`;
      const oh = objeto(h, rpc, ondeH);
      return {
        dia_semana: numero(oh, "dia_semana", rpc, ondeH),
        inicio: texto(oh, "inicio", rpc, ondeH),
        fim: texto(oh, "fim", rpc, ondeH),
      };
    });
    return {
      id: texto(o, "id", rpc, onde),
      nome: texto(o, "nome", rpc, onde),
      modalidade_id: texto(o, "modalidade_id", rpc, onde),
      publico: texto(o, "publico", rpc, onde),
      horarios,
    };
  });

  const planos: PlanoPublico[] = lista(a.planos, rpc, "planos").map((p, i) => {
    const onde = `planos[${i}]`;
    const o = objeto(p, rpc, onde);
    return {
      id: texto(o, "id", rpc, onde),
      nome: texto(o, "nome", rpc, onde),
      valor: numero(o, "valor", rpc, onde),
      periodicidade: texto(o, "periodicidade", rpc, onde),
    };
  });

  return {
    id: texto(a, "id", rpc, "a resposta"),
    nome: texto(a, "nome", rpc, "a resposta"),
    logo_url: textoOuNulo(a, "logo_url", rpc, "a resposta"),
    matricula_online_aberta: booleano(a, "matricula_online_aberta", rpc, "a resposta"),
    modalidades,
    turmas,
    planos,
  };
}

/** `totem_turmas_agora(p_academia_id)`: lista, possivelmente vazia. */
export function lerTurmasAbertasTotem(valor: Json): TurmaAbertaTotem[] {
  const rpc = "totem_turmas_agora";
  return lista(valor, rpc, "a resposta").map((t, i) => {
    const onde = `[${i}]`;
    const o = objeto(t, rpc, onde);
    return {
      id: texto(o, "id", rpc, onde),
      nome: texto(o, "nome", rpc, onde),
      hora_inicio: texto(o, "hora_inicio", rpc, onde),
      hora_fim: texto(o, "hora_fim", rpc, onde),
    };
  });
}

/** `emitir_token_checkin(p_turma_id)`. */
export function lerTokenCheckin(valor: Json): TokenCheckinInfo {
  const rpc = "emitir_token_checkin";
  const o = objeto(valor, rpc, "a resposta");
  return {
    token: texto(o, "token", rpc, "a resposta"),
    expira_em: texto(o, "expira_em", rpc, "a resposta"),
    periodo_segundos: numero(o, "periodo_segundos", rpc, "a resposta"),
  };
}
