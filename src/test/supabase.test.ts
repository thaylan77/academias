import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("emitirTokenCheckin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // As variáveis simuladas não podem vazar para outros testes.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("deve retornar mock em ambiente DEV sem supabase configurado", async () => {
    // Save original env
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');

    // Dynamically import to get the new env variables
    const { emitirTokenCheckin } = await import("../lib/supabase");

    const resultado = await emitirTokenCheckin("turma-123");

    expect(resultado).not.toBeNull();
    expect(resultado?.token).toMatch(/^tok_[a-z0-9]+$/);
    expect(resultado?.periodo_segundos).toBe(30);
    expect(resultado?.expira_em).toBeDefined();

    const tempoExpira = new Date(resultado!.expira_em).getTime();
    const tempoAtual = Date.now();

    expect(tempoExpira).toBeGreaterThan(tempoAtual);
    expect(tempoExpira - tempoAtual).toBeLessThanOrEqual(30000);
  });

  it("deve chamar supabase.rpc e retornar data quando o supabase estiver configurado", async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://test.com');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

    const { emitirTokenCheckin, supabase } = await import("../lib/supabase");

    const mockData = {
      token: "tok_rpc_123",
      expira_em: new Date(Date.now() + 30000).toISOString(),
      periodo_segundos: 30,
    };

    // Sem cliente, a função cairia no token simulado e o teste passaria sem testar nada.
    if (!supabase) throw new Error("o cliente Supabase deveria existir com as variáveis definidas");
    supabase.rpc = vi.fn().mockResolvedValue({ data: mockData, error: null });

    const resultado = await emitirTokenCheckin("turma-123");

    expect(resultado).toEqual(mockData);
    expect(supabase.rpc).toHaveBeenCalledWith("emitir_token_checkin", {
      p_turma_id: "turma-123"
    });
  });

  it("deve lançar erro se supabase.rpc retornar erro", async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://test.com');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

    const { emitirTokenCheckin, supabase } = await import("../lib/supabase");

    // Erro no formato do PostgREST: objeto com o código de negócio no hint.
    const mockError = {
      message: "Fora da janela da aula",
      code: "P0001",
      hint: "checkin_fora_do_horario",
      details: "",
    };

    if (!supabase) throw new Error("o cliente Supabase deveria existir com as variáveis definidas");
    supabase.rpc = vi.fn().mockResolvedValue({ data: null, error: mockError });

    // O erro sobe como veio, com o hint, para quem chama decidir por ele.
    await expect(emitirTokenCheckin("turma-123")).rejects.toMatchObject({ hint: "checkin_fora_do_horario" });
  });
});
