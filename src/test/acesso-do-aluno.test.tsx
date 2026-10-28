import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

// O portão só aparece com servidor: o cliente é trocado por um objeto qualquer.
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../lib/portal", async (original) => {
  const real = await original<typeof import("../lib/portal")>();
  return {
    normalizarEmail: real.normalizarEmail,
    enderecoDeVolta: real.enderecoDeVolta,
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

  it("vínculo recusado: 'Tentar de novo' liga de novo e mostra o check-in", async () => {
    m.emailDaSessao.mockResolvedValue("ana@x.test");
    m.vincularCadastro
      .mockResolvedValueOnce({ sucesso: false, mensagem: "Não foi possível ligar seu cadastro agora." })
      .mockResolvedValueOnce({ sucesso: true, ligados: 1 });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("conteúdo do check-in")).toBeInTheDocument();
    expect(m.vincularCadastro).toHaveBeenCalledTimes(2);
  });

  it("troca de conta: o login novo é ligado e aparece", async () => {
    m.emailDaSessao.mockResolvedValue("ana@x.test");
    montar();
    await screen.findByText("conteúdo do check-in");
    await act(async () => avisarLogin("pai@x.test"));
    expect(await screen.findByText("pai@x.test")).toBeInTheDocument();
    expect(m.vincularCadastro).toHaveBeenCalledTimes(2);
  });

  it("sessão inicial falha depois que o aviso de login já trouxe alguém: não volta ao pedido de link", async () => {
    let falhar: (e: unknown) => void = () => {};
    m.emailDaSessao.mockReturnValue(new Promise((_, rej) => (falhar = rej)));
    montar();
    await act(async () => avisarLogin("ana@x.test"));
    await act(async () => falhar(new Error("rede")));
    expect(await screen.findByText("conteúdo do check-in")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Entrar" })).not.toBeInTheDocument();
  });

  it("sessão inicial falha sem ninguém: pede o link", async () => {
    m.emailDaSessao.mockRejectedValue(new Error("rede"));
    montar();
    expect(await screen.findByRole("form", { name: "Entrar" })).toBeInTheDocument();
  });

  it("'Usar outro e-mail' volta ao campo, com o foco nele", async () => {
    m.emailDaSessao.mockResolvedValue(null);
    m.enviarLinkDeAcesso.mockResolvedValue({ sucesso: true });
    montar();
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "ana@x.test" } });
    fireEvent.submit(screen.getByRole("form", { name: "Entrar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Usar outro e-mail" }));
    expect(await screen.findByLabelText("E-mail")).toHaveFocus();
  });

  it("sair: clique duplo sai uma vez só", async () => {
    m.emailDaSessao.mockResolvedValue("ana@x.test");
    let soltar: (v: boolean) => void = () => {};
    m.sairDoPortal.mockReturnValue(new Promise((res) => (soltar = res)));
    montar();
    await screen.findByText("conteúdo do check-in");
    const botao = screen.getByRole("button", { name: "Sair" });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await act(async () => soltar(true));
    expect(m.sairDoPortal).toHaveBeenCalledTimes(1);
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
