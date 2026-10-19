import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

type Chamada = { tabela: string; metodo: string; args: unknown[] };
type Resposta = { data: unknown; error: unknown };

/** Cliente falso: registra cada chamada e responde sempre `resposta`. */
function clienteFalso(resposta: Resposta) {
  const chamadas: Chamada[] = [];
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order", "limit"]) {
      q[metodo] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return q;
      };
    }
    q.then = (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, falha);
    return q;
  });
  return { from, rpc: vi.fn(), chamadas, auth: { onAuthStateChange: vi.fn() } };
}

async function carregarComCliente(cliente: unknown) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-anon-de-teste");
  const sb = await import("@supabase/supabase-js");
  (sb.createClient as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(cliente);
  return import("../lib/checkins-da-aula");
}

const T1 = "fa000000-0000-4000-8000-0000000004a1";

describe("listarCheckinsDaAula (com cliente)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("filtra por academia, turma e dia, do mais recente para o mais antigo", async () => {
    const cliente = clienteFalso({
      data: [
        { id: "p1", aluno_id: "al-1", checkin_em: "2026-10-19T22:10:00Z", origem: "professor", alunos: { nome: "Ana" } },
        { id: "p2", aluno_id: "al-2", checkin_em: "2026-10-19T22:00:00Z", origem: "outra", alunos: null },
        { id: "p3", aluno_id: "al-3", checkin_em: "2026-10-19T21:55:00Z", origem: "qrcode", alunos: { nome: "Bia" } },
        { id: "p4", aluno_id: "al-4", checkin_em: "2026-10-19T21:50:00Z", origem: "recepcao", alunos: { nome: "Caio" } },
      ],
      error: null,
    });
    const lib = await carregarComCliente(cliente);
    const lista = await lib.listarCheckinsDaAula("acad-a", T1, "2026-10-19");

    expect(cliente.from).toHaveBeenCalledWith("presencas");
    expect(cliente.chamadas.find((c) => c.metodo === "select")?.args[0]).toBe("id, aluno_id, checkin_em, origem, alunos(nome)");
    const de = (m: string) => cliente.chamadas.filter((c) => c.metodo === m).map((c) => c.args);
    expect(de("eq")).toEqual([["academia_id", "acad-a"], ["turma_id", T1], ["data", "2026-10-19"]]);
    expect(de("order")).toEqual([["checkin_em", { ascending: false }], ["id"]]);
    expect(lista).toEqual([
      { id: "p1", aluno_id: "al-1", aluno: "Ana", checkin_em: "2026-10-19T22:10:00Z", origem: "professor" },
      { id: "p2", aluno_id: "al-2", aluno: "", checkin_em: "2026-10-19T22:00:00Z", origem: "recepcao" },
      { id: "p3", aluno_id: "al-3", aluno: "Bia", checkin_em: "2026-10-19T21:55:00Z", origem: "qrcode" },
      { id: "p4", aluno_id: "al-4", aluno: "Caio", checkin_em: "2026-10-19T21:50:00Z", origem: "recepcao" },
    ]);
  });

  it("sem linhas (data nula), devolve lista vazia", async () => {
    const lib = await carregarComCliente(clienteFalso({ data: null, error: null }));
    await expect(lib.listarCheckinsDaAula("acad-a", T1, "2026-10-19")).resolves.toEqual([]);
  });

  it("data inexistente é recusada sem consultar", async () => {
    const cliente = clienteFalso({ data: [], error: null });
    const lib = await carregarComCliente(cliente);
    for (const d of ["2026-02-31", "2026-13-01", "19/10/2026", ""]) {
      await expect(lib.listarCheckinsDaAula("acad-a", T1, d)).rejects.toThrow("Data inválida.");
    }
    expect(cliente.from).not.toHaveBeenCalled();
  });

  it("repassa o erro da leitura", async () => {
    const lib = await carregarComCliente(clienteFalso({ data: null, error: { message: "permission denied" } }));
    await expect(lib.listarCheckinsDaAula("acad-a", T1, "2026-10-19")).rejects.toEqual({ message: "permission denied" });
  });
});
