import { assert, assertEquals } from "@std/assert";
import { concluirSenha } from "../_shared/senha.ts";
import { depsSimuladas, jwtFalso, pedido, SESSAO, TOKEN_SENHA, USUARIO } from "./apoio.ts";

Deno.test("sem token: 401 sem_sessao", async () => {
  const s = depsSimuladas();
  const r = await concluirSenha(pedido({ senha: "senha-nova-123" }, null), s.deps);
  assertEquals(r.status, 401);
  assertEquals(s.de("rpc:definir_senha_comprovada_interna").length, 0);
});

Deno.test("sessão aberta com senha (não pelo link): convite_exige_link, sem gravar", async () => {
  const s = depsSimuladas();
  const r = await concluirSenha(pedido({ senha: "senha-nova-123" }, TOKEN_SENHA), s.deps);
  assertEquals(r.status, 403);
  assertEquals(await r.json(), { erro: "convite_exige_link" });
  assertEquals(s.de("rpc:definir_senha_comprovada_interna").length, 0);
});

Deno.test("token sem session_id: convite_exige_link", async () => {
  const s = depsSimuladas();
  const token = jwtFalso({ sub: USUARIO, iat: 1, amr: [{ method: "otp" }] });
  const r = await concluirSenha(pedido({ senha: "senha-nova-123" }, token), s.deps);
  assertEquals(await r.json(), { erro: "convite_exige_link" });
});

Deno.test("sessão do link: grava senha e prova com o usuário e a sessão do token", async () => {
  const s = depsSimuladas();
  const r = await concluirSenha(pedido({ senha: "senha-nova-123", user_id: "outro" }), s.deps);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: true });
  assertEquals(s.de("rpc:definir_senha_comprovada_interna")[0].args[0], {
    p_user_id: USUARIO,
    p_sessao: SESSAO,
    p_senha: "senha-nova-123",
  });
});

Deno.test("hint do banco repassado sem texto cru (senha_repetida)", async () => {
  const s = depsSimuladas({
    rpcSenha: { error: { message: "Escolha uma senha diferente da atual.", hint: "senha_repetida" } },
  });
  const r = await concluirSenha(pedido({ senha: "senha-nova-123" }), s.deps);
  assertEquals(r.status, 400);
  const corpo = await r.text();
  assertEquals(JSON.parse(corpo), { erro: "senha_repetida" });
  assert(!corpo.includes("Escolha"));
});

Deno.test("senha que não é texto: dados_invalidos", async () => {
  const s = depsSimuladas();
  const r = await concluirSenha(pedido({ senha: 12345678 }), s.deps);
  assertEquals(await r.json(), { erro: "dados_invalidos" });
  assertEquals(s.de("rpc:definir_senha_comprovada_interna").length, 0);
});

Deno.test("o log não leva a senha", async () => {
  const s = depsSimuladas({ rpcSenha: { error: { message: "falha" } } });
  await concluirSenha(pedido({ senha: "senha-secreta-xyz" }), s.deps);
  for (const l of s.logs) assert(!l.includes("senha-secreta-xyz"));
});
