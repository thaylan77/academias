import { describe, it, expect, afterEach, vi } from "vitest";
import { normalizarEmail } from "../lib/portal";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

function clienteFalso() {
  return {
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(),
      signInWithOtp: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  };
}

async function carregarComCliente(cliente: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(cliente);
  return import("../lib/portal");
}

describe("Portal do aluno: acesso", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("e-mail: sem espaços, em minúsculas; inválido vira null", () => {
    expect(normalizarEmail("  Maria@Exemplo.COM ")).toBe("maria@exemplo.com");
    expect(normalizarEmail("maria@")).toBeNull();
    expect(normalizarEmail("")).toBeNull();
  });

  it("link: volta para a página do QR e cria o login se ainda não existe", async () => {
    const cliente = clienteFalso();
    cliente.auth.signInWithOtp.mockResolvedValue({ error: null });
    const lib = await carregarComCliente(cliente);
    expect(await lib.enviarLinkDeAcesso("ana@x.test", "https://app/academia/checkin?turma=t1&t=abc")).toEqual({ sucesso: true });
    expect(cliente.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "ana@x.test",
      options: { emailRedirectTo: "https://app/academia/checkin?turma=t1&t=abc", shouldCreateUser: true },
    });
  });

  it("link recusado: limite pelo status 429; o resto, mensagem genérica (nunca o texto do servidor)", async () => {
    const cliente = clienteFalso();
    cliente.auth.signInWithOtp
      .mockResolvedValueOnce({ error: { status: 429, message: "qualquer coisa" } })
      .mockResolvedValueOnce({ error: { status: 400, message: "Email rate limit exceeded" } });
    const lib = await carregarComCliente(cliente);
    const limite = await lib.enviarLinkDeAcesso("ana@x.test", "u");
    expect(limite.sucesso ? "" : limite.mensagem).toContain("Espere um minuto");
    const outro = await lib.enviarLinkDeAcesso("ana@x.test", "u");
    expect(outro.sucesso ? "" : outro.mensagem).toContain("Não foi possível enviar o link");
  });

  it("vínculo: devolve quantos ligou; recusa decidida pelo hint", async () => {
    const cliente = clienteFalso();
    cliente.rpc
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: null, error: { hint: "email_nao_confirmado", message: "x" } })
      .mockResolvedValueOnce({ data: null, error: { hint: null, message: "Confirme seu e-mail" } });
    const lib = await carregarComCliente(cliente);
    expect(await lib.vincularCadastro()).toEqual({ sucesso: true, ligados: 2 });
    expect(cliente.rpc).toHaveBeenCalledWith("vincular_meu_cadastro_aluno");
    const naoConfirmado = await lib.vincularCadastro();
    expect(naoConfirmado.sucesso ? "" : naoConfirmado.mensagem).toContain("Confirme o e-mail");
    const semHint = await lib.vincularCadastro();
    expect(semHint.sucesso ? "" : semHint.mensagem).toContain("Não foi possível ligar");
  });

  it("sessão e saída: e-mail do login; sai só neste aparelho", async () => {
    const cliente = clienteFalso();
    cliente.auth.getSession.mockResolvedValue({ data: { session: { user: { email: "ana@x.test" } } }, error: null });
    cliente.auth.signOut.mockResolvedValue({ error: null });
    const lib = await carregarComCliente(cliente);
    expect(await lib.emailDaSessao()).toBe("ana@x.test");
    expect(await lib.sairDoPortal()).toBe(true);
    expect(cliente.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
