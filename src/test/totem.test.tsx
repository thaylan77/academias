import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TotemPage } from "../pages/checkin/totem-page";
import * as supabaseModule from "../lib/supabase";
import * as tokenCheckin from "../lib/token-checkin";

const TURMA_JUDO = { id: "turma-1", nome: "Judo Infantil", hora_inicio: "18:00", hora_fim: "19:00" };

// Abre o totem e entra com o atalho de desenvolvimento.
async function entrarNoTotem() {
  render(<TotemPage slug="honor-demo-a" />);
  await waitFor(() => {
    expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("Professor (Seed)"));
}

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

  it("deve preservar a sessão e acionar reconexão transitória quando o refresh falhar por erro de rede/503", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue({
      status: 401,
      message: "JWT expired",
    });

    const renovarSpy = vi.spyOn(supabaseModule, "renovarSessao").mockResolvedValue({
      sucesso: false,
      ehTransitorio: true,
      erro: { status: 503, message: "Service Unavailable" },
    });
    const logoutSpy = vi.spyOn(supabaseModule, "logoutEquipe");

    render(<TotemPage slug="honor-demo-a" />);

    await waitFor(() => {
      expect(screen.getByText("Professor (Seed)")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Professor (Seed)"));

    // O totem não desloga: detecta que a falha do refresh é transitória e entra em reconexão
    await waitFor(() => {
      expect(screen.getByText("Conexão Instável")).toBeInTheDocument();
      expect(screen.getByText(/Reconectando ao tatame/i)).toBeInTheDocument();
    });

    expect(renovarSpy).toHaveBeenCalled();
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Sessão encerrada, faça login novamente.")).not.toBeInTheDocument();
    expect(screen.queryByText("Acesso ao Totem de Presença")).not.toBeInTheDocument();
  });

  it("relógio do aparelho adiantado: token com expira_em no passado continua exibido", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([TURMA_JUDO]);

    // Para um aparelho com o relógio uma hora adiantado, o expira_em do banco já "passou".
    vi.spyOn(supabaseModule, "emitirTokenCheckin").mockResolvedValue({
      token: "tok-relogio-adiantado",
      expira_em: new Date(Date.now() - 3_600_000).toISOString(),
      periodo_segundos: 30,
    });

    await entrarNoTotem();

    await waitFor(() => {
      expect(screen.getByText("Judo Infantil")).toBeInTheDocument();
      expect(screen.getByText(/Token rotativo ativo/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("QR Code Expirado")).not.toBeInTheDocument();
    // E não entra em renovação a cada segundo: espera um período menos a folga.
    expect(screen.getByText(/Renovando em 2[0-5]s/i)).toBeInTheDocument();
  });

  it("deve ocultar o QR code quando o prazo de exibição passa sem renovação", async () => {
    let agoraMono = 1_000;
    vi.spyOn(tokenCheckin.relogio, "agora").mockImplementation(() => agoraMono);

    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([TURMA_JUDO]);
    vi.spyOn(supabaseModule, "emitirTokenCheckin").mockResolvedValue({
      token: "tok-vai-vencer",
      expira_em: new Date(Date.now() + 30_000).toISOString(),
      periodo_segundos: 30,
    });

    await entrarNoTotem();

    await waitFor(() => {
      expect(screen.getByText(/Token rotativo ativo/i)).toBeInTheDocument();
    });

    // Passa um período inteiro no relógio monotônico sem que um token novo chegue.
    agoraMono += 30_000;

    // A tela se redesenha a cada segundo (relógio do cabeçalho) e passa a esconder o QR.
    await waitFor(
      () => {
        expect(screen.getByText("QR Code Expirado")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
    expect(screen.queryByText(/Aponte a câmera do seu celular para registrar sua presença no tatame/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Token rotativo ativo/i)).not.toBeInTheDocument();
  });

  it("durante a reconexão, o QR ainda válido não diz que está renovando", async () => {
    const turmasMock = vi
      .spyOn(supabaseModule, "obterTurmasAbertasTotem")
      .mockResolvedValueOnce([TURMA_JUDO])
      .mockRejectedValue(new Error("Failed to fetch"));

    // expira_em a 1,5 s: o totem busca o próximo token em 1 s, e essa busca cai.
    vi.spyOn(supabaseModule, "emitirTokenCheckin").mockResolvedValue({
      token: "tok-ainda-valido",
      expira_em: new Date(Date.now() + 1_500).toISOString(),
      periodo_segundos: 30,
    });

    await entrarNoTotem();

    await waitFor(() => {
      expect(screen.getByText(/Token rotativo ativo • Renovando em/i)).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.getByText(/Oscilação de rede detectada/i)).toBeInTheDocument();
        expect(screen.getByText(/Código ainda válido • Sem conexão para renovar/i)).toBeInTheDocument();
      },
      { timeout: 4000 }
    );
    expect(screen.queryByText(/Renovando em/i)).not.toBeInTheDocument();
    expect(turmasMock).toHaveBeenCalledTimes(2);
  });

  it("dois disparos no mesmo instante executam um ciclo só", async () => {
    const turmasMock = vi
      .spyOn(supabaseModule, "obterTurmasAbertasTotem")
      .mockRejectedValue(new Error("Failed to fetch"));

    await entrarNoTotem();

    await waitFor(() => {
      expect(screen.getByText("Reconectar Agora")).toBeInTheDocument();
    });
    expect(turmasMock).toHaveBeenCalledTimes(1);

    // Dois cliques antes de qualquer nova renderização.
    const botao = screen.getByText("Reconectar Agora");
    fireEvent.click(botao);
    fireEvent.click(botao);

    await waitFor(() => {
      expect(turmasMock).toHaveBeenCalledTimes(2);
    });
    // Dá tempo de um terceiro ciclo indevido aparecer.
    await new Promise((r) => setTimeout(r, 100));
    expect(turmasMock).toHaveBeenCalledTimes(2);
  });

  it("emite os tokens de todas as turmas ao mesmo tempo", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([
      TURMA_JUDO,
      { id: "turma-2", nome: "Muay Thai Geral", hora_inicio: "18:30", hora_fim: "19:30" },
    ]);

    const liberar: Array<() => void> = [];
    const emitirMock = vi.spyOn(supabaseModule, "emitirTokenCheckin").mockImplementation(
      (turmaId: string) =>
        new Promise((resolve) => {
          liberar.push(() =>
            resolve({
              token: `tok-${turmaId}`,
              expira_em: new Date(Date.now() + 30_000).toISOString(),
              periodo_segundos: 30,
            })
          );
        })
    );

    await entrarNoTotem();

    // O segundo pedido sai sem esperar a resposta do primeiro.
    await waitFor(() => {
      expect(emitirMock).toHaveBeenCalledTimes(2);
    });
    expect(liberar).toHaveLength(2);

    liberar.forEach((f) => f());

    await waitFor(() => {
      expect(screen.getAllByText(/Token rotativo ativo/i)).toHaveLength(2);
    });
  });

  it("sessão expirada na emissão do token de uma turma aciona a renovação da sessão", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockResolvedValue([TURMA_JUDO]);
    vi.spyOn(supabaseModule, "emitirTokenCheckin")
      .mockRejectedValueOnce({ code: "PGRST301", message: "JWT expired" })
      .mockResolvedValue({
        token: "tok-depois-do-refresh",
        expira_em: new Date(Date.now() + 30_000).toISOString(),
        periodo_segundos: 30,
      });
    const renovarSpy = vi.spyOn(supabaseModule, "renovarSessao").mockResolvedValue({ sucesso: true });
    const logoutSpy = vi.spyOn(supabaseModule, "logoutEquipe");

    await entrarNoTotem();

    await waitFor(() => {
      expect(screen.getByText(/Token rotativo ativo/i)).toBeInTheDocument();
    });
    expect(renovarSpy).toHaveBeenCalledTimes(1);
    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it("erro de negócio com hint não desloga, mesmo com texto e status de não autorizado", async () => {
    vi.spyOn(supabaseModule, "obterTurmasAbertasTotem").mockRejectedValue({
      code: "P0001",
      status: 401,
      hint: "sem_permissao",
      message: "Unauthorized: sessão expirada",
    });
    const renovarSpy = vi.spyOn(supabaseModule, "renovarSessao");
    const logoutSpy = vi.spyOn(supabaseModule, "logoutEquipe");

    await entrarNoTotem();

    await waitFor(() => {
      expect(screen.getByText("Este login não pode operar o totem.")).toBeInTheDocument();
    });
    expect(renovarSpy).not.toHaveBeenCalled();
    expect(logoutSpy).not.toHaveBeenCalled();
  });
});
