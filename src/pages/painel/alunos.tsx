import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlunoNaoEncontrado,
  AlunoResumo,
  ErrosAluno,
  FichaDoAluno,
  FormularioAluno,
  SituacaoAluno,
  anonimizarAluno,
  filtrarAlunos,
  formatarCpf,
  formatarTelefone,
  formularioDoAluno,
  formularioVazio,
  hojeNoFuso,
  idadeEm,
  lerFichaDoAluno,
  listarAlunos,
  podeAnonimizar,
  podeEditarAlunos,
  podeVerFinanceiro,
  salvarAluno,
  validarAluno,
} from "../../lib/alunos";
import { usarPainel } from "./contexto";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { ArrowLeft, Plus } from "lucide-react";

const ROTULO_SITUACAO: Record<SituacaoAluno, string> = {
  ativo: "Ativo",
  pendente: "Pendente",
  inativo: "Inativo",
  anonimizado: "Anonimizado",
};

const VARIANTE_SITUACAO: Record<SituacaoAluno, "success" | "secondary" | "outline" | "destructive"> = {
  ativo: "success",
  pendente: "secondary",
  inativo: "outline",
  anonimizado: "destructive",
};

const ROTULO_MATRICULA: Record<string, string> = {
  pendente: "Pendente",
  ativa: "Ativa",
  trancada: "Trancada",
  cancelada: "Cancelada",
};

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

/** Seção Alunos do painel: lista, ficha (`/alunos/<id>`) e cadastro novo (`/alunos/novo`). */
export const AlunosSecao: React.FC = () => {
  const { item } = usarPainel();
  if (item === "novo") return <EdicaoDoAluno />;
  if (item) return <FichaAluno key={item} alunoId={item} />;
  return <ListaDeAlunos />;
};

// ------------------------------------------------------------------ lista

