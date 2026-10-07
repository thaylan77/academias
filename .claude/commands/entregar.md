---
description: Entrega uma issue de ponta a ponta — branch, implementação, PR, revisão (Gemini e Codex), CI e merge
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

## 5. Atualizar com `main`, abrir o PR e revisar

Ordem das revisões: **Gemini primeiro** (só em PR de front e de risco),
**Codex por último**, no head final. A decisão é **só a linha do Codex**.

### 5.1 Preparar

- Traga `main` para a branch (merge, não rebase) **antes** de pedir revisão.
- Commit e push; abra o PR com base `main` (`Closes #<número>`), para ter
  onde publicar as rodadas.
- Se o PR muda o schema: antes de pedir revisão, espere o CI falhar no passo
  de tipos, baixe o artifact `database-types` daquela execução, commite como
  `src/types/database.ts` e faça push. As revisões rodam no head que já tem
  os tipos.

### 5.2 Como toda revisão externa roda

**Sempre por `scripts/revisao-externa.sh`**, sem exceção. Nunca chame os
plugins direto no worktree de trabalho. O script garante:

1. **Worktree descartável** (`../honorteam-revisao-<sha>`), criado no head já
   publicado e removido no fim. O revisor vê só o que está commitado: nada de
   `.env`, arquivo ignorado ou alteração solta.
2. **Ambiente por lista de permissão**: o processo do revisor recebe só
   `PATH`, `PATHEXT`, `SYSTEMROOT`, `COMSPEC`, `USERPROFILE`, `HOME`,
   `APPDATA`, `LOCALAPPDATA`, `TEMP` e `TMP`. Nenhuma outra variável passa,
   tenha ou não nome de segredo (`SUPABASE_DB_PASSWORD`,
   `SUPABASE_ACCESS_TOKEN`, `GH_PAT`...). Codex e `agy` autenticam por arquivo
   e pelo Gerenciador de Credenciais, não por variável.
3. **Versões fixas dos plugins.** A do Antigravity é a auditada; não
   atualize sem nova auditoria.

O sha tem de ser o head publicado do PR. Depois de rodar, confira que
`git worktree list` não mostra mais a pasta de revisão. O worktree
descartável não tem `node_modules`: a revisão é estática, e quem roda lint,
testes e build é você (passo 4) e o CI. Para mudar a lista de variáveis ou
as versões, mude o script por PR.

Não gaste rodada de revisor com teste de ambiente ou de ferramenta.

### 5.3 Primeira revisão: Gemini (plugin do Antigravity)

Só em PR de **front** e em PR de **risco** (financeiro, segurança/RLS). Nos
demais, vá direto ao 5.4.

```bash
scripts/revisao-externa.sh gemini "$(git rev-parse HEAD)" "<saída>" "<foco>"
```

Sempre em modo só leitura; nunca `delegate`. O Gemini só enxerga o diff que
vai no prompt, então o **foco** leva o contexto que falta:

- o que a issue pede;
- um **resumo do `AGENTS.md`** no que toca o PR (regras multi-tenant, papéis
  e permissões, `error.hint`, convenções relevantes);
- a **seção da spec** que o PR implementa ou altera (`docs/specs/`), copiada
  ou resumida, com o que o banco já garante (RPCs, hints, RLS);
- a instrução de responder em português, **só com base no prompt, sem usar
  ferramentas nem executar comandos** (no modo só leitura o comando é negado
  e a resposta volta vazia);
- o pedido de classificar cada achado como **"possível problema"**, com
  arquivo, linha e o motivo. Ele não decide o que bloqueia: quem faz a
  triagem é você.

**Tamanho**: foco e diff vão juntos na linha de comando, que no Windows não
aceita mais que ~32 mil caracteres; acima disso o plugin volta vazio em
segundos. Mantenha o foco enxuto e, se não couber, divida por grupo de
arquivos (uma chamada por parte, mantendo juntos os arquivos que se
explicam):

