import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { slug, dados, captchaToken } = await req.json();

    if (!slug || !dados || !captchaToken) {
      return new Response(
        JSON.stringify({
          error: {
            hint: "dados_invalidos",
            message: "Faltam parâmetros obrigatórios ou o captcha não foi resolvido.",
          },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify Turnstile Token
    if (TURNSTILE_SECRET_KEY && TURNSTILE_SECRET_KEY !== "mock-secret-for-testing") {
      const formData = new FormData();
      formData.append("secret", TURNSTILE_SECRET_KEY);
      formData.append("response", captchaToken);

      const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
      const result = await fetch(url, {
        body: formData,
        method: "POST",
      });

      const outcome = await result.json();
      if (!outcome.success) {
        return new Response(
          JSON.stringify({
            error: {
              hint: "dados_invalidos",
              message: "Falha na verificação de segurança (Captcha).",
            },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (!TURNSTILE_SECRET_KEY) {
      return new Response(
        JSON.stringify({
          error: {
            hint: "dados_invalidos",
            message: "Erro de configuração do servidor: Captcha não configurado.",
          },
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
       console.log("Skipping Turnstile verify (DEV mode)");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabaseAdmin.rpc("matricula_online", {
      p_slug: slug,
      p_dados: dados,
    });

    if (error) {
      // The edge function should forward the exact error from Supabase RPC
      return new Response(
        JSON.stringify({ error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: {
          hint: "dados_invalidos",
          message: error.message || "Erro inesperado ao processar a matrícula.",
        },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
