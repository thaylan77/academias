import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Catalogo,
  DIAS_SEMANA,
  Horario,
  MatriculadoNaTurma,
  Modalidade,
  Professor,
  Publico,
  ROTULO_PUBLICO,
  Turma,
  TurmaNaoEncontrada,
  conferirHorarios,
  descreverHorario,
  lerCatalogo,
  lerTurma,
  listarTurmas,
  matriculaVigente,
  podeGerirTurmas,
  salvarModalidade,
  salvarProfessor,
  salvarTurma,
} from "../../lib/turmas";
import { formatarTelefone, hojeNoFuso } from "../../lib/alunos";
import { usarPainel } from "./contexto";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

const SELECT = "flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100";
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

/** Carga com número: resposta de carga antiga é descartada. */
function usarCarga<T>(carregar: () => Promise<T>, deps: React.DependencyList) {
  const [estado, setEstado] = useState<{ fase: "carregando" } | { fase: "erro"; erro: unknown } | { fase: "pronto"; dados: T }>({
    fase: "carregando",
  });
  const geracao = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recarregar = useCallback(() => {
    const minha = ++geracao.current;
    setEstado({ fase: "carregando" });
    carregar()
      .then((dados) => minha === geracao.current && setEstado({ fase: "pronto", dados }))
      .catch((erro) => minha === geracao.current && setEstado({ fase: "erro", erro }));
  }, deps);
  useEffect(() => {
    recarregar();
    return () => {
      geracao.current++;
    };
  }, [recarregar]);
  return [estado, recarregar] as const;
}

const SemHorario: React.FC = () => <Badge variant="destructive">Sem horário: não aceita check-in por QR</Badge>;

/** Seção Turmas do painel: lista e catálogo, ficha (`/turmas/<id>`) e cadastro (`/turmas/novo`). */
export const TurmasSecao: React.FC = () => {
  const { item } = usarPainel();
  if (item === "novo") return <EdicaoDaTurma />;
  if (item) return <FichaTurma key={item} turmaId={item} />;
  return (
    <div className="space-y-10">
      <ListaDeTurmas />
      <CatalogoDasTurmas />
    </div>
  );
};

// ------------------------------------------------------------------ lista

