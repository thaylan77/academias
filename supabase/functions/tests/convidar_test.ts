import { assert, assertEquals } from "@std/assert";
import { convidarMembro, recusaDefinitiva, statusDoHint } from "../_shared/convidar.ts";
import {
  ACADEMIA,
  CONTA,
  CONVITE,
  criado,
  depsSimuladas,
  ENVIO,
  pedido,
  SESSAO,
  type Simulado,
  USUARIO,
} from "./apoio.ts";

const CORPO = { academia_id: ACADEMIA, email: "  Pessoa@Exemplo.TEST ", papel: "professor" };
const REDIRECT = "https://painel.exemplo.test/painel/convites";
const RESERVA = { p_envio_id: ENVIO };

async function chama(s: Simulado, corpo: unknown = CORPO) {
  const sim = depsSimuladas(s);
  const r = await convidarMembro(pedido(corpo), sim.deps);
  const texto = await r.text();
  return { ...sim, status: r.status, corpo: JSON.parse(texto), texto };
}

Deno.test("sem token: 401 sem_sessao, sem chamar o banco", async () => {
  const s = depsSimuladas();
  const r = await convidarMembro(pedido(CORPO, null), s.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.json(), { erro: "sem_sessao" });
  assertEquals(s.de("rpc:criar_convite_interna").length, 0);
});

Deno.test("token recusado pelo Auth: 401 sem_sessao, sem chamar o banco", async () => {
  const r = await chama({ token: "invalido", rpc: { criar_convite_interna: criado("confirmada") } });
  assertEquals([r.status, r.corpo], [401, { erro: "sem_sessao" }]);
  assertEquals(r.de("rpc:criar_convite_interna").length, 0);
});

Deno.test("Auth fora do ar: 500 erro_interno com CORS, não sem_sessao", async () => {
  const s = depsSimuladas({ token: "falha" });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(r.status, 500);
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await r.json(), { erro: "erro_interno" });
  assertEquals(s.de("rpc:criar_convite_interna").length, 0);
});

