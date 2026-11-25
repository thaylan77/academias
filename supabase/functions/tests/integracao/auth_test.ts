// Integração com o Auth real (supabase start no CI). Roda só com
// INTEGRACAO=1 e as variáveis SUPABASE_URL, SUPABASE_ANON_KEY e
// SUPABASE_SERVICE_ROLE_KEY do stack local. Nunca aponte para o honorteam-dev.
//
// Cobre o que o pgTAP não alcança: a senha gravada pelo banco
// (definir_senha_comprovada_interna) vale no login do Auth, invalida a
// senha antiga e o token de recuperação anterior e mantém a sessão do link
// renovável; e os três ramos da convidar-membro contra o Auth de verdade.

import { assert, assertEquals } from "@std/assert";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientesDoAmbiente, depsConvidar, depsSenha } from "../../_shared/clientes.ts";
import { convidarMembro } from "../../_shared/convidar.ts";
import { concluirSenha } from "../../_shared/senha.ts";

const ativo = Deno.env.get("INTEGRACAO") === "1";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (ativo && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error("integração só roda contra o Supabase local");
}

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
const sufixo = crypto.randomUUID().slice(0, 8);
const email = (nome: string) => `${nome}-${sufixo}@integracao.test`;

function novoAnon(): SupabaseClient {
  return createClient(url, anonKey, opcoes);
}

/** Sessão aberta pelo link mágico (amr otp), como a do convite. */
async function sessaoPorLink(admin: SupabaseClient, endereco: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: endereco });
  if (error) throw error;
  const cliente = novoAnon();
  const v = await cliente.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (v.error || !v.data.session) throw v.error ?? new Error("sem sessão");
  return { cliente, sessao: v.data.session };
}

