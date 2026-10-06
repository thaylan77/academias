import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TotemPage } from "../pages/checkin/totem-page";
import * as supabaseModule from "../lib/supabase";

describe("Tela de Totem (Proteção de Equipe e Token Rotativo)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await supabaseModule.logoutEquipe();
  });

  it("deve bloquear acesso público e exigir login da equipe", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Acesso ao Totem de Presença")).toBeInTheDocument();
    });

    expect(screen.getByText(/Uso Restrito • Equipe da Academia/i)).toBeInTheDocument();
    expect(screen.getByText("Entrar no Totem")).toBeInTheDocument();
  });

  it("deve autenticar membro da equipe e liberar a projeção do QR code", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });

    // Clica no atalho de dev para o usuário do seed
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText(/Totem Ativo • Quiosque do Tatame/i)).toBeInTheDocument();
      expect(screen.getAllByText(/CHECK-IN ABERTO/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Professor")).toBeInTheDocument();
    });

    // Verifica presença do botão de encerrar sessão
    expect(screen.getByText(/Encerrar Sessão/i)).toBeInTheDocument();
  });

  it("deve exibir mensagem neutra quando não houver nenhuma turma aberta", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([]);

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText(/Nenhuma turma com check-in aberto no momento/i)).toBeInTheDocument();
      expect(screen.getByText(/O check-in abre automaticamente minutos antes do início da aula/i)).toBeInTheDocument();
    });
  });

  it("deve permitir que o operador encerre a sessão do totem", async () => {
    render(<TotemPage slug="honor-demo-a" />);

    // Autentica
    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText(/Encerrar Sessão/i)).toBeInTheDocument();
    });

    // Encerra sessão
    fireEvent.click(screen.getByText(/Encerrar Sessão/i));

    // Volta para a tela de bloqueio
    await waitFor(() => {
      expect(screen.getByText("Acesso ao Totem de Presença")).toBeInTheDocument();
    });
  });

  it("deve exibir erro mapeado e pausar sincronização quando totem_turmas_agora falhar com academia_suspensa", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue({
      code: "P0001",
      hint: "academia_suspensa",
      message: "Acesso suspenso por mensalidade",
    });

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText("Acesso da academia suspenso")).toBeInTheDocument();
      expect(screen.getByText("A academia está com acesso suspenso temporariamente.")).toBeInTheDocument();
    });

    // Não deve exibir mensagem neutra nem o indicador de sincronização automática
    expect(screen.queryByText(/Nenhuma turma com check-in aberto no momento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sincronizando com o tatame automaticamente/i)).not.toBeInTheDocument();
    expect(screen.getByText("Tentar Reconectar")).toBeInTheDocument();
  });

  it("deve exibir erro mapeado quando totem_turmas_agora falhar com sem_permissao", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue({
      code: "P0001",
      hint: "sem_permissao",
      message: "Usuário não autorizado",
    });

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText("Este login não pode operar o totem.")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Nenhuma turma com check-in aberto no momento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sincronizando com o tatame automaticamente/i)).not.toBeInTheDocument();
  });

  it("não deve exibir QR Code com token vazio quando emitirTokenCheckin falhar para uma turma", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([
      {
        id: "turma-1",
        nome: "Jiu-Jitsu No-Gi",
        hora_inicio: "19:00",
        hora_fim: "20:00",
      },
    ]);

    vi.spyOn(supabaseModule, "emitirTokenCheckin").mockRejectedValue({
      code: "P0001",
      hint: "checkin_fora_do_horario",
      message: "Fora da janela da aula",
    });

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText("Jiu-Jitsu No-Gi")).toBeInTheDocument();
      expect(screen.getByText("Fora da Janela da Aula")).toBeInTheDocument();
    });

    // Não deve renderizar o QR code nem as instruções de escanear QR Code
    expect(screen.queryByText(/Aponte a câmera do seu celular para registrar sua presença no tatame/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Token rotativo ativo/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Tentando novo token no próximo ciclo/i)).toBeInTheDocument();
  });

  it("deve filtrar por academia_id em resolverPapelEquipe garantindo isolamento multi-tenant", async () => {
    const eqMock3 = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { papel: "admin" },
        error: null,
      }),
    });
    const eqMock2 = vi.fn().mockReturnValue({
      eq: eqMock3,
    });
    const eqMock1 = vi.fn().mockReturnValue({
      eq: eqMock2,
    });

    const fakeClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: eqMock1,
        }),
      }),
    };

    const papelResolvido = await supabaseModule.resolverPapelEquipe(
      fakeClient,
      "user-123",
      "acad-uuid-456",
      "professor"
    );

    expect(papelResolvido).toBe("admin");
    expect(fakeClient.from).toHaveBeenCalledWith("membros_academia");
    expect(eqMock1).toHaveBeenCalledWith("user_id", "user-123");
    expect(eqMock2).toHaveBeenCalledWith("ativo", true);
    expect(eqMock3).toHaveBeenCalledWith("academia_id", "acad-uuid-456");
  });

  it("deve tratar erro transitório de rede com feedback de 'reconectando' e espera crescente de 5s", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue(
      new Error("Failed to fetch")
    );

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText("Conexão Instável")).toBeInTheDocument();
      expect(screen.getByText(/Reconectando ao tatame/i)).toBeInTheDocument();
      expect(screen.getByText(/Reconectando em 5s/i)).toBeInTheDocument();
    });

    // Não deve bloquear com a tela de permissão nem academia suspensa
    expect(screen.queryByText("Acesso da academia suspenso")).not.toBeInTheDocument();
    expect(screen.queryByText("Este login não pode operar o totem.")).not.toBeInTheDocument();
    expect(screen.getByText("Reconectar Agora")).toBeInTheDocument();
  });

  it("deve recuperar a exibição de turmas após o restabelecimento da conexão de rede", async () => {
    // Primeiro ciclo falha por rede
    const mockObterTurmas = vi.spyOn(supabaseModule, "obterTurmasAbertasTotem")
      .mockRejectedValueOnce(new Error("NetworkError when attempting to fetch resource."));

    vi.spyOn(supabaseModule, "emitirTokenCheckin").mockResolvedValue({
      token: "tok-recuperado-123",
      expira_em: new Date(Date.now() + 30000).toISOString(),
      periodo_segundos: 30,
    });

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    // Confirma estado de oscilação / reconexão
    await waitFor(() => {
      expect(screen.getByText("Conexão Instável")).toBeInTheDocument();
    });

    // Agora a rede volta e retorna a turma aberta
    mockObterTurmas.mockResolvedValueOnce([
      {
        id: "turma-jj-01",
        nome: "Jiu-Jitsu Noturno",
        hora_inicio: "20:00",
        hora_fim: "21:00",
      },
    ]);

    // Dispara reconexão manual
    fireEvent.click(screen.getByText("Reconectar Agora"));

    // O totem se recupera sozinho e exibe a turma normalmente
    await waitFor(() => {
      expect(screen.getByText("Jiu-Jitsu Noturno")).toBeInTheDocument();
      expect(screen.getByText(/CHECK-IN ABERTO/i)).toBeInTheDocument();
      expect(screen.queryByText("Conexão Instável")).not.toBeInTheDocument();
    });
  });

  it("deve exibir aviso de checagem automática a cada 60s em erro permanente de academia suspensa", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue({
      code: "P0001",
      hint: "academia_suspensa",
      message: "Academia com assinatura suspensa",
    });

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    await waitFor(() => {
      expect(screen.getByText("Acesso da academia suspenso")).toBeInTheDocument();
      expect(screen.getByText(/Verificando novamente em 60s/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Tentar Reconectar")).toBeInTheDocument();
  });

  it("deve renovar a sessão e continuar sem logout quando o JWT expirar e refreshSession tiver sucesso", async () => {
    // 1ª chamada falha por JWT expirado (401), 2ª chamada pós-refresh tem sucesso
    const turmasMock = vi.spyOn(supabaseModule, "obterTurmasAbertasTotem")
      .mockRejectedValueOnce({
        status: 401,
        message: "JWT expired",
      })
      .mockResolvedValueOnce([
        {
          id: "turma-renovada-1",
          nome: "Muay Thai Noite",
          hora_inicio: "19:00",
          hora_fim: "20:00",
        },
      ]);

    vi.spyOn(supabaseModule, "emitirTokenCheckin").mockResolvedValue({
      token: "tok-renovado-123",
      expira_em: new Date(Date.now() + 30000).toISOString(),
      periodo_segundos: 30,
    });

    const renovarSpy = vi.spyOn(supabaseModule, "renovarSessao").mockResolvedValue({
      sucesso: true,
    });
    const logoutSpy = vi.spyOn(supabaseModule, "logoutEquipe");

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    // O totem renova o JWT, repete a chamada e continua operando sem logout
    await waitFor(() => {
      expect(screen.getByText("Muay Thai Noite")).toBeInTheDocument();
      expect(screen.getByText(/CHECK-IN ABERTO/i)).toBeInTheDocument();
    });

    expect(renovarSpy).toHaveBeenCalled();
    expect(turmasMock).toHaveBeenCalledTimes(2);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Sessão encerrada, faça login novamente.")).not.toBeInTheDocument();
    expect(screen.queryByText("Acesso ao Totem de Presença")).not.toBeInTheDocument();
  });

  it("deve encerrar a sessão e ir para a tela de login quando o JWT expirar e a renovação de sessão falhar", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue({
      status: 401,
      message: "JWT expired",
    });

    const renovarSpy = vi.spyOn(supabaseModule, "renovarSessao").mockResolvedValue({
      sucesso: false,
      erro: new Error("invalid_grant: refresh token expired"),
    });
    const logoutSpy = vi.spyOn(supabaseModule, "logoutEquipe");

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    // Como a renovação falhou, faz logout e volta para o login com a mensagem
    await waitFor(() => {
      expect(screen.getByText("Acesso ao Totem de Presença")).toBeInTheDocument();
      expect(screen.getByText("Sessão encerrada, faça login novamente.")).toBeInTheDocument();
    });

    expect(renovarSpy).toHaveBeenCalled();
    expect(logoutSpy).toHaveBeenCalled();
    expect(screen.queryByText(/Reconectando ao tatame/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reconectando em/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Verificando novamente em 60s/i)).not.toBeInTheDocument();
  });
});

