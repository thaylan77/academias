import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MatriculasSecao } from "../pages/painel/matriculas";
import { PainelContexto } from "../pages/painel/contexto";
import * as lib from "../lib/matriculas";
import * as cobrancas from "../lib/cobrancas";
import * as alunos from "../lib/alunos";
import * as turmas from "../lib/turmas";
import { AcademiaDoMembro, PapelPainel } from "../lib/painel";

const mat = (extra: Partial<lib.Matricula> = {}): lib.Matricula => ({
  id: "m1", aluno_id: "a1", aluno: "Ana Souza", plano_id: "p1", plano: "Mensal", status: "ativa", origem: "recepcao",
  data_inicio: "2026-01-10", data_fim: null, dia_vencimento: 10, valor: null,
  turmas: [{ id: "t1", nome: "Adulto Noite" }], ...extra,
});

function montar(papel: PapelPainel = "recepcao", ativa = true) {
  const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "A", slug: "a", papel, ativa, fuso: "America/Fortaleza" };
  const abrir = vi.fn();
  render(
    <PainelContexto.Provider value={{ academia, item: null, abrir }}>
      <MatriculasSecao />
    </PainelContexto.Provider>
  );
  return { abrir };
}

const linhaDe = (nome: string) =>
  within(screen.getByRole("list", { name: "Lista de matrículas" })).getAllByRole("listitem").find((li) => li.textContent?.includes(nome))!;