function pedido(token: string, corpo: unknown): Request {
  return new Request("http://localhost/funcao", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

Deno.test({
  name:
    "senha do convite gravada pelo banco: login novo, senha e recuperação antigas recusadas, sessão do link renovável",
  ignore: !ativo,
  async fn() {
    const c = clientesDoAmbiente();
    const endereco = email("senha");
    const criado = await c.servico.auth.admin.createUser({
      email: endereco,
      email_confirm: true,
      password: "senha-antiga-123",
    });
    if (criado.error) throw criado.error;

    const { cliente, sessao } = await sessaoPorLink(c.servico, endereco);
    const rec = await c.servico.auth.admin.generateLink({ type: "recovery", email: endereco });
    if (rec.error) throw rec.error;

    const r = await concluirSenha(pedido(sessao.access_token, { senha: "senha-nova-do-convite" }), depsSenha(c));
    assertEquals(r.status, 200, await r.clone().text());

    const nova = await novoAnon().auth.signInWithPassword({ email: endereco, password: "senha-nova-do-convite" });
    assertEquals(nova.error, null, "a senha gravada pelo banco vale no login do Auth");
    const antiga = await novoAnon().auth.signInWithPassword({ email: endereco, password: "senha-antiga-123" });
    assert(antiga.error, "a senha antiga não entra mais");

    const usarRec = await novoAnon().auth.verifyOtp({ token_hash: rec.data.properties.hashed_token, type: "recovery" });
    assert(usarRec.error, "o token de recuperação emitido antes da troca não vale mais");

    const renovada = await cliente.auth.refreshSession({ refresh_token: sessao.refresh_token });
    assertEquals(renovada.error, null, "a sessão do link continua renovável");

    const repetida = await concluirSenha(
      pedido(renovada.data.session!.access_token, { senha: "senha-nova-do-convite" }),
      depsSenha(c),
    );
    assertEquals(await repetida.json(), { erro: "senha_repetida" });
  },
});

const mailpit = Deno.env.get("MAILPIT_URL") ?? "";

/** Dono com academia em trial, logado com senha. */
async function prepararDono(nome: string) {
  const c = clientesDoAmbiente();
  const endereco = email(nome);
  const dono = await c.servico.auth.admin.createUser({
    email: endereco,
    email_confirm: true,
    password: "senha-do-dono-1",
  });
  if (dono.error) throw dono.error;
  const cliente = novoAnon();
  const login = await cliente.auth.signInWithPassword({ email: endereco, password: "senha-do-dono-1" });
  if (login.error) throw login.error;
  const acad = await cliente.rpc("criar_academia", {
    p_nome: "Integração " + nome + sufixo,
    p_slug: `int-${nome}-${sufixo}`,
  });
  if (acad.error) throw acad.error;
  return { c, token: login.data.session!.access_token, academiaId: acad.data as string };
}

async function usuarioPorEmail(c: ReturnType<typeof clientesDoAmbiente>, endereco: string) {
  const { data, error } = await c.servico.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === endereco) ?? null;
}

async function envioConfirmado(c: ReturnType<typeof clientesDoAmbiente>, conviteId: string) {
  const { data, error } = await c.servico.from("convites_envios").select("enviado_em").eq("convite_id", conviteId);
  if (error) throw error;
  return data.some((v) => v.enviado_em !== null);
}

/** Texto dos e-mails que o Mailpit recebeu para o endereço (espera até 10 s). */
async function emailsPara(endereco: string): Promise<string[]> {
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${endereco}"`)}`);
    const lista = await r.json();
    if ((lista.messages ?? []).length > 0) {
      const textos: string[] = [];
      for (const m of lista.messages) {
        const d = await (await fetch(`${mailpit}/api/v1/message/${m.ID}`)).json();
        textos.push(`${d.Text ?? ""}\n${d.HTML ?? ""}`);
      }
      return textos;
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return [];
}

/** O link do e-mail leva a /painel/convites (redirect_to codificado na URL). */
function levaAosConvites(texto: string): boolean {
  const t = texto.replace(/&amp;/g, "&");
  return t.includes("redirect_to=http%3A%2F%2F127.0.0.1%3A3000%2Fpainel%2Fconvites") ||
    t.includes("redirect_to=http://127.0.0.1:3000/painel/convites");
}

Deno.test({
  name: "convidar-membro contra o Auth real: conta nova, não confirmada e confirmada, com o e-mail no Mailpit",
  ignore: !ativo,
  async fn() {
    const { c, token, academiaId } = await prepararDono("ramos");
    const deps = depsConvidar(c, "http://127.0.0.1:3000");
    async function convidar(endereco: string) {
      const r = await convidarMembro(
        pedido(token, { academia_id: academiaId, email: endereco, papel: "professor" }),
        deps,
      );
      return { status: r.status, corpo: await r.json() };
    }

    // Conta nova: o Auth cria e convida; fica marcada para definir senha.
    const novo = email("novo");
    const r1 = await convidar(novo);
    assertEquals(r1, { status: 200, corpo: { convite_id: r1.corpo.convite_id, email_enviado: true } });
    assertEquals((await usuarioPorEmail(c, novo))?.app_metadata?.definir_senha, true);
    assert(await envioConfirmado(c, r1.corpo.convite_id), "a reserva do envio foi confirmada");
    assert((await emailsPara(novo)).some(levaAosConvites), "o convite chegou com o link para /painel/convites");

    // Conta criada por outra pessoa e nunca confirmada: o banco derruba a
    // senha e as sessões dela.
    const ocupado = email("ocupado");
    const squat = await c.servico.auth.admin.createUser({
      email: ocupado,
      email_confirm: false,
      password: "senha-do-intruso-1",
    });
    if (squat.error) throw squat.error;
    const r2 = await convidar(ocupado);
    assertEquals(r2.corpo.email_enviado, true, JSON.stringify(r2));
    assert(await envioConfirmado(c, r2.corpo.convite_id), "a reserva do envio foi confirmada");
    const u2 = await usuarioPorEmail(c, ocupado);
    assertEquals(u2?.app_metadata?.definir_senha, true);
    assert((await emailsPara(ocupado)).some(levaAosConvites), "o link chegou à conta não confirmada");
    const confirma = await c.servico.auth.admin.updateUserById(u2!.id, { email_confirm: true });
    if (confirma.error) throw confirma.error;
    const entra = await novoAnon().auth.signInWithPassword({ email: ocupado, password: "senha-do-intruso-1" });
    assert(entra.error, "a senha de quem criou a conta com o e-mail alheio não vale mais");

    // Conta confirmada: só o link mágico, sem mexer na senha.
    const antigo = email("antigo");
    const conf = await c.servico.auth.admin.createUser({
      email: antigo,
      email_confirm: true,
      password: "senha-propria-1",
    });
    if (conf.error) throw conf.error;
    const r3 = await convidar(antigo);
    assertEquals(r3.corpo.email_enviado, true, JSON.stringify(r3));
    assert(await envioConfirmado(c, r3.corpo.convite_id));
    assert((await emailsPara(antigo)).some(levaAosConvites), "o link mágico chegou com o redirect certo");
    const propria = await novoAnon().auth.signInWithPassword({ email: antigo, password: "senha-propria-1" });
    assertEquals(propria.error, null, "a conta confirmada não tem a senha trocada pelo convite");
  },
});

Deno.test({
  name: "fluxo inteiro pelo runtime: gateway, convite, senha nova pelo link, aceite e acesso depois de renovar",
  ignore: !ativo,
  async fn() {
    const { token, academiaId } = await prepararDono("fluxo");
    const funcoes = `${url}/functions/v1`;

    // O gateway recusa sem token (verify_jwt) e a função sobe pelo runtime.
    const semToken = await fetch(`${funcoes}/convidar-membro`, { method: "POST", body: "{}" });
    await semToken.body?.cancel();
    assertEquals(semToken.status, 401, "o gateway exige o JWT");

    const convidado = email("convidado");
    const r = await fetch(`${funcoes}/convidar-membro`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ academia_id: academiaId, email: convidado, papel: "professor" }),
    });
    const corpo = await r.json();
    assertEquals([r.status, corpo.email_enviado], [200, true], JSON.stringify(corpo));

    // A pessoa abre o link que chegou no e-mail (Mailpit): o Auth confere o
    // token e redireciona para /painel/convites com a sessão no fragmento.
    const textos = await emailsPara(convidado);
    const achado = textos.map((x) =>
      x.replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)
    )
      .find((m) => m);
    assert(achado, "o e-mail do convite traz o link de verificação");
    const abre = await fetch(achado[0], { redirect: "manual" });
    await abre.body?.cancel();
    const destino = abre.headers.get("Location") ?? "";
    assert(destino.startsWith("http://127.0.0.1:3000/painel/convites"), `o link leva a /painel/convites (${destino})`);
    const fragmento = new URLSearchParams(destino.split("#")[1] ?? "");
    const acesso = fragmento.get("access_token");
    const renovacao = fragmento.get("refresh_token");
    assert(acesso && renovacao, "o redirect traz a sessão aberta pelo link");
    const cliente = novoAnon();
    const v = await cliente.auth.setSession({ access_token: acesso, refresh_token: renovacao });
    if (v.error || !v.data.session) throw v.error ?? new Error("sem sessão");

    // Define a senha nova pela concluir-senha, também pelo runtime.
    const s = await fetch(`${funcoes}/concluir-senha`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${v.data.session.access_token}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ senha: "senha-do-convidado-1" }),
    });
    assertEquals([s.status, await s.json()], [200, { ok: true }]);

    // Aceita com a sessão renovada e, depois do marco, lê a academia.
    const renovada = await cliente.auth.refreshSession({ refresh_token: v.data.session.refresh_token });
    if (renovada.error) throw renovada.error;
    const aceite = await cliente.rpc("aceitar_convite", { p_convite_id: corpo.convite_id });
    assertEquals(aceite.error, null, JSON.stringify(aceite.error));
    await new Promise((ok) => setTimeout(ok, 1500));
    const depois = await cliente.auth.refreshSession();
    if (depois.error) throw depois.error;
    const leitura = await cliente.from("academias").select("id").eq("id", academiaId);
    assertEquals(leitura.error, null);
    assertEquals(leitura.data?.length, 1, "com o token novo, o vínculo aceito vale");

    const login = await novoAnon().auth.signInWithPassword({ email: convidado, password: "senha-do-convidado-1" });
    assertEquals(login.error, null, "a senha definida pela concluir-senha vale no login");
  },
});

