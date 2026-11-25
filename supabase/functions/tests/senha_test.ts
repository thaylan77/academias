import { assert, assertEquals } from "@std/assert";
import { concluirSenha, POR_LINK } from "../_shared/senha.ts";
import { depsSimuladas, jwtFalso, pedido, SESSAO, type Simulado, TOKEN_SENHA, tokenCom, USUARIO } from "./apoio.ts";

const SENHA = { senha: "senha-nova-123" };

async function chama(s: Simulado, corpo: unknown = SENHA, token?: string | null) {
  const sim = depsSimuladas(s);
  const r = await concluirSenha(pedido(corpo, token === undefined ? undefined : token), sim.deps);
  const texto = await r.text();
  return { ...sim, status: r.status, corpo: texto ? JSON.parse(texto) : null, texto };
}

Deno.test("sem token: 401 sem_sessao", async () => {
  const r = await chama({}, SENHA, null);
  assertEquals([r.status, r.corpo], [401, { erro: "sem_sessao" }]);
  assertEquals(r.de("rpc:definir_senha_comprovada_interna").length, 0);
});

Deno.test("token recusado pelo Auth: 401 sem_sessao, sem gravar", async () => {
  const r = await chama({ token: "invalido" });
  assertEquals([r.status, r.corpo], [401, { erro: "sem_sessao" }]);
  assertEquals(r.de("rpc:definir_senha_comprovada_interna").length, 0);
});

Deno.test("Auth fora do ar: 500 erro_interno, não sem_sessao", async () => {
  const r = await chama({ token: "falha" });
  assertEquals([r.status, r.corpo], [500, { erro: "erro_interno" }]);
});

Deno.test("a lista de métodos por link é exatamente a do aceite no banco", () => {
  assertEquals([...POR_LINK].sort(), ["email/signup", "email_change", "invite", "magiclink", "otp", "recovery"]);
});

Deno.test("cada método por link é aceito; senha, email e signup soltos não", async () => {
  for (const m of POR_LINK) {
    const r = await chama({}, SENHA, tokenCom(m));
    assertEquals(r.status, 200, m);
  }
  for (const m of ["password", "email", "signup", "oauth", "anonymous"]) {
    const r = await chama({}, SENHA, tokenCom(m));
    assertEquals([r.status, r.corpo], [403, { erro: "convite_exige_link" }], m);
    assertEquals(r.de("rpc:definir_senha_comprovada_interna").length, 0);
  }
  const s = await chama({}, SENHA, TOKEN_SENHA);
  assertEquals(s.status, 403);
});

Deno.test("token sem session_id: convite_exige_link", async () => {
  const token = jwtFalso({ sub: USUARIO, iat: 1, amr: [{ method: "otp" }] });
  const r = await chama({}, SENHA, token);
  assertEquals(r.corpo, { erro: "convite_exige_link" });
});

Deno.test("sessão do link: grava senha e prova com o usuário e a sessão do token (o corpo não escolhe)", async () => {
  const r = await chama({}, { senha: "senha-nova-123", user_id: "outro", p_sessao: "outra" });
  assertEquals([r.status, r.corpo], [200, { ok: true }]);
  assertEquals(r.de("rpc:definir_senha_comprovada_interna")[0].args[0], {
    p_user_id: USUARIO,
    p_sessao: SESSAO,
    p_senha: "senha-nova-123",
  });
});

Deno.test("hint do banco repassado sem texto cru", async () => {
  for (
    const [hint, status] of [["senha_repetida", 400], ["dados_invalidos", 400], ["convite_exige_link", 403]] as const
  ) {
    const r = await chama({
      rpc: { definir_senha_comprovada_interna: { error: { message: "Texto da mensagem do banco.", hint } } },
    });
    assertEquals([r.status, r.corpo], [status, { erro: hint }]);
    assert(!r.texto.includes("Texto da mensagem"));
  }
});

Deno.test("corpo inválido: dados_invalidos", async () => {
  for (const corpo of [{ senha: 12345678 }, "{nao e json", {}]) {
    const r = await chama({}, corpo);
    assertEquals(r.corpo, { erro: "dados_invalidos" });
    assertEquals(r.de("rpc:definir_senha_comprovada_interna").length, 0);
  }
});

Deno.test("erro sem hint: 500, e o log leva o código, nunca a senha", async () => {
  const r = await chama(
    { rpc: { definir_senha_comprovada_interna: { error: { code: "XX000", message: "falha senha-secreta-xyz" } } } },
    { senha: "senha-secreta-xyz" },
  );
  assertEquals([r.status, r.corpo], [500, { erro: "erro_interno" }]);
  assert(r.logs.length > 0);
  assert(r.logs.some((l) => l.includes("XX000")));
  for (const l of r.logs) assert(!l.includes("senha-secreta-xyz"));
});
