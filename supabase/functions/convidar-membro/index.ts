// Edge Function convidar-membro: dono ou admin convida alguém para a equipe
// por e-mail (docs/specs/convite-membros.md, 4.4). Entrada:
// { academia_id, email, papel }, com o JWT de quem convida.

import { clientesDoAmbiente, depsConvidar } from "../_shared/clientes.ts";
import { convidarMembro } from "../_shared/convidar.ts";
import { siteUrlValida } from "../_shared/http.ts";

const deps = depsConvidar(clientesDoAmbiente(), siteUrlValida(Deno.env.get("SITE_URL")));

Deno.serve((req) => convidarMembro(req, deps));
