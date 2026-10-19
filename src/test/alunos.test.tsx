import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AlunosSecao } from "../pages/painel/alunos";
import { PainelContexto } from "../pages/painel/contexto";
import * as lib from "../lib/alunos";
import { AcademiaDoMembro, PapelPainel } from "../lib/painel";

const ALUNO = "f9000000-0000-4000-8000-0000000001a1";

const LISTA: lib.AlunoResumo[] = [
  { id: ALUNO, nome: "Ana Souza", cpf: "52998224725", telefone: null, data_nascimento: null, situacao: "ativo" },
  { id: "f9000000-0000-4000-8000-0000000001a2", nome: "Bruno Lima", cpf: null, telefone: null, data_nascimento: null, situacao: "pendente" },
];

function ficha(situacao: lib.SituacaoAluno = "ativo"): lib.FichaDoAluno {
  return {
    aluno: {
      id: ALUNO, nome: situacao === "anonimizado" ? "Aluno anonimizado" : "Ana Souza",
      cpf: situacao === "anonimizado" ? null : "52998224725", data_nascimento: null, telefone: "5585999991234",
      email: null, responsavel_nome: null, responsavel_cpf: null, responsavel_telefone: null,
      contato_emergencia: null, observacoes_medicas: null,
      status: situacao === "anonimizado" ? "inativo" : "ativo", situacao,
    },
    matriculas: [{ id: "m1", status: "ativa", data_inicio: "2026-01-10", data_fim: null, valor: 150, plano: "Mensal", turmas: ["Adulto"] }],
    financeiro: { pendentes: 1, totalPendente: 150, atrasadas: 0, totalAtrasado: 0 },
  };
}

function montar(papel: PapelPainel, item: string | null = null, ativa = true) {
  const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "Academia A", slug: "a", papel, ativa, fuso: "America/Fortaleza" };
  const abrir = vi.fn();
  const r = render(
    <PainelContexto.Provider value={{ academia, item, abrir }}>
      <AlunosSecao />
    </PainelContexto.Provider>
  );
  return { abrir, ...r };
}

