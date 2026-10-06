---
description: Entrega uma issue de ponta a ponta — branch, implementação, revisão do Codex, PR, CI e merge
argument-hint: '<número da issue>'
---

Entregue a issue `$ARGUMENTS` do começo ao merge em `main`, seguindo o
`AGENTS.md`. Trabalhe no worktree `../honorteam-claude`; a pasta `academias`
fica parada em `main`.

Se `$ARGUMENTS` não for o número de uma issue aberta do repositório, pare e
avise.

## 1. Ler a issue e as dependências

- Leia a issue, os comentários e as specs que ela cita (`docs/specs/`).
- Liste as dependências (issues ou PRs citados como pré-requisito). Se alguma
  ainda não estiver em `main`, **pare e avise** qual falta. Não comece por cima
  de branch de feature.

## 2. Branch

- `git fetch origin` e crie `claude/<número-da-issue>` a partir de
  `origin/main` atualizado.

## 3. Implementar

- Siga o `AGENTS.md`: regras multi-tenant, papéis e permissões, convenções e
  códigos estáveis no `hint`.
- Toda mudança vem com teste: pgTAP para banco e RLS (com 2 academias),
  Vitest para o front.
- Mudança de schema ou de política RLS: apresente o plano e espere aprovação
  antes de escrever a migration (`CLAUDE.md`).
- Migration nova com `npx supabase@2.119.0 migration new <nome>`. Nunca edite
  migration já aplicada.

## 4. Rodar localmente o que der

- pgTAP em PGlite (não há Docker nem Supabase local nesta máquina).
- `npm test`, `npm run lint` e `npm run build`.
- Isso ajuda a desenvolver, mas não conta como verde: o verde oficial é o CI.
  Diga no PR o que rodou onde.

## 5. Atualizar com `main` e pedir a revisão do Codex

- Traga `main` para a branch (merge, não rebase) **antes** de pedir a revisão.
- Commit e push; abra o PR com base `main` (`Closes #<número>`), para ter
  onde publicar as rodadas.
- Se o PR muda o schema: antes de pedir a revisão, espere o CI falhar no
  passo de tipos, baixe o artifact `database-types` daquela execução, commite
  como `src/types/database.ts` e faça push. A revisão roda no head que já
  tem os tipos.
- Os scripts dos plugins ficam em
  `~/.claude/plugins/cache/<marketplace>/<plugin>/<versão>/scripts/`
  (`openai-codex/codex` e `dpa-antigravity/antigravity`).
- Rode a revisão pelo plugin do Codex, no worktree da branch:

  ```bash
  node "<raiz do plugin codex>/scripts/codex-companion.mjs" adversarial-review \
    --wait --base origin/main --scope branch "<foco>"
  ```

  O foco diz o que a issue pede, manda seguir o `AGENTS.md`, responder em
  português e terminar com uma única linha final, fora de lista e sem
  marcador: `APROVADO: <sha completo do head>` ou
  `MUDANÇAS: <sha completo do head>`.
- Publique a saída de **cada rodada** como comentário no PR, **sem editar**.
  Nunca escreva nem corrija a linha de decisão você mesmo.
- `MUDANÇAS`: corrija os bloqueadores, commit, push e repita a revisão no head
  novo.

### Segunda revisão (Gemini, pelo plugin do Antigravity)

Só em PR de **front** e em PR de **risco** (financeiro, segurança/RLS). Nos
demais, pule.

- Rode depois que o Codex não tiver mais bloqueadores, no mesmo head, sempre
  em modo só leitura (`review` ou `adversarial-review`; nunca `delegate`):

  ```bash
  node "<raiz do plugin antigravity>/scripts/antigravity.mjs" adversarial-review \
    --wait --base origin/main "<foco>"
  ```

  O foco manda responder em português e **só com base no diff do prompt, sem
  usar ferramentas nem executar comandos**: no modo só leitura o comando é
  negado e a resposta volta vazia.
- Publique a saída do Gemini no PR **sem editar**.
- Para **cada bloqueador** dele: corrija, ou explique no PR por que não
  procede. Correção troca o head e pede nova rodada do Codex.
- A decisão continua sendo **só a linha do Codex**. O veredito do Gemini não
  aprova nem barra o merge sozinho.
- Se a revisão voltar vazia ou com erro (cota, login, tempo esgotado), diga
  isso no PR; não trate como revisão limpa.

## 6. CI verde

- Espere o CI `Banco` (banco e front) ficar verde no head, no push e no pull
  request.
- Qualquer commit depois da revisão (inclusive de tipos) troca o head e pede
  nova rodada do Codex.

## 7. Merge com squash

Mescle (squash) só se **todos** valerem, conferidos pela API nesta ordem:

1. o PR está aberto;
2. a última linha da revisão do Codex é `APROVADO: <sha>` e esse sha é o head
   atual do PR;
3. a base é `main`;
4. o CI `Banco` está verde nesse head, no push e no pull request.

Se `main` andar depois da aprovação: faça merge de `main` na branch, confira
que o delta entre o head aprovado e o novo é só esse merge e peça ao Codex
**apenas a confirmação disso**, com nova linha `APROVADO: <sha novo>`.
Publique sem editar, espere o CI e então mescle.

Se qualquer item falhar, não mescle e avise.

## 8. Depois do merge

- Se o PR trouxe migration: na pasta `academias`, `git pull origin main`
  (ela não se atualiza sozinha com o merge pela API), confira que a migration
  está lá e só então `npx supabase@2.119.0 db push` no `honorteam-dev`.
- Confira que a issue fechou e diga o que foi entregue e o que rodou onde.

## 9. Quando parar e perguntar

Siga sem perguntar, exceto:

- decisão de produto (regra de negócio que a issue ou a spec não define);
- plano de schema ou RLS aguardando aprovação (passo 3);
- você e o Codex discordarem **duas vezes no mesmo ponto**: pare, mostre as
  duas posições e espere a decisão;
- dependência fora de `main` (passo 1).