Deno.test({
  name: "duas academias convidam a mesma conta não confirmada: o segundo envio é suprimido e o primeiro link vale",
  ignore: !ativo,
  async fn() {
    const a = await prepararDono("acad-a");
    const b = await prepararDono("acad-b");
    const deps = depsConvidar(a.c, "http://127.0.0.1:3000");
    const ocupado = email("disputado");
    const squat = await a.c.servico.auth.admin.createUser({
      email: ocupado,
      email_confirm: false,
      password: "senha-do-intruso-2",
    });
    if (squat.error) throw squat.error;

    async function convidar(token: string, academiaId: string) {
      const r = await convidarMembro(
        pedido(token, { academia_id: academiaId, email: ocupado, papel: "professor" }),
        deps,
      );
      return await r.json();
    }
    const r1 = await convidar(a.token, a.academiaId);
    assertEquals(r1.email_enviado, true, JSON.stringify(r1));
    const primeiro = await emailsPara(ocupado);
    assertEquals(primeiro.length, 1);

    // Dentro do intervalo de 60 s do endereço: a segunda academia grava o
    // convite sem envio, e a resposta é a mesma de um envio.
    const r2 = await convidar(b.token, b.academiaId);
    assertEquals(r2.email_enviado, true, JSON.stringify(r2));
    await new Promise((ok) => setTimeout(ok, 1000));
    assertEquals((await emailsPara(ocupado)).length, 1, "o segundo envio foi suprimido");

    // O link do primeiro e-mail, aberto depois do segundo pedido, ainda vale.
    const achado = primeiro[0].replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
    assert(achado, "o e-mail traz o link de verificação");
    const abre = await fetch(achado[0], { redirect: "manual" });
    await abre.body?.cancel();
    const destino = abre.headers.get("Location") ?? "";
    assert(destino.includes("access_token="), `o primeiro link abre a sessão (${destino.replace(/#.*/, "#...")})`);
  },
});
