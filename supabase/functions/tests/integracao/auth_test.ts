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

    // Conta comum, mesmo entrando por link: sem convite, não troca a senha
    // por aqui (troca pelo Auth).
    const semConvite = await concluirSenha(
      pedido(sessao.access_token, { senha: "senha-nova-do-convite" }),
      depsSenha(c),
    );
    assertEquals([semConvite.status, await semConvite.json()], [400, { erro: "convite_invalido" }]);
    const intacta = await novoAnon().auth.signInWithPassword({ email: endereco, password: "senha-antiga-123" });
    assertEquals(intacta.error, null, "sem convite, a senha da conta não muda");

    // Com um convite pendente para o e-mail, a mesma sessão define a senha.
    const dono = await prepararDono("dono-senha");
    const convite = await convidarMembro(
      pedido(dono.token, { academia_id: dono.academiaId, email: endereco, papel: "professor" }),
      depsConvidar(dono.c, "http://127.0.0.1:3000"),
    );
    assertEquals(convite.status, 200, await convite.clone().text());
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
    assertEquals(r1, { status: 200, corpo: { convite_id: r1.corpo.convite_id } });
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
    assertEquals(r2.status, 200, JSON.stringify(r2));
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
    assertEquals(r3.status, 200, JSON.stringify(r3));
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
    assertEquals([r.status, typeof corpo.convite_id], [200, "string"], JSON.stringify(corpo));

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

    // Como no runtime: a primeira academia responde antes do envio. O Auth
    // emite e entrega o link, e o retorno ao handler fica retido até a
    // segunda academia convidar. A reserva ainda está em aberto nesse ponto.
    let soltar!: () => void;
    const retido = new Promise<void>((ok) => (soltar = ok));
    let envioA: Promise<void> = Promise.resolve();
    const depsA = {
      ...deps,
      async enviarLinkMagico(endereco: string, redirectTo: string) {
        // O Auth emite e manda o link de verdade; o retorno ao handler fica
        // retido, com a reserva ainda em aberto.
        const resultado = await deps.enviarLinkMagico(endereco, redirectTo);
        await retido;
        return resultado;
      },
      emSegundoPlano(tarefa: () => Promise<void>) {
        envioA = tarefa();
        return Promise.resolve();
      },
    };
    async function convidar(token: string, academiaId: string, d = deps) {
      const r = await convidarMembro(pedido(token, { academia_id: academiaId, email: ocupado, papel: "professor" }), d);
      return await r.json();
    }
    const r1 = await convidar(a.token, a.academiaId, depsA);
    assertEquals(typeof r1.convite_id, "string", JSON.stringify(r1));
    const reserva = await a.c.servico.from("convites_envios").select("enviado_em, liberado_em")
      .eq("convite_id", r1.convite_id);
    assertEquals(reserva.data, [{ enviado_em: null, liberado_em: null }], "a reserva do primeiro envio está em aberto");

    assertEquals((await emailsPara(ocupado)).length, 1, "o primeiro link já foi emitido e entregue");

    // Com a reserva em aberto, a segunda academia grava o convite sem envio,
    // e a resposta é a mesma.
    const r2 = await convidar(b.token, b.academiaId);
    assertEquals(typeof r2.convite_id, "string", JSON.stringify(r2));
    soltar();
    await envioA;
    const primeiro = await emailsPara(ocupado);
    assertEquals(primeiro.length, 1);
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

Deno.test({
  name: "endereço sem conta: o convite da segunda academia, suprimido, não invalida o link do primeiro",
  ignore: !ativo,
  async fn() {
    const a = await prepararDono("nova-a");
    const b = await prepararDono("nova-b");
    const novo = email("sem-conta");
    async function convidar(d: Awaited<ReturnType<typeof prepararDono>>) {
      const r = await convidarMembro(
        pedido(d.token, { academia_id: d.academiaId, email: novo, papel: "professor" }),
        depsConvidar(d.c, "http://127.0.0.1:3000"),
      );
      return { status: r.status, corpo: await r.json() };
    }

    // A primeira academia cria a conta pelo convite do Auth e manda o link.
    const r1 = await convidar(a);
    assertEquals(r1.status, 200, JSON.stringify(r1));
    const primeiro = await emailsPara(novo);
    assertEquals(primeiro.length, 1);

    // A segunda, dentro do intervalo do endereço: a conta aparece como não
    // confirmada, o envio é suprimido e a neutralização roda.
    const r2 = await convidar(b);
    assertEquals(r2.status, 200, JSON.stringify(r2));
    await new Promise((ok) => setTimeout(ok, 1000));
    assertEquals((await emailsPara(novo)).length, 1, "o segundo envio foi suprimido");

    // O link do convite da primeira academia ainda abre a sessão.
    const achado = primeiro[0].replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
    assert(achado, "o e-mail traz o link de verificação");
    const abre = await fetch(achado[0], { redirect: "manual" });
    await abre.body?.cancel();
    const destino = abre.headers.get("Location") ?? "";
    assert(destino.includes("access_token="), `o link do primeiro convite vale (${destino.replace(/#.*/, "#...")})`);
  },
});

