import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ErrosFaixa,
  Faixa,
  FormularioFaixa,
  Progresso,
  filtrarProgresso,
  lerFaixas,
  listarProgresso,
  podeEditarFaixas,
  podeRegistrarGraduacao,
  registrarGraduacao,
  salvarFaixa,
  validarFaixa,
} from "../../lib/graduacoes";
import { Catalogo, Turma, lerCatalogo, lerTurma, listarTurmas } from "../../lib/turmas";
import { AlunoResumo, hojeNoFuso, listarAlunos } from "../../lib/alunos";
import { usarPainel } from "./contexto";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Plus } from "lucide-react";

const SELECT = "flex h-10 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 text-sm text-zinc-100";
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

type Dados = {
  progresso: Progresso[];
  faixas: Faixa[];
  catalogo: Catalogo;
  turmas: Turma[];
  alunos: AlunoResumo[];
};

/** Seção Graduações do painel: progresso e aptos, registro de graduação e faixas. */
export const GraduacoesSecao: React.FC = () => {
  const { academia } = usarPainel();
  const [estado, setEstado] = useState<{ fase: "carregando" } | { fase: "erro" } | { fase: "pronto"; dados: Dados }>({ fase: "carregando" });
  const [falhaRecarga, setFalhaRecarga] = useState(false);
  const geracao = useRef(0);

  // Depois de gravar, recarrega sem tirar a tela do lugar: o aviso de sucesso
  // e os filtros escolhidos continuam.
  const carregar = useCallback((emSegundoPlano = false) => {
    const minha = ++geracao.current;
    setFalhaRecarga(false);
    if (!emSegundoPlano) setEstado({ fase: "carregando" });
    Promise.all([
      listarProgresso(academia.academia_id),
      lerFaixas(academia.academia_id),
      lerCatalogo(academia.academia_id),
      listarTurmas(academia.academia_id),
      listarAlunos(academia.academia_id),
    ])
      .then(([progresso, faixas, catalogo, turmas, alunos]) => {
        if (minha === geracao.current) setEstado({ fase: "pronto", dados: { progresso, faixas, catalogo, turmas, alunos } });
      })
      .catch(() => {
        if (minha !== geracao.current) return;
        // Em segundo plano, a gravação já deu certo: mantém a tela e avisa.
        if (emSegundoPlano) setFalhaRecarga(true);
        else setEstado({ fase: "erro" });
      });
  }, [academia.academia_id]);
  useEffect(() => {
    carregar();
    return () => {
      geracao.current++;
    };
  }, [carregar]);
  const recarregar = useCallback(() => carregar(true), [carregar]);

  if (estado.fase === "carregando") return <p role="status" className="text-sm text-zinc-500">Carregando graduações...</p>;
  if (estado.fase === "erro") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>
          Não foi possível carregar as graduações.{" "}
          <button type="button" className="underline" onClick={() => carregar()}>Tentar de novo</button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-10">
      {falhaRecarga && (
        <Alert variant="warning" role="alert">
          <AlertDescription>
            Salvo, mas não foi possível atualizar a lista.{" "}
            <button type="button" className="underline" onClick={recarregar}>Atualizar</button>
          </AlertDescription>
        </Alert>
      )}
      <Progressos dados={estado.dados} aoMudar={recarregar} />
      <CatalogoDeFaixas dados={estado.dados} aoMudar={recarregar} />
    </div>
  );
};

// ------------------------------------------------------------------ progresso e registro

type Alvo = { aluno_id: string; modalidade_id: string } | "novo";

