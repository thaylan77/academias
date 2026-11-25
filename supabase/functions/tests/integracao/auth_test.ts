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

Deno.test({
  name: "convidar-membro contra o Auth real: conta nova, não confirmada e confirmada",
  ignore: !ativo,
  async fn() {
    const c = clientesDoAmbiente();
    const deps = depsConvidar(c, "http://127.0.0.1:3000");

    // Dono com academia em trial.
    const enderecoDono = email("dono");
    const dono = await c.servico.auth.admin.createUser({
      email: enderecoDono,
      email_confirm: true,
      password: "senha-do-dono-1",
    });
    if (dono.error) throw dono.error;
    const clienteDono = novoAnon();
    const login = await clienteDono.auth.signInWithPassword({ email: enderecoDono, password: "senha-do-dono-1" });
    if (login.error) throw login.error;
    const acad = await clienteDono.rpc("criar_academia", {
      p_nome: "Integração " + sufixo,
      p_slug: "integracao-" + sufixo,
    });
    if (acad.error) throw acad.error;
    const token = login.data.session!.access_token;

    async function convidar(endereco: string) {
      const r = await convidarMembro(
        pedido(token, { academia_id: acad.data, email: endereco, papel: "professor" }),
        deps,
      );
      return { status: r.status, corpo: await r.json() };
    }
    async function usuarioPorEmail(endereco: string) {
      const { data, error } = await c.servico.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      return data.users.find((u) => u.email === endereco) ?? null;
    }
    async function envioConfirmado(conviteId: string) {
      const { data, error } = await c.servico.from("convites_envios").select("enviado_em").eq("convite_id", conviteId);
      if (error) throw error;
      return data.some((v) => v.enviado_em !== null);
    }

    // Conta nova: o Auth cria e convida; fica marcada para definir senha.
    const novo = email("novo");
    const r1 = await convidar(novo);
    assertEquals(r1, { status: 200, corpo: { convite_id: r1.corpo.convite_id, email_enviado: true } });
    assertEquals((await usuarioPorEmail(novo))?.app_metadata?.definir_senha, true);
    assert(await envioConfirmado(r1.corpo.convite_id), "a reserva do envio foi confirmada");

    // Conta criada por outra pessoa e nunca confirmada: a senha dela cai.
    const ocupado = email("ocupado");
    const squat = await c.servico.auth.admin.createUser({
      email: ocupado,
      email_confirm: false,
      password: "senha-do-intruso-1",
    });
    if (squat.error) throw squat.error;
    const r2 = await convidar(ocupado);
    assertEquals(r2.corpo.email_enviado, true, JSON.stringify(r2));
    const u2 = await usuarioPorEmail(ocupado);
    assertEquals(u2?.app_metadata?.definir_senha, true);
    const intruso = await c.servico.auth.admin.updateUserById(u2!.id, { email_confirm: true });
    if (intruso.error) throw intruso.error;
    const entra = await novoAnon().auth.signInWithPassword({ email: ocupado, password: "senha-do-intruso-1" });
    assert(entra.error, "a senha de quem criou a conta com o e-mail alheio não vale mais");

    // Conta confirmada: só o link mágico.
    const antigo = email("antigo");
    const conf = await c.servico.auth.admin.createUser({
      email: antigo,
      email_confirm: true,
      password: "senha-propria-1",
    });
    if (conf.error) throw conf.error;
    const r3 = await convidar(antigo);
    assertEquals(r3.corpo.email_enviado, true, JSON.stringify(r3));
    assert(await envioConfirmado(r3.corpo.convite_id));
    const propria = await novoAnon().auth.signInWithPassword({ email: antigo, password: "senha-propria-1" });
    assertEquals(propria.error, null, "a conta confirmada não tem a senha trocada pelo convite");
  },
});