Deno.test({
  name: "worker que cai antes de chamar o Auth: a reserva abandonada é liberada e o endereço volta a receber convite",
  ignore: !ativo,
  async fn() {
    const a = await prepararDono("cai-a");
    const b = await prepararDono("cai-b");
    const endereco = email("abandonado");

    // A primeira academia cria o convite e a reserva, mas o trabalho em
    // segundo plano nunca roda (o worker caiu).
    const depsCaiu = { ...depsConvidar(a.c, "http://127.0.0.1:3000"), emSegundoPlano: () => Promise.resolve() };
    const r1 = await convidarMembro(
      pedido(a.token, { academia_id: a.academiaId, email: endereco, papel: "professor" }),
      depsCaiu,
    );
    const { convite_id } = await r1.json();
    const reserva = await a.c.servico.from("convites_envios").select("id, tentativa_em").eq("convite_id", convite_id);
    assertEquals(reserva.data?.length, 1);
    assertEquals(reserva.data![0].tentativa_em, null, "nenhum worker assumiu a reserva");

    // Passados 2 minutos (aqui, a reserva envelhecida), o job a libera.
    const envelhece = await a.c.servico.from("convites_envios")
      .update({ reservado_em: new Date(Date.now() - 5 * 60_000).toISOString() }).eq("id", reserva.data![0].id);
    if (envelhece.error) throw envelhece.error;
    const job = await a.c.servico.rpc("liberar_reservas_abandonadas_interna");
    assertEquals([job.error, job.data], [null, 1]);

    // Outra academia convida o mesmo endereço e o e-mail sai.
    const r2 = await convidarMembro(
      pedido(b.token, { academia_id: b.academiaId, email: endereco, papel: "professor" }),
      depsConvidar(b.c, "http://127.0.0.1:3000"),
    );
    assertEquals(r2.status, 200, await r2.clone().text());
    assertEquals((await emailsPara(endereco)).length, 1, "o endereço voltou a receber convite");
  },
});

/** Código TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) para o segredo em base32. */
async function codigoTotp(segredo: string): Promise<string> {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of segredo.replace(/=+$/, "").toUpperCase()) bits += alfabeto.indexOf(ch).toString(2).padStart(5, "0");
  const chave = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < chave.length; i++) chave[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const contador = new ArrayBuffer(8);
  new DataView(contador).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", k, contador));
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

Deno.test({
  name: "cadastro com senha entre a reserva e o convite: a conta reaproveitada é neutralizada e sai um link novo",
  ignore: !ativo,
  async fn() {
    const a = await prepararDono("dono-cadastro-meio");
    const endereco = email("cadastro-meio");
    const base = depsConvidar(a.c, "http://127.0.0.1:3000");
    const deps = {
      ...base,
      async convidarPorEmail(e: string, redirectTo: string) {
        // Alguém se cadastra com senha depois da leitura de criar_convite_interna
        // e antes do convite do Auth, que reaproveita a conta não confirmada.
        const cadastro = await a.c.servico.auth.admin.createUser({
          email: e,
          email_confirm: false,
          password: "senha-do-cadastro-1",
        });
        if (cadastro.error) throw cadastro.error;
        return await base.convidarPorEmail(e, redirectTo);
      },
    };
    const r = await convidarMembro(
      pedido(a.token, { academia_id: a.academiaId, email: endereco, papel: "professor" }),
      deps,
    );
    assertEquals(r.status, 200, await r.clone().text());
    assertEquals((await emailsPara(endereco)).length >= 1, true, "o convite saiu");

    // Depois de confirmar o e-mail, a senha do cadastro concorrente não vale.
    const u = await usuarioPorEmail(a.c, endereco);
    assertEquals(u?.app_metadata?.definir_senha, true);
    const confirma = await a.c.servico.auth.admin.updateUserById(u!.id, { email_confirm: true });
    if (confirma.error) throw confirma.error;
    const entra = await novoAnon().auth.signInWithPassword({ email: endereco, password: "senha-do-cadastro-1" });
    assert(entra.error, "a senha do cadastro concorrente foi invalidada");
  },
});

Deno.test({
  name: "conta com MFA: concluir-senha recusa a sessão aal1 do link e aceita depois do segundo fator",
  ignore: !ativo,
  async fn() {
    const dono = await prepararDono("mfa-dono");
    const endereco = email("mfa");
    const conta = await dono.c.servico.auth.admin.createUser({
      email: endereco,
      email_confirm: true,
      password: "senha-com-mfa-1",
    });
    if (conta.error) throw conta.error;

    // A pessoa tem um fator TOTP verificado.
    const comSenha = novoAnon();
    const login = await comSenha.auth.signInWithPassword({ email: endereco, password: "senha-com-mfa-1" });
    if (login.error) throw login.error;
    const fator = await comSenha.auth.mfa.enroll({ factorType: "totp" });
    if (fator.error) throw fator.error;
    const ativa = await comSenha.auth.mfa.challengeAndVerify({
      factorId: fator.data.id,
      code: await codigoTotp(fator.data.totp.secret),
    });
    if (ativa.error) throw ativa.error;

    // Convite pendente para o e-mail e sessão aberta pelo link (aal1).
    const convite = await convidarMembro(
      pedido(dono.token, { academia_id: dono.academiaId, email: endereco, papel: "professor" }),
      depsConvidar(dono.c, "http://127.0.0.1:3000"),
    );
    assertEquals(convite.status, 200, await convite.clone().text());
    const { cliente, sessao } = await sessaoPorLink(dono.c.servico, endereco);
    const aal1 = await concluirSenha(pedido(sessao.access_token, { senha: "senha-nova-mfa-1" }), depsSenha(dono.c));
    assertEquals([aal1.status, await aal1.json()], [400, { erro: "mfa_necessario" }]);

    // Com o segundo fator na mesma sessão (aal2), a senha é definida.
    const segundo = await cliente.auth.mfa.challengeAndVerify({
      factorId: fator.data.id,
      code: await codigoTotp(fator.data.totp.secret),
    });
    if (segundo.error) throw segundo.error;
    const { data: atual } = await cliente.auth.getSession();
    const aal2 = await concluirSenha(
      pedido(atual.session!.access_token, { senha: "senha-nova-mfa-1" }),
      depsSenha(dono.c),
    );
    assertEquals([aal2.status, await aal2.json()], [200, { ok: true }]);
  },
});
