import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { convidarMembro } from "../_shared/convidar.ts";
import { ACADEMIA, criado, depsSimuladas, pedido, SESSAO, USUARIO } from "./apoio.ts";

const CORPO = { academia_id: ACADEMIA, email: "  Pessoa@Exemplo.TEST ", papel: "professor" };
const REDIRECT = "https://painel.exemplo.test/painel/convites";

Deno.test("sem token: 401 sem_sessao, sem chamar o banco", async () => {
  const s = depsSimuladas();
  const r = await convidarMembro(pedido(CORPO, null), s.deps);
  assertEquals(r.status, 401);
  assertEquals(await r.json(), { erro: "sem_sessao" });
  assertEquals(s.de("rpc:criar_convite_interna").length, 0);
});

Deno.test("passa ao banco o usuário, o iat e a sessão do token conferido", async () => {
  const s = depsSimuladas({ rpcCriar: criado("confirmada") });
  await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(s.de("rpc:criar_convite_interna")[0].args[0], {
    p_user_id: USUARIO,
    p_academia_id: ACADEMIA,
    p_email: CORPO.email,
    p_papel: "professor",
    p_iat: 1700000000,
    p_sessao: SESSAO,
  });
});

Deno.test("conta nenhuma: convite do Auth com o e-mail normalizado, marca definir_senha e confirma a reserva", async () => {
  const s = depsSimuladas({ rpcCriar: criado("nenhuma") });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { convite_id: "55555555-5555-4555-8555-555555555555", email_enviado: true });
  assertEquals(s.de("convidarPorEmail")[0].args, ["pessoa@exemplo.test", REDIRECT]);
  assertEquals(s.de("marcarDefinirSenha")[0].args, ["44444444-4444-4444-8444-444444444444", undefined]);
  assertEquals(s.de("rpc:confirmar_envio_convite_interna")[0].args[0], {
    p_envio_id: "77777777-7777-4777-8777-777777777777",
  });
  assertEquals(s.de("enviarLinkMagico").length, 0);
});

Deno.test("conta não confirmada: troca a senha por uma aleatória, marca definir_senha e manda o link", async () => {
  const s = depsSimuladas({ rpcCriar: criado("nao_confirmada") });
  await convidarMembro(pedido(CORPO), s.deps);
  const [userId, senha] = s.de("marcarDefinirSenha")[0].args as [string, string];
  assertEquals(userId, "66666666-6666-4666-8666-666666666666");
  assert(typeof senha === "string" && senha.length >= 43, "senha aleatória de 32 bytes");
  assertEquals(s.de("enviarLinkMagico")[0].args, ["pessoa@exemplo.test", REDIRECT]);
  assertEquals(s.nomes().indexOf("marcarDefinirSenha") < s.nomes().indexOf("enviarLinkMagico"), true);

  const s2 = depsSimuladas({ rpcCriar: criado("nao_confirmada") });
  await convidarMembro(pedido(CORPO), s2.deps);
  assertNotEquals(s2.de("marcarDefinirSenha")[0].args[1], senha, "cada convite sorteia outra senha");
});

Deno.test("conta confirmada: só o link mágico, sem mexer na senha", async () => {
  const s = depsSimuladas({ rpcCriar: criado("confirmada") });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals((await r.json()).email_enviado, true);
  assertEquals(s.de("enviarLinkMagico").length, 1);
  assertEquals(s.de("marcarDefinirSenha").length, 0);
  assertEquals(s.de("convidarPorEmail").length, 0);
});

Deno.test("redirectTo vem só do SITE_URL, nunca do pedido", async () => {
  const s = depsSimuladas({ rpcCriar: criado("confirmada") });
  await convidarMembro(pedido({ ...CORPO, redirectTo: "https://mal.exemplo/roubo" }), s.deps);
  assertEquals(s.de("enviarLinkMagico")[0].args[1], REDIRECT);
});

Deno.test("enviar = false: sem e-mail e resposta igual à de um envio", async () => {
  const s = depsSimuladas({ rpcCriar: criado("confirmada", { enviar: false, envio_id: null }) });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(await r.json(), { convite_id: "55555555-5555-4555-8555-555555555555", email_enviado: true });
  assertEquals(s.de("enviarLinkMagico").length + s.de("convidarPorEmail").length, 0);
  assertEquals(
    s.de("rpc:confirmar_envio_convite_interna").length + s.de("rpc:liberar_envio_convite_interna").length,
    0,
  );
});

Deno.test("provedor recusa de vez (4xx): libera a reserva e o convite fica pendente", async () => {
  const s = depsSimuladas({ rpcCriar: criado("confirmada"), link: { status: 422, message: "recusado" } });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(r.status, 200);
  assertEquals((await r.json()).email_enviado, false);
  assertEquals(s.de("rpc:liberar_envio_convite_interna").length, 1);
  assertEquals(s.de("rpc:confirmar_envio_convite_interna").length, 0);
  assertEquals(s.nomes().filter((n) => n.startsWith("rpc:") && n.includes("cancelar")).length, 0);
});

Deno.test("falha sem resultado (5xx ou rede): a reserva fica, sem confirmar nem liberar", async () => {
  for (const link of [{ status: 502 }, { message: "rede" }]) {
    const s = depsSimuladas({ rpcCriar: criado("confirmada"), link });
    const r = await convidarMembro(pedido(CORPO), s.deps);
    assertEquals((await r.json()).email_enviado, false);
    assertEquals(
      s.de("rpc:liberar_envio_convite_interna").length + s.de("rpc:confirmar_envio_convite_interna").length,
      0,
    );
  }
});

Deno.test("troca de senha recusada na conta não confirmada: não manda e libera a reserva", async () => {
  const s = depsSimuladas({ rpcCriar: criado("nao_confirmada"), marcar: { status: 500 } });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals((await r.json()).email_enviado, false);
  assertEquals(s.de("enviarLinkMagico").length, 0);
  assertEquals(s.de("rpc:liberar_envio_convite_interna").length, 1);
});

Deno.test("erro do banco: repassa só o hint, sem o texto cru", async () => {
  const s = depsSimuladas({ rpcCriar: { error: { message: "texto cru com detalhe interno", hint: "sem_permissao" } } });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(r.status, 403);
  const corpo = await r.text();
  assertEquals(JSON.parse(corpo), { erro: "sem_permissao" });
  assert(!corpo.includes("texto cru"));
  assertEquals(s.de("enviarLinkMagico").length + s.de("convidarPorEmail").length, 0);
});

Deno.test("erro do banco sem hint: 500 erro_interno, sem o texto cru", async () => {
  const s = depsSimuladas({ rpcCriar: { error: { message: "relation x does not exist" } } });
  const r = await convidarMembro(pedido(CORPO), s.deps);
  assertEquals(r.status, 500);
  assertEquals(await r.json(), { erro: "erro_interno" });
});

Deno.test("corpo inválido: dados_invalidos, sem chamar o banco", async () => {
  const s = depsSimuladas();
  const r = await convidarMembro(pedido({ academia_id: "nao-e-uuid", email: "a@b.c", papel: "admin" }), s.deps);
  assertEquals(await r.json(), { erro: "dados_invalidos" });
  assertEquals(s.de("rpc:criar_convite_interna").length, 0);
});

Deno.test("o log não leva o e-mail completo", async () => {
  const s = depsSimuladas({ rpcCriar: criado("confirmada"), link: { status: 422 } });
  await convidarMembro(pedido(CORPO), s.deps);
  assert(s.logs.length > 0);
  for (const l of s.logs) assert(!l.toLowerCase().includes("pessoa@exemplo.test"), l);
});
