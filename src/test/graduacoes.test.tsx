import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { GraduacoesSecao } from "../pages/painel/graduacoes";
import { PainelContexto } from "../pages/painel/contexto";
import * as lib from "../lib/graduacoes";
import * as turmas from "../lib/turmas";
import * as alunos from "../lib/alunos";
import { AcademiaDoMembro, PapelPainel } from "../lib/painel";

const FAIXAS: lib.Faixa[] = [
  { id: "f-branca", modalidade_id: "jj", nome: "Branca", cor: "#FFFFFF", ordem: 1, max_graus: 4, min_meses: 0, min_aulas: 20 },
  { id: "f-azul", modalidade_id: "jj", nome: "Azul", cor: "#1E40AF", ordem: 2, max_graus: 4, min_meses: 24, min_aulas: 200 },
];

const progresso = (extra: Partial<lib.Progresso> = {}): lib.Progresso => ({
  aluno_id: "a1", aluno: "Ana Souza", modalidade_id: "jj", faixa_id: "f-branca", faixa: "Branca", cor: "#FFFFFF", grau: 2,
  graduado_em: "2026-05-10", proximo_passo: "grau 3", aulas_desde: 25, min_aulas: 20, meses_desde: 4, min_meses: 0, apto: true,
  ...extra,
});

function montar(papel: PapelPainel, ativa = true) {
  const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "A", slug: "a", papel, ativa, fuso: "America/Fortaleza" };
  render(
    <PainelContexto.Provider value={{ academia, item: null, abrir: vi.fn() }}>
      <GraduacoesSecao />
    </PainelContexto.Provider>
  );
}

