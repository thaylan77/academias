import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import { CheckinsDaAula } from "../pages/painel/checkins-da-aula";
import { PainelContexto } from "../pages/painel/contexto";
import * as lib from "../lib/checkins-da-aula";
import { AcademiaDoMembro } from "../lib/painel";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const T1 = "fa000000-0000-4000-8000-0000000004a1";

function montar(academiaId = "acad-a", turmaId = T1) {
  const academia: AcademiaDoMembro = { academia_id: academiaId, nome: "A", slug: "a", papel: "professor", ativa: true, fuso: "America/Fortaleza" };
  return render(
    <PainelContexto.Provider value={{ academia, item: turmaId, abrir: vi.fn() }}>
      <CheckinsDaAula turmaId={turmaId} />
    </PainelContexto.Provider>
  );
}

function checkin(extra: Partial<lib.CheckinDaAula> = {}): lib.CheckinDaAula {
  // 22:10 UTC = 19:10 em Fortaleza
  return { id: "p1", aluno_id: "al-1", aluno: "Ana Souza", checkin_em: "2026-10-19T22:10:00Z", origem: "qrcode", ...extra };
}

/** Deixa as promessas pendentes andarem. */
async function andar(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function visibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("Check-ins da aula", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    // 01:30 UTC de 20/10 ainda é 19/10 em Fortaleza.
    vi.setSystemTime(new Date("2026-10-20T01:30:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lista os check-ins de hoje no fuso da academia, com hora e origem", async () => {
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([
      checkin(),
      checkin({ id: "p2", aluno_id: "al-2", aluno: "Bruno Lima", checkin_em: "2026-10-19T22:05:00Z", origem: "recepcao" }),
    ]);
    montar();
    await andar();

    expect(listar).toHaveBeenCalledWith("acad-a", T1, "2026-10-19");
    const itens = within(screen.getByRole("list", { name: "Check-ins da aula" })).getAllByRole("listitem");
    expect(itens.map((i) => i.textContent)).toEqual(["Ana SouzaQR19:10", "Bruno LimaRecepção19:05"]);
    expect(screen.getByText("Check-ins de hoje (2)")).toBeInTheDocument();
    expect(screen.getByText("Atualizado às 22:30")).toBeInTheDocument();
  });

  it("sem check-in, avisa", async () => {
    vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([]);
    montar();
    await andar();
    expect(screen.getByText("Nenhum check-in hoje nesta turma.")).toBeInTheDocument();
  });

  it("atualiza sozinha a cada 15 s e mostra quem chegou", async () => {
    const listar = vi.spyOn(lib, "listarCheckinsDaAula")
      .mockResolvedValueOnce([checkin()])
      .mockResolvedValue([checkin({ id: "p3", aluno_id: "al-3", aluno: "Carla Dias", origem: "professor" }), checkin()]);
    montar();
    await andar();
    expect(screen.queryByText("Carla Dias")).not.toBeInTheDocument();

    await andar(lib.INTERVALO_ATUALIZACAO_MS - 1);
    expect(listar).toHaveBeenCalledTimes(1);
    await andar(1);
    expect(listar).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Carla Dias")).toBeInTheDocument();
    expect(screen.getByText("Professor")).toBeInTheDocument();
  });

  it("pausa com a aba escondida e atualiza na hora quando ela volta", async () => {
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([checkin()]);
    montar();
    await andar();
    expect(listar).toHaveBeenCalledTimes(1);

    visibilidade("hidden");
    await andar(lib.INTERVALO_ATUALIZACAO_MS * 3);
    expect(listar).toHaveBeenCalledTimes(1);

    visibilidade("visible");
    await andar();
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("falha mantém a última lista, avisa e tenta de novo no próximo ciclo", async () => {
    vi.spyOn(lib, "listarCheckinsDaAula")
      .mockResolvedValueOnce([checkin()])
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValue([checkin()]);
    montar();
    await andar();
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível atualizar os check-ins.");
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();

    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("'Atualizar' busca na hora", async () => {
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([]);
    montar();
    await andar();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await andar();
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("descarta resposta atrasada de outra turma e para de consultar ao desmontar", async () => {
    let resolverAntiga: (v: lib.CheckinDaAula[]) => void = () => {};
    const listar = vi.spyOn(lib, "listarCheckinsDaAula")
      .mockImplementationOnce(() => new Promise((r) => { resolverAntiga = r; }))
      .mockResolvedValue([checkin({ id: "p9", aluno: "Da Turma Nova" })]);
    const { rerender, unmount } = montar();
    const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "A", slug: "a", papel: "professor", ativa: true, fuso: "America/Fortaleza" };
    rerender(
      <PainelContexto.Provider value={{ academia, item: "t2", abrir: vi.fn() }}>
        <CheckinsDaAula turmaId="t2" />
      </PainelContexto.Provider>
    );
    await andar();
    resolverAntiga([checkin({ aluno: "Da Turma Antiga" })]);
    await andar();
    expect(screen.getByText("Da Turma Nova")).toBeInTheDocument();
    expect(screen.queryByText("Da Turma Antiga")).not.toBeInTheDocument();
    expect(listar).toHaveBeenLastCalledWith("acad-a", "t2", "2026-10-19");

    unmount();
    const chamadas = listar.mock.calls.length;
    await andar(lib.INTERVALO_ATUALIZACAO_MS * 2);
    expect(listar).toHaveBeenCalledTimes(chamadas);
  });
});

describe("Check-ins da aula: troca de contexto, falhas e ciclo", () => {
  const ACAD_A: AcademiaDoMembro = { academia_id: "acad-a", nome: "A", slug: "a", papel: "professor", ativa: true, fuso: "America/Fortaleza" };
  const ACAD_B: AcademiaDoMembro = { academia_id: "acad-b", nome: "B", slug: "b", papel: "professor", ativa: true, fuso: "America/Manaus" };
  const tela = (academia: AcademiaDoMembro, turmaId: string) => (
    <PainelContexto.Provider value={{ academia, item: turmaId, abrir: vi.fn() }}>
      <CheckinsDaAula turmaId={turmaId} />
    </PainelContexto.Provider>
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-20T01:30:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("trocando de academia, a lista da anterior some na hora e a resposta atrasada dela é descartada", async () => {
    let resolverA: (v: lib.CheckinDaAula[]) => void = () => {};
    let resolverB: (v: lib.CheckinDaAula[]) => void = () => {};
    const listar = vi.spyOn(lib, "listarCheckinsDaAula")
      .mockResolvedValueOnce([checkin({ aluno: "Aluno de A" })])
      .mockImplementationOnce(() => new Promise((r) => { resolverA = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolverB = r; }));
    const { rerender } = render(tela(ACAD_A, T1));
    await andar();
    expect(screen.getByText("Aluno de A")).toBeInTheDocument();

    // Um ciclo de A fica pendurado; a troca para B não espera por ele.
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    rerender(tela(ACAD_B, "tb"));
    expect(screen.queryByText("Aluno de A")).not.toBeInTheDocument();
    expect(screen.queryByText(/Atualizado às/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando check-ins...");
    // Em Manaus ainda é dia 19 (21:30).
    expect(listar).toHaveBeenLastCalledWith("acad-b", "tb", "2026-10-19");

    resolverA([checkin({ aluno: "Atrasado de A" })]);
    await andar();
    expect(screen.queryByText("Atrasado de A")).not.toBeInTheDocument();
    resolverB([checkin({ id: "pb", aluno: "Aluno de B" })]);
    await andar();
    expect(screen.getByText("Aluno de B")).toBeInTheDocument();
    expect(screen.getByText("Atualizado às 21:30")).toBeInTheDocument();
  });

  it("erro atrasado da turma anterior não aparece na turma nova", async () => {
    let rejeitarAntiga: (e: unknown) => void = () => {};
    vi.spyOn(lib, "listarCheckinsDaAula")
      .mockImplementationOnce(() => new Promise((_, rej) => { rejeitarAntiga = rej; }))
      .mockResolvedValue([checkin({ aluno: "Da Turma Nova" })]);
    const { rerender } = render(tela(ACAD_A, T1));
    rerender(tela(ACAD_A, "t2"));
    await andar();
    rejeitarAntiga(new Error("rede"));
    await andar();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Da Turma Nova")).toBeInTheDocument();
  });

  it("falha na primeira busca mostra o aviso, sem dizer que não houve check-in", async () => {
    vi.spyOn(lib, "listarCheckinsDaAula").mockRejectedValue(new Error("rede"));
    montar();
    await andar();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível atualizar os check-ins.");
    expect(screen.queryByText("Nenhum check-in hoje nesta turma.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Atualizado às/)).not.toBeInTheDocument();
  });

  it("ciclo que falha não avança o 'Atualizado às'", async () => {
    vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValueOnce([checkin()]).mockRejectedValue(new Error("rede"));
    montar();
    await andar();
    expect(screen.getByText("Atualizado às 22:30")).toBeInTheDocument();
    await andar(60_000);
    expect(screen.getByText("Atualizado às 22:30")).toBeInTheDocument();
  });

  it("depois que a aba volta, o ciclo de 15 s continua (um só)", async () => {
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([]);
    montar();
    await andar();
    visibilidade("hidden");
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    visibilidade("visible");
    await andar();
    expect(listar).toHaveBeenCalledTimes(2);
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    expect(listar).toHaveBeenCalledTimes(3);
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    expect(listar).toHaveBeenCalledTimes(4);
  });

  it("montada com a aba escondida, só busca uma vez até ela voltar", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([]);
    montar();
    await andar(lib.INTERVALO_ATUALIZACAO_MS * 3);
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("desmontada, voltar para a aba não busca mais", async () => {
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([]);
    const { unmount } = montar();
    await andar();
    unmount();
    visibilidade("hidden");
    visibilidade("visible");
    await andar();
    expect(listar).toHaveBeenCalledTimes(1);
  });

  it("não sobrepõe consultas: 'Atualizar' fica travado e o ciclo espera, mas uma resposta que não chega não para a lista", async () => {
    let resolver: (v: lib.CheckinDaAula[]) => void = () => {};
    const listar = vi.spyOn(lib, "listarCheckinsDaAula")
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((r) => { resolver = r; }))
      .mockResolvedValue([checkin()]);
    montar();
    await andar();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await andar();
    expect(listar).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Atualizando..." })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Check-ins de hoje" })).toHaveAttribute("aria-busy", "true");

    // Volta para a aba logo depois: a consulta pendente não ganha outra por cima.
    visibilidade("visible");
    await andar(1_000);
    expect(listar).toHaveBeenCalledTimes(2);

    // Pendurada há um intervalo inteiro: o ciclo a substitui.
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    expect(listar).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled();
    resolver([]);
    await andar();
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
  });

  it("na virada da meia-noite no fuso da academia, a busca seguinte já pede o dia novo", async () => {
    vi.setSystemTime(new Date("2026-10-20T02:59:50Z")); // 23:59:50 em Fortaleza
    const listar = vi.spyOn(lib, "listarCheckinsDaAula").mockResolvedValue([]);
    montar();
    await andar();
    expect(listar).toHaveBeenLastCalledWith("acad-a", T1, "2026-10-19");
    await andar(lib.INTERVALO_ATUALIZACAO_MS);
    expect(listar).toHaveBeenLastCalledWith("acad-a", T1, "2026-10-20");
  });
});

describe("horaNoFuso", () => {
  it("converte o instante para o fuso da academia", () => {
    expect(lib.horaNoFuso("2026-10-20T01:30:00Z", "America/Fortaleza")).toBe("22:30");
    expect(lib.horaNoFuso("2026-10-20T01:30:00Z", "America/Manaus")).toBe("21:30");
    expect(lib.horaNoFuso("lixo", "America/Fortaleza")).toBe("");
  });

  it("fuso desconhecido não quebra a tela (mesmo fallback do hojeNoFuso)", () => {
    expect(lib.horaNoFuso("2026-10-20T01:30:00Z", "Fuso/Inexistente")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("listarCheckinsDaAula", () => {
  it("recusa data malformada antes de consultar", async () => {
    vi.restoreAllMocks();
    await expect(lib.listarCheckinsDaAula("acad-a", T1, "19/10/2026")).rejects.toThrow("Data inválida.");
  });
});