describe("Painel: matrículas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 01:30 UTC do dia 28 ainda é dia 27 em Fortaleza.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T01:30:00Z"));
    vi.spyOn(alunos, "listarAlunos").mockResolvedValue([
      { id: "a1", nome: "Ana Souza", cpf: null, telefone: null, data_nascimento: null, situacao: "ativo" },
      { id: "a2", nome: "Bruno Lima", cpf: null, telefone: null, data_nascimento: null, situacao: "pendente" },
      { id: "a9", nome: "Aluno anonimizado", cpf: null, telefone: null, data_nascimento: null, situacao: "anonimizado" },
    ]);
    vi.spyOn(turmas, "listarTurmas").mockResolvedValue([
      { id: "t1", nome: "Adulto Noite", modalidade_id: "jj", modalidade: "Jiu-Jitsu", professor_id: null, professor: null,
        publico: "adulto", capacidade: null, ativa: true, horarios: [] },
      { id: "t2", nome: "Antiga", modalidade_id: "jj", modalidade: "Jiu-Jitsu", professor_id: null, professor: null,
        publico: "adulto", capacidade: null, ativa: false, horarios: [] },
    ]);
    vi.spyOn(lib, "listarPlanos").mockResolvedValue([{ id: "p1", nome: "Mensal", valor: 150, periodicidade: "mensal" }]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("professor não vê matrículas, nem carrega os dados", () => {
    const listar = vi.spyOn(lib, "listarMatriculas");
    montar("professor");
    expect(screen.getByRole("alert")).toHaveTextContent("não acessa as matrículas");
    expect(listar).not.toHaveBeenCalled();
  });

  it("pendentes em destaque; a lista começa nas ativas e filtra por situação, com encerrada no dia da academia", async () => {
    const listar = vi.spyOn(lib, "listarMatriculas").mockResolvedValue([
      mat(),
      mat({ id: "m2", aluno_id: "a2", aluno: "Bruno Lima", status: "pendente", origem: "online", dia_vencimento: null }),
      mat({ id: "m3", aluno: "Carla Dias", data_fim: "2026-10-26" }),
      mat({ id: "m4", aluno: "Davi Rocha", data_fim: "2026-10-27" }),
    ]);
    montar();
    const pend = await screen.findByRole("region", { name: "Pendentes" });
    expect(listar).toHaveBeenCalledWith("acad-a");
    expect(pend).toHaveTextContent("Pendentes da matrícula online (1)");
    expect(pend).toHaveTextContent("Bruno Lima");

    const nomes = () => within(screen.getByRole("list", { name: "Lista de matrículas" })).getAllByRole("listitem").map((l) => l.textContent);
    // Fim hoje (27) ainda está ativa; fim ontem (26) é encerrada.
    expect(nomes().join("|")).toContain("Ana Souza");
    expect(nomes().join("|")).toContain("Davi Rocha");
    expect(nomes().join("|")).not.toContain("Carla Dias");
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "encerrada" } });
    expect(nomes()).toHaveLength(1);
    expect(nomes()[0]).toContain("Carla Dias");
  });

  it("aprovar pendente com plano pede o dia de vencimento e manda o dia; avisa e recarrega", async () => {
    const listar = vi.spyOn(lib, "listarMatriculas").mockResolvedValue([
      mat({ id: "m2", aluno_id: "a2", aluno: "Bruno Lima", status: "pendente", origem: "online", dia_vencimento: null }),
    ]);
    const aprovar = vi.spyOn(lib, "aprovarMatricula").mockResolvedValue({ sucesso: true, valor: undefined });
    montar();
    const botao = await screen.findByRole("button", { name: "Aprovar matrícula de Bruno Lima" });
    fireEvent.click(botao);
    expect(await screen.findByText("Com plano, informe o dia de vencimento (1 a 28).")).toBeInTheDocument();
    expect(aprovar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Dia de vencimento"), { target: { value: "5" } });
    fireEvent.click(botao);
    expect(await screen.findByRole("status")).toHaveTextContent("Matrícula de Bruno Lima aprovada");
    expect(aprovar).toHaveBeenCalledWith("m2", 5);
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("aprovação recusada mostra a mensagem do hint e recarrega", async () => {
    const listar = vi.spyOn(lib, "listarMatriculas").mockResolvedValue([
      mat({ id: "m2", aluno: "Bruno Lima", status: "pendente", plano_id: null, plano: null, dia_vencimento: null }),
    ]);
    vi.spyOn(lib, "aprovarMatricula").mockResolvedValue({ sucesso: false, mensagem: "Esta matrícula não está mais pendente." });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar matrícula de Bruno Lima" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não está mais pendente");
    await waitFor(() => expect(listar).toHaveBeenCalledTimes(2));
  });

  it("matrícula nova: valida, cria pela RPC e gera as cobranças em seguida", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([]);
    const criar = vi.spyOn(lib, "criarMatricula").mockResolvedValue({ sucesso: true, valor: "m-nova" });
    const gerar = vi.spyOn(cobrancas, "gerarCobrancasAgora").mockResolvedValue({ sucesso: true, geradas: 1 });
    const { abrir } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "Nova matrícula" }));
    const form = screen.getByRole("form", { name: "Nova matrícula" });

    // Aluno anonimizado e turma inativa não aparecem para escolher.
    expect(within(form).queryByRole("option", { name: /anonimizado/ })).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/Antiga/)).not.toBeInTheDocument();
    expect(within(form).getByLabelText("Início das aulas")).toHaveValue("2026-10-27");

    fireEvent.click(within(form).getByRole("button", { name: "Matricular" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Escolha o aluno.");
    fireEvent.change(within(form).getByLabelText("Aluno"), { target: { value: "a2" } });
    fireEvent.change(within(form).getByLabelText("Plano"), { target: { value: "p1" } });
    fireEvent.click(within(form).getByLabelText(/Adulto Noite/));
    fireEvent.click(within(form).getByRole("button", { name: "Matricular" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("informe o dia de vencimento");
    expect(criar).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText(/Dia de vencimento/), { target: { value: "10" } });
    fireEvent.click(within(form).getByRole("button", { name: "Matricular" }));
    const ok = await screen.findByRole("status");
    expect(ok).toHaveTextContent("Matrícula de Bruno Lima criada e 1 cobrança gerada.");
    expect(criar).toHaveBeenCalledWith("acad-a", {
      aluno_id: "a2", plano_id: "p1", turma_ids: ["t1"], data_inicio: "2026-10-27", dia_vencimento: 10, valor: null, cobrar_a_partir: null,
    });
    expect(gerar).toHaveBeenCalledWith("m-nova");
    expect(screen.queryByRole("form", { name: "Nova matrícula" })).not.toBeInTheDocument();
    fireEvent.click(within(ok).getByRole("button", { name: "Ver cobranças" }));
    expect(abrir).toHaveBeenCalledWith("cobrancas");
  });

  it("matrícula sem plano não gera cobrança; geração que falha avisa para gerar em Cobranças", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([]);
    vi.spyOn(lib, "criarMatricula").mockResolvedValue({ sucesso: true, valor: "m-nova" });
    const gerar = vi.spyOn(cobrancas, "gerarCobrancasAgora").mockResolvedValue({ sucesso: false, mensagem: "x" });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Nova matrícula" }));
    let form = screen.getByRole("form", { name: "Nova matrícula" });
    fireEvent.change(within(form).getByLabelText("Aluno"), { target: { value: "a1" } });
    fireEvent.click(within(form).getByLabelText(/Adulto Noite/));
    fireEvent.click(within(form).getByRole("button", { name: "Matricular" }));
    expect(await screen.findByRole("status")).toHaveTextContent("sem plano (não gera cobrança)");
    expect(gerar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Nova matrícula" }));
    form = screen.getByRole("form", { name: "Nova matrícula" });
    fireEvent.change(within(form).getByLabelText("Aluno"), { target: { value: "a1" } });
    fireEvent.change(within(form).getByLabelText("Plano"), { target: { value: "p1" } });
    fireEvent.change(within(form).getByLabelText(/Dia de vencimento/), { target: { value: "10" } });
    fireEvent.click(within(form).getByLabelText(/Adulto Noite/));
    fireEvent.click(within(form).getByRole("button", { name: "Matricular" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("criada, mas as cobranças não foram geradas");
    expect(within(alerta).getByRole("button", { name: "Ver cobranças" })).toBeInTheDocument();
  });

  it("recusa da criação (duplicada) fica no formulário, sem gerar nada", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([]);
    vi.spyOn(lib, "criarMatricula").mockResolvedValue({ sucesso: false, mensagem: "O aluno já tem matrícula nesta turma no mesmo período." });
    const gerar = vi.spyOn(cobrancas, "gerarCobrancasAgora");
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Nova matrícula" }));
    const form = screen.getByRole("form", { name: "Nova matrícula" });
    fireEvent.change(within(form).getByLabelText("Aluno"), { target: { value: "a1" } });
    fireEvent.click(within(form).getByLabelText(/Adulto Noite/));
    fireEvent.click(within(form).getByRole("button", { name: "Matricular" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("já tem matrícula nesta turma");
    expect(gerar).not.toHaveBeenCalled();
  });

  it("clique duplo em Matricular cria uma vez só", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([]);
    let resolver: (v: lib.Resultado<string>) => void = () => {};
    const criar = vi.spyOn(lib, "criarMatricula").mockImplementation(() => new Promise((r) => { resolver = r; }));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Nova matrícula" }));
    const form = screen.getByRole("form", { name: "Nova matrícula" });
    fireEvent.change(within(form).getByLabelText("Aluno"), { target: { value: "a1" } });
    fireEvent.click(within(form).getByLabelText(/Adulto Noite/));
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(criar).toHaveBeenCalledTimes(1);
    resolver({ sucesso: false, mensagem: "x" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("x");
  });

  it("encerrar: pede a data, avisa das pendentes depois do fim e leva a Cobranças", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([mat()]);
    const encerrar = vi.spyOn(lib, "encerrarMatricula").mockResolvedValue({ sucesso: true, valor: 2 });
    const { abrir } = montar();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar matrícula de Ana Souza" }));
    const grupo = screen.getByRole("group", { name: "Encerrar matrícula de Ana Souza" });
    expect(within(grupo).getByLabelText("Último dia")).toHaveValue("2026-10-27");
    fireEvent.change(within(grupo).getByLabelText("Último dia"), { target: { value: "2026-01-09" } });
    fireEvent.click(within(grupo).getByRole("button", { name: "Confirmar fim" }));
    expect(within(linhaDe("Ana Souza")).getByRole("alert")).toHaveTextContent("antes do início");
    expect(encerrar).not.toHaveBeenCalled();

    fireEvent.change(within(grupo).getByLabelText("Último dia"), { target: { value: "2026-10-31" } });
    fireEvent.click(within(grupo).getByRole("button", { name: "Confirmar fim" }));
    const ok = await screen.findByRole("status");
    expect(ok).toHaveTextContent("encerrada em 31/10/2026. 2 cobranças pendentes vencem depois do fim e continuam em aberto");
    expect(encerrar).toHaveBeenCalledWith("m1", "2026-10-31");
    fireEvent.click(within(ok).getByRole("button", { name: "Ver cobranças" }));
    expect(abrir).toHaveBeenCalledWith("cobrancas");
  });

  it("trancar pede confirmação; destrancar só aparece na trancada", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([mat(), mat({ id: "m5", aluno: "Eva Melo", status: "trancada" })]);
    const trancar = vi.spyOn(lib, "trancarMatricula").mockResolvedValue({ sucesso: true, valor: 0 });
    const destrancar = vi.spyOn(lib, "destrancarMatricula").mockResolvedValue({ sucesso: true, valor: undefined });
    montar();
    fireEvent.change(await screen.findByLabelText("Situação"), { target: { value: "todas" } });
    expect(within(linhaDe("Ana Souza")).queryByRole("button", { name: /Destrancar/ })).not.toBeInTheDocument();
    expect(within(linhaDe("Eva Melo")).queryByRole("button", { name: /^Trancar/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trancar matrícula de Ana Souza" }));
    expect(trancar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar trancamento" }));
    const ok = await screen.findByRole("status");
    expect(ok).toHaveTextContent("trancada: sem check-in e sem cobranças novas");
    expect(ok).not.toHaveTextContent("pendente");
    expect(trancar).toHaveBeenCalledWith("m1");

    fireEvent.click(screen.getByRole("button", { name: "Destrancar matrícula de Eva Melo" }));
    expect(await screen.findByText(/Matrícula de Eva Melo destrancada/)).toBeInTheDocument();
    expect(destrancar).toHaveBeenCalledWith("m5");
  });

  it("academia suspensa: consulta, sem aprovar, matricular nem alterar", async () => {
    vi.spyOn(lib, "listarMatriculas").mockResolvedValue([mat(), mat({ id: "m2", aluno: "Bruno Lima", status: "pendente" })]);
    montar("dono", false);
    await screen.findByRole("region", { name: "Pendentes" });
    expect(screen.getByText(/assinatura suspensa/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Aprovar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova matrícula" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Encerrar|Trancar/ })).not.toBeInTheDocument();
  });

  it("falha ao carregar oferece tentar de novo", async () => {
    const listar = vi.spyOn(lib, "listarMatriculas").mockRejectedValueOnce(new Error("rede")).mockResolvedValue([]);
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("region", { name: "Matrículas" });
    expect(listar).toHaveBeenCalledTimes(2);
  });
});