describe("Painel: alunos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("lista", () => {
    it("carrega os alunos da academia selecionada; busca e filtro por situação", async () => {
      const listar = vi.spyOn(lib, "listarAlunos").mockResolvedValue(LISTA);
      montar("recepcao");

      const lista = await screen.findByRole("list", { name: "Lista de alunos" });
      expect(listar).toHaveBeenCalledWith("acad-a");
      expect(within(lista).getAllByRole("button")).toHaveLength(2);

      fireEvent.change(screen.getByLabelText("Buscar por nome ou CPF"), { target: { value: "529.982" } });
      expect(within(lista).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Ana Souza")]);

      fireEvent.change(screen.getByLabelText("Buscar por nome ou CPF"), { target: { value: "" } });
      fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "pendente" } });
      expect(within(screen.getByRole("list", { name: "Lista de alunos" })).getAllByRole("button").map((b) => b.textContent))
        .toEqual([expect.stringContaining("Bruno Lima")]);
    });

    it("abrir um aluno navega para a ficha; 'Novo aluno' para o cadastro", async () => {
      vi.spyOn(lib, "listarAlunos").mockResolvedValue(LISTA);
      const { abrir } = montar("recepcao");

      fireEvent.click(await screen.findByRole("button", { name: /Ana Souza/ }));
      expect(abrir).toHaveBeenCalledWith("alunos", ALUNO);
      fireEvent.click(screen.getByRole("button", { name: /Novo aluno/ }));
      expect(abrir).toHaveBeenCalledWith("alunos", "novo");
    });

    it("professor e academia suspensa não veem 'Novo aluno'", async () => {
      vi.spyOn(lib, "listarAlunos").mockResolvedValue(LISTA);
      const { unmount } = montar("professor");
      await screen.findByRole("list", { name: "Lista de alunos" });
      expect(screen.queryByRole("button", { name: /Novo aluno/ })).not.toBeInTheDocument();
      unmount();

      montar("dono", null, false);
      await screen.findByRole("list", { name: "Lista de alunos" });
      expect(screen.queryByRole("button", { name: /Novo aluno/ })).not.toBeInTheDocument();
    });

    it("falha ao carregar: aviso com nova tentativa", async () => {
      const listar = vi.spyOn(lib, "listarAlunos").mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce(LISTA);
      montar("recepcao");

      fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
      await screen.findByRole("list", { name: "Lista de alunos" });
      expect(listar).toHaveBeenCalledTimes(2);
    });
  });

  describe("ficha", () => {
    it("mostra dados, matrículas e situação financeira; recepção edita mas não anonimiza", async () => {
      const ler = vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
      montar("recepcao", ALUNO);

      await screen.findByRole("heading", { name: "Ana Souza" });
      expect(ler).toHaveBeenCalledWith("acad-a", ALUNO, true);
      expect(screen.getByText("529.982.247-25")).toBeInTheDocument();
      expect(screen.getByText("(85) 99999-1234")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Matrículas" })).getByText("Mensal")).toBeInTheDocument();
      expect(within(screen.getByRole("region", { name: "Situação financeira" })).getByText(/1 cobrança/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Anonimizar" })).not.toBeInTheDocument();
    });

    it("professor: só leitura e sem financeiro (nem pede)", async () => {
      const ler = vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue({ ...ficha(), financeiro: null });
      montar("professor", ALUNO);

      await screen.findByRole("heading", { name: "Ana Souza" });
      expect(ler).toHaveBeenCalledWith("acad-a", ALUNO, false);
      expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Anonimizar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Situação financeira" })).not.toBeInTheDocument();
    });

    it("academia suspensa: dono não edita, mas anonimiza (exceção LGPD)", async () => {
      vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
      montar("dono", ALUNO, false);

      await screen.findByRole("heading", { name: "Ana Souza" });
      expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Anonimizar" })).toBeInTheDocument();
    });

    it("anonimizar pede confirmação, chama a RPC e recarrega", async () => {
      const ler = vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValueOnce(ficha()).mockResolvedValueOnce(ficha("anonimizado"));
      const anonimizar = vi.spyOn(lib, "anonimizarAluno").mockResolvedValue({ sucesso: true });
      montar("admin", ALUNO);

      fireEvent.click(await screen.findByRole("button", { name: "Anonimizar" }));
      expect(anonimizar).not.toHaveBeenCalled();
      const dialogo = screen.getByRole("alertdialog");
      expect(dialogo).toHaveTextContent("Não dá para desfazer");
      fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar anonimização" }));

      await screen.findByRole("heading", { name: "Aluno anonimizado" });
      expect(anonimizar).toHaveBeenCalledWith(ALUNO);
      expect(ler).toHaveBeenCalledTimes(2);
    });

    it("cancelar a confirmação não anonimiza", async () => {
      vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
      const anonimizar = vi.spyOn(lib, "anonimizarAluno");
      montar("dono", ALUNO);

      fireEvent.click(await screen.findByRole("button", { name: "Anonimizar" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(anonimizar).not.toHaveBeenCalled();
    });

    it("erro ao anonimizar (cobrança pendente) aparece na ficha", async () => {
      vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
      vi.spyOn(lib, "anonimizarAluno").mockResolvedValue({
        sucesso: false,
        mensagem: "Cancele ou dê baixa nas cobranças pendentes do aluno antes de anonimizar.",
      });
      montar("dono", ALUNO);

      fireEvent.click(await screen.findByRole("button", { name: "Anonimizar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar anonimização" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Cancele ou dê baixa nas cobranças pendentes");
    });

    it("aluno anonimizado aparece como tal, sem dados e sem editar nem anonimizar de novo", async () => {
      vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha("anonimizado"));
      montar("dono", ALUNO);

      await screen.findByRole("heading", { name: "Aluno anonimizado" });
      expect(screen.getByText(/foi anonimizado \(LGPD\)/)).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Dados" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Anonimizar" })).not.toBeInTheDocument();
    });

    it("aluno que não é da academia: não encontrado", async () => {
      vi.spyOn(lib, "lerFichaDoAluno").mockRejectedValue(new lib.AlunoNaoEncontrado());
      montar("dono", ALUNO);
      expect(await screen.findByRole("alert")).toHaveTextContent("Aluno não encontrado nesta academia.");
    });
  });

  describe("cadastro e edição", () => {
    it("valida antes de gravar e mostra o erro em cada campo", async () => {
      const salvar = vi.spyOn(lib, "salvarAluno");
      montar("recepcao", "novo");

      fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "123" } });
      fireEvent.click(screen.getByRole("button", { name: "Cadastrar aluno" }));

      expect(await screen.findByText("Informe o nome do aluno.")).toBeInTheDocument();
      expect(screen.getByLabelText("CPF")).toHaveAttribute("aria-invalid", "true");
      expect(salvar).not.toHaveBeenCalled();
    });

    it("cadastra com os dados normalizados e abre a ficha do aluno novo", async () => {
      const salvar = vi.spyOn(lib, "salvarAluno").mockResolvedValue({ sucesso: true, id: ALUNO });
      const { abrir } = montar("recepcao", "novo");

      fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Souza" } });
      fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "529.982.247-25" } });
      fireEvent.change(screen.getByLabelText("Telefone (WhatsApp)"), { target: { value: "(85) 99999-1234" } });
      fireEvent.click(screen.getByRole("button", { name: "Cadastrar aluno" }));

      await waitFor(() => expect(abrir).toHaveBeenCalledWith("alunos", ALUNO));
      expect(salvar).toHaveBeenCalledWith(
        "acad-a",
        expect.objectContaining({ nome: "Ana Souza", cpf: "52998224725", telefone: "5585999991234" }),
        undefined
      );
    });

    it("CPF duplicado (e outros erros do banco) aparece no formulário", async () => {
      vi.spyOn(lib, "salvarAluno").mockResolvedValue({ sucesso: false, mensagem: "Já existe um aluno com esse CPF nesta academia." });
      montar("recepcao", "novo");

      fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Souza" } });
      fireEvent.click(screen.getByRole("button", { name: "Cadastrar aluno" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um aluno com esse CPF nesta academia.");
    });

    it("professor (ou academia suspensa) não abre o cadastro, mesmo pela URL", () => {
      const { unmount } = montar("professor", "novo");
      expect(screen.getByRole("alert")).toHaveTextContent("Seu papel nesta academia não cadastra nem edita alunos.");
      expect(screen.queryByRole("button", { name: "Cadastrar aluno" })).not.toBeInTheDocument();
      unmount();

      montar("recepcao", "novo", false);
      expect(screen.getByRole("alert")).toHaveTextContent("assinatura desta academia está suspensa");
    });

    it("edição parte dos dados atuais, grava no aluno e volta para a ficha atualizada", async () => {
      const ler = vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
      const salvar = vi.spyOn(lib, "salvarAluno").mockResolvedValue({ sucesso: true, id: ALUNO });
      montar("recepcao", ALUNO);

      fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
      expect(screen.getByLabelText("Nome completo")).toHaveValue("Ana Souza");
      fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Souza Lima" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

      expect(await screen.findByText("Cadastro atualizado.")).toBeInTheDocument();
      expect(salvar).toHaveBeenCalledWith("acad-a", expect.objectContaining({ nome: "Ana Souza Lima" }), ALUNO);
      expect(ler).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Painel: alunos (cobertura pedida na primeira revisão)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("busca por nome, sem acento nem maiúscula", async () => {
    vi.spyOn(lib, "listarAlunos").mockResolvedValue(LISTA);
    montar("recepcao");
    await screen.findByRole("list", { name: "Lista de alunos" });

    fireEvent.change(screen.getByLabelText("Buscar por nome ou CPF"), { target: { value: "bruno" } });
    expect(within(screen.getByRole("list", { name: "Lista de alunos" })).getAllByRole("button").map((b) => b.textContent))
      .toEqual([expect.stringContaining("Bruno Lima")]);
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "ativo" } });
    expect(screen.getByText("Nenhum aluno encontrado com esses filtros.")).toBeInTheDocument();
  });

  it("trocar a academia do contexto recarrega a lista da academia nova", async () => {
    const listar = vi.spyOn(lib, "listarAlunos").mockResolvedValue(LISTA);
    const { rerender } = montar("recepcao");
    await screen.findByRole("list", { name: "Lista de alunos" });

    const outra: AcademiaDoMembro = { academia_id: "acad-b", nome: "B", slug: "b", papel: "recepcao", ativa: true, fuso: "America/Fortaleza" };
    rerender(
      <PainelContexto.Provider value={{ academia: outra, item: null, abrir: vi.fn() }}>
        <AlunosSecao />
      </PainelContexto.Provider>
    );
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith("acad-b"));
  });

  it("resposta atrasada de uma carga anterior (outra academia) é descartada", async () => {
    let soltarA: (v: lib.AlunoResumo[]) => void = () => {};
    vi.spyOn(lib, "listarAlunos")
      .mockImplementationOnce(() => new Promise((r) => (soltarA = r)))
      .mockResolvedValueOnce([LISTA[1]]);
    const { rerender } = montar("recepcao");

    const outra: AcademiaDoMembro = { academia_id: "acad-b", nome: "B", slug: "b", papel: "recepcao", ativa: true, fuso: "America/Fortaleza" };
    rerender(
      <PainelContexto.Provider value={{ academia: outra, item: null, abrir: vi.fn() }}>
        <AlunosSecao />
      </PainelContexto.Provider>
    );
    await screen.findByRole("button", { name: /Bruno Lima/ });
    await act(async () => soltarA(LISTA));

    expect(screen.queryByRole("button", { name: /Ana Souza/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bruno Lima/ })).toBeInTheDocument();
  });

  it("ficha mostra o responsável de menor de idade", async () => {
    const f = ficha();
    f.aluno = { ...f.aluno, data_nascimento: "2015-05-01", responsavel_nome: "Maria Souza", responsavel_cpf: "11144477735", responsavel_telefone: "5585988887777" };
    vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(f);
    montar("recepcao", ALUNO);

    const bloco = await screen.findByRole("region", { name: "Responsável" });
    expect(within(bloco).getByText("Maria Souza")).toBeInTheDocument();
    expect(within(bloco).getByText("111.444.777-35")).toBeInTheDocument();
    expect(within(bloco).getByText("(85) 98888-7777")).toBeInTheDocument();
  });

  it("cadastro de menor grava o responsável normalizado", async () => {
    const salvar = vi.spyOn(lib, "salvarAluno").mockResolvedValue({ sucesso: true, id: ALUNO });
    montar("recepcao", "novo");

    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Pedro" } });
    fireEvent.change(screen.getByLabelText("Data de nascimento"), { target: { value: "2015-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar aluno" }));
    expect(await screen.findByText("Aluno menor de idade: informe o responsável.")).toBeInTheDocument();
    expect(salvar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nome do responsável"), { target: { value: "Maria" } });
    fireEvent.change(screen.getByLabelText("CPF do responsável"), { target: { value: "111.444.777-35" } });
    fireEvent.change(screen.getByLabelText("Telefone do responsável"), { target: { value: "(85) 98888-7777" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar aluno" }));

    await waitFor(() => expect(salvar).toHaveBeenCalled());
    expect(salvar.mock.calls[0][1]).toMatchObject({
      responsavel_nome: "Maria", responsavel_cpf: "11144477735", responsavel_telefone: "5585988887777",
    });
  });

  it("depois de editar, a ficha mostra os dados novos", async () => {
    const atualizada = ficha();
    atualizada.aluno = { ...atualizada.aluno, nome: "Ana Souza Lima" };
    vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValueOnce(ficha()).mockResolvedValueOnce(atualizada);
    vi.spyOn(lib, "salvarAluno").mockResolvedValue({ sucesso: true, id: ALUNO });
    montar("recepcao", ALUNO);

    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana Souza Lima" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByRole("heading", { name: "Ana Souza Lima" })).toBeInTheDocument();
  });

  it("academia suspensa: admin anonimiza; recepção não vê o botão", async () => {
    vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
    const anonimizar = vi.spyOn(lib, "anonimizarAluno").mockResolvedValue({ sucesso: true });
    const { unmount } = montar("recepcao", ALUNO, false);
    await screen.findByRole("heading", { name: "Ana Souza" });
    expect(screen.queryByRole("button", { name: "Anonimizar" })).not.toBeInTheDocument();
    unmount();

    montar("admin", ALUNO, false);
    fireEvent.click(await screen.findByRole("button", { name: "Anonimizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar anonimização" }));
    await waitFor(() => expect(anonimizar).toHaveBeenCalledWith(ALUNO));
  });

  it("confirmação: foco em Cancelar, Esc fecha, e Editar some enquanto ela está aberta", async () => {
    vi.spyOn(lib, "lerFichaDoAluno").mockResolvedValue(ficha());
    montar("dono", ALUNO);

    fireEvent.click(await screen.findByRole("button", { name: "Anonimizar" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toHaveAccessibleDescription(/Não dá para desfazer/);
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();

    fireEvent.keyDown(dialogo, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("falha ao carregar a ficha: aviso com nova tentativa", async () => {
    const ler = vi.spyOn(lib, "lerFichaDoAluno").mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce(ficha());
    montar("recepcao", ALUNO);

    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("heading", { name: "Ana Souza" });
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("salvar que termina depois de sair da tela não navega de volta", async () => {
    let terminar: (r: lib.ResultadoGravacao) => void = () => {};
    vi.spyOn(lib, "salvarAluno").mockImplementation(() => new Promise((r) => (terminar = r)));
    const { abrir, unmount } = montar("recepcao", "novo");

    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar aluno" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando..." })).toBeInTheDocument());
    unmount();
    terminar({ sucesso: true, id: ALUNO });
    await new Promise((r) => setTimeout(r, 0));

    expect(abrir).not.toHaveBeenCalled();
  });
});
