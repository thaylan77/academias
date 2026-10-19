import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PainelApp } from "../pages/painel/painel-app";
import * as painel from "../lib/painel";
import { AcademiaDoMembro } from "../lib/painel";

const A: AcademiaDoMembro = { academia_id: "a", nome: "Academia Alpha", slug: "alpha", papel: "dono", ativa: true, fuso: "America/Fortaleza" };
const B: AcademiaDoMembro = { academia_id: "b", nome: "Academia Beta", slug: "beta", papel: "professor", ativa: false, fuso: "America/Fortaleza" };

function abrir(caminho: string) {
  window.history.pushState({}, "", caminho);
}

describe("Painel da equipe: entrada e escolha de academia", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    abrir("/painel");
  });

  it("sem sessão, mostra o login; login sem academia mostra a recusa", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([]);
    vi.spyOn(painel, "entrarNoPainel").mockResolvedValue({
      sucesso: false,
      mensagem: "Este login não faz parte da equipe de nenhuma academia.",
    });
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "x@a.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Este login não faz parte da equipe de nenhuma academia.")
    );
  });

  it("com uma academia só, entra direto e a URL ganha o slug", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/alpha");
    expect(screen.queryByText(/Trocar de academia/)).not.toBeInTheDocument();
  });

  it("com várias, pergunta; a escolha fica guardada para a próxima vez", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A, B]);
    const { unmount } = render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Em qual academia você quer entrar?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Academia Beta/ }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/beta");
    unmount();

    // Voltando ao painel sem slug, abre a guardada.
    abrir("/painel");
    render(<PainelApp />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
  });

  it("login pelo formulário repassa e-mail e senha e abre a academia", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([]);
    const entrar = vi
      .spyOn(painel, "entrarNoPainel")
      .mockResolvedValue({ sucesso: true, academias: [A], usuarioId: "user-a" });
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "  dono@a.test " } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    expect(entrar).toHaveBeenCalledWith("dono@a.test", "segredo", expect.anything());
    expect(window.location.pathname).toBe("/painel/alpha");
  });

  it("troca de academia sem sair, inclusive entrando pela guardada em /painel", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A, B]);
    localStorage.setItem("honorteam.painel.academia", "alpha");
    abrir("/painel");
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/alpha");
    fireEvent.click(screen.getByRole("button", { name: /Trocar de academia/ }));

    await waitFor(() => expect(screen.getByText("Em qual academia você quer entrar?")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/painel");
    expect(localStorage.getItem("honorteam.painel.academia")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Academia Beta/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/beta");
    expect(localStorage.getItem("honorteam.painel.academia")).toBe("beta");
    expect(screen.getByText(/Você entrou como/)).toHaveTextContent("Professor");
  });

  it("usuário da academia A não abre o painel da B trocando a URL", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    abrir("/painel/beta");
    render(<PainelApp />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Você não faz parte da equipe da academia beta")
    );
    expect(screen.queryByRole("navigation", { name: "Menu do painel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver minhas academias" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    expect(window.location.pathname).toBe("/painel/alpha");
  });

  it("academia suspensa ou com teste vencido mostra o aviso de só leitura", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([B]);
    render(<PainelApp />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Você pode consultar os dados, mas não alterar")
    );
  });

  it("o menu mostra só o que o papel pode ver; seção proibida pela URL cai no início", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([B]);
    abrir("/painel/beta/cobrancas");
    render(<PainelApp />);

    const menu = await screen.findByRole("navigation", { name: "Menu do painel" });
    const itens = within(menu).getAllByRole("link").map((l) => l.textContent);
    expect(itens).toEqual(["Início", "Alunos", "Turmas", "Graduações"]);
    expect(within(menu).getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
    // A seção de cobranças não chega a montar (a URL cai no início).
    expect(await screen.findByText("Escolha uma seção no menu.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cobranças" })).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/painel/beta"));
  });

  it("voltar do navegador muda a seção na tela", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    abrir("/painel/alpha/alunos");
    render(<PainelApp />);

    const menu = await screen.findByRole("navigation", { name: "Menu do painel" });
    fireEvent.click(within(menu).getByRole("link", { name: "Turmas" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Turmas" })).toBeInTheDocument());

    window.history.pushState({}, "", "/painel/alpha/alunos");
    fireEvent(window, new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Alunos" })).toBeInTheDocument());
  });

  it("Ctrl+clique no menu fica com o navegador (nova aba), sem navegar aqui", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    abrir("/painel/alpha");
    render(<PainelApp />);

    const menu = await screen.findByRole("navigation", { name: "Menu do painel" });
    const turmas = within(menu).getByRole("link", { name: "Turmas" });
    expect(turmas).toHaveAttribute("href", "/painel/alpha/turmas");
    // Depois do React: anota se o painel cancelou o clique e impede o jsdom de navegar.
    let canceladoPeloPainel: boolean | null = null;
    const depois = (e: Event) => {
      canceladoPeloPainel = e.defaultPrevented;
      e.preventDefault();
    };
    window.addEventListener("click", depois);
    fireEvent.click(turmas, { ctrlKey: true });
    window.removeEventListener("click", depois);
    expect(canceladoPeloPainel).toBe(false);
    expect(window.location.pathname).toBe("/painel/alpha");
  });

  it("se a sessão pode ter ficado guardada, não finge que saiu: esconde a academia e pede nova tentativa", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    const sair = vi.spyOn(painel, "sairDoPainel").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    localStorage.setItem("honorteam.painel.academia", "alpha");
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sair/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível encerrar a sessão neste aparelho")
    );
    expect(screen.queryByText("Painel da equipe")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu do painel" })).not.toBeInTheDocument();
    expect(localStorage.getItem("honorteam.painel.academia")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tentar sair de novo" }));
    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    expect(sair).toHaveBeenCalledTimes(2);
  });

  it("sessão guardada que não deu para confirmar: sem dados nem formulário; tenta de novo ou sai", async () => {
    const listar = vi
      .spyOn(painel, "listarMinhasAcademias")
      .mockRejectedValueOnce(Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError" }))
      .mockResolvedValueOnce([A]);
    render(<PainelApp />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível confirmar a sua sessão")
    );
    expect(screen.queryByText("Painel da equipe")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Menu do painel" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("sessão que não deu para confirmar: 'Sair deste aparelho' encerra (ou avisa que não conseguiu)", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockRejectedValue(new Error("Failed to fetch"));
    const sair = vi.spyOn(painel, "sairDoPainel").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Sair deste aparelho" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Sair deste aparelho" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível encerrar a sessão neste aparelho")
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar sair de novo" }));
    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    expect(sair).toHaveBeenCalledTimes(2);
  });

  it("saída em outra aba leva esta aba ao login", async () => {
    let avisar: (id: string | null) => void = () => {};
    vi.spyOn(painel, "observarSessao").mockImplementation((cb) => {
      avisar = cb;
      cb("user-a");
      return () => {};
    });
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    act(() => avisar(null));
    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();
  });

  it("troca de usuário em outra aba recarrega academias e papel; resposta atrasada do anterior é descartada", async () => {
    let avisar: (id: string | null) => void = () => {};
    vi.spyOn(painel, "observarSessao").mockImplementation((cb) => {
      avisar = cb;
      cb("dono-a");
      return () => {};
    });
    let soltarAntiga: (v: AcademiaDoMembro[]) => void = () => {};
    vi.spyOn(painel, "listarMinhasAcademias")
      .mockImplementationOnce(() => new Promise((r) => (soltarAntiga = r)))
      .mockResolvedValueOnce([B]);
    render(<PainelApp />);

    // Carga do dono ainda pendente quando o login troca para o professor.
    act(() => avisar("professor-b"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());

    await act(async () => soltarAntiga([A]));
    expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();
    const menu = screen.getByRole("navigation", { name: "Menu do painel" });
    expect(within(menu).queryByRole("link", { name: "Cobranças" })).not.toBeInTheDocument();
  });

  describe("login pelo formulário ainda pendente quando a sessão muda", () => {
    // Imita entrarNoPainel: consulta os vínculos (pendente até `concluirA`),
    // pergunta se pode gravar a sessão, grava (avisando SIGNED_IN) e confere de novo.
    async function comLoginPendente() {
      let avisar: (id: string | null) => void = () => {};
      vi.spyOn(painel, "observarSessao").mockImplementation((cb) => {
        avisar = cb;
        cb(null);
        return () => {};
      });
      const listar = vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([]);
      const gravadas: string[] = [];
      let concluirA: () => Promise<void> = async () => {};
      vi.spyOn(painel, "entrarNoPainel").mockImplementation(
        (_email, _senha, controle) =>
          new Promise((resolve) => {
            concluirA = async () => {
              const mudou = { sucesso: false as const, mensagem: "A sessão deste navegador mudou em outra aba. Entre de novo." };
              if (!controle!.podePublicar("dono-a")) return resolve(mudou);
              gravadas.push("dono-a");
              avisar("dono-a"); // SIGNED_IN da própria gravação
              resolve(controle!.continuaValida() ? { sucesso: true, academias: [A], usuarioId: "dono-a" } : mudou);
            };
          })
      );
      render(<PainelApp />);

      await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "dono@a.test" } });
      fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha" } });
      fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Entrando..." })).toBeInTheDocument());
      return { avisar: (id: string | null) => act(() => avisar(id)), listar, gravadas, concluirA: () => act(concluirA) };
    }

    it("B entra e sai em outra aba: a tentativa de A não grava a sessão nem mostra academias", async () => {
      const { avisar, gravadas, concluirA } = await comLoginPendente();

      avisar("professor-b");
      avisar(null);
      await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
      await concluirA();

      expect(gravadas).toEqual([]);
      expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();
    });

    it("B entra em outra aba: A não grava por cima de B, e a tela mostra B", async () => {
      const { avisar, listar, gravadas, concluirA } = await comLoginPendente();
      listar.mockResolvedValue([B]);

      avisar("professor-b");
      await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
      await concluirA();

      expect(gravadas).toEqual([]);
      expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Academia Alpha" })).not.toBeInTheDocument();
    });

    it("B entra e a consulta de A termina no mesmo tique (antes da recarga): A não grava", async () => {
      const { avisar, listar, gravadas, concluirA } = await comLoginPendente();
      listar.mockResolvedValue([B]);

      avisar("professor-b");
      await concluirA(); // sem esperar o setTimeout da recarga

      expect(gravadas).toEqual([]);
      // Deixa a recarga de B terminar aqui, sem vazar para o próximo teste.
      await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Beta" })).toBeInTheDocument());
    });

    it("sem mudança: grava, e o SIGNED_IN da própria tentativa não recarrega nem descarta", async () => {
      const { listar, gravadas, concluirA } = await comLoginPendente();

      await concluirA();

      expect(gravadas).toEqual(["dono-a"]);
      await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
      expect(listar).toHaveBeenCalledTimes(1); // só a carga inicial
    });
  });

  it("tentativa que gravou a sessão e não conseguiu desfazê-la vai para 'Tentar sair de novo'", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([]);
    vi.spyOn(painel, "entrarNoPainel").mockResolvedValue({
      sucesso: false,
      mensagem: "A sessão deste navegador mudou em outra aba. Entre de novo.",
      sessaoPodeTerFicado: true,
    });
    const sair = vi.spyOn(painel, "sairDoPainel").mockResolvedValue(true);
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "x@a.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível encerrar a sessão neste aparelho")
    );
    expect(screen.queryByText("Painel da equipe")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar sair de novo" }));
    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    expect(sair).toHaveBeenCalledTimes(1);
  });

  it("recusa do formulário mostra a mensagem", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([]);
    vi.spyOn(painel, "entrarNoPainel").mockResolvedValue({
      sucesso: false,
      mensagem: "Este login não faz parte da equipe de nenhuma academia.",
    });
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "totem@a.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "senha" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Este login não faz parte da equipe de nenhuma academia.")
    );
  });

  it("navega pelo menu e a URL acompanha", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A]);
    abrir("/painel/alpha");
    render(<PainelApp />);

    const menu = await screen.findByRole("navigation", { name: "Menu do painel" });
    fireEvent.click(within(menu).getByRole("link", { name: "Turmas" }));
    await waitFor(() => expect(window.location.pathname).toBe("/painel/alpha/turmas"));
    expect(await screen.findByRole("heading", { name: "Turmas" })).toBeInTheDocument();
  });

  it("sair volta ao login e esquece a escolha", async () => {
    vi.spyOn(painel, "listarMinhasAcademias").mockResolvedValue([A, B]);
    const sair = vi.spyOn(painel, "sairDoPainel").mockResolvedValue(true);
    localStorage.setItem("honorteam.painel.academia", "alpha");
    render(<PainelApp />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Academia Alpha" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sair/ }));

    await waitFor(() => expect(screen.getByText("Painel da equipe")).toBeInTheDocument());
    expect(sair).toHaveBeenCalled();
    expect(localStorage.getItem("honorteam.painel.academia")).toBeNull();
    expect(window.location.pathname).toBe("/painel");
  });
});
