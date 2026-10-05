# Honor Team SaaS — instruções para agentes

Este arquivo vale para todos os agentes (Claude Code, Codex, Antigravity).
Responda, comente código e escreva mensagens de commit em **português**.

## Produto

SaaS multi-academia de gestão para academias de artes marciais: alunos,
matrícula online, turmas, frequência (check-in), graduações (faixas e graus)
e financeiro. Cada academia é um tenant (tabela `academias`).

Usuários:
- **Equipe**: dono, admin, professor, recepção (painel).
- **Alunos / responsáveis**: portal do aluno (check-in, graduação, pagamentos).
- **Visitante anônimo**: página pública de matrícula `/{slug}/matricula`.

## Stack

- Supabase: Postgres 15+, Auth, Storage, Edge Functions (Deno).
- Front: React + Vite + TypeScript + Tailwind + shadcn/ui. *(ajuste se mudar)*
- Pagamentos: gateway (Asaas, Efí ou Mercado Pago) via Edge Function + webhook.
- WhatsApp: Cloud API oficial via Edge Function.

## Comandos

```bash
# CLI do Supabase sempre na versão fixada no CI (a saída de gen types varia):
npx supabase@2.119.0 migration new <nome>   # nova migration
npm run dev | npm run build | npm run lint | npm test

# Só com Docker (não é o caso da máquina principal do projeto):
supabase start                      # sobe o banco local
supabase db reset                   # recria o banco local (migrations + seed)
supabase test db                    # roda os testes pgTAP no banco local
```

## Ambientes de banco

- **CI é o "verde" oficial.** O workflow `Banco` (`.github/workflows/banco.yml`)
  aplica todas as migrations do zero e roda os testes pgTAP a cada push e
  pull request. Validação feita de outro jeito (PGlite, Postgres temporário)
  ajuda a desenvolver, mas não conta como verde: diga no PR o que rodou onde.
- **Não há Supabase local na máquina principal** (sem Docker). Não tente
  `supabase start`, `supabase db reset` nem `supabase test db` nela.
- **`honorteam-dev`** é o projeto Supabase de dev compartilhado: ref
  `eugtoifaryynoqwozgcc`, região São Paulo (`sa-east-1`), Postgres 17,
  `https://eugtoifaryynoqwozgcc.supabase.co`. Lá só entra `main`, via
  `supabase db push`, depois do merge. Nunca aplique branch de feature nem
  rode `db reset` nele.
- Depois de cada merge que traga migration, na pasta original (`academias`,
  em `main`, já linkada ao projeto): `npx supabase@2.119.0 db push`.
  Precisa de `supabase login` na máquina.
- O front de dev aponta para o `honorteam-dev` só com a URL e a chave
  `anon`/publishable. A `service_role` desse projeto não vai para `.env`
  de front nem para o repositório.
- **Testes pgTAP nunca rodam contra o `honorteam-dev`** (nada de
  `supabase test db --linked` nem `--db-url` apontando para ele).
- **Os tipos (`src/types/database.ts`) saem do CI**, nunca do
  `honorteam-dev`. O workflow `Banco` roda
  `supabase gen types typescript --local`, publica o resultado como artifact
  `database-types` e **falha se ele diferir do arquivo commitado**.
  PR que muda o schema: espere o CI falhar nesse passo, baixe o artifact
  daquela execução (`gh run download <run> -n database-types`) e commite como
  `src/types/database.ts` na própria branch. Não edite o arquivo à mão nem
  gere com `--linked`: a saída tem outro formato e o CI recusa.
- A versão da CLI é fixa (`2.119.0`) no workflow e no `npx` dos agentes.
  Para trocar, mude os dois no mesmo PR e regenere os tipos.

## Estrutura