```bash
scripts/revisao-externa.sh gemini "$SHA" "<saída-1>" "<foco, parte 1 de N>" src/a.tsx src/b.ts
scripts/revisao-externa.sh gemini "$SHA" "<saída-2>" "<foco, parte 2 de N>" src/c.ts
```

Depois:

- Publique a saída do Gemini no PR **sem editar** (uma por parte) e registre
  se foi em partes e quais arquivos ficaram em cada uma.
- **Triagem**, num comentário seu: cada achado com fundamento é corrigido
  agora ou vira issue; cada achado sem fundamento leva **uma linha** dizendo
  por que não procede.
- Erro 503 do serviço é passageiro: repita. Se a revisão voltar vazia ou com
  erro (cota, login, tempo esgotado), diga isso no PR, não trate como
  revisão limpa e siga para o Codex.

### 5.4 Revisão final: Codex

Roda **uma vez, no head final**, depois das correções vindas do Gemini:

```bash
scripts/revisao-externa.sh codex "$(git rev-parse HEAD)" "<saída>" "<foco>"
```

O foco diz o que a issue pede, manda seguir o `AGENTS.md`, responder em
português e terminar com uma única linha final:
`APROVADO: <sha completo do head>` ou `MUDANÇAS: <sha completo do head>`.
O plugin devolve essa linha como último item da lista "Next steps"
(`- APROVADO: <sha>`): vale assim, desde que seja a última linha, o sha seja
o head e o campo `Verdict` do Codex concorde (`approve`).

- Publique a saída de **cada rodada** no PR, **sem editar**. Nunca escreva
  nem corrija a linha de decisão você mesmo.
- `MUDANÇAS`: corrija os bloqueadores, commit, push e repita o Codex no head
  novo. Não repita o Gemini por causa disso.
- **Codex sem cota ou fora do ar: o PR espera.** O Gemini nunca decide no
  lugar dele, nem em PR de documentação.

### 5.5 O Gemini acrescentou algo?

Em todo PR que teve revisão do Gemini, depois da rodada do Codex, registre
no PR uma linha:

`Gemini acrescentou algo além do Codex: sim — <achado>` ou
`Gemini acrescentou algo além do Codex: não`.

Conta como "sim" um achado com fundamento (corrigido ou transformado em
issue) que o Codex não levantou. Antes de registrar, veja as linhas dos dois
PRs anteriores que tiveram Gemini: com **três "não" seguidos**, avise o
usuário para decidir se desinstala o plugin.

## 6. CI verde

- Espere o CI `Banco` (banco e front) ficar verde no head, no push e no pull
  request.
- Commit seu depois da aprovação (inclusive de tipos) troca o conteúdo
  aprovado e pede nova rodada do Codex. A única exceção é o merge de `main`
  do passo 7.

## 7. Merge com squash

Mescle (squash) só se **todos** valerem, conferidos pela API nesta ordem:

1. o PR está aberto;
2. a última linha da revisão do Codex é `APROVADO: <sha>` e esse sha é o head
   atual do PR, ou vale o reaproveitamento abaixo;
3. a base é `main`;
4. o CI `Banco` está verde no head atual, no push e no pull request.

Se qualquer item falhar, não mescle e avise.

### Reaproveitamento da aprovação quando `main` anda

Se depois do `APROVADO` a branch precisar receber `main`:

1. Guarde o diff aprovado **antes** de atualizar:
   `git diff origin/main...<sha aprovado> > aprovado.diff` (com `origin/main`
   ainda no ponto em que a revisão rodou; se já andou, use a base antiga:
   `git diff <merge-base antigo> <sha aprovado>`).
2. Faça merge de `main` na branch (não rebase).
3. **Sem conflito** e `git diff origin/main...HEAD` **idêntico** a
   `aprovado.diff`: registre a verificação no PR (sha aprovado, sha novo, que
   o merge não teve conflito e que os diffs são iguais), espere o CI no head
   novo e mescle **sem nova rodada do Codex**.
4. **Com conflito resolvido**, ou diff diferente em qualquer linha: Codex de
   novo no head novo.

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
