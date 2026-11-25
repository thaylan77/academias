// Edge Function convidar-membro: dono ou admin convida alguém para a equipe
// por e-mail (docs/specs/convite-membros.md, 4.4). Entrada:
// { academia_id, email, papel }, com o JWT de quem convida.

import { clientesDoAmbiente, depsConvidar } from "../_shared/clientes.ts";
import { convidarMembro } from "../_shared/convidar.ts";

const siteUrl = Deno.env.get("SITE_URL");
if (!siteUrl) throw new Error("variável de ambiente ausente: SITE_URL");
const deps = depsConvidar(clientesDoAmbiente(), siteUrl);

Deno.serve((req) => convidarMembro(req, deps));