```
supabase/migrations/   SQL versionado. NUNCA editar migration já aplicada: crie outra.
supabase/functions/    Edge Functions (únicas que podem usar service_role)
supabase/seed.sql      dados de exemplo para dev local
src/                   front-end
src/types/database.ts  tipos gerados do banco (não editar à mão)
```

## Regras multi-tenant (não negociáveis)

1. Toda tabela de negócio tem `academia_id uuid not null`, RLS ligado e
   políticas usando as funções helper abaixo. Nunca desligue RLS "para testar".
   Também tem o trigger `<tabela>_academia_imutavel`
   (`before update of academia_id`, função `bloqueia_troca_academia`):
   nenhum registro muda de academia.
2. Tabela que é referenciada por outras tem `unique (academia_id, id)`.
3. Toda referência entre tabelas é FK composta:
   `foreign key (academia_id, x_id) references x (academia_id, id)`.
   Isso impede ligar registro de uma academia a outra, mesmo sabendo o UUID.
4. `service_role` nunca vai para o front. Só Edge Functions usam.
5. O front sempre filtra por `academia_id` da academia selecionada (um
   usuário pode ser membro de várias academias; o RLS protege, o filtro
   evita misturar dados na tela).
6. Fluxo com regra de negócio ou acesso anônimo = função RPC
   `security definer` com `set search_path = ''`, nomes qualificados
   (`public.tabela`), `revoke execute ... from public, anon` e grant explícito.
7. Views sempre `with (security_invoker = true)`.
8. Política RLS que chama `auth.uid()` direto usa `(select auth.uid())`.

## Papéis e permissões

| Papel     | Lê                                         | Escreve                                      |
|-----------|--------------------------------------------|----------------------------------------------|
| dono      | tudo da academia                           | tudo; único que cria/altera outro dono       |
| admin     | tudo da academia                           | catálogo, equipe, alunos, matrículas, financeiro |
| professor | alunos, turmas, presenças, graduações      | presenças, graduações (sem financeiro)       |
| recepcao  | alunos, matrículas, presenças, cobranças   | alunos, matrículas, presenças, cobranças     |
| aluno     | próprio cadastro (ou dos filhos), catálogo | só via RPC (check-in)                        |

Helpers SQL:
- `tem_papel(academia_id, papeis[])`: leitura.
- `pode_gerir(academia_id, papeis[])`: escrita; exige também assinatura do
  SaaS em dia. Academia suspensa ou com trial vencido lê, mas não altera.
- `academia_ativa(academia_id)`: assinatura ativa ou trial válido.
- `sou_o_aluno(aluno_id)`: o login é o aluno ou o responsável dele.
- `hoje_academia(academia_id)`: data de hoje no fuso da academia. Use no lugar
  de `current_date` em qualquer regra de negócio.

**Única exceção** à regra "suspensa lê, mas não altera": `anonimizar_aluno`
usa `tem_papel` (dono, admin) sem checar a assinatura, porque pedido de
titular (LGPD) não depende de pagamento. Coberta por
`supabase/tests/financeiro/permissoes.test.sql`. Não crie outra exceção sem
aprovação.

Plano, status e slug da academia só mudam via `service_role` (billing do SaaS).

## RPCs e views existentes

| Nome                                   | Quem chama   | Faz                                                        |
|----------------------------------------|--------------|------------------------------------------------------------|
| `criar_academia(nome, slug)`           | logado       | onboarding: cria academia em trial e vira dono             |
| `academia_publica(slug)`               | anon         | dados públicos para a página de matrícula                  |
| `matricula_online(slug, dados)`        | anon         | cria aluno + matrícula `pendente` (recepção aprova)        |
| `vincular_meu_cadastro_aluno()`        | logado       | liga login (e-mail confirmado) aos alunos ativos           |
| `fazer_checkin(turma_id, aluno_id?)`   | aluno        | check-in por QR; bloqueia atraso > `dias_tolerancia`       |
| `baixar_cobranca_manual(cobranca_id, ...)` | secretaria   | baixa de cobrança não emitida no gateway (`baixa_por`, `baixa_em`) |
| `cancelar_cobranca(cobranca_id)`       | secretaria   | cancela cobrança não emitida; cobrança nunca é apagada     |
| `gerar_cobrancas_matricula(matricula_id)` | secretaria | gera na hora as cobranças recorrentes da matrícula         |
| `anonimizar_aluno(aluno_id)`           | dono, admin  | LGPD: substitui o delete de aluno                          |
| `vw_graduacao_atual`                   | equipe/aluno | faixa e grau atuais por modalidade                         |
| `vw_progresso_graduacao`               | equipe/aluno | aulas e meses desde a última graduação, campo `apto`       |
| `vw_inadimplentes`                     | secretaria   | alunos com cobrança pendente vencida                       |

