import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
  const academia: AcademiaDoMembro = { academia_id: "acad-a", nome: "Academia A", slug: "a", papel, ativa };
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
