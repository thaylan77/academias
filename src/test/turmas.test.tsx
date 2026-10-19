import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TurmasSecao } from "../pages/painel/turmas";
import { PainelContexto } from "../pages/painel/contexto";
import * as lib from "../lib/turmas";
import * as checkins from "../lib/checkins-da-aula";
import { AcademiaDoMembro, PapelPainel } from "../lib/painel";

const T1 = "fa000000-0000-4000-8000-0000000004a1";

function turma(extra: Partial<lib.Turma> = {}): lib.Turma {
  return {
    id: T1, nome: "Adulto Noite", modalidade_id: "mod-jj", modalidade: "Jiu-Jitsu", professor_id: "prof-1", professor: "Mestre Lima",
    publico: "adulto", capacidade: 20, ativa: true,
    horarios: [{ dia_semana: 1, hora_inicio: "19:00", hora_fim: "20:30" }],
    ...extra,
  };
}

const CATALOGO: lib.Catalogo = {
  modalidades: [
    { id: "mod-jj", nome: "Jiu-Jitsu", ativa: true },
    { id: "mod-old", nome: "Capoeira", ativa: false },
  ],
  professores: [{ id: "prof-1", nome: "Mestre Lima", telefone: "5585999991234", email: null, ativo: true }],
};

function montar(papel: PapelPainel, item: string | null = null, ativa = true) {
  const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "A", slug: "a", papel, ativa, fuso: "America/Fortaleza" };
  const abrir = vi.fn();
  render(
    <PainelContexto.Provider value={{ academia, item, abrir }}>
      <TurmasSecao />
    </PainelContexto.Provider>
  );
  return { abrir };
}