const ListaDeAlunos: React.FC = () => {
  const { academia, abrir } = usarPainel();
  const [alunos, setAlunos] = useState<AlunoResumo[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<SituacaoAluno | "todas">("todas");

  // Cada carga tem um número; resposta de carga antiga é descartada (inclusive
  // as disparadas por "Tentar de novo").
  const geracao = useRef(0);
  const carregar = useCallback(() => {
    const minha = ++geracao.current;
    setFalhou(false);
    setAlunos(null);
    listarAlunos(academia.academia_id)
      .then((lista) => minha === geracao.current && setAlunos(lista))
      .catch(() => minha === geracao.current && setFalhou(true));
  }, [academia.academia_id]);
  useEffect(() => {
    carregar();
    return () => {
      geracao.current++;
    };
  }, [carregar]);

  const visiveis = useMemo(() => (alunos ? filtrarAlunos(alunos, busca, situacao) : []), [alunos, busca, situacao]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Alunos</h2>
        {podeEditarAlunos(academia.papel, academia.ativa) && (
          <Button size="sm" onClick={() => abrir("alunos", "novo")}>
            <Plus className="w-4 h-4 mr-1.5" /> Novo aluno
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label htmlFor="alunos-busca">Buscar por nome ou CPF</Label>
          <Input id="alunos-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alunos-situacao">Situação</Label>
          <select
            id="alunos-situacao"
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as SituacaoAluno | "todas")}
            className="flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100"
          >
            <option value="todas">Todas</option>
            <option value="ativo">Ativos</option>
            <option value="pendente">Pendentes</option>
            <option value="inativo">Inativos</option>
            <option value="anonimizado">Anonimizados</option>
          </select>
        </div>
      </div>

      {falhou && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Não foi possível carregar os alunos.{" "}
            <button type="button" className="underline" onClick={carregar}>
              Tentar de novo
            </button>
          </AlertDescription>
        </Alert>
      )}
      {!falhou && !alunos && <p role="status" className="text-sm text-zinc-500">Carregando alunos...</p>}
      {alunos && visiveis.length === 0 && (
        <p className="text-sm text-zinc-400">
          {alunos.length === 0 ? "Nenhum aluno cadastrado ainda." : "Nenhum aluno encontrado com esses filtros."}
        </p>
      )}
      {visiveis.length > 0 && (
        <ul aria-label="Lista de alunos" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {visiveis.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => abrir("alunos", a.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-900"
              >
                <span>
                  <span className="block font-medium text-white">{a.nome}</span>
                  {a.cpf && <span className="block text-xs text-zinc-500">CPF {formatarCpf(a.cpf)}</span>}
                </span>
                <Badge variant={VARIANTE_SITUACAO[a.situacao]}>{ROTULO_SITUACAO[a.situacao]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ ficha

type EstadoFicha =
  | { fase: "carregando" }
  | { fase: "nao_encontrado" }
  | { fase: "erro" }
  | { fase: "pronta"; ficha: FichaDoAluno };

const FichaAluno: React.FC<{ alunoId: string }> = ({ alunoId }) => {
  const { academia, abrir } = usarPainel();
  const [estado, setEstado] = useState<EstadoFicha>({ fase: "carregando" });
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [anonimizando, setAnonimizando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const verFinanceiro = podeVerFinanceiro(academia.papel);

  const geracao = useRef(0);
  const carregar = useCallback(() => {
    const minha = ++geracao.current;
    setEstado({ fase: "carregando" });
    lerFichaDoAluno(academia.academia_id, alunoId, verFinanceiro)
      .then((ficha) => minha === geracao.current && setEstado({ fase: "pronta", ficha }))
      .catch((e) => {
        if (minha === geracao.current) setEstado({ fase: e instanceof AlunoNaoEncontrado ? "nao_encontrado" : "erro" });
      });
  }, [academia.academia_id, alunoId, verFinanceiro]);
  useEffect(() => {
    carregar();
    return () => {
      geracao.current++;
    };
  }, [carregar]);

  const voltar = (
    <Button variant="ghost" size="sm" disabled={anonimizando} onClick={() => abrir("alunos")}>
      <ArrowLeft className="w-4 h-4 mr-1.5" /> Alunos
    </Button>
  );

  if (estado.fase === "carregando") return <p role="status" className="text-sm text-zinc-500">Carregando aluno...</p>;
  if (estado.fase !== "pronta") {
    return (
      <div className="space-y-4">
        {voltar}
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {estado.fase === "nao_encontrado" ? (
              "Aluno não encontrado nesta academia."
            ) : (
              <>
                Não foi possível carregar o aluno.{" "}
                <button type="button" className="underline" onClick={carregar}>
                  Tentar de novo
                </button>
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { aluno, matriculas, financeiro } = estado.ficha;
  const anonimizado = aluno.situacao === "anonimizado";
  const podeEditar = podeEditarAlunos(academia.papel, academia.ativa) && !anonimizado;

  if (editando && podeEditar && !confirmando && !anonimizando) {
    return (
      <EdicaoDoAluno
        alunoId={aluno.id}
        inicial={formularioDoAluno(aluno)}
        aoTerminar={(salvou) => {
          setEditando(false);
          if (salvou) {
            setAviso({ tipo: "ok", texto: "Cadastro atualizado." });
            carregar();
          }
        }}
      />
    );
  }

  const anonimizar = async () => {
    setAnonimizando(true);
    const res = await anonimizarAluno(aluno.id);
    setAnonimizando(false);
    setConfirmando(false);
    if (res.sucesso) {
      setAviso({ tipo: "ok", texto: "Cadastro anonimizado." });
      carregar();
    } else {
      setAviso({ tipo: "erro", texto: res.mensagem });
    }
  };

  const idade = idadeEm(aluno.data_nascimento, hojeNoFuso(academia.fuso));

  return (
    <div className="space-y-6">
      {voltar}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">{aluno.nome}</h2>
          <Badge variant={VARIANTE_SITUACAO[aluno.situacao]}>{ROTULO_SITUACAO[aluno.situacao]}</Badge>
        </div>
        {/* Durante a confirmação e a anonimização, nada de editar nem pedir de novo.
            Fora do DOM, não só escondido: o hidden perde para a classe flex. */}
        {!confirmando && !anonimizando && (
        <div className="flex gap-2">
          {podeEditar && (
            <Button size="sm" variant="outline" onClick={() => { setAviso(null); setEditando(true); }}>
              Editar
            </Button>
          )}
          {podeAnonimizar(academia.papel) && !anonimizado && (
            <Button size="sm" variant="destructive" onClick={() => { setAviso(null); setConfirmando(true); }}>
              Anonimizar
            </Button>
          )}
        </div>
        )}
      </div>

      {aviso && (
        <Alert variant={aviso.tipo === "ok" ? "success" : "destructive"} role={aviso.tipo === "ok" ? "status" : "alert"}>
          <AlertDescription>{aviso.texto}</AlertDescription>
        </Alert>
      )}

      {confirmando && (
        <ConfirmacaoAnonimizar
          nome={aluno.nome}
          anonimizando={anonimizando}
          aoConfirmar={anonimizar}
          aoCancelar={() => setConfirmando(false)}
        />
      )}

      {anonimizado ? (
        <p className="text-sm text-zinc-400">
          Este cadastro foi anonimizado (LGPD). Os dados pessoais foram removidos e ele não pode mais ser editado.
        </p>
      ) : (
        <>
          <Bloco titulo="Dados">
            <Campo rotulo="CPF" valor={formatarCpf(aluno.cpf)} />
            <Campo
              rotulo="Nascimento"
              valor={aluno.data_nascimento ? `${dataBr(aluno.data_nascimento)}${idade !== null ? ` (${idade} anos)` : ""}` : ""}
            />
            <Campo rotulo="Telefone" valor={formatarTelefone(aluno.telefone)} />
            <Campo rotulo="E-mail" valor={aluno.email ?? ""} />
            <Campo rotulo="Contato de emergência" valor={aluno.contato_emergencia ?? ""} />
            <Campo rotulo="Observações médicas" valor={aluno.observacoes_medicas ?? ""} />
          </Bloco>
          {(aluno.responsavel_nome || (idade !== null && idade < 18)) && (
            <Bloco titulo="Responsável">
              <Campo rotulo="Nome" valor={aluno.responsavel_nome ?? ""} />
              <Campo rotulo="CPF" valor={formatarCpf(aluno.responsavel_cpf)} />
              <Campo rotulo="Telefone" valor={formatarTelefone(aluno.responsavel_telefone)} />
            </Bloco>
          )}
        </>
      )}

      <Bloco titulo="Matrículas">
        {matriculas.length === 0 ? (
          <p className="text-sm text-zinc-400 sm:col-span-2">Nenhuma matrícula.</p>
        ) : (
          <ul className="space-y-2 sm:col-span-2">
            {matriculas.map((m) => (
              <li key={m.id} className="rounded-lg border border-zinc-800 px-3 py-2 text-sm">
                <span className="font-medium text-white">{m.plano ?? "Sem plano"}</span>{" "}
                <Badge variant={m.status === "ativa" ? "success" : "outline"}>{ROTULO_MATRICULA[m.status] ?? m.status}</Badge>
                <span className="block text-xs text-zinc-400">
                  {m.turmas.length ? m.turmas.join(", ") : "Sem turma"} · desde {dataBr(m.data_inicio)}
                  {m.data_fim ? ` até ${dataBr(m.data_fim)}` : ""}
                  {m.valor !== null ? ` · ${reais(m.valor)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {financeiro && (
        <Bloco titulo="Situação financeira">
          <Campo
            rotulo="Em aberto"
            valor={financeiro.pendentes ? `${financeiro.pendentes} cobrança(s), ${reais(financeiro.totalPendente)}` : "Nada em aberto"}
          />
          <Campo
            rotulo="Em atraso"
            valor={financeiro.atrasadas ? `${financeiro.atrasadas} cobrança(s), ${reais(financeiro.totalAtrasado)}` : "Nada em atraso"}
          />
        </Bloco>
      )}
    </div>
  );
};

/**
 * Confirmação da anonimização. O foco vai para "Cancelar" ao abrir (a ação
 * que não destrói nada), Esc cancela, e o texto explica o que acontece.
 */
const ConfirmacaoAnonimizar: React.FC<{
  nome: string;
  anonimizando: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}> = ({ nome, anonimizando, aoConfirmar, aoCancelar }) => {
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelar.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-labelledby="anonimizar-titulo"
      aria-describedby="anonimizar-texto"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !anonimizando) aoCancelar();
      }}
      className="rounded-xl border border-red-900/60 bg-red-950/30 p-4 space-y-3"
    >
      <p id="anonimizar-titulo" className="font-semibold text-white">Anonimizar {nome}?</p>
      <p id="anonimizar-texto" className="text-sm text-zinc-300">
        Os dados pessoais saem do cadastro de vez (nome, CPF, contatos, responsável, observações), as matrículas
        são canceladas e o login do aluno perde o acesso. O histórico de presenças e cobranças fica, sem
        identificar a pessoa. Não dá para desfazer.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={anonimizando} onClick={aoConfirmar}>
          {anonimizando ? "Anonimizando..." : "Confirmar anonimização"}
        </Button>
        <Button ref={cancelar} size="sm" variant="outline" disabled={anonimizando} onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
};

const Bloco: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <section aria-label={titulo} className="space-y-2">
    <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{titulo}</h3>
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{children}</dl>
  </section>
);

const Campo: React.FC<{ rotulo: string; valor: string }> = ({ rotulo, valor }) => (
  <div>
    <dt className="text-xs text-zinc-500">{rotulo}</dt>
    <dd className="text-sm text-zinc-100">{valor || "—"}</dd>
  </div>
);

// ------------------------------------------------------------------ cadastro e edição

const CAMPOS: Array<{ campo: keyof FormularioAluno; rotulo: string; tipo?: string; ajuda?: string }> = [
  { campo: "nome", rotulo: "Nome completo" },
  { campo: "cpf", rotulo: "CPF", ajuda: "Só os números ou com pontos e traço." },
  { campo: "data_nascimento", rotulo: "Data de nascimento", tipo: "date" },
  { campo: "telefone", rotulo: "Telefone (WhatsApp)", tipo: "tel", ajuda: "Com DDD." },
  { campo: "email", rotulo: "E-mail", tipo: "email" },
  { campo: "contato_emergencia", rotulo: "Contato de emergência" },
];

const CAMPOS_RESPONSAVEL: Array<{ campo: keyof FormularioAluno; rotulo: string; tipo?: string }> = [
  { campo: "responsavel_nome", rotulo: "Nome do responsável" },
  { campo: "responsavel_cpf", rotulo: "CPF do responsável" },
  { campo: "responsavel_telefone", rotulo: "Telefone do responsável", tipo: "tel" },
];

const EdicaoDoAluno: React.FC<{
  alunoId?: string;
  inicial?: FormularioAluno;
  // Só na edição: volta para a ficha (salvou ou cancelou).
  aoTerminar?: (salvou: boolean) => void;
}> = ({ alunoId, inicial, aoTerminar }) => {
  const { academia, abrir } = usarPainel();
  const [form, setForm] = useState<FormularioAluno>(inicial ?? formularioVazio());
  const [erros, setErros] = useState<ErrosAluno>({});
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Navegar ou mexer no estado depois de sair da tela (outra seção, outra
  // academia) levaria a pessoa de volta para cá sem ela pedir.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  if (!podeEditarAlunos(academia.papel, academia.ativa)) {
    return (
      <Alert variant="warning" role="alert">
        <AlertDescription>
          {academia.ativa
            ? "Seu papel nesta academia não cadastra nem edita alunos."
            : "A assinatura desta academia está suspensa: os alunos podem ser consultados, mas não alterados."}
        </AlertDescription>
      </Alert>
    );
  }

  const mudar = (campo: keyof FormularioAluno) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));

  const cancelar = () => (aoTerminar ? aoTerminar(false) : abrir("alunos"));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setFalha(null);
    const v = validarAluno(form, hojeNoFuso(academia.fuso));
    if (!v.ok) {
      setErros(v.erros);
      return;
    }
    setErros({});
    setSalvando(true);
    const res = await salvarAluno(academia.academia_id, v.dados, alunoId);
    if (!montado.current) return;
    setSalvando(false);
    if (!res.sucesso) {
      setFalha(res.mensagem);
      return;
    }
    if (aoTerminar) aoTerminar(true);
    else abrir("alunos", res.id);
  };

  const campo = (c: { campo: keyof FormularioAluno; rotulo: string; tipo?: string; ajuda?: string }) => {
    const id = `aluno-${c.campo}`;
    const erro = erros[c.campo];
    return (
      <div key={c.campo} className="space-y-1.5">
        <Label htmlFor={id}>{c.rotulo}</Label>
        <Input
          id={id}
          type={c.tipo ?? "text"}
          value={form[c.campo]}
          onChange={mudar(c.campo)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}-erro` : undefined}
        />
        {erro ? (
          <p id={`${id}-erro`} className="text-xs text-red-400">{erro}</p>
        ) : (
          c.ajuda && <p className="text-xs text-zinc-500">{c.ajuda}</p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={enviar} noValidate className="space-y-6" aria-label={alunoId ? "Editar aluno" : "Novo aluno"}>
      <h2 className="text-lg font-bold text-white">{alunoId ? "Editar aluno" : "Novo aluno"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{CAMPOS.map(campo)}</div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-zinc-300">Responsável (obrigatório para menor de 18 anos)</legend>
        <div className="grid gap-4 sm:grid-cols-3">{CAMPOS_RESPONSAVEL.map(campo)}</div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="aluno-observacoes_medicas">Observações médicas</Label>
          <textarea
            id="aluno-observacoes_medicas"
            value={form.observacoes_medicas}
            onChange={mudar("observacoes_medicas")}
            rows={3}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-100"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="aluno-status">Situação</Label>
          <select
            id="aluno-status"
            value={form.status}
            onChange={mudar("status")}
            className="flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100"
          >
            <option value="ativo">Ativo</option>
            <option value="pendente">Pendente</option>
            <option value="inativo">Inativo</option>
          </select>
        </div>
      </div>

      {falha && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{falha}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando..." : alunoId ? "Salvar alterações" : "Cadastrar aluno"}
        </Button>
        <Button type="button" variant="outline" disabled={salvando} onClick={cancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
};
