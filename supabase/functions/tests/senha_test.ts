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
    p_aal: null,
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

Deno.test("passa ao banco o aal do token conferido (o banco exige aal2 com MFA)", async () => {
  const token = jwtFalso({ sub: USUARIO, iat: 1, session_id: SESSAO, aal: "aal2", amr: [{ method: "otp" }] });
  const r = await chama({}, SENHA, token);
  assertEquals(r.status, 200);
  assertEquals((r.de("rpc:definir_senha_comprovada_interna")[0].args[0] as { p_aal: string }).p_aal, "aal2");
});

Deno.test("mfa_necessario do banco repassado como 400", async () => {
  const r = await chama({ rpc: { definir_senha_comprovada_interna: { error: { hint: "mfa_necessario" } } } });
  assertEquals([r.status, r.corpo], [400, { erro: "mfa_necessario" }]);
});

Deno.test("limite de tentativas: 429 limite_tentativas, sem chegar ao bcrypt", async () => {
  const r = await chama({ rpc: { registrar_tentativa_senha_interna: { data: false } } });
  assertEquals([r.status, r.corpo], [429, { erro: "limite_tentativas" }]);
  assertEquals(r.de("rpc:definir_senha_comprovada_interna").length, 0);
});

Deno.test("chamadas concorrentes: as que passam do limite não chegam ao bcrypt", async () => {
  let restantes = 5;
  const s = depsSimuladas();
  const original = s.deps.rpc;
  s.deps.rpc = (nome, args) => {
    if (nome === "registrar_tentativa_senha_interna") {
      return Promise.resolve({ data: restantes-- > 0, error: null });
    }
    return original(nome, args);
  };
  const respostas = await Promise.all(
    Array.from({ length: 8 }, () => concluirSenha(pedido(SENHA), s.deps)),
  );
  const status = respostas.map((r) => r.status).sort();
  assertEquals(status.filter((x) => x === 429).length, 3);
  assertEquals(s.de("rpc:definir_senha_comprovada_interna").length, 5);
});

Deno.test("falha ao registrar a tentativa: 500, sem gravar a senha", async () => {
  const r = await chama({ rpc: { registrar_tentativa_senha_interna: { error: { code: "57014" } } } });
  assertEquals([r.status, r.corpo], [500, { erro: "erro_interno" }]);
  assertEquals(r.de("rpc:definir_senha_comprovada_interna").length, 0);
});
