import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

// O portão só aparece com servidor: o cliente é trocado por um objeto qualquer.
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../lib/portal", async (original) => {
  const real = await original<typeof import("../lib/portal")>();
  return {
    normalizarEmail: real.normalizarEmail,
    emailDaSessao: vi.fn(),
    observarLogin: vi.fn(),
    enviarLinkDeAcesso: vi.fn(),
    vincularCadastro: vi.fn(),
    sairDoPortal: vi.fn(),
  };
});

import * as portal from "../lib/portal";
import { AcessoDoAluno } from "../pages/checkin/acesso-do-aluno";

const m = portal as unknown as Record<string, ReturnType<typeof vi.fn>>;
let avisarLogin: (email: string | null) => void = () => {};

function montar() {
  render(
    <AcessoDoAluno>
      <p>conteúdo do check-in</p>
    </AcessoDoAluno>
  );
}

describe("Portal do aluno: portão do check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.observarLogin.mockImplementation((cb: (email: string | null) => void) => {
      avisarLogin = cb;
      return () => {};
    });
    m.vincularCadastro.mockResolvedValue({ sucesso: true, ligados: 1 });
  });

  it("sem login: pede o e-mail, confere antes de enviar e manda o link de volta para esta página", async () => {
    m.emailDaSessao.mockResolvedValue(null);
    m.enviarLinkDeAcesso.mockResolvedValue({ sucesso: true });
    montar();

    const form = await screen.findByRole("form", { name: "Entrar" });
    expect(screen.queryByText("conteúdo do check-in")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@" } });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe um e-mail válido.");
    expect(m.enviarLinkDeAcesso).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: " Ana@X.test " } });
    fireEvent.submit(form);
    expect(await screen.findByText(/Link enviado para/)).toHaveTextContent("ana@x.test");
    expect(m.enviarLinkDeAcesso).toHaveBeenCalledWith("ana@x.test", window.location.href);
  });

  it("clique duplo envia um link só", async () => {
    m.emailDaSessao.mockResolvedValue(null);
    let soltar: (r: unknown) => void = () => {};
    m.enviarLinkDeAcesso.mockReturnValue(new Promise((r) => (soltar = r)));
    montar();
    const form = await screen.findByRole("form", { name: "Entrar" });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "ana@x.test" } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => soltar({ sucesso: true }));
    expect(m.enviarLinkDeAcesso).toHaveBeenCalledTimes(1);
  });

  it("recusa do envio aparece", async () => {
    m.emailDaSessao.mockResolvedValue(null);
    m.enviarLinkDeAcesso.mockResolvedValue({ sucesso: false, mensagem: "Muitos pedidos seguidos." });
    montar();
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "ana@x.test" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Muitos pedidos seguidos.");
  });

  it("com login: liga o cadastro uma vez e mostra o check-in, com quem entrou", async () => {
    m.emailDaSessao.mockResolvedValue("ana@x.test");
    montar();
    expect(await screen.findByText("conteúdo do check-in")).toBeInTheDocument();
    expect(screen.getByText("ana@x.test")).toBeInTheDocument();
    // O aviso do mesmo login (outra aba, renovação) não liga de novo.
    await act(async () => avisarLogin("ana@x.test"));
    expect(m.vincularCadastro).toHaveBeenCalledTimes(1);
  });

  it("voltou pelo link: o aviso de login liga e mostra o check-in", async () => {
    m.emailDaSessao.mockResolvedValue(null);
    montar();
    await screen.findByRole("form", { name: "Entrar" });
    await act(async () => avisarLogin("pai@x.test"));
    expect(await screen.findByText("conteúdo do check-in")).toBeInTheDocument();
    expect(m.vincularCadastro).toHaveBeenCalledTimes(1);
  });

  it("vínculo recusado: aviso, sem o check-in", async () => {
    m.emailDaSessao.mockResolvedValue("ana@x.test");
    m.vincularCadastro.mockResolvedValue({ sucesso: false, mensagem: "Confirme o e-mail pelo link que enviamos antes de continuar." });
    montar();
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirme o e-mail");
    expect(screen.queryByText("conteúdo do check-in")).not.toBeInTheDocument();
  });

  it("sair: volta ao pedido de link quando o login sai; falha avisa", async () => {
    m.emailDaSessao.mockResolvedValue("ana@x.test");
    m.sairDoPortal.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    montar();
    await screen.findByText("conteúdo do check-in");
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível sair");
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    await waitFor(() => expect(m.sairDoPortal).toHaveBeenCalledTimes(2));
    await act(async () => avisarLogin(null));
    expect(await screen.findByRole("form", { name: "Entrar" })).toBeInTheDocument();
  });
});
