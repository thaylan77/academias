import { describe, it, expect, vi, beforeEach } from "vitest";

describe("emitirTokenCheckin", () => {
  beforeEach(() => {
    vi.resetModules();
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

    if(supabase) {
        // mock rpc behavior
        supabase.rpc = vi.fn().mockResolvedValue({
            data: mockData,
            error: null
        });
    }

    const resultado = await emitirTokenCheckin("turma-123");

    expect(resultado).toEqual(mockData);
    expect(supabase?.rpc).toHaveBeenCalledWith("emitir_token_checkin", {
      p_turma_id: "turma-123"
    });
  });

  it("deve lançar erro se supabase.rpc retornar erro", async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://test.com');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

    const { emitirTokenCheckin, supabase } = await import("../lib/supabase");

    const mockError = new Error("RPC Error");

    if(supabase) {
        supabase.rpc = vi.fn().mockResolvedValue({
            data: null,
            error: mockError
        });
    }

    await expect(emitirTokenCheckin("turma-123")).rejects.toThrow("RPC Error");
  });
});
