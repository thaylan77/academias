// Utilidades HTTP comuns às Edge Functions: CORS, respostas JSON, token do
// pedido e leitura das claims de um JWT já validado pelo Auth.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Resposta de erro só com o código estável (o front decide pelo hint). */
export function erro(status: number, hint: string): Response {
  return json(status, { erro: hint });
}

/** Token do cabeçalho Authorization ("Bearer <jwt>"), ou null. */
export function tokenDoPedido(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

export interface Claims {
  iat: number | null;
  sessao: string | null;
  amr: { method: string; timestamp?: number }[];
}

/**
 * Lê as claims do payload de um JWT. Só use depois de o Auth validar o mesmo
 * token (auth.getUser): aqui não há conferência de assinatura.
 */
export function claimsDoToken(jwt: string): Claims {
  const partes = jwt.split(".");
  if (partes.length !== 3) return { iat: null, sessao: null, amr: [] };
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const preenchido = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(preenchido), (c) => c.charCodeAt(0))));
    return {
      iat: typeof p.iat === "number" ? Math.floor(p.iat) : null,
      sessao: typeof p.session_id === "string" ? p.session_id : null,
      amr: Array.isArray(p.amr) ? p.amr : [],
    };
  } catch {
    return { iat: null, sessao: null, amr: [] };
  }
}

/** E-mail para log: só a primeira letra do usuário e o domínio. */
export function emailMascarado(email: string): string {
  const [usuario, dominio] = email.split("@");
  if (!dominio) return "***";
  return `${usuario.slice(0, 1)}***@${dominio}`;
}

/** Hint de um erro do PostgREST (RPC), ou null. */
export function hintDoErro(e: unknown): string | null {
  if (e && typeof e === "object" && "hint" in e) {
    const h = (e as { hint?: unknown }).hint;
    if (typeof h === "string" && /^[a-z_]+$/.test(h)) return h;
  }
  return null;
}
