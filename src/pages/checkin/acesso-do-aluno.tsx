import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  emailDaSessao,
  enviarLinkDeAcesso,
  normalizarEmail,
  observarLogin,
  sairDoPortal,
  vincularCadastro,
} from "../../lib/portal";
import { Card, CardContent, CardDescription, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Alert, AlertDescription } from "../../components/ui/alert";

type Estado =
  | { fase: "carregando" }
  | { fase: "sem_login" }
  | { fase: "ligando"; email: string }
  | { fase: "pronto"; email: string }
  | { fase: "erro_vinculo"; email: string; mensagem: string };

/**
 * Portão do check-in: sem login, pede o e-mail e manda o link mágico de volta
 * para esta mesma página (com a turma e o token do QR); com login, liga o
 * cadastro uma vez e mostra o check-in. Sem servidor (demonstração), mostra o
 * check-in direto.
 */
export const AcessoDoAluno: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!supabase) return <>{children}</>;
  return <Portao>{children}</Portao>;
};

const Portao: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  // O último e-mail já ligado: o aviso de login de outra aba não liga de novo.
  const ligado = useRef<string | null>(null);

  useEffect(() => {
    let vale = true;
    const ligar = async (email: string | null) => {
      if (!vale) return;
      if (!email) {
        ligado.current = null;
        setEstado({ fase: "sem_login" });
        return;
      }
      if (ligado.current === email) return;
      ligado.current = email;
      setEstado({ fase: "ligando", email });
      const res = await vincularCadastro();
      if (!vale || ligado.current !== email) return;
      setEstado(res.sucesso ? { fase: "pronto", email } : { fase: "erro_vinculo", email, mensagem: res.mensagem });
    };
    emailDaSessao()
      .then(ligar)
      .catch(() => vale && setEstado({ fase: "sem_login" }));
    const parar = observarLogin((email) => void ligar(email));
    return () => {
      vale = false;
      parar();
    };
  }, []);

  if (estado.fase === "carregando") {
    return <p role="status" className="container mx-auto px-4 py-16 text-center text-sm text-zinc-500">Carregando...</p>;
  }
  if (estado.fase === "sem_login") return <PedirLink />;

  return (
    <div>
      <div className="container mx-auto max-w-xl px-4 pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <span>Entrou como <strong className="text-zinc-200">{estado.email}</strong></span>
        <BotaoSair />
      </div>
      {estado.fase === "ligando" && (
        <p role="status" className="container mx-auto px-4 py-16 text-center text-sm text-zinc-500">Ligando seu cadastro...</p>
      )}
      {estado.fase === "erro_vinculo" && (
        <div className="container mx-auto max-w-xl px-4 py-8">
          <Alert variant="destructive" role="alert">
            <AlertDescription>{estado.mensagem}</AlertDescription>
          </Alert>
        </div>
      )}
      {estado.fase === "pronto" && children}
    </div>
  );
};

const BotaoSair: React.FC = () => {
  const [falhou, setFalhou] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const sair = async () => {
    setSaindo(true);
    setFalhou(false);
    const ok = await sairDoPortal();
    setSaindo(false);
    // Saiu: o aviso de login muda o portão para o pedido de link.
    if (!ok) setFalhou(true);
  };
  return (
    <span className="flex items-center gap-2">
      {falhou && <span role="alert" className="text-red-400">Não foi possível sair. Tente de novo.</span>}
      <Button size="sm" variant="outline" disabled={saindo} onClick={sair}>{saindo ? "Saindo..." : "Sair"}</Button>
    </span>
  );
};

const PedirLink: React.FC = () => {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra clique duplo ou Enter repetido.
  const emAndamento = useRef(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emAndamento.current) return;
    const valido = normalizarEmail(email);
    if (!valido) return setErro("Informe um e-mail válido.");
    setErro(null);
    emAndamento.current = true;
    setEnviando(true);
    const res = await enviarLinkDeAcesso(valido, window.location.href);
    emAndamento.current = false;
    setEnviando(false);
    if (res.sucesso) setEnviadoPara(valido);
    else setErro(res.mensagem);
  };

  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <Card className="border-zinc-800 bg-zinc-950/80">
        <CardContent className="space-y-4 p-6">
          <div>
            <CardTitle className="text-xl text-white">Entrar para fazer o check-in</CardTitle>
            <CardDescription className="mt-1 text-xs text-zinc-400">
              Use o e-mail do seu cadastro na academia (ou o do responsável, para alunos menores). Mandamos um link de
              acesso: abra no mesmo aparelho e o check-in continua daqui.
            </CardDescription>
          </div>
          {enviadoPara ? (
            <Alert variant="success" role="status">
              <AlertDescription>
                Link enviado para <strong>{enviadoPara}</strong>. Abra o e-mail neste aparelho. Se o QR da aula tiver mudado
                até lá, é só ler o novo.
                <button type="button" className="mt-2 block underline" onClick={() => setEnviadoPara(null)}>
                  Usar outro e-mail
                </button>
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={enviar} noValidate aria-label="Entrar" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="portal-email">E-mail</Label>
                <Input id="portal-email" type="email" autoComplete="email" inputMode="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} aria-invalid={erro ? true : undefined}
                  aria-describedby={erro ? "portal-email-erro" : undefined} />
              </div>
              {erro && <p id="portal-email-erro" role="alert" className="text-xs text-red-400">{erro}</p>}
              <Button type="submit" className="w-full" disabled={enviando}>{enviando ? "Enviando..." : "Receber link de acesso"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