Deno.test("OPTIONS responde 204 com CORS; outro método, 405", async () => {
  const s = depsSimuladas();
  const o = await convidarMembro(pedido(null, null, "OPTIONS"), s.deps);
  assertEquals(o.status, 204);
  assertEquals(o.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  const g = await convidarMembro(pedido(null, null, "GET"), s.deps);
  assertEquals([g.status, await g.json()], [405, { erro: "metodo_invalido" }]);
});

Deno.test("passa ao banco o usuário, o iat e a sessão do token conferido", async () => {
  const r = await chama({ rpc: { criar_convite_interna: criado("confirmada") } });
  assertEquals(r.de("rpc:criar_convite_interna")[0].args[0], {
    p_user_id: USUARIO,
    p_academia_id: ACADEMIA,
    p_email: CORPO.email,
    p_papel: "professor",
    p_iat: 1700000000,
    p_sessao: SESSAO,
  });
});

Deno.test("conta nenhuma: convite do Auth com o e-mail normalizado, marca definir_senha e confirma a reserva", async () => {
  const r = await chama({ rpc: { criar_convite_interna: criado("nenhuma") } });
  assertEquals([r.status, r.corpo], [200, { convite_id: CONVITE }]);
  assertEquals(r.de("convidarPorEmail")[0].args, ["pessoa@exemplo.test", REDIRECT]);
  assertEquals(r.de("rpc:marcar_definir_senha_interna")[0].args[0], {
    p_user_id: "44444444-4444-4444-8444-444444444444",
  });
  assertEquals(r.de("rpc:confirmar_envio_convite_interna").map((c) => c.args[0]), [RESERVA]);
  assertEquals(r.de("enviarLinkMagico").length + r.de("rpc:neutralizar_conta_nao_confirmada_interna").length, 0);
});

Deno.test("conta nenhuma, convite recusado pelo Auth (4xx): libera a reserva, sem marcar", async () => {
  const r = await chama({
    rpc: { criar_convite_interna: criado("nenhuma") },
    convidar: { userId: null, erro: { status: 422 } },
  });
  assertEquals(r.corpo, { convite_id: CONVITE }, "a resposta é sempre a mesma");
  assertEquals(r.de("rpc:liberar_envio_convite_interna").map((c) => c.args[0]), [RESERVA]);
  assertEquals(r.de("rpc:marcar_definir_senha_interna").length + r.de("rpc:confirmar_envio_convite_interna").length, 0);
});

Deno.test("conta nenhuma, marca definir_senha falha depois do envio: e-mail saiu, reserva confirmada, log", async () => {
  const r = await chama({
    rpc: { criar_convite_interna: criado("nenhuma"), marcar_definir_senha_interna: { error: { code: "XX000" } } },
  });
  assertEquals(r.corpo, { convite_id: CONVITE }, "a resposta é sempre a mesma");
  assertEquals(r.de("rpc:confirmar_envio_convite_interna").length, 1);
  assert(r.logs.some((l) => l.includes("definir_senha falhou")));
});

Deno.test("conta não confirmada: o banco neutraliza a conta antes do link mágico", async () => {
  const r = await chama({
    rpc: { criar_convite_interna: criado("nao_confirmada"), neutralizar_conta_nao_confirmada_interna: { data: true } },
  });
  assertEquals(r.de("rpc:neutralizar_conta_nao_confirmada_interna")[0].args[0], { p_user_id: CONTA });
  assertEquals(r.de("enviarLinkMagico")[0].args, ["pessoa@exemplo.test", REDIRECT]);
  assert(r.nomes().indexOf("rpc:neutralizar_conta_nao_confirmada_interna") < r.nomes().indexOf("enviarLinkMagico"));
  assertEquals(r.de("rpc:confirmar_envio_convite_interna").map((c) => c.args[0]), [RESERVA]);
  assertEquals(r.de("rpc:marcar_definir_senha_interna").length, 0, "a senha não passa pela Admin API");
});

Deno.test("conta que se confirmou no meio do caminho (neutralizar devolve false): só o link mágico", async () => {
  const r = await chama({
    rpc: { criar_convite_interna: criado("nao_confirmada"), neutralizar_conta_nao_confirmada_interna: { data: false } },
  });
  assertEquals(r.corpo, { convite_id: CONVITE }, "a resposta é sempre a mesma");
  assertEquals(r.de("enviarLinkMagico").length, 1);
});

Deno.test("conta não confirmada com enviar = false: neutraliza mesmo assim, sem e-mail", async () => {
  const r = await chama({
    rpc: {
      criar_convite_interna: criado("nao_confirmada", { enviar: false, envio_id: null }),
      neutralizar_conta_nao_confirmada_interna: { data: true },
    },
  });
  assertEquals(r.corpo, { convite_id: CONVITE });
  assertEquals(r.de("rpc:neutralizar_conta_nao_confirmada_interna").length, 1);
  assertEquals(r.de("enviarLinkMagico").length, 0);
});

Deno.test("falha ao neutralizar a conta: não manda, libera a reserva e registra (também sem envio)", async () => {
  const falha = { neutralizar_conta_nao_confirmada_interna: { error: { code: "40P01", message: "deadlock" } } };
  const r = await chama({ rpc: { criar_convite_interna: criado("nao_confirmada"), ...falha } });
  assertEquals(r.corpo, { convite_id: CONVITE }, "a resposta é sempre a mesma");
  assertEquals(r.de("enviarLinkMagico").length, 0);
  assertEquals(r.de("rpc:liberar_envio_convite_interna").length, 1);
  assert(r.logs.some((l) => l.includes("40P01")));

  const r2 = await chama({
    rpc: { criar_convite_interna: criado("nao_confirmada", { enviar: false, envio_id: null }), ...falha },
  });
  assertEquals(r2.corpo, { convite_id: CONVITE });
  assert(r2.logs.some((l) => l.includes("não neutralizou")), "a falha sem envio também fica no log");
});

Deno.test("conta confirmada: só o link mágico", async () => {
  const r = await chama({ rpc: { criar_convite_interna: criado("confirmada") } });
  assertEquals(r.corpo, { convite_id: CONVITE }, "a resposta é sempre a mesma");
  assertEquals(r.de("enviarLinkMagico").length, 1);
  assertEquals(
    r.de("rpc:marcar_definir_senha_interna").length + r.de("convidarPorEmail").length +
      r.de("rpc:neutralizar_conta_nao_confirmada_interna").length,
    0,
  );
  assertEquals(r.de("rpc:confirmar_envio_convite_interna").map((c) => c.args[0]), [RESERVA]);
});

Deno.test("redirectTo vem só do SITE_URL, nunca do pedido", async () => {
  const r = await chama({ rpc: { criar_convite_interna: criado("confirmada") } }, {
    ...CORPO,
    redirectTo: "https://mal.exemplo/roubo",
  });
  assertEquals(r.de("enviarLinkMagico")[0].args[1], REDIRECT);
});

Deno.test("enviar = false: sem e-mail e resposta igual à de um envio", async () => {
  const r = await chama({ rpc: { criar_convite_interna: criado("confirmada", { enviar: false, envio_id: null }) } });
  assertEquals(r.corpo, { convite_id: CONVITE });
  assertEquals(r.de("enviarLinkMagico").length + r.de("convidarPorEmail").length, 0);
  assertEquals(
    r.de("rpc:confirmar_envio_convite_interna").length + r.de("rpc:liberar_envio_convite_interna").length,
    0,
  );
});

Deno.test("recusa definitiva (4xx, inclusive 429): libera a reserva e o convite fica pendente", async () => {
  for (const status of [400, 422, 429]) {
    const r = await chama({ rpc: { criar_convite_interna: criado("confirmada") }, link: { status } });
    assertEquals([r.status, r.corpo], [200, { convite_id: CONVITE }]);
    assertEquals(r.de("rpc:liberar_envio_convite_interna").map((c) => c.args[0]), [RESERVA], `status ${status}`);
    assertEquals(r.de("rpc:confirmar_envio_convite_interna").length, 0);
    assertEquals(r.nomes().filter((n) => n.includes("cancelar")).length, 0);
  }
});

Deno.test("falha sem resultado (5xx, 408 ou rede): a reserva fica, sem confirmar nem liberar", async () => {
  for (const link of [{ status: 502 }, { status: 408 }, { message: "rede" }]) {
    const r = await chama({ rpc: { criar_convite_interna: criado("confirmada") }, link });
    assertEquals(r.corpo, { convite_id: CONVITE }, "a resposta é sempre a mesma");
    assertEquals(
      r.de("rpc:liberar_envio_convite_interna").length + r.de("rpc:confirmar_envio_convite_interna").length,
      0,
      JSON.stringify(link),
    );
  }
});

Deno.test("confirmar a reserva falha uma vez: tenta de novo e não registra erro", async () => {
  const r = await chama({
    rpc: {
      criar_convite_interna: criado("confirmada"),
      confirmar_envio_convite_interna: [{ error: { code: "57014" } }, {}],
    },
  });
  assertEquals(r.de("rpc:confirmar_envio_convite_interna").length, 2);
  assertEquals(r.logs.filter((l) => l.includes("confirmar_envio")).length, 0);
});

Deno.test("reserva que não se resolve: duas tentativas e log com o id e o código, sem o e-mail", async () => {
  const r = await chama({
    rpc: { criar_convite_interna: criado("confirmada"), confirmar_envio_convite_interna: { error: { code: "57014" } } },
  });
  assertEquals(r.de("rpc:confirmar_envio_convite_interna").length, 2);
  const l = r.logs.find((x) => x.includes("confirmar_envio_convite_interna"));
  assert(l && l.includes(ENVIO) && l.includes("57014") && !l.includes("pessoa@"), l);
});

Deno.test("erro do banco: repassa só o hint, sem o texto cru", async () => {
  const r = await chama({
    rpc: { criar_convite_interna: { error: { message: "texto cru com detalhe interno", hint: "sem_permissao" } } },
  });
  assertEquals([r.status, r.corpo], [403, { erro: "sem_permissao" }]);
  assert(!r.texto.includes("texto cru"));
  assertEquals(r.de("enviarLinkMagico").length + r.de("convidarPorEmail").length, 0);
});

Deno.test("status por hint: 403, 429 e 400", () => {
  assertEquals(statusDoHint("sem_permissao"), 403);
  assertEquals(statusDoHint("limite_convites"), 429);
  assertEquals(statusDoHint("convite_reenvio_cedo"), 429);
  assertEquals(statusDoHint("ja_membro"), 400);
  assertEquals([recusaDefinitiva({ status: 408 }), recusaDefinitiva({}), recusaDefinitiva({ status: 404 })], [
    false,
    false,
    true,
  ]);
});

Deno.test("erro do banco sem hint: 500 erro_interno, log só com o código", async () => {
  const r = await chama({ rpc: { criar_convite_interna: { error: { code: "PGRST202", message: "texto cru" } } } });
  assertEquals([r.status, r.corpo], [500, { erro: "erro_interno" }]);
  assert(r.logs.some((l) => l.includes("PGRST202") && !l.includes("texto cru")));
});

Deno.test("corpo inválido (JSON malformado ou campos errados): dados_invalidos, sem chamar o banco", async () => {
  for (const corpo of ["{nao e json", { academia_id: "nao-e-uuid", email: "a@b.c", papel: "admin" }, { email: 1 }]) {
    const s = depsSimuladas();
    const r = await convidarMembro(pedido(corpo), s.deps);
    assertEquals([r.status, await r.json()], [400, { erro: "dados_invalidos" }]);
    assertEquals(s.de("rpc:criar_convite_interna").length, 0);
  }
});

Deno.test("o log não leva o e-mail completo", async () => {
  const r = await chama({ rpc: { criar_convite_interna: criado("confirmada") }, link: { status: 422 } });
  assert(r.logs.length > 0);
  for (const l of r.logs) assert(!l.toLowerCase().includes("pessoa@exemplo.test"), l);
});

Deno.test("a resposta não distingue envio real recusado (429) de envio suprimido nem de envio que saiu", async () => {
  const recusado = await chama({ rpc: { criar_convite_interna: criado("confirmada") }, link: { status: 429 } });
  const suprimido = await chama({
    rpc: { criar_convite_interna: criado("confirmada", { enviar: false, envio_id: null }) },
  });
  const saiu = await chama({ rpc: { criar_convite_interna: criado("nenhuma") } });
  assertEquals(recusado.texto, suprimido.texto);
  assertEquals(saiu.texto, suprimido.texto);
  assertEquals([recusado.status, suprimido.status, saiu.status], [200, 200, 200]);
});

Deno.test("a resposta não espera o envio: com o Auth lento, ela sai antes e o envio termina depois", async () => {
  let soltar!: () => void;
  const atrasoLink = new Promise<void>((ok) => (soltar = ok));
  const s = depsSimuladas({ rpc: { criar_convite_interna: criado("confirmada") }, adiar: true, atrasoLink });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals([r.status, await r.json()], [200, { convite_id: CONVITE }]);
  assertEquals(s.de("rpc:confirmar_envio_convite_interna").length, 0, "o envio ainda não terminou");
  soltar();
  await Promise.all(s.pendentes);
  assertEquals(s.de("rpc:confirmar_envio_convite_interna").length, 1, "o envio terminou depois da resposta");
});

Deno.test("conta não confirmada: a neutralização também roda depois da resposta", async () => {
  const s = depsSimuladas({
    rpc: { criar_convite_interna: criado("nao_confirmada", { enviar: false, envio_id: null }) },
    adiar: true,
  });
  await convidarMembro(pedido(CORPO), s.deps);
  assert(s.nomes().indexOf("emSegundoPlano") < s.nomes().indexOf("rpc:neutralizar_conta_nao_confirmada_interna"));
  await Promise.all(s.pendentes);
});

Deno.test("exceção no envio em segundo plano fica no log, sem derrubar a resposta", async () => {
  const s = depsSimuladas({ rpc: { criar_convite_interna: criado("confirmada") } });
  s.deps.enviarLinkMagico = () => Promise.reject(new TypeError("rede"));
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(r.status, 200);
  assert(s.logs.some((l) => l.includes("exceção no envio (TypeError)")));
});