const Progressos: React.FC<{ dados: Dados; aoMudar: () => void }> = ({ dados, aoMudar }) => {
  const { academia } = usarPainel();
  const [modalidadeId, setModalidadeId] = useState("");
  const [turmaId, setTurmaId] = useState("");
  const [soAptos, setSoAptos] = useState(false);
  const [alunosDaTurma, setAlunosDaTurma] = useState<Set<string> | null>(null);
  const [turmaCarregando, setTurmaCarregando] = useState(false);
  const [falhaTurma, setFalhaTurma] = useState(false);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const registrar = podeRegistrarGraduacao(academia.papel, academia.ativa);

  // Turma escolhida: os alunos com matrícula vigente nela (no dia da academia).
  useEffect(() => {
    let vivo = true;
    setFalhaTurma(false);
    setAlunosDaTurma(null);
    if (!turmaId) {
      setTurmaCarregando(false);
      return;
    }
    setTurmaCarregando(true);
    lerTurma(academia.academia_id, turmaId, hojeNoFuso(academia.fuso))
      .then(({ matriculados }) => {
        if (!vivo) return;
        setAlunosDaTurma(new Set(matriculados.map((m) => m.aluno_id)));
        setTurmaCarregando(false);
      })
      .catch(() => {
        if (!vivo) return;
        setFalhaTurma(true);
        setTurmaCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [academia.academia_id, academia.fuso, turmaId]);

  const nomeModalidade = useMemo(
    () => new Map(dados.catalogo.modalidades.map((m) => [m.id, m.nome])),
    [dados.catalogo.modalidades]
  );
  // Como no registro novo, graduação nova só em modalidade ativa.
  const modalidadeAtiva = useMemo(
    () => new Set(dados.catalogo.modalidades.filter((m) => m.ativa).map((m) => m.id)),
    [dados.catalogo.modalidades]
  );
  const visiveis = filtrarProgresso(dados.progresso, { modalidadeId: modalidadeId || null, alunosDaTurma, soAptos });
  const turmasDaModalidade = dados.turmas.filter((t) => t.ativa && (!modalidadeId || t.modalidade_id === modalidadeId));

  return (
    <section aria-label="Progresso" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Graduações</h2>
        {registrar && alvo === null && (
          <Button size="sm" onClick={() => { setAviso(null); setAlvo("novo"); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Registrar graduação
          </Button>
        )}
      </div>

      {aviso && (
        <Alert variant="success" role="status">
          <AlertDescription>{aviso}</AlertDescription>
        </Alert>
      )}

      {alvo !== null && (
        <RegistroDeGraduacao
          dados={dados}
          alvo={alvo}
          aoTerminar={(salvou) => {
            setAlvo(null);
            if (salvou) {
              setAviso("Graduação registrada. O progresso do aluno nessa modalidade recomeça a contar.");
              aoMudar();
            }
          }}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
        <div className="space-y-1.5">
          <Label htmlFor="grad-modalidade">Modalidade</Label>
          <select id="grad-modalidade" className={SELECT} value={modalidadeId}
            onChange={(e) => { setModalidadeId(e.target.value); setTurmaId(""); }}>
            <option value="">Todas</option>
            {dados.catalogo.modalidades.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="grad-turma">Turma</Label>
          <select id="grad-turma" className={SELECT} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>
            <option value="">Todas</option>
            {turmasDaModalidade.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-zinc-300">
          <input type="checkbox" checked={soAptos} onChange={(e) => setSoAptos(e.target.checked)} />
          Só os aptos a graduar
        </label>
      </div>
      {falhaTurma && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Não foi possível carregar os alunos da turma: a lista abaixo não está filtrada por ela.</AlertDescription>
        </Alert>
      )}

      {turmaCarregando ? (
        <p role="status" className="text-sm text-zinc-500">Carregando os alunos da turma...</p>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-zinc-400">
          {dados.progresso.length === 0
            ? "Nenhum aluno graduado ainda. Registre a primeira graduação de cada aluno para acompanhar o progresso."
            : "Nenhum aluno com esses filtros."}
        </p>
      ) : (
        <ul aria-label="Progresso dos alunos" className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {visiveis.map((p) => (
            <li key={`${p.aluno_id}-${p.modalidade_id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium text-white">{p.aluno}</span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full border border-zinc-600"
                    style={{ backgroundColor: p.cor ?? "transparent" }} />
                  {nomeModalidade.get(p.modalidade_id) ?? ""} · {p.faixa}{p.grau ? `, grau ${p.grau}` : ""} · desde {dataBr(p.graduado_em)}
                </span>
                <span className="block text-xs text-zinc-500">
                  {p.aulas_desde} de {p.min_aulas} aulas · {p.meses_desde} de {p.min_meses} meses · próximo: {p.proximo_passo}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {p.apto && <Badge variant="success">Apto</Badge>}
                {registrar && alvo === null && modalidadeAtiva.has(p.modalidade_id) && (
                  <Button size="sm" variant="outline" aria-label={`Registrar graduação de ${p.aluno}`}
                    onClick={() => { setAviso(null); setAlvo({ aluno_id: p.aluno_id, modalidade_id: p.modalidade_id }); }}>
                    Registrar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const RegistroDeGraduacao: React.FC<{ dados: Dados; alvo: Alvo; aoTerminar: (salvou: boolean) => void }> = ({ dados, alvo, aoTerminar }) => {
  const { academia } = usarPainel();
  const hoje = hojeNoFuso(academia.fuso);
  const fixo = alvo !== "novo";
  const [alunoId, setAlunoId] = useState(fixo ? alvo.aluno_id : "");
  const [modalidadeId, setModalidadeId] = useState(fixo ? alvo.modalidade_id : "");
  const [faixaId, setFaixaId] = useState("");
  const [grau, setGrau] = useState("0");
  const [data, setData] = useState(hoje);
  const [professorId, setProfessorId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const faixas = dados.faixas.filter((f) => f.modalidade_id === modalidadeId).sort((a, b) => a.ordem - b.ordem);
  const faixa = faixas.find((f) => f.id === faixaId);
  const ativos = dados.alunos.filter((a) => a.situacao === "ativo");
  const nomeAluno = dados.alunos.find((a) => a.id === alunoId)?.nome ?? "";

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    const g = grau.trim() === "" ? Number.NaN : Number(grau);
    if (!alunoId) return setErro("Escolha o aluno.");
    if (!faixa) return setErro("Escolha a faixa.");
    if (!Number.isInteger(g) || g < 0 || g > faixa.max_graus) return setErro(`O grau vai de 0 a ${faixa.max_graus} nesta faixa.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return setErro("Informe a data da graduação.");
    if (data > hoje) return setErro("A data não pode ser no futuro.");
    setSalvando(true);
    const res = await registrarGraduacao(academia.academia_id, {
      aluno_id: alunoId,
      faixa_id: faixa.id,
      grau: g,
      data,
      professor_id: professorId || null,
      observacao: observacao.trim() || null,
    });
    if (!montado.current) return;
    setSalvando(false);
    if (!res.sucesso) return setErro(res.mensagem);
    aoTerminar(true);
  };

  return (
    <form onSubmit={enviar} noValidate aria-label="Registrar graduação" className="space-y-4 rounded-xl border border-zinc-800 p-4">
      <h3 className="font-semibold text-white">{fixo ? `Registrar graduação de ${nomeAluno}` : "Registrar graduação"}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {!fixo && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="reg-aluno">Aluno</Label>
              <select id="reg-aluno" className={SELECT} value={alunoId} onChange={(e) => setAlunoId(e.target.value)}>
                <option value="">Escolha...</option>
                {ativos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-modalidade">Modalidade</Label>
              <select id="reg-modalidade" className={SELECT} value={modalidadeId}
                onChange={(e) => { setModalidadeId(e.target.value); setFaixaId(""); }}>
                <option value="">Escolha...</option>
                {dados.catalogo.modalidades.filter((m) => m.ativa).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="reg-faixa">Faixa</Label>
          <select id="reg-faixa" className={SELECT} value={faixaId} onChange={(e) => setFaixaId(e.target.value)}>
            <option value="">Escolha...</option>
            {faixas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          {modalidadeId && faixas.length === 0 && (
            <p className="text-xs text-amber-300">Esta modalidade ainda não tem faixas: cadastre no catálogo abaixo.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-grau">Grau</Label>
          <Input id="reg-grau" type="number" min={0} max={faixa?.max_graus ?? 12} value={grau} onChange={(e) => setGrau(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-data">Data</Label>
          <Input id="reg-data" type="date" max={hoje} value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reg-professor">Professor</Label>
          <select id="reg-professor" className={SELECT} value={professorId} onChange={(e) => setProfessorId(e.target.value)}>
            <option value="">Sem professor</option>
            {dados.catalogo.professores.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-observacao">Observação</Label>
        <textarea id="reg-observacao" rows={2} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-100" />
      </div>
      {erro && <p role="alert" className="text-sm text-red-400">{erro}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvando}>{salvando ? "Salvando..." : "Salvar graduação"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={() => aoTerminar(false)}>Cancelar</Button>
      </div>
    </form>
  );
};

// ------------------------------------------------------------------ catálogo de faixas

/**
 * As faixas ficam aqui, junto do progresso que dependem delas: uma tela de
 * configuração separada fica para quando houver mais catálogo.
 */
const CatalogoDeFaixas: React.FC<{ dados: Dados; aoMudar: () => void }> = ({ dados, aoMudar }) => {
  const { academia } = usarPainel();
  const editar = podeEditarFaixas(academia.papel, academia.ativa);
  const [editando, setEditando] = useState<{ modalidadeId: string; faixa?: Faixa } | null>(null);

  return (
    <section aria-label="Faixas" className="space-y-4">
      <h2 className="text-lg font-bold text-white">Faixas por modalidade</h2>
      {dados.catalogo.modalidades.length === 0 && (
        <p className="text-sm text-zinc-400">Cadastre as modalidades na seção Turmas.</p>
      )}
      {dados.catalogo.modalidades.map((m) => {
        const faixas = dados.faixas.filter((f) => f.modalidade_id === m.id).sort((a, b) => a.ordem - b.ordem);
        return (
          <div key={m.id} className="space-y-2" role="group" aria-label={`Faixas de ${m.nome}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">{m.nome}</h3>
              {editar && editando === null && (
                <Button size="sm" variant="outline" aria-label={`Nova faixa em ${m.nome}`} onClick={() => setEditando({ modalidadeId: m.id })}>
                  <Plus className="w-4 h-4 mr-1.5" /> Faixa
                </Button>
              )}
            </div>
            {faixas.length === 0 ? (
              <p className="text-sm text-zinc-400">Nenhuma faixa.</p>
            ) : (
              <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
                {faixas.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-zinc-600"
                        style={{ backgroundColor: f.cor ?? "transparent" }} />
                      <span className="text-white">{f.ordem}. {f.nome}</span>
                      <span className="text-xs text-zinc-500">
                        {f.max_graus} graus · mínimo de {f.min_meses} meses e {f.min_aulas} aulas
                      </span>
                    </span>
                    {editar && editando === null && (
                      <Button size="sm" variant="ghost" aria-label={`Editar faixa ${f.nome} de ${m.nome}`}
                        onClick={() => setEditando({ modalidadeId: m.id, faixa: f })}>
                        Editar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editando?.modalidadeId === m.id && (
              <EdicaoDeFaixa
                modalidadeId={m.id}
                faixa={editando.faixa}
                proximaOrdem={(faixas.at(-1)?.ordem ?? 0) + 1}
                aoTerminar={(salvou) => {
                  setEditando(null);
                  if (salvou) aoMudar();
                }}
              />
            )}
          </div>
        );
      })}
    </section>
  );
};

const EdicaoDeFaixa: React.FC<{ modalidadeId: string; faixa?: Faixa; proximaOrdem: number; aoTerminar: (salvou: boolean) => void }> = ({
  modalidadeId, faixa, proximaOrdem, aoTerminar,
}) => {
  const { academia } = usarPainel();
  const [form, setForm] = useState<FormularioFaixa>({
    nome: faixa?.nome ?? "",
    cor: faixa?.cor ?? "",
    ordem: String(faixa?.ordem ?? proximaOrdem),
    max_graus: String(faixa?.max_graus ?? 4),
    min_meses: String(faixa?.min_meses ?? 0),
    min_aulas: String(faixa?.min_aulas ?? 0),
  });
  const [erros, setErros] = useState<ErrosFaixa>({});
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setFalha(null);
    const v = validarFaixa(form);
    if (!v.ok) return setErros(v.erros);
    setErros({});
    setSalvando(true);
    const res = await salvarFaixa(academia.academia_id, modalidadeId, v.dados, faixa?.id);
    setSalvando(false);
    if (!res.sucesso) return setFalha(res.mensagem);
    aoTerminar(true);
  };

  const campo = (c: keyof FormularioFaixa, rotulo: string, tipo = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`faixa-${c}`}>{rotulo}</Label>
      <Input id={`faixa-${c}`} type={tipo} value={form[c]} onChange={(e) => setForm({ ...form, [c]: e.target.value })}
        aria-invalid={erros[c] ? true : undefined} aria-describedby={erros[c] ? `faixa-${c}-erro` : undefined} />
      {erros[c] && <p id={`faixa-${c}-erro`} className="text-xs text-red-400">{erros[c]}</p>}
    </div>
  );

  return (
    <form onSubmit={enviar} noValidate aria-label={faixa ? "Editar faixa" : "Nova faixa"} className="space-y-3 rounded-xl border border-zinc-800 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {campo("nome", "Nome da faixa")}
        {campo("cor", "Cor (#RRGGBB)")}
        {campo("ordem", "Ordem")}
        {campo("max_graus", "Graus")}
        {campo("min_meses", "Mínimo de meses")}
        {campo("min_aulas", "Mínimo de aulas")}
      </div>
      {falha && <p role="alert" className="text-xs text-red-400">{falha}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvando}>{salvando ? "Salvando..." : "Salvar faixa"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={() => aoTerminar(false)}>Cancelar</Button>
      </div>
    </form>
  );
};