describe("Painel: turmas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(lib, "lerCatalogo").mockResolvedValue(CATALOGO);
  });

  describe("lista", () => {
    it("agrupa por modalidade, mostra professor e horários, e avisa turma sem horário", async () => {
      const listar = vi.spyOn(lib, "listarTurmas").mockResolvedValue([
        turma(),
        turma({ id: "t2", nome: "Kids", publico: "infantil", horarios: [] }),
        turma({ id: "t3", nome: "Judô Manhã", modalidade: "Judô" }),
      ]);
      montar("professor");

      const jj = await screen.findByRole("region", { name: "Modalidade Jiu-Jitsu" });
      expect(listar).toHaveBeenCalledWith("acad-a");
      expect(within(jj).getAllByRole("button").map((b) => b.textContent)).toEqual([
        expect.stringContaining("Adulto Noite"), expect.stringContaining("Kids"),
      ]);
      expect(within(jj).getByText(/Mestre Lima · Adulto · até 20 alunos/)).toBeInTheDocument();
      expect(within(jj).getByText("Segunda, 19:00 às 20:30")).toBeInTheDocument();
      expect(within(jj).getByText("Sem horário: não aceita check-in por QR")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Modalidade Judô" })).toBeInTheDocument();
      expect(screen.getByText("Horários no fuso da academia (America/Fortaleza).")).toBeInTheDocument();
    });

    it("inativas só aparecem quando pedidas", async () => {
      vi.spyOn(lib, "listarTurmas").mockResolvedValue([turma(), turma({ id: "t2", nome: "Antiga", ativa: false })]);
      montar("recepcao");

      await screen.findByRole("button", { name: /Adulto Noite/ });
      expect(screen.queryByRole("button", { name: /Antiga/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("Mostrar turmas inativas"));
      expect(screen.getByRole("button", { name: /Antiga/ })).toHaveTextContent("Inativa");
    });

    it("'Nova turma' e edição do catálogo só para dono e admin com a assinatura em dia", async () => {
      vi.spyOn(lib, "listarTurmas").mockResolvedValue([turma()]);
      for (const [papel, ativa, ve] of [["admin", true, true], ["dono", false, false], ["recepcao", true, false], ["professor", true, false]] as const) {
        const { unmount } = render(
          <PainelContexto.Provider value={{ academia: { academia_id: "acad-a", nome: "A", slug: "a", papel, ativa, fuso: "America/Fortaleza" }, item: null, abrir: vi.fn() }}>
            <TurmasSecao />
          </PainelContexto.Provider>
        );
        await screen.findByRole("button", { name: /Adulto Noite/ });
        await screen.findByText("Capoeira");
        expect(!!screen.queryByRole("button", { name: /Nova turma/ }), `${papel} ${ativa}`).toBe(ve);
        expect(!!screen.queryByRole("button", { name: /^Modalidade$/ }), `${papel} ${ativa}`).toBe(ve);
        expect(!!screen.queryByRole("button", { name: "Editar professor Mestre Lima" }), `${papel} ${ativa}`).toBe(ve);
        unmount();
      }
    });
  });

  describe("ficha", () => {
    const MATRICULADOS: lib.MatriculadoNaTurma[] = [
      { matricula_id: "m1", aluno_id: "a1", nome: "Ana", status: "ativa", data_inicio: "2026-01-01", data_fim: null },
      { matricula_id: "m2", aluno_id: "a2", nome: "Encerrado", status: "ativa", data_inicio: "2025-01-01", data_fim: "2025-06-30" },
    ];

    it("mostra horários e só os matriculados vigentes, com a capacidade", async () => {
      vi.spyOn(lib, "lerTurma").mockResolvedValue({ turma: turma(), matriculados: MATRICULADOS });
      const { abrir } = montar("professor", T1);

      await screen.findByRole("heading", { name: "Adulto Noite" });
      expect(within(screen.getByRole("region", { name: "Horários" })).getByText("Segunda, 19:00 às 20:30")).toBeInTheDocument();
      const alunos = screen.getByRole("region", { name: "Alunos matriculados" });
      expect(alunos).toHaveTextContent("Alunos matriculados (1 ativo de 20)");
      expect(within(alunos).queryByText("Encerrado")).not.toBeInTheDocument();
      fireEvent.click(within(alunos).getByRole("button", { name: /Ana/ }));
      expect(abrir).toHaveBeenCalledWith("alunos", "a1");
      expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    });

    it("mostra os check-ins de hoje da turma aberta", async () => {
      vi.spyOn(lib, "lerTurma").mockResolvedValue({ turma: turma(), matriculados: [] });
      const listar = vi.spyOn(checkins, "listarCheckinsDaAula").mockResolvedValue([
        { id: "p1", aluno_id: "a1", aluno: "Ana", checkin_em: "2026-10-19T22:10:00Z", origem: "qrcode" },
      ]);
      // 01:30 UTC de 20/10 ainda é 19/10 em Fortaleza.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-20T01:30:00Z"));
      try {
        montar("professor", T1);
        const lista = await screen.findByRole("list", { name: "Check-ins da aula" });
        expect(lista).toHaveTextContent("Ana");
        expect(listar).toHaveBeenCalledWith("acad-a", T1, "2026-10-19");
      } finally {
        vi.useRealTimers();
      }
    });

    it("turma sem horário avisa que o check-in por QR não abre", async () => {
      vi.spyOn(lib, "lerTurma").mockResolvedValue({ turma: turma({ horarios: [] }), matriculados: [] });
      montar("dono", T1);
      expect(await screen.findByRole("alert")).toHaveTextContent("o check-in por QR não abre para ela");
    });

    it("dono edita a partir dos dados atuais e volta para a ficha atualizada", async () => {
      vi.spyOn(lib, "lerTurma")
        .mockResolvedValueOnce({ turma: turma(), matriculados: [] })
        .mockResolvedValueOnce({ turma: turma({ nome: "Adulto Tarde" }), matriculados: [] });
      const salvar = vi.spyOn(lib, "salvarTurma").mockResolvedValue({ sucesso: true, id: T1 });
      montar("dono", T1);

      fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
      expect(screen.getByLabelText("Nome da turma")).toHaveValue("Adulto Noite");
      await waitFor(() => expect(screen.getByLabelText("Modalidade")).toHaveValue("mod-jj"));
      fireEvent.change(screen.getByLabelText("Nome da turma"), { target: { value: "Adulto Tarde" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

      expect(await screen.findByRole("heading", { name: "Adulto Tarde" })).toBeInTheDocument();
      expect(salvar).toHaveBeenCalledWith("acad-a", expect.objectContaining({ nome: "Adulto Tarde", modalidade_id: "mod-jj" }), T1);
    });

    it("turma de outra academia: não encontrada", async () => {
      vi.spyOn(lib, "lerTurma").mockRejectedValue(new lib.TurmaNaoEncontrada());
      montar("dono", T1);
      expect(await screen.findByRole("alert")).toHaveTextContent("Turma não encontrada nesta academia.");
    });
  });

  describe("cadastro", () => {
    it("valida nome, modalidade e horários antes de gravar", async () => {
      const salvar = vi.spyOn(lib, "salvarTurma");
      montar("admin", "novo");
      await screen.findByRole("option", { name: "Jiu-Jitsu" });

      fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }));
      fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }));
      fireEvent.click(screen.getByRole("button", { name: "Cadastrar turma" }));

      expect(await screen.findByText("Informe o nome da turma.")).toBeInTheDocument();
      expect(screen.getByText("Escolha a modalidade.")).toBeInTheDocument();
      expect(screen.getByText("Sobrepõe o horário de segunda das 19:00.")).toBeInTheDocument();
      expect(salvar).not.toHaveBeenCalled();
    });

    it("modalidade inativa não aparece para escolher numa turma nova", async () => {
      montar("admin", "novo");
      await screen.findByRole("option", { name: "Jiu-Jitsu" });
      expect(screen.queryByRole("option", { name: /Capoeira/ })).not.toBeInTheDocument();
    });

    it("cadastra com horários e abre a ficha da turma nova", async () => {
      const salvar = vi.spyOn(lib, "salvarTurma").mockResolvedValue({ sucesso: true, id: T1 });
      const { abrir } = montar("admin", "novo");
      await screen.findByRole("option", { name: "Jiu-Jitsu" });

      fireEvent.change(screen.getByLabelText("Nome da turma"), { target: { value: "Kids" } });
      fireEvent.change(screen.getByLabelText("Modalidade"), { target: { value: "mod-jj" } });
      fireEvent.change(screen.getByLabelText("Público"), { target: { value: "infantil" } });
      fireEvent.change(screen.getByLabelText("Capacidade (opcional)"), { target: { value: "15" } });
      fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }));
      fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "6" } });
      fireEvent.change(screen.getByLabelText("Início"), { target: { value: "09:00" } });
      fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "10:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Cadastrar turma" }));

      await waitFor(() => expect(abrir).toHaveBeenCalledWith("turmas", T1));
      expect(salvar).toHaveBeenCalledWith("acad-a", {
        nome: "Kids", modalidade_id: "mod-jj", professor_id: null, publico: "infantil", capacidade: 15, ativa: true,
        horarios: [{ dia_semana: 6, hora_inicio: "09:00", hora_fim: "10:00" }],
      }, undefined);
    });

    it("erro do banco aparece no formulário", async () => {
      vi.spyOn(lib, "salvarTurma").mockResolvedValue({ sucesso: false, mensagem: "Há horários que se sobrepõem no mesmo dia." });
      montar("admin", "novo");
      await screen.findByRole("option", { name: "Jiu-Jitsu" });
      fireEvent.change(screen.getByLabelText("Nome da turma"), { target: { value: "Kids" } });
      fireEvent.change(screen.getByLabelText("Modalidade"), { target: { value: "mod-jj" } });
      fireEvent.click(screen.getByRole("button", { name: "Cadastrar turma" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Há horários que se sobrepõem no mesmo dia.");
    });

    it("recepção (ou academia suspensa) não abre o cadastro pela URL", () => {
      montar("recepcao", "novo");
      expect(screen.getByRole("alert")).toHaveTextContent("Só o dono e a administração cadastram e editam turmas.");
      expect(screen.queryByRole("button", { name: "Cadastrar turma" })).not.toBeInTheDocument();
    });
  });

  describe("catálogo", () => {
    it("admin cadastra modalidade; nome repetido mostra o erro", async () => {
      vi.spyOn(lib, "listarTurmas").mockResolvedValue([]);
      const salvar = vi.spyOn(lib, "salvarModalidade")
        .mockResolvedValueOnce({ sucesso: false, mensagem: "Já existe uma modalidade com esse nome." })
        .mockResolvedValueOnce({ sucesso: true, id: "mod-new" });
      montar("admin");

      fireEvent.click(await screen.findByRole("button", { name: /^Modalidade$/ }));
      fireEvent.change(screen.getByLabelText("Nome da modalidade"), { target: { value: "Jiu-Jitsu" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar modalidade" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Já existe uma modalidade com esse nome.");

      fireEvent.change(screen.getByLabelText("Nome da modalidade"), { target: { value: "Judô" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar modalidade" }));
      await waitFor(() => expect(screen.queryByLabelText("Nome da modalidade")).not.toBeInTheDocument());
      expect(salvar).toHaveBeenLastCalledWith("acad-a", { nome: "Judô", ativa: true }, undefined);
      expect(lib.lerCatalogo).toHaveBeenCalledTimes(2);
    });

    it("admin edita professor existente", async () => {
      vi.spyOn(lib, "listarTurmas").mockResolvedValue([]);
      const salvar = vi.spyOn(lib, "salvarProfessor").mockResolvedValue({ sucesso: true, id: "prof-1" });
      montar("admin");

      fireEvent.click(await screen.findByRole("button", { name: "Editar professor Mestre Lima" }));
      expect(screen.getByLabelText("Nome do professor")).toHaveValue("Mestre Lima");
      fireEvent.click(screen.getByLabelText("Ativo"));
      fireEvent.click(screen.getByRole("button", { name: "Salvar professor" }));
      await waitFor(() => expect(salvar).toHaveBeenCalledWith(
        "acad-a", { nome: "Mestre Lima", telefone: "5585999991234", email: "", ativo: false }, "prof-1"
      ));
    });
  });
});

describe("Painel: turmas (cobertura pedida na primeira revisão)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(lib, "lerCatalogo").mockResolvedValue(CATALOGO);
  });

  it("ficha: lê a turma da academia selecionada; academia suspensa não mostra Editar", async () => {
    const ler = vi.spyOn(lib, "lerTurma").mockResolvedValue({ turma: turma(), matriculados: [] });
    montar("dono", T1, false);
    await screen.findByRole("heading", { name: "Adulto Noite" });
    expect(ler).toHaveBeenCalledWith("acad-a", T1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });

  it("ficha: pendente e trancada aparecem com o rótulo, mas só ativas contam contra a capacidade", async () => {
    vi.spyOn(lib, "lerTurma").mockResolvedValue({
      turma: turma(),
      matriculados: [
        { matricula_id: "m1", aluno_id: "a1", nome: "Ana", status: "ativa", data_inicio: "2026-01-01", data_fim: null },
        { matricula_id: "m2", aluno_id: "a2", nome: "Bia", status: "pendente", data_inicio: "2026-01-01", data_fim: null },
        { matricula_id: "m3", aluno_id: "a3", nome: "Caio", status: "trancada", data_inicio: "2026-01-01", data_fim: null },
      ],
    });
    montar("recepcao", T1);
    const alunos = await screen.findByRole("region", { name: "Alunos matriculados" });
    expect(alunos).toHaveTextContent("Alunos matriculados (1 ativo de 20)");
    expect(within(alunos).getByRole("button", { name: /Bia/ })).toHaveTextContent("Pendente");
    expect(within(alunos).getByRole("button", { name: /Caio/ })).toHaveTextContent("Trancada");
  });

  it("dono com a academia suspensa não abre o cadastro pela URL nem busca o catálogo", async () => {
    montar("dono", "novo", false);
    expect(screen.getByRole("alert")).toHaveTextContent("assinatura desta academia está suspensa");
    expect(screen.queryByRole("button", { name: "Cadastrar turma" })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(lib.lerCatalogo).not.toHaveBeenCalled();
  });

  it("edição manda todos os campos, inclusive desativar, sem perder horários nem professor", async () => {
    vi.spyOn(lib, "lerTurma").mockResolvedValue({ turma: turma(), matriculados: [] });
    const salvar = vi.spyOn(lib, "salvarTurma").mockResolvedValue({ sucesso: true, id: T1 });
    montar("admin", T1);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await waitFor(() => expect(screen.getByLabelText("Professor")).toHaveValue("prof-1"));
    fireEvent.click(screen.getByLabelText(/Turma ativa/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(salvar).toHaveBeenCalled());
    expect(salvar.mock.calls[0]).toEqual(["acad-a", {
      nome: "Adulto Noite", modalidade_id: "mod-jj", professor_id: "prof-1", publico: "adulto", capacidade: 20, ativa: false,
      horarios: [{ dia_semana: 1, hora_inicio: "19:00", hora_fim: "20:30" }],
    }, T1]);
  });

  it("turma antiga numa modalidade inativa: a edição mantém a modalidade escolhida", async () => {
    vi.spyOn(lib, "lerTurma").mockResolvedValue({ turma: turma({ modalidade_id: "mod-old", modalidade: "Capoeira" }), matriculados: [] });
    montar("admin", T1);
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await waitFor(() => expect(screen.getByLabelText("Modalidade")).toHaveValue("mod-old"));
    expect(screen.getByRole("option", { name: "Capoeira (inativa)" })).toBeInTheDocument();
  });

  it("horário com fim antes do início e sobreposição parcial são apontados; remover horário funciona", async () => {
    const salvar = vi.spyOn(lib, "salvarTurma");
    montar("admin", "novo");
    await screen.findByRole("option", { name: "Jiu-Jitsu" });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar horário/ }));
    const grupos = screen.getAllByRole("group", { name: /Horário \d/ });
    // 1: 20:00-19:00 (fim antes); 2: 19:00-20:30; 3: 20:00-21:00 (sobrepõe o 2)
    fireEvent.change(within(grupos[0]).getByLabelText("Início"), { target: { value: "20:00" } });
    fireEvent.change(within(grupos[0]).getByLabelText("Fim"), { target: { value: "19:00" } });
    fireEvent.change(within(grupos[1]).getByLabelText("Fim"), { target: { value: "20:30" } });
    fireEvent.change(within(grupos[2]).getByLabelText("Início"), { target: { value: "20:00" } });
    fireEvent.change(within(grupos[2]).getByLabelText("Fim"), { target: { value: "21:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar turma" }));

    expect(await screen.findByText("O fim precisa ser depois do início.")).toBeInTheDocument();
    expect(screen.getByText("Sobrepõe o horário de segunda das 19:00.")).toBeInTheDocument();
    expect(salvar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remover horário 1" }));
    expect(screen.getAllByRole("group", { name: /Horário \d/ })).toHaveLength(2);
  });

  it("trocar a academia do contexto recarrega turmas e catálogo da academia nova", async () => {
    const listar = vi.spyOn(lib, "listarTurmas").mockResolvedValue([turma()]);
    const academia = (id: string): AcademiaDoMembro => ({ academia_id: id, nome: id, slug: id, papel: "admin", ativa: true, fuso: "America/Fortaleza" });
    const { rerender } = render(
      <PainelContexto.Provider value={{ academia: academia("acad-a"), item: null, abrir: vi.fn() }}>
        <TurmasSecao />
      </PainelContexto.Provider>
    );
    await screen.findByRole("button", { name: /Adulto Noite/ });
    rerender(
      <PainelContexto.Provider value={{ academia: academia("acad-b"), item: null, abrir: vi.fn() }}>
        <TurmasSecao />
      </PainelContexto.Provider>
    );
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith("acad-b"));
    expect(lib.lerCatalogo).toHaveBeenLastCalledWith("acad-b");
  });

  it("catálogo: cria professor, edita modalidade e mostra erro de validação", async () => {
    vi.spyOn(lib, "listarTurmas").mockResolvedValue([]);
    const salvarProfessor = vi.spyOn(lib, "salvarProfessor")
      .mockResolvedValueOnce({ sucesso: false, mensagem: "Informe o nome do professor." })
      .mockResolvedValueOnce({ sucesso: true, id: "prof-2" });
    const salvarModalidade = vi.spyOn(lib, "salvarModalidade").mockResolvedValue({ sucesso: true, id: "mod-old" });
    montar("admin");

    fireEvent.click(await screen.findByRole("button", { name: /^Professor$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar professor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe o nome do professor.");
    fireEvent.change(screen.getByLabelText("Nome do professor"), { target: { value: "Mestra Rosa" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "(85) 98888-7777" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar professor" }));
    await waitFor(() => expect(salvarProfessor).toHaveBeenLastCalledWith(
      "acad-a", { nome: "Mestra Rosa", telefone: "(85) 98888-7777", email: "", ativo: true }, undefined
    ));

    await waitFor(() => expect(screen.queryByLabelText("Nome do professor")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar modalidade Capoeira" }));
    fireEvent.click(screen.getByLabelText("Ativa"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar modalidade" }));
    await waitFor(() => expect(salvarModalidade).toHaveBeenCalledWith("acad-a", { nome: "Capoeira", ativa: true }, "mod-old"));
  });
});