## Convenções

- Banco em português, `snake_case`, tabelas no plural.
- Status como `text` + `check` (não usar enum: é difícil de alterar depois).
- Dinheiro em `numeric(10,2)`. Data de negócio é `date` no fuso da academia
  (`academias.fuso`), não em UTC.
- CPF e telefone só com dígitos; telefone no formato E.164 (55 + DDD + número).
- Mensagens de erro exibidas ao usuário em português.
- Commits no padrão Conventional Commits: `feat(checkin): ...`, `fix(rls): ...`.

## Trabalho em paralelo entre agentes

- Uma branch por tarefa, prefixada pelo agente: `claude/rls-cobrancas`,
  `codex/crud-turmas`, `antigravity/tela-checkin`. Prefira `git worktree`.
- Cada agente trabalha **só no próprio worktree**, pastas irmãs do repositório:
  `../honorteam-claude`, `../honorteam-codex`, `../honorteam-antigravity`.
  A pasta original (`academias`) fica parada em `main`: ninguém edita,
  commita nem troca de branch nela.
- Só **um** agente mexe em `supabase/migrations/` por vez.
- Só para quem tiver Docker: existe **um só** Supabase local, compartilhado
  por todos os worktrees. Nunca suba um segundo (`supabase start` em outro
  worktree disputa as mesmas portas). Só **um** agente roda
  `supabase db reset` por vez: confirme com quem coordena antes de rodar,
  porque o reset apaga os dados que os outros agentes estão usando.
- Divisão padrão:
  - **Claude**: schema, RLS, specs de módulo, revisão de PR.
  - **Codex**: CRUDs, Edge Functions, testes.
  - **Antigravity**: telas e validação no navegador.
- Quem escreveu o PR não é quem revisa.

## Checklist antes de abrir PR

- [ ] CI `Banco` verde no último commit (migrations do zero + pgTAP)
- [ ] Tabela nova: `academia_id` + RLS + políticas + FK composta + trigger
      de academia imutável
- [ ] Testado com 2 academias: usuário de A não lê nem altera nada de B
- [ ] Tipos: `src/types/database.ts` igual ao artifact `database-types` do
      CI da própria branch (o passo de conferência do CI passa)
- [ ] `npm run lint`, `npm run build` e `npm test` passando

## Backlog conhecido

- Matrícula online atrás de Edge Function com captcha (Cloudflare Turnstile);
  depois revogar `matricula_online` de `anon`.
- Convite de membros da equipe por e-mail (Edge Function com auth admin).
- Financeiro: Edge Functions do gateway e do webhook, agendamento de
  `gerar_cobrancas` no pg_cron (spec em `docs/specs/financeiro-gateway-webhook.md`;
  funções `*_interna` e `gateway_*` são só para `service_role`).
- Lembretes no WhatsApp: vencimento, aluno sumido há X dias, apto a graduar.
- Storage de fotos dos alunos: bucket privado, caminho `{academia_id}/{aluno_id}.jpg`.
- Testes de RLS com pgTAP (`supabase test db`).
- `seed.sql` com faixas padrão por modalidade.