describe("Painel: graduações", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(lib, "lerFaixas").mockResolvedValue(FAIXAS);
    vi.spyOn(turmas, "lerCatalogo").mockResolvedValue({
      modalidades: [{ id: "jj", nome: "Jiu-Jitsu", ativa: true }, { id: "mt", nome: "Muay Thai", ativa: true }],
      professores: [{ id: "p1", nome: "Mestre Ricardo", telefone: null, email: null, ativo: true }],
    });
    vi.spyOn(turmas, "listarTurmas").mockResolvedValue([
      { id: "t1", nome: "Adulto Noite", modalidade_id: "jj", modalidade: "Jiu-Jitsu", professor_id: null, professor: null,
        publico: "adulto", capacidade: null, ativa: true, horarios: [] },
    ]);
    vi.spyOn(alunos, "listarAlunos").mockResolvedValue([
      { id: "a1", nome: "Ana Souza", cpf: null, telefone: null, data_nascimento: null, situacao: "ativo" },
      { id: "a2", nome: "Bruno Lima", cpf: null, telefone: null, data_nascimento: null, situacao: "ativo" },
      { id: "a3", nome: "Caio Inativo", cpf: null, telefone: null, data_nascimento: null, situacao: "inativo" },
    ]);
  });

  it("mostra o progresso com faixa, aulas e meses, e marca quem está apto", async () => {
    const listar = vi.spyOn(lib, "listarProgresso").mockResolvedValue([
      progresso(),
      progresso({ aluno_id: "a2", aluno: "Bruno Lima", apto: false, aulas_desde: 3 }),
    ]);
    montar("recepcao");

    const lista = await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(listar).toHaveBeenCalledWith("acad-a");
    const ana = within(lista).getAllByRole("listitem")[0];
    expect(ana).toHaveTextContent("Jiu-Jitsu · Branca, grau 2 · desde 10/05/2026");
    expect(ana).toHaveTextContent("25 de 20 aulas · 4 de 0 meses · próximo: grau 3");
    expect(within(ana).getByText("Apto")).toBeInTheDocument();
    expect(within(within(lista).getAllByRole("listitem")[1]).queryByText("Apto")).not.toBeInTheDocument();
  });

  it("recepção não registra nem edita faixas", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    montar("recepcao");
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(screen.queryByRole("button", { name: /Registrar graduação/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar graduação de Ana/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova faixa/ })).not.toBeInTheDocument();
  });

  it("professor registra, mas não edita faixas; academia suspensa não registra", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    montar("professor");
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(screen.getByRole("button", { name: /^Registrar graduação$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova faixa/ })).not.toBeInTheDocument();
  });

  it("academia suspensa: nem o dono registra", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    montar("dono", false);
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(screen.queryByRole("button", { name: /Registrar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova faixa/ })).not.toBeInTheDocument();
  });

  it("filtros: só aptos e por turma (alunos com matrícula vigente nela)", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([
      progresso(),
      progresso({ aluno_id: "a2", aluno: "Bruno Lima", apto: false }),
    ]);
    const lerTurma = vi.spyOn(turmas, "lerTurma").mockResolvedValue({
      turma: (await turmas.listarTurmas("acad-a"))[0],
      matriculados: [{ matricula_id: "m2", aluno_id: "a2", nome: "Bruno Lima", status: "ativa", data_inicio: "2026-01-01", data_fim: null }],
    });
    montar("professor");
    await screen.findByRole("list", { name: "Progresso dos alunos" });

    fireEvent.click(screen.getByLabelText("Só os aptos a graduar"));
    expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Só os aptos a graduar"));

    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "t1" } });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("list", { name: "Progresso dos alunos" })).toHaveTextContent("Bruno Lima");
    expect(lerTurma).toHaveBeenCalledWith("acad-a", "t1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("com modalidade em 'Todas', a turma escolhida limita o progresso à modalidade dela", async () => {
    // Ana treina Jiu-Jitsu (não apta) e Muay Thai (apta); a turma t1 é de Jiu-Jitsu.
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([
      progresso({ apto: false }),
      progresso({ modalidade_id: "mt", apto: true }),
    ]);
    vi.spyOn(turmas, "lerTurma").mockResolvedValue({
      turma: (await turmas.listarTurmas("acad-a"))[0],
      matriculados: [{ matricula_id: "m1", aluno_id: "a1", nome: "Ana Souza", status: "ativa", data_inicio: "2026-01-01", data_fim: null }],
    });
    montar("professor");
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "t1" } });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("list", { name: "Progresso dos alunos" })).toHaveTextContent("Jiu-Jitsu");
    expect(screen.getByRole("list", { name: "Progresso dos alunos" })).not.toHaveTextContent("Muay Thai");

    // Só os aptos: Ana não aparece por estar apta em outra modalidade.
    fireEvent.click(screen.getByLabelText("Só os aptos a graduar"));
    expect(await screen.findByText("Nenhum aluno com esses filtros.")).toBeInTheDocument();
  });

  it("registrar a partir da linha: aluno e modalidade fixos, data padrão hoje, e recarrega", async () => {
    const listar = vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    const registrar = vi.spyOn(lib, "registrarGraduacao").mockResolvedValue({ sucesso: true, id: "g1" });
    montar("professor");

    fireEvent.click(await screen.findByRole("button", { name: "Registrar graduação de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Registrar graduação" });
    expect(form).toHaveTextContent("Registrar graduação de Ana Souza");
    expect(within(form).queryByLabelText("Aluno")).not.toBeInTheDocument();
    const hoje = (within(form).getByLabelText("Data") as HTMLInputElement).value;
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(within(form).getByLabelText("Faixa"), { target: { value: "f-branca" } });
    fireEvent.change(within(form).getByLabelText("Grau"), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("Professor"), { target: { value: "p1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));

    expect(await screen.findByText(/Graduação registrada/)).toBeInTheDocument();
    expect(registrar).toHaveBeenCalledWith("acad-a", {
      aluno_id: "a1", faixa_id: "f-branca", grau: 3, data: hoje, professor_id: "p1", observacao: null,
    });
    expect(listar).toHaveBeenCalledTimes(2);
  });

  it("registro novo: escolhe aluno (só ativos) e modalidade; confere grau e data antes de gravar", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([]);
    const registrar = vi.spyOn(lib, "registrarGraduacao");
    montar("admin");

    expect(await screen.findByText(/Nenhum aluno graduado ainda/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Registrar graduação$/ }));
    const form = screen.getByRole("form", { name: "Registrar graduação" });
    expect(within(form).queryByRole("option", { name: "Caio Inativo" })).not.toBeInTheDocument();

    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Escolha o aluno.");

    fireEvent.change(within(form).getByLabelText("Aluno"), { target: { value: "a2" } });
    fireEvent.change(within(form).getByLabelText("Modalidade"), { target: { value: "jj" } });
    fireEvent.change(within(form).getByLabelText("Faixa"), { target: { value: "f-azul" } });
    fireEvent.change(within(form).getByLabelText("Grau"), { target: { value: "5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("O grau vai de 0 a 4 nesta faixa.");

    fireEvent.change(within(form).getByLabelText("Grau"), { target: { value: "0" } });
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "2999-01-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("A data não pode ser no futuro.");
    expect(registrar).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("Modalidade"), { target: { value: "mt" } });
    expect(within(form).getByText(/Esta modalidade ainda não tem faixas/)).toBeInTheDocument();
  });

  it("erro do banco aparece no formulário", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    vi.spyOn(lib, "registrarGraduacao").mockResolvedValue({ sucesso: false, mensagem: "Esse grau passa do máximo da faixa." });
    montar("professor");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar graduação de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Registrar graduação" });
    fireEvent.change(within(form).getByLabelText("Faixa"), { target: { value: "f-branca" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Esse grau passa do máximo da faixa.");
  });

  it("catálogo: admin cria faixa com a próxima ordem e vê erro de validação", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([]);
    const salvar = vi.spyOn(lib, "salvarFaixa").mockResolvedValue({ sucesso: true, id: "f-roxa" });
    montar("admin");

    const grupo = await screen.findByRole("group", { name: "Faixas de Jiu-Jitsu" });
    expect(within(grupo).getByText("1. Branca")).toBeInTheDocument();
    fireEvent.click(within(grupo).getByRole("button", { name: "Nova faixa em Jiu-Jitsu" }));
    expect(screen.getByLabelText("Ordem")).toHaveValue("3");
    fireEvent.change(screen.getByLabelText("Cor (#RRGGBB)"), { target: { value: "roxa" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar faixa" }));
    expect(await screen.findByText("Cor no formato #RRGGBB.")).toBeInTheDocument();
    expect(salvar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nome da faixa"), { target: { value: "Roxa" } });
    fireEvent.change(screen.getByLabelText("Cor (#RRGGBB)"), { target: { value: "#6B21A8" } });
    fireEvent.change(screen.getByLabelText("Mínimo de meses"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar faixa" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith("acad-a", "jj",
      { nome: "Roxa", cor: "#6B21A8", ordem: 3, max_graus: 4, min_meses: 18, min_aulas: 0 }, undefined));
  });

  it("catálogo: editar faixa parte dos valores atuais", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([]);
    const salvar = vi.spyOn(lib, "salvarFaixa").mockResolvedValue({ sucesso: false, mensagem: "Já existe uma faixa nessa ordem nesta modalidade." });
    montar("dono");
    fireEvent.click(await screen.findByRole("button", { name: "Editar faixa Azul de Jiu-Jitsu" }));
    expect(screen.getByLabelText("Mínimo de aulas")).toHaveValue("200");
    fireEvent.change(screen.getByLabelText("Ordem"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar faixa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma faixa nessa ordem nesta modalidade.");
    expect(salvar).toHaveBeenCalledWith("acad-a", "jj", expect.objectContaining({ ordem: 1, nome: "Azul" }), "f-azul");
  });

  it("falha ao carregar: aviso com nova tentativa", async () => {
    const listar = vi.spyOn(lib, "listarProgresso").mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce([progresso()]);
    montar("professor");
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(listar).toHaveBeenCalledTimes(2);
  });
});

describe("Painel: graduações (cobertura pedida na primeira revisão)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.spyOn(lib, "lerFaixas").mockResolvedValue(FAIXAS);
    vi.spyOn(turmas, "lerCatalogo").mockResolvedValue({
      modalidades: [{ id: "jj", nome: "Jiu-Jitsu", ativa: true }, { id: "mt", nome: "Muay Thai", ativa: false }],
      professores: [],
    });
    vi.spyOn(turmas, "listarTurmas").mockResolvedValue([
      { id: "t1", nome: "Adulto Noite", modalidade_id: "jj", modalidade: "Jiu-Jitsu", professor_id: null, professor: null,
        publico: "adulto", capacidade: null, ativa: true, horarios: [] },
      { id: "t2", nome: "Muay Thai Adulto", modalidade_id: "mt", modalidade: "Muay Thai", professor_id: null, professor: null,
        publico: "misto", capacidade: null, ativa: true, horarios: [] },
    ]);
    vi.spyOn(alunos, "listarAlunos").mockResolvedValue([
      { id: "a1", nome: "Ana Souza", cpf: null, telefone: null, data_nascimento: null, situacao: "ativo" },
    ]);
  });

  it("data padrão e limite de futuro são o dia da academia, não o do relógio em UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:30 em UTC do dia 20 ainda é dia 19 em Fortaleza (UTC-3).
    vi.setSystemTime(new Date("2026-10-20T01:30:00Z"));
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    const registrar = vi.spyOn(lib, "registrarGraduacao");
    montar("professor");

    fireEvent.click(await screen.findByRole("button", { name: "Registrar graduação de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Registrar graduação" });
    expect(within(form).getByLabelText("Data")).toHaveValue("2026-10-19");
    fireEvent.change(within(form).getByLabelText("Faixa"), { target: { value: "f-branca" } });
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "2026-10-20" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("A data não pode ser no futuro.");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("grau vazio não vira 0, e data vazia pede a data", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    const registrar = vi.spyOn(lib, "registrarGraduacao");
    montar("professor");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar graduação de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Registrar graduação" });
    fireEvent.change(within(form).getByLabelText("Faixa"), { target: { value: "f-branca" } });
    fireEvent.change(within(form).getByLabelText("Grau"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("O grau vai de 0 a 4 nesta faixa.");
    fireEvent.change(within(form).getByLabelText("Grau"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText("Data"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Informe a data da graduação.");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("modalidade inativa: sem atalho de registro na linha", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso({ modalidade_id: "mt", aluno: "Ana Souza" })]);
    montar("professor");
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    expect(screen.queryByRole("button", { name: "Registrar graduação de Ana Souza" })).not.toBeInTheDocument();
  });

  it("filtro de modalidade restringe a lista e as turmas, e limpa a turma escolhida", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([
      progresso(),
      progresso({ aluno_id: "a2", aluno: "Bruno Lima", modalidade_id: "mt" }),
    ]);
    vi.spyOn(turmas, "lerTurma").mockResolvedValue({ turma: (await turmas.listarTurmas("acad-a"))[0], matriculados: [] });
    montar("recepcao");
    await screen.findByRole("list", { name: "Progresso dos alunos" });

    fireEvent.change(screen.getByLabelText("Modalidade"), { target: { value: "jj" } });
    expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByLabelText("Turma")).queryByRole("option", { name: "Muay Thai Adulto" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "t1" } });
    await screen.findByText("Nenhum aluno com esses filtros.");
    fireEvent.change(screen.getByLabelText("Modalidade"), { target: { value: "" } });
    expect(screen.getByLabelText("Turma")).toHaveValue("");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(2));
  });

  it("turma carregando mostra aviso; falha não esconde a lista", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    let falhar: (e: Error) => void = () => {};
    vi.spyOn(turmas, "lerTurma").mockImplementation(() => new Promise((_, rej) => (falhar = rej)));
    montar("recepcao");
    await screen.findByRole("list", { name: "Progresso dos alunos" });

    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "t1" } });
    expect(await screen.findByText("Carregando os alunos da turma...")).toBeInTheDocument();
    await act(async () => falhar(new Error("rede")));
    expect(screen.getByRole("alert")).toHaveTextContent("a lista abaixo não está filtrada por ela");
    expect(within(screen.getByRole("list", { name: "Progresso dos alunos" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("recarga que falha depois de gravar mantém a tela e avisa", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValueOnce([progresso()]).mockRejectedValueOnce(new Error("rede"));
    vi.spyOn(lib, "registrarGraduacao").mockResolvedValue({ sucesso: true, id: "g1" });
    montar("professor");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar graduação de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Registrar graduação" });
    fireEvent.change(within(form).getByLabelText("Faixa"), { target: { value: "f-branca" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar graduação" }));

    expect(await screen.findByText(/Salvo, mas não foi possível atualizar a lista/)).toBeInTheDocument();
    expect(screen.getByText(/Graduação registrada/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Progresso dos alunos" })).toBeInTheDocument();
  });

  it("depois de salvar faixa, o formulário fecha e as faixas recarregam", async () => {
    vi.spyOn(lib, "listarProgresso").mockResolvedValue([]);
    vi.spyOn(lib, "salvarFaixa").mockResolvedValue({ sucesso: true, id: "f-roxa" });
    montar("admin");
    const grupo = await screen.findByRole("group", { name: "Faixas de Jiu-Jitsu" });
    fireEvent.click(within(grupo).getByRole("button", { name: "Nova faixa em Jiu-Jitsu" }));
    fireEvent.change(screen.getByLabelText("Nome da faixa"), { target: { value: "Roxa" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar faixa" }));
    await waitFor(() => expect(screen.queryByLabelText("Nome da faixa")).not.toBeInTheDocument());
    expect(lib.lerFaixas).toHaveBeenCalledTimes(2);
    expect(lib.lerFaixas).toHaveBeenLastCalledWith("acad-a");
  });

  it("trocar a academia do contexto recarrega tudo da academia nova", async () => {
    const listar = vi.spyOn(lib, "listarProgresso").mockResolvedValue([progresso()]);
    const academia = (id: string): AcademiaDoMembro => ({ academia_id: id, nome: id, slug: id, papel: "admin", ativa: true, fuso: "America/Fortaleza" });
    const { rerender } = render(
      <PainelContexto.Provider value={{ academia: academia("acad-a"), item: null, abrir: vi.fn() }}>
        <GraduacoesSecao />
      </PainelContexto.Provider>
    );
    await screen.findByRole("list", { name: "Progresso dos alunos" });
    rerender(
      <PainelContexto.Provider value={{ academia: academia("acad-b"), item: null, abrir: vi.fn() }}>
        <GraduacoesSecao />
      </PainelContexto.Provider>
    );
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith("acad-b"));
    expect(lib.lerFaixas).toHaveBeenLastCalledWith("acad-b");
    expect(turmas.lerCatalogo).toHaveBeenLastCalledWith("acad-b");
    expect(turmas.listarTurmas).toHaveBeenLastCalledWith("acad-b");
    expect(alunos.listarAlunos).toHaveBeenLastCalledWith("acad-b");
  });
});
