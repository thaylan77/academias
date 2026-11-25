// Edge Function concluir-senha: grava a senha nova do convite e a prova que
// o aceite exige (docs/specs/convite-membros.md, 4.4). Entrada: { senha },
// com o JWT da sessão aberta pelo link do e-mail.

import { clientesDoAmbiente, depsSenha } from "../_shared/clientes.ts";
import { concluirSenha } from "../_shared/senha.ts";

const deps = depsSenha(clientesDoAmbiente());

Deno.serve((req) => concluirSenha(req, deps));