const ListaDeTurmas: React.FC = () => {
  const { academia, abrir } = usarPainel();
  const [estado, recarregar] = usarCarga(() => listarTurmas(academia.academia_id), [academia.academia_id]);
  const [inativas, setInativas] = useState(false);

  const grupos = useMemo(() => {
    if (estado.fase !== "pronto") return [];
    const mapa = new Map<string, Turma[]>();
    for (const t of estado.dados) {
      if (!inativas && !t.ativa) continue;
      mapa.set(t.modalidade, [...(mapa.get(t.modalidade) ?? []), t]);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [estado, inativas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Turmas</h2>
        {podeGerirTurmas(academia.papel, academia.ativa) && (
          <Button size="sm" onClick={() => abrir("turmas", "novo")}>
            <Plus className="w-4 h-4 mr-1.5" /> Nova turma
          </Button>
        )}
      </div>
      <p className="text-xs text-zinc-500">Horários no fuso da academia ({academia.fuso}).</p>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={inativas} onChange={(e) => setInativas(e.target.checked)} />
        Mostrar turmas inativas
      </label>

      {estado.fase === "carregando" && <p role="status" className="text-sm text-zinc-500">Carregando turmas...</p>}
      {estado.fase === "erro" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Não foi possível carregar as turmas.{" "}
            <button type="button" className="underline" onClick={recarregar}>Tentar de novo</button>
          </AlertDescription>
        </Alert>
      )}
      {estado.fase === "pronto" && grupos.length === 0 && (
        <p className="text-sm text-zinc-400">
          {estado.dados.length === 0 ? "Nenhuma turma cadastrada ainda." : "Nenhuma turma ativa."}
        </p>
      )}
      {grupos.map(([modalidade, turmas]) => (
        <section key={modalidade} aria-label={`Modalidade ${modalidade}`} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{modalidade}</h3>
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {turmas.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => abrir("turmas", t.id)}
                  className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left hover:bg-zinc-900"
                >
                  <span>
                    <span className="block font-medium text-white">{t.nome}</span>
                    <span className="block text-xs text-zinc-400">
                      {t.professor ?? "Sem professor"} · {ROTULO_PUBLICO[t.publico]}
                      {t.capacidade ? ` · até ${t.capacidade} alunos` : ""}
                    </span>
                    {t.horarios.length > 0 && (
                      <span className="block text-xs text-zinc-500">{t.horarios.map(descreverHorario).join(" · ")}</span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    {!t.ativa && <Badge variant="outline">Inativa</Badge>}
                    {t.ativa && t.horarios.length === 0 && <SemHorario />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ ficha

const FichaTurma: React.FC<{ turmaId: string }> = ({ turmaId }) => {
  const { academia, abrir } = usarPainel();
  const [estado, recarregar] = usarCarga(() => lerTurma(academia.academia_id, turmaId), [academia.academia_id, turmaId]);
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const voltar = (
    <Button variant="ghost" size="sm" onClick={() => abrir("turmas")}>
      <ArrowLeft className="w-4 h-4 mr-1.5" /> Turmas
    </Button>
  );

  if (estado.fase === "carregando") return <p role="status" className="text-sm text-zinc-500">Carregando turma...</p>;
  if (estado.fase === "erro") {
    return (
      <div className="space-y-4">
        {voltar}
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {estado.erro instanceof TurmaNaoEncontrada ? (
              "Turma não encontrada nesta academia."
            ) : (
              <>
                Não foi possível carregar a turma.{" "}
                <button type="button" className="underline" onClick={recarregar}>Tentar de novo</button>
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { turma, matriculados } = estado.dados;
  const gerir = podeGerirTurmas(academia.papel, academia.ativa);

  if (editando && gerir) {
    return (
      <EdicaoDaTurma
        turma={turma}
        aoTerminar={(salvou) => {
          setEditando(false);
          if (salvou) {
            setAviso("Turma atualizada.");
            recarregar();
          }
        }}
      />
    );
  }

  const hoje = hojeNoFuso(academia.fuso);
  const vigentes = matriculados.filter((m) => matriculaVigente(m, hoje));

  return (
    <div className="space-y-6">
      {voltar}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-white">{turma.nome}</h2>
          {!turma.ativa && <Badge variant="outline">Inativa</Badge>}
        </div>
        {gerir && (
          <Button size="sm" variant="outline" onClick={() => { setAviso(null); setEditando(true); }}>
            Editar
          </Button>
        )}
      </div>
      <p className="text-sm text-zinc-400">
        {turma.modalidade} · {turma.professor ?? "Sem professor"} · {ROTULO_PUBLICO[turma.publico]}
        {turma.capacidade ? ` · capacidade ${turma.capacidade}` : ""}
      </p>

      {aviso && (
        <Alert variant="success" role="status">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      <section aria-label="Horários" className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Horários</h3>
        {turma.horarios.length === 0 ? (
          <Alert variant="warning" role="alert">
            <AlertDescription>
              Esta turma não tem horário: o check-in por QR não abre para ela. A presença ainda pode ser lançada à mão.
            </AlertDescription>
          </Alert>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-200">
            {turma.horarios.map((h) => (
              <li key={`${h.dia_semana}-${h.hora_inicio}`}>{descreverHorario(h)}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">No fuso da academia ({academia.fuso}).</p>
      </section>

      <section aria-label="Alunos matriculados" className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Alunos matriculados ({vigentes.length}{turma.capacidade ? ` de ${turma.capacidade}` : ""})
        </h3>
        {vigentes.length === 0 ? (
          <p className="text-sm text-zinc-400">Nenhuma matrícula vigente nesta turma.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {vigentes.map((m) => <LinhaMatriculado key={m.matricula_id} m={m} />)}
          </ul>
        )}
      </section>

      <p className="text-xs text-zinc-500">A lista de check-ins da aula em tempo real chega com a issue #16.</p>
    </div>
  );
};

const LinhaMatriculado: React.FC<{ m: MatriculadoNaTurma }> = ({ m }) => {
  const { abrir } = usarPainel();
  return (
    <li>
      <button
        type="button"
        onClick={() => abrir("alunos", m.aluno_id)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-zinc-900"
      >
        <span className="text-white">{m.nome}</span>
        <span className="text-xs text-zinc-400">
          {m.status === "ativa" ? "Ativa" : m.status === "trancada" ? "Trancada" : "Pendente"} · desde {dataBr(m.data_inicio)}
        </span>
      </button>
    </li>
  );
};

// ------------------------------------------------------------------ cadastro e edição

type FormTurma = {
  nome: string;
  modalidade_id: string;
  professor_id: string;
  publico: Publico;
  capacidade: string;
  ativa: boolean;
  horarios: Horario[];
};

const EdicaoDaTurma: React.FC<{ turma?: Turma; aoTerminar?: (salvou: boolean) => void }> = ({ turma, aoTerminar }) => {
  const { academia, abrir } = usarPainel();
  const [catalogo] = usarCarga(() => lerCatalogo(academia.academia_id), [academia.academia_id]);
  const [form, setForm] = useState<FormTurma>(() => ({
    nome: turma?.nome ?? "",
    modalidade_id: turma?.modalidade_id ?? "",
    professor_id: turma?.professor_id ?? "",
    publico: turma?.publico ?? "adulto",
    capacidade: turma?.capacidade ? String(turma.capacidade) : "",
    ativa: turma?.ativa ?? true,
    horarios: turma?.horarios ?? [],
  }));
  const [erros, setErros] = useState<{ nome?: string; modalidade_id?: string; capacidade?: string; horarios?: Record<number, string> }>({});
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  if (!podeGerirTurmas(academia.papel, academia.ativa)) {
    return (
      <Alert variant="warning" role="alert">
        <AlertDescription>
          {academia.ativa
            ? "Só o dono e a administração cadastram e editam turmas."
            : "A assinatura desta academia está suspensa: as turmas podem ser consultadas, mas não alteradas."}
        </AlertDescription>
      </Alert>
    );
  }

  const cancelar = () => (aoTerminar ? aoTerminar(false) : abrir("turmas"));
  const mudarHorario = (i: number, campo: keyof Horario, valor: string) =>
    setForm((f) => ({
      ...f,
      horarios: f.horarios.map((h, j) => (j === i ? { ...h, [campo]: campo === "dia_semana" ? Number(valor) : valor } : h)),
    }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setFalha(null);
    const novos: typeof erros = {};
    if (form.nome.trim().length < 2) novos.nome = "Informe o nome da turma.";
    if (!form.modalidade_id) novos.modalidade_id = "Escolha a modalidade.";
    const capacidade = form.capacidade.trim() ? Number(form.capacidade) : null;
    if (capacidade !== null && (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 9999)) {
      novos.capacidade = "Capacidade é um número inteiro a partir de 1.";
    }
    const errosHorario = conferirHorarios(form.horarios);
    if (errosHorario) novos.horarios = errosHorario;
    setErros(novos);
    if (Object.keys(novos).length) return;

    setSalvando(true);
    const res = await salvarTurma(
      academia.academia_id,
      {
        nome: form.nome,
        modalidade_id: form.modalidade_id,
        professor_id: form.professor_id || null,
        publico: form.publico,
        capacidade,
        ativa: form.ativa,
        horarios: form.horarios,
      },
      turma?.id
    );
    if (!montado.current) return;
    setSalvando(false);
    if (!res.sucesso) {
      setFalha(res.mensagem);
      return;
    }
    if (aoTerminar) aoTerminar(true);
    else abrir("turmas", res.id);
  };

  const opcoes = catalogo.fase === "pronto" ? catalogo.dados : null;
  // Inativos não aparecem para escolha, menos o que a turma já usa.
  const modalidades = (opcoes?.modalidades ?? []).filter((m) => m.ativa || m.id === turma?.modalidade_id);
  const professores = (opcoes?.professores ?? []).filter((p) => p.ativo || p.id === turma?.professor_id);

  return (
    <form onSubmit={enviar} noValidate className="space-y-6" aria-label={turma ? "Editar turma" : "Nova turma"}>
      <h2 className="text-lg font-bold text-white">{turma ? "Editar turma" : "Nova turma"}</h2>
      {catalogo.fase === "erro" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Não foi possível carregar modalidades e professores.</AlertDescription>
        </Alert>
      )}
      {opcoes && opcoes.modalidades.length === 0 && (
        <Alert variant="warning" role="alert">
          <AlertDescription>Cadastre uma modalidade no catálogo, na lista de turmas, antes de criar a turma.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="turma-nome" rotulo="Nome da turma" erro={erros.nome}>
          <Input id="turma-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
            aria-invalid={erros.nome ? true : undefined} aria-describedby={erros.nome ? "turma-nome-erro" : undefined} />
        </Campo>
        <Campo id="turma-modalidade" rotulo="Modalidade" erro={erros.modalidade_id}>
          <select id="turma-modalidade" className={SELECT} value={form.modalidade_id}
            onChange={(e) => setForm({ ...form, modalidade_id: e.target.value })}
            aria-invalid={erros.modalidade_id ? true : undefined}
            aria-describedby={erros.modalidade_id ? "turma-modalidade-erro" : undefined}>
            <option value="">Escolha...</option>
            {modalidades.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.ativa ? "" : " (inativa)"}</option>)}
          </select>
        </Campo>
        <Campo id="turma-professor" rotulo="Professor">
          <select id="turma-professor" className={SELECT} value={form.professor_id}
            onChange={(e) => setForm({ ...form, professor_id: e.target.value })}>
            <option value="">Sem professor</option>
            {professores.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}
          </select>
        </Campo>
        <Campo id="turma-publico" rotulo="Público">
          <select id="turma-publico" className={SELECT} value={form.publico}
            onChange={(e) => setForm({ ...form, publico: e.target.value as Publico })}>
            {(Object.keys(ROTULO_PUBLICO) as Publico[]).map((p) => <option key={p} value={p}>{ROTULO_PUBLICO[p]}</option>)}
          </select>
        </Campo>
        <Campo id="turma-capacidade" rotulo="Capacidade (opcional)" erro={erros.capacidade}>
          <Input id="turma-capacidade" inputMode="numeric" value={form.capacidade}
            onChange={(e) => setForm({ ...form, capacidade: e.target.value })}
            aria-invalid={erros.capacidade ? true : undefined}
            aria-describedby={erros.capacidade ? "turma-capacidade-erro" : undefined} />
        </Campo>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-300">
          <input type="checkbox" checked={form.ativa} onChange={(e) => setForm({ ...form, ativa: e.target.checked })} />
          Turma ativa (desativar não apaga o histórico de presença)
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-zinc-300">Horários (fuso da academia: {academia.fuso})</legend>
        {form.horarios.length === 0 && (
          <p className="text-sm text-amber-300">Sem horário, a turma não aceita check-in por QR.</p>
        )}
        {form.horarios.map((h, i) => {
          const erro = erros.horarios?.[i];
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto] items-end" role="group" aria-label={`Horário ${i + 1}`}>
              <div className="space-y-1">
                <Label htmlFor={`horario-${i}-dia`}>Dia</Label>
                <select id={`horario-${i}-dia`} className={SELECT} value={h.dia_semana}
                  onChange={(e) => mudarHorario(i, "dia_semana", e.target.value)}>
                  {DIAS_SEMANA.map((d, n) => <option key={d} value={n}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`horario-${i}-inicio`}>Início</Label>
                <Input id={`horario-${i}-inicio`} type="time" value={h.hora_inicio}
                  onChange={(e) => mudarHorario(i, "hora_inicio", e.target.value)}
                  aria-invalid={erro ? true : undefined} aria-describedby={erro ? `horario-${i}-erro` : undefined} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`horario-${i}-fim`}>Fim</Label>
                <Input id={`horario-${i}-fim`} type="time" value={h.hora_fim}
                  onChange={(e) => mudarHorario(i, "hora_fim", e.target.value)}
                  aria-invalid={erro ? true : undefined} aria-describedby={erro ? `horario-${i}-erro` : undefined} />
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={`Remover horário ${i + 1}`}
                onClick={() => setForm((f) => ({ ...f, horarios: f.horarios.filter((_, j) => j !== i) }))}>
                <Trash2 className="w-4 h-4" />
              </Button>
              {erro && <p id={`horario-${i}-erro`} className="text-xs text-red-400 sm:col-span-4">{erro}</p>}
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm"
          onClick={() => setForm((f) => ({ ...f, horarios: [...f.horarios, { dia_semana: 1, hora_inicio: "19:00", hora_fim: "20:00" }] }))}>
          <Plus className="w-4 h-4 mr-1.5" /> Adicionar horário
        </Button>
      </fieldset>

      {falha && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{falha}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando..." : turma ? "Salvar alterações" : "Cadastrar turma"}
        </Button>
        <Button type="button" variant="outline" disabled={salvando} onClick={cancelar}>Cancelar</Button>
      </div>
    </form>
  );
};

const Campo: React.FC<{ id: string; rotulo: string; erro?: string; children: React.ReactNode }> = ({ id, rotulo, erro, children }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{rotulo}</Label>
    {children}
    {erro && <p id={`${id}-erro`} className="text-xs text-red-400">{erro}</p>}
  </div>
);

// ------------------------------------------------------------------ catálogo

/**
 * Modalidades e professores ficam aqui, junto das turmas que os usam: uma
 * tela de configuração separada fica para quando houver mais catálogo.
 */
const CatalogoDasTurmas: React.FC = () => {
  const { academia } = usarPainel();
  const [estado, recarregar] = usarCarga<Catalogo>(() => lerCatalogo(academia.academia_id), [academia.academia_id]);
  const gerir = podeGerirTurmas(academia.papel, academia.ativa);

  return (
    <section aria-label="Catálogo" className="space-y-6">
      <h2 className="text-lg font-bold text-white">Modalidades e professores</h2>
      {estado.fase === "carregando" && <p role="status" className="text-sm text-zinc-500">Carregando catálogo...</p>}
      {estado.fase === "erro" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Não foi possível carregar o catálogo.{" "}
            <button type="button" className="underline" onClick={recarregar}>Tentar de novo</button>
          </AlertDescription>
        </Alert>
      )}
      {estado.fase === "pronto" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <ListaModalidades modalidades={estado.dados.modalidades} gerir={gerir} aoMudar={recarregar} />
          <ListaProfessores professores={estado.dados.professores} gerir={gerir} aoMudar={recarregar} />
        </div>
      )}
    </section>
  );
};

const ListaModalidades: React.FC<{ modalidades: Modalidade[]; gerir: boolean; aoMudar: () => void }> = ({ modalidades, gerir, aoMudar }) => {
  const { academia } = usarPainel();
  const [editando, setEditando] = useState<string | "nova" | null>(null);
  const [nome, setNome] = useState("");
  const [ativa, setAtiva] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const abrirEdicao = (m?: Modalidade) => {
    setFalha(null);
    setEditando(m ? m.id : "nova");
    setNome(m?.nome ?? "");
    setAtiva(m?.ativa ?? true);
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    const res = await salvarModalidade(academia.academia_id, { nome, ativa }, editando === "nova" ? undefined : editando ?? undefined);
    setSalvando(false);
    if (!res.sucesso) return setFalha(res.mensagem);
    setEditando(null);
    aoMudar();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Modalidades</h3>
        {gerir && editando === null && (
          <Button size="sm" variant="outline" onClick={() => abrirEdicao()}><Plus className="w-4 h-4 mr-1.5" /> Modalidade</Button>
        )}
      </div>
      {modalidades.length === 0 && <p className="text-sm text-zinc-400">Nenhuma modalidade.</p>}
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {modalidades.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="text-white">{m.nome} {!m.ativa && <Badge variant="outline">Inativa</Badge>}</span>
            {gerir && editando === null && (
              <Button size="sm" variant="ghost" aria-label={`Editar modalidade ${m.nome}`} onClick={() => abrirEdicao(m)}>Editar</Button>
            )}
          </li>
        ))}
      </ul>
      {editando !== null && (
        <form onSubmit={salvar} aria-label={editando === "nova" ? "Nova modalidade" : "Editar modalidade"} className="space-y-2 rounded-xl border border-zinc-800 p-3">
          <Label htmlFor="modalidade-nome">Nome da modalidade</Label>
          <Input id="modalidade-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Ativa
          </label>
          {falha && <p role="alert" className="text-xs text-red-400">{falha}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={salvando}>{salvando ? "Salvando..." : "Salvar modalidade"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={() => setEditando(null)}>Cancelar</Button>
          </div>
        </form>
      )}
    </div>
  );
};

const ListaProfessores: React.FC<{ professores: Professor[]; gerir: boolean; aoMudar: () => void }> = ({ professores, gerir, aoMudar }) => {
  const { academia } = usarPainel();
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", ativo: true });
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const abrirEdicao = (p?: Professor) => {
    setFalha(null);
    setEditando(p ? p.id : "novo");
    setForm({ nome: p?.nome ?? "", telefone: p?.telefone ?? "", email: p?.email ?? "", ativo: p?.ativo ?? true });
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    const res = await salvarProfessor(academia.academia_id, form, editando === "novo" ? undefined : editando ?? undefined);
    setSalvando(false);
    if (!res.sucesso) return setFalha(res.mensagem);
    setEditando(null);
    aoMudar();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Professores</h3>
        {gerir && editando === null && (
          <Button size="sm" variant="outline" onClick={() => abrirEdicao()}><Plus className="w-4 h-4 mr-1.5" /> Professor</Button>
        )}
      </div>
      {professores.length === 0 && <p className="text-sm text-zinc-400">Nenhum professor.</p>}
      <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
        {professores.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span>
              <span className="text-white">{p.nome}</span> {!p.ativo && <Badge variant="outline">Inativo</Badge>}
              {p.telefone && <span className="block text-xs text-zinc-500">{formatarTelefone(p.telefone)}</span>}
            </span>
            {gerir && editando === null && (
              <Button size="sm" variant="ghost" aria-label={`Editar professor ${p.nome}`} onClick={() => abrirEdicao(p)}>Editar</Button>
            )}
          </li>
        ))}
      </ul>
      {editando !== null && (
        <form onSubmit={salvar} aria-label={editando === "novo" ? "Novo professor" : "Editar professor"} className="space-y-2 rounded-xl border border-zinc-800 p-3">
          <Label htmlFor="professor-nome">Nome do professor</Label>
          <Input id="professor-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <Label htmlFor="professor-telefone">Telefone</Label>
          <Input id="professor-telefone" type="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
          <Label htmlFor="professor-email">E-mail</Label>
          <Input id="professor-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo
          </label>
          {falha && <p role="alert" className="text-xs text-red-400">{falha}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={salvando}>{salvando ? "Salvando..." : "Salvar professor"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={() => setEditando(null)}>Cancelar</Button>
          </div>
        </form>
      )}
    </div>
  );
};
