import React, { useEffect, useState, useCallback } from "react";
import {
  AcademiaPublica,
  MatriculaOnlinePayload,
} from "../../types/app";
import { obterAcademiaPublica, submeterMatriculaOnline } from "../../lib/supabase";
import {
  formatarCPF,
  formatarTelefone,
  formatarMoeda,
  formatarDiaSemana,
  calcularIdade,
} from "../../lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  User,
  ShieldCheck,
  Phone,
  Mail,
  HeartPulse,
  Award,
  ArrowRight,
  Sparkles,
} from "lucide-react";

interface MatriculaPageProps {
  slug: string;
}

const TurmaCard = React.memo(({ turma, selecionada, onToggle }: { turma: any, selecionada: boolean, onToggle: (id: string) => void }) => {
  return (
    <div
      onClick={() => onToggle(turma.id)}
      className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none flex flex-col justify-between ${
        selecionada
          ? "border-red-600 bg-red-950/20 shadow-md ring-1 ring-red-600/50"
          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="font-semibold text-sm text-white">{turma.nome}</p>
          <Badge variant="outline" className="text-[10px] mt-1 capitalize text-zinc-400">
            Público: {turma.publico}
          </Badge>
        </div>
        <input
          type="checkbox"
          checked={selecionada}
          onChange={() => {}} // tratado no onClick do container
          className="h-4 w-4 rounded accent-red-600 cursor-pointer"
        />
      </div>

      <div className="space-y-1 mt-2 pt-2 border-t border-zinc-800/80">
        {turma.horarios.map((h: any, idx: number) => (
          <div key={idx} className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="w-3 h-3 text-red-400" />
            <span>
              {formatarDiaSemana(h.dia_semana)}: {h.inicio} às {h.fim}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export const MatriculaPage: React.FC<MatriculaPageProps> = ({ slug }) => {
  const [academia, setAcademia] = useState<AcademiaPublica | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [erroMsg, setErroMsg] = useState<string | null>(null);
  const [sucessoProtocolo, setSucessoProtocolo] = useState<string | null>(null);

  // Form states
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");

  // Responsável (se menor de 18)
  const [responsavelNome, setResponsavelNome] = useState("");
  const [responsavelCpf, setResponsavelCpf] = useState("");
  const [responsavelTelefone, setResponsavelTelefone] = useState("");

  // Saúde e emergência
  const [contatoEmergencia, setContatoEmergencia] = useState("");
  const [observacoesMedicas, setObservacoesMedicas] = useState("");

  // Seleções
  const [planoId, setPlanoId] = useState<string>("");
  const [turmasSelecionadas, setTurmasSelecionadas] = useState<string[]>([]);
  const [aceiteTermo, setAceiteTermo] = useState<boolean>(false);

  const idade = calcularIdade(dataNascimento);
  const isMenor = idade !== null && idade < 18;

  useEffect(() => {
    carregarDados();
  }, [slug]);

  const carregarDados = async () => {
    setLoading(true);
    setErroMsg(null);
    setSucessoProtocolo(null);
    try {
      const data = await obterAcademiaPublica(slug);
      setAcademia(data);
      if (data && data.planos.length > 0) {
        setPlanoId(data.planos[0].id);
      }
    } catch (err: any) {
      setErroMsg("Erro ao carregar dados da academia.");
    } finally {
      setLoading(false);
    }
  };

  const toggleTurma = useCallback((id: string) => {
    setTurmasSelecionadas((prev) => {
      if (prev.includes(id)) {
        return prev.filter((t) => t !== id);
      } else {
        return [...prev, id];
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroMsg(null);

    // Validações no front
    if (!nome.trim()) {
      setErroMsg("Por favor, preencha o nome completo.");
      return;
    }

    if (!aceiteTermo) {
      setErroMsg("É obrigatório concordar com o termo de responsabilidade para prosseguir.");
      return;
    }

    if (isMenor) {
      if (!responsavelNome.trim() || !responsavelCpf.trim()) {
        setErroMsg("Menores de idade precisam de responsável legal (nome e CPF obrigatórios).");
        return;
      }
    }

    setSubmitting(true);

    const payload: MatriculaOnlinePayload = {
      nome: nome.trim(),
      cpf: cpf.trim() || undefined,
      data_nascimento: dataNascimento || undefined,
      telefone: telefone.trim() || undefined,
      email: email.trim() || undefined,
      responsavel_nome: isMenor ? responsavelNome.trim() : undefined,
      responsavel_cpf: isMenor ? responsavelCpf.trim() : undefined,
      responsavel_telefone: isMenor ? responsavelTelefone.trim() : undefined,
      contato_emergencia: contatoEmergencia.trim() || undefined,
      observacoes_medicas: observacoesMedicas.trim() || undefined,
      aceite_termo: true,
      plano_id: planoId || undefined,
      turma_ids: turmasSelecionadas.length > 0 ? turmasSelecionadas : undefined,
    };

    const res = await submeterMatriculaOnline(slug, payload);
    setSubmitting(false);

    if (res.sucesso) {
      setSucessoProtocolo(res.matricula_id || "MAT-" + Math.floor(100000 + Math.random() * 900000));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setErroMsg(res.mensagem || "Não foi possível concluir sua matrícula. Procure a recepção.");
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-16 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 rounded-full border-4 border-red-600/20 border-t-red-600 animate-spin mb-4" />
        <p className="text-zinc-400 text-sm animate-pulse">Carregando formulário de matrícula...</p>
      </div>
    );
  }

  if (!academia || !academia.matricula_online_aberta) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-16">
        <Card className="border-red-900/40 bg-zinc-950/90 text-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4 text-amber-500">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <CardTitle className="text-xl mb-2 text-zinc-100">
            Matrículas Online Indisponíveis
          </CardTitle>
          <CardDescription className="text-zinc-400 mb-6">
            A unidade <strong className="text-zinc-200">{academia?.nome || slug}</strong> não está recebendo novas matrículas online no momento.
          </CardDescription>
          <p className="text-sm text-zinc-400 mb-6">
            Para saber sobre vagas, horários e condições especiais, por favor entre em contato diretamente com a nossa recepção ou direção.
          </p>
          <Button
            variant="outline"
            className="w-full gap-2 border-zinc-700 hover:bg-zinc-800"
            onClick={() => window.location.reload()}
          >
            Atualizar Página
          </Button>
        </Card>
      </div>
    );
  }

  // Tela de Sucesso
  if (sucessoProtocolo) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-12">
        <Card className="border-emerald-800/50 bg-gradient-to-b from-zinc-900 to-zinc-950 overflow-hidden shadow-2xl">
          <div className="h-2 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <CardContent className="pt-8 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center mx-auto mb-5 text-emerald-400 animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <Badge variant="success" className="mb-3 text-xs uppercase tracking-wider">
              Solicitação Enviada com Sucesso
            </Badge>

            <h2 className="text-2xl font-extrabold text-white tracking-tight mb-2">
              Bem-vindo ao Tatame!
            </h2>
            <p className="text-zinc-400 text-sm max-w-md mx-auto mb-6">
              Sua pré-matrícula para <strong className="text-white">{nome}</strong> na unidade <strong className="text-white">{academia.nome}</strong> foi registrada.
            </p>

            <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 text-left mb-6 space-y-2.5">
              <div className="flex justify-between items-center text-xs border-b border-zinc-800 pb-2">
                <span className="text-zinc-400 font-mono">Protocolo:</span>
                <span className="font-mono font-bold text-emerald-400">{sucessoProtocolo}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-400">Status:</span>
                <Badge variant="outline" className="text-amber-300 border-amber-800/60 bg-amber-950/30">
                  Aguardando Validação da Recepção
                </Badge>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-400">Data de Envio:</span>
                <span className="text-zinc-300">{new Date().toLocaleDateString("pt-BR")}</span>
              </div>
            </div>

            <div className="bg-zinc-950/60 rounded-xl p-4 border border-zinc-800/80 text-left text-xs text-zinc-300 space-y-2 mb-6">
              <div className="flex items-center gap-2 font-semibold text-zinc-100">
                <Sparkles className="w-4 h-4 text-red-500" />
                Próximos Passos:
              </div>
              <p className="text-zinc-400 leading-relaxed">
                1. Nossa equipe entrará em contato pelo WhatsApp informado para tirar dúvidas e efetivar seu plano.
              </p>
              <p className="text-zinc-400 leading-relaxed">
                2. Na sua primeira aula, basta apresentar seu documento de identidade na recepção para receber o acesso ao Portal do Aluno e ao sistema de Check-in por QR Code.
              </p>
            </div>

            <Button
              className="w-full gap-2 font-bold"
              size="lg"
              onClick={() => {
                setSucessoProtocolo(null);
                setNome("");
                setCpf("");
                setTelefone("");
                setEmail("");
                setResponsavelNome("");
                setResponsavelCpf("");
                setResponsavelTelefone("");
                setAceiteTermo(false);
              }}
            >
              Fazer Outra Matrícula
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      {/* Top Banner da Academia */}
      <div className="text-center mb-8">
        <Badge variant="secondary" className="mb-2 uppercase tracking-widest text-[10px]">
          Matrícula Online Oficial
        </Badge>
        <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
          {academia.nome}
        </h1>
        <p className="text-sm text-zinc-400 mt-2 max-w-lg mx-auto">
          Preencha o formulário abaixo para garantir sua vaga e iniciar seus treinos.
        </p>
      </div>

      {erroMsg && (
        <Alert variant="destructive" className="mb-6 shadow-lg animate-in fade-in">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <AlertTitle>Não foi possível enviar</AlertTitle>
            <AlertDescription>{erroMsg}</AlertDescription>
          </div>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Bloco 1: Escolha do Treino & Turmas */}
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-red-500">
              <Award className="w-5 h-5" />
              <CardTitle className="text-lg">1. Escolha suas Turmas e Horários</CardTitle>
            </div>
            <CardDescription>
              Selecione as turmas que pretende frequentar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {academia.turmas.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">
                Nenhuma turma aberta no catálogo online. A recepção definirá seus horários após o envio.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {academia.turmas.map((turma) => (
                  <TurmaCard
                    key={turma.id}
                    turma={turma}
                    selecionada={turmasSelecionadas.includes(turma.id)}
                    onToggle={toggleTurma}
                  />
                ))}
              </div>
            )}

            {/* Planos Disponíveis */}
            {academia.planos.length > 0 && (
              <div className="mt-5 pt-4 border-t border-zinc-800">
                <Label className="mb-2">Plano de Preferência</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {academia.planos.map((plano) => {
                    const ativo = planoId === plano.id;
                    return (
                      <div
                        key={plano.id}
                        onClick={() => setPlanoId(plano.id)}
                        className={`p-3 rounded-xl border text-center cursor-pointer transition-all ${
                          ativo
                            ? "border-red-600 bg-red-950/30 ring-1 ring-red-600"
                            : "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900"
                        }`}
                      >
                        <p className="font-semibold text-xs text-zinc-200">{plano.nome}</p>
                        <p className="text-base font-extrabold text-white mt-1">
                          {formatarMoeda(plano.valor)}
                        </p>
                        <span className="text-[10px] text-zinc-400 capitalize">
                          Cobrança {plano.periodicidade}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bloco 2: Dados Pessoais do Aluno */}
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-red-500">
              <User className="w-5 h-5" />
              <CardTitle className="text-lg">2. Dados Pessoais do Aluno</CardTitle>
            </div>
            <CardDescription>
              Informações cadastrais para identificação e histórico esportivo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label htmlFor="nome" required>Nome Completo do Aluno</Label>
                <Input
                  id="nome"
                  placeholder="Ex: Carlos Gracie Silva"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="dataNascimento" required>Data de Nascimento</Label>
                <div className="relative mt-1">
                  <Input
                    id="dataNascimento"
                    type="date"
                    value={dataNascimento}
                    onChange={(e) => setDataNascimento(e.target.value)}
                    required
                  />
                </div>
                {idade !== null && (
                  <p className="text-xs text-zinc-400 mt-1">
                    Idade calculada: <strong className="text-white">{idade} anos</strong>
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="cpf" required={!isMenor}>
                  CPF do Aluno {isMenor && <span className="text-xs text-zinc-500">(opcional se menor)</span>}
                </Label>
                <Input
                  id="cpf"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={(e) => setCpf(formatarCPF(e.target.value))}
                  maxLength={14}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="telefone" required>Telefone / WhatsApp</Label>
                <div className="relative mt-1">
                  <Input
                    id="telefone"
                    placeholder="(00) 00000-0000"
                    value={telefone}
                    onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
                    maxLength={15}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="email">E-mail para Acesso ao Portal</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="aluno@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Condicional para Menor de 18 Anos */}
            {isMenor && (
              <div className="mt-4 p-4 rounded-xl border border-amber-800/60 bg-amber-950/20 space-y-4 animate-in fade-in">
                <div className="flex items-center gap-2 text-amber-400">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-bold text-sm">Dados do Responsável Legal</p>
                    <p className="text-xs text-amber-200/80">
                      O aluno é menor de idade. O preenchimento do responsável é obrigatório.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-3">
                    <Label htmlFor="responsavelNome" required>Nome Completo do Responsável</Label>
                    <Input
                      id="responsavelNome"
                      placeholder="Ex: Maria Aparecida Silva"
                      value={responsavelNome}
                      onChange={(e) => setResponsavelNome(e.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="responsavelCpf" required>CPF do Responsável</Label>
                    <Input
                      id="responsavelCpf"
                      placeholder="000.000.000-00"
                      value={responsavelCpf}
                      onChange={(e) => setResponsavelCpf(formatarCPF(e.target.value))}
                      maxLength={14}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="responsavelTelefone">WhatsApp do Responsável</Label>
                    <Input
                      id="responsavelTelefone"
                      placeholder="(00) 00000-0000"
                      value={responsavelTelefone}
                      onChange={(e) => setResponsavelTelefone(formatarTelefone(e.target.value))}
                      maxLength={15}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bloco 3: Saúde e Emergência */}
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-red-500">
              <HeartPulse className="w-5 h-5" />
              <CardTitle className="text-lg">3. Saúde e Emergência</CardTitle>
            </div>
            <CardDescription>
              Informações para segurança e primeiros socorros no tatame
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="contatoEmergencia">Contato de Emergência (Nome e Telefone)</Label>
              <Input
                id="contatoEmergencia"
                placeholder="Ex: Tio Roberto - (11) 98888-7777"
                value={contatoEmergencia}
                onChange={(e) => setContatoEmergencia(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="observacoesMedicas">Observações Médicas ou Alergias</Label>
              <textarea
                id="observacoesMedicas"
                rows={2}
                placeholder="Ex: Asma leve, uso de bombinha se necessário. Nenhuma restrição osteoarticular."
                value={observacoesMedicas}
                onChange={(e) => setObservacoesMedicas(e.target.value)}
                className="w-full mt-1 rounded-lg border border-zinc-800 bg-zinc-900/90 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 transition-colors"
              />
            </div>
          </CardContent>
        </Card>

        {/* Bloco 4: Termo de Adesão & Aceite */}
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 text-red-500">
              <ShieldCheck className="w-5 h-5" />
              <CardTitle className="text-lg">4. Termo de Responsabilidade</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-32 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400 leading-relaxed space-y-2">
              <p>
                <strong>TERMO DE ADESÃO E RESPONSABILIDADE CIVIL E ESPORTIVA:</strong>
              </p>
              <p>
                1. Declaro estar em plenas condições físicas e mentais para a prática de artes marciais e atividades esportivas de contato, não tendo conhecimento de contraindicação médica.
              </p>
              <p>
                2. Comprometo-me a seguir as regras de conduta, respeito aos mestres, instrutores e colegas de treino, bem como o uso obrigatório de uniforme/kimono limpo e equipamentos de segurança.
              </p>
              <p>
                3. Em caso de aluno menor de idade, o responsável legal assume integral responsabilidade civil pela autorização da prática esportiva na academia.
              </p>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aceiteTermo}
                onChange={(e) => setAceiteTermo(e.target.checked)}
                className="mt-1 h-4 w-4 rounded accent-red-600 cursor-pointer"
                required
              />
              <span className="text-xs text-zinc-300">
                Li e concordo expressamente com o <strong>Termo de Adesão</strong> e autorizo o envio dos meus dados para pré-matrícula na academia.
              </span>
            </label>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              type="submit"
              size="lg"
              disabled={submitting}
              className="w-full gap-2 text-base font-bold shadow-lg shadow-red-900/30"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  Processando Pré-matrícula...
                </>
              ) : (
                <>
                  Enviar Solicitação de Matrícula
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
};
