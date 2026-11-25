// Liga as dependências das funções ao Supabase de verdade. A service_role
// só existe aqui, no servidor (variável de ambiente da função).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DepsConvidar, ErroAuth } from "./convidar.ts";
import type { DepsSenha } from "./senha.ts";

function variavel(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`variável de ambiente ausente: ${nome}`);
  return v;
}

export interface Clientes {
  servico: SupabaseClient;
  publico: SupabaseClient;
}

export function clientesDoAmbiente(): Clientes {
  const url = variavel("SUPABASE_URL");
  const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    servico: createClient(url, variavel("SUPABASE_SERVICE_ROLE_KEY"), opcoes),
    publico: createClient(url, variavel("SUPABASE_ANON_KEY"), opcoes),
  };
}

function erroAuth(e: { status?: number; message?: string } | null): ErroAuth | null {
  return e ? { status: e.status, message: e.message } : null;
}

export function depsBase(c: Clientes) {
  return {
    async usuarioDoToken(jwt: string): Promise<string | null> {
      const { data, error } = await c.servico.auth.getUser(jwt);
      // 4xx: o Auth recusou o token. 5xx ou rede: falha do Auth, não do
      // token (vira erro_interno, e o front não encerra a sessão por isso).
      if (error) {
        if (error.status !== undefined && error.status >= 400 && error.status < 500) return null;
        throw new Error("Auth indisponível");
      }
      return data.user?.id ?? null;
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      const { data, error } = await c.servico.rpc(nome, args);
      return { data, error };
    },
    log(msg: string) {
      console.log(msg);
    },
  };
}

export function depsConvidar(c: Clientes, siteUrl: string): DepsConvidar {
  return {
    ...depsBase(c),
    siteUrl,
    async convidarPorEmail(email, redirectTo) {
      const { data, error } = await c.servico.auth.admin.inviteUserByEmail(email, { redirectTo });
      return { userId: data?.user?.id ?? null, erro: erroAuth(error) };
    },
    async marcarDefinirSenha(userId) {
      const { error } = await c.servico.auth.admin.updateUserById(userId, { app_metadata: { definir_senha: true } });
      return erroAuth(error);
    },
    async enviarLinkMagico(email, redirectTo) {
      const { error } = await c.publico.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      return erroAuth(error);
    },
  };
}

export function depsSenha(c: Clientes): DepsSenha {
  return depsBase(c);
}
