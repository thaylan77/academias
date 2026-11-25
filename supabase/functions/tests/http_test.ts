import { assertEquals, assertThrows } from "@std/assert";
import {
  claimsDoToken,
  codigoDoErro,
  emailMascarado,
  hintDoErro,
  siteUrlValida,
  tokenDoPedido,
} from "../_shared/http.ts";
import { jwtFalso } from "./apoio.ts";

Deno.test("SITE_URL: normaliza e recusa valor ausente ou malformado", () => {
  assertEquals(siteUrlValida(" https://painel.exemplo.test/ "), "https://painel.exemplo.test");
  assertEquals(siteUrlValida("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (
    const v of [undefined, "", "painel.exemplo.test", "javascript:alert(1)", "https://x.test/?a=1", "https://x.test/#a"]
  ) {
    assertThrows(() => siteUrlValida(v), Error, undefined, String(v));
  }
});

Deno.test("claims do token: iat inteiro, session_id e amr; token estranho não quebra", () => {
  assertEquals(claimsDoToken(jwtFalso({ iat: 10.7, session_id: "s", amr: [{ method: "otp" }] })), {
    iat: 10,
    sessao: "s",
    amr: [{ method: "otp" }],
  });
  assertEquals(claimsDoToken("abc"), { iat: null, sessao: null, amr: [] });
  assertEquals(claimsDoToken("a.%%%.c"), { iat: null, sessao: null, amr: [] });
});

Deno.test("token do pedido só no formato Bearer", () => {
  const r = (h?: string) => new Request("http://x", { headers: h ? { Authorization: h } : {} });
  assertEquals(tokenDoPedido(r("Bearer abc.def.ghi")), "abc.def.ghi");
  assertEquals(tokenDoPedido(r("Basic abc")), null);
  assertEquals(tokenDoPedido(r()), null);
});

Deno.test("hint e código só em formato estável; e-mail mascarado", () => {
  assertEquals(hintDoErro({ hint: "ja_membro" }), "ja_membro");
  assertEquals(hintDoErro({ hint: "Texto Livre com espaço" }), null);
  assertEquals(codigoDoErro({ code: "40P01" }), "40P01");
  assertEquals(codigoDoErro({ code: "texto livre" }), "?");
  assertEquals(emailMascarado("pessoa@exemplo.test"), "p***@exemplo.test");
});
