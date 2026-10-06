# Seed e testes do banco

`supabase/seed.sql` cria duas academias de demonstração (`honor-demo-a` e
`honor-demo-b`), cada uma com Jiu-Jitsu (cinco faixas adultas, da branca à
preta) e Muay Thai (sete graduações por prajied). Cores, graus e carências
são exemplos configuráveis por escola, não normas federativas. O catálogo
não contempla todas as faixas infantis ou de mestria do Jiu-Jitsu.

O seed é transacional e reaplicável: conflitos de ID/slug da academia, nome
da modalidade e ordem da faixa são ignorados, preservando ajustes existentes.
Se um slug de demonstração pertence a outro ID, essa demonstração é pulada
inteiramente; o catálogo não é ligado ao tenant já existente.
Não cria usuários, senhas ou vínculos de acesso. Use somente em ambiente
local descartável ou no CI; não aplique em produção ou no `honorteam-dev`.

## Validação oficial

O workflow [Banco](../../.github/workflows/banco.yml) executa, a cada push e
pull request, `supabase db start` e `supabase test db` em uma instância nova
no GitHub Actions. O verde oficial é o resultado desse workflow para o SHA
da branch. A máquina principal não tem Docker: não execute nela comandos
para subir/resetar o Supabase. Testes nunca usam `--linked` nem uma URL do
`honorteam-dev`; esse banco compartilhado recebe somente migrations de
`main` pelo fluxo definido em `AGENTS.md`.

Em um ambiente descartável com Docker, já configurado para este projeto:

```sh
npx supabase@2.119.0 db start
npx supabase@2.119.0 test db
```

A CLI está fixada em `2.119.0`. O mesmo workflow gera os tipos do banco
local, publica o artifact `database-types` e confere a igualdade com
`src/types/database.ts`. Se houver diferença, copie o arquivo do artifact
daquela execução e commite na branch; não gere tipos com `--linked` nem
edite o arquivo manualmente.

## Suítes

| Arquivo | Testes | Cobertura |
|---------|--------|-----------|
| `database/rls.test.sql` | 307 | Isolamento entre tenants, matriz com totem, portal, check-in com token, DELETE negado e RPCs de cancelamento/anonimização |
| `checkin/checkin.test.sql` | 69 | HMAC, janela de horário, permissões do totem, candidatos e códigos de erro |
| `checkin/matricula_online.test.sql` | 28 | Códigos públicos e validação de entradas da matrícula |
| `financeiro/emissao_webhook.test.sql` | 46 | Emissão, tentativa da reserva, adoção pelo webhook e divergências |
| `financeiro/permissoes.test.sql` | 30 | Grants financeiros, colunas de sistema, anonimização e academia imutável |
| `financeiro/recorrencia.test.sql` | 21 | Competência, recorrência e mês inicial da cobrança |

Todos os arquivos usam fixtures próprias e `ROLLBACK`; não dependem do seed.
Na suíte RLS, `SET LOCAL ROLE authenticated`/`anon` e
`request.jwt.claim.sub` simulam o chamador. Somente a preparação dos dados
usa o papel administrativo. Os auxiliares temporários são SECURITY INVOKER.
Tentativas genéricas de escrita são desfeitas em subtransações. Os testes
finais de RPC verificam efeitos persistidos dentro da transação da suíte,
que é inteiramente revertida no encerramento.

A suíte RLS cobre:

- RLS habilitado nas 18 tabelas, incluindo `checkin_segredos`, e papel autenticado sem bypass.
- Leitura sem filtro de tenant e tentativas de INSERT, UPDATE e DELETE
  cruzados, incluindo views, UUIDs conhecidos e FKs compostas.
- Matriz de INSERT para dono, admin, professor, recepção, aluno e totem.
- Totem lê só o próprio vínculo, não lê academia/catálogo/segredo e não
  insere nas 13 tabelas da matriz; DELETE de alunos/cobranças retorna `42501`.
- DELETE direto de `alunos` e `cobrancas` com SQLSTATE `42501` e mensagem
  `permission denied`, inclusive para dono/admin. Isso distingue revogação
  de privilégio de uma política RLS que apenas afeta zero linhas.
- `cancelar_cobranca`: papéis permitidos, isolamento, idempotência e
  manutenção da cobrança cancelada no histórico.
- `anonimizar_aluno`: permissão de dono/admin, bloqueio por pendências,
  limpeza dos dados pessoais, preservação de matrícula/presenças/graduações/
  cobranças e manutenção do vínculo do responsável com outro filho.
- Academia suspensa sem escrita comum; anonimização continua permitida,
  conforme a exceção explícita de LGPD em `AGENTS.md`.
- Responsável com dois filhos, check-in próprio via RPC, restrições
  financeiras, proteção de donos e colunas de billing, membro inativo,
  usuário sem vínculo, anônimo e limites do trial.

As datas da suíte RLS usam `hoje_academia`, inclusive para comparar o
check-in com a data da academia e testar trial válido/vencido.
Os tokens de A/B são calculados antes de assumir o papel autenticado e
guardados numa tabela temporária com grant de leitura. Os horários cobrem
todo o dia local (`00:00` a `24:00`), inclusive o último segundo. As chamadas
usam `p_turma_id`, `p_token` e `p_aluno_id`; a rejeição de outro aluno/tenant
confere `checkin_sem_matricula`, após passar por token e horário válidos.

O plano fixo de 307 asserções detecta casos omitidos pelos laços. O grant
que bloqueia alterar `alunos.academia_id` é testado com `42501` explícito;
o auxiliar de escrita genérica distingue somente permitido/bloqueado.
Nas RPCs financeiras ainda sem hint, os testes negativos comparam trechos
da mensagem por expressão regular, evitando exigir a redação completa.

## Validação local desta entrega

Na correção criada a partir de `main` (`a26b142`), os seis arquivos passaram
no PGlite com pgcrypto e pgTAP 1.3.4: **501 testes, sem falhas**.
O seed foi aplicado duas vezes
e o conteúdo completo permaneceu igual: 2 academias, 4 modalidades e
24 faixas. Também foram verificadas a preservação de nome personalizado e
a colisão de slug com outro ID, sem inserir catálogo nesse tenant antigo
nem criar usuários/vínculos. Foram usados auth e Vault simulados; o pgTAP oficial foi carregado
em `extensions`, omitindo `CREATE EXTENSION` somente na cópia temporária
de execução. Essa validação auxilia a iteração e não substitui o CI.

A branch contém apenas seed, testes e esta documentação. Migrations e
`src/types/database.ts` permanecem iguais aos de `main`. O front-end é validado com `npm run lint`, `npm run build` e `npm test`.
O PR registra o SHA e o resultado do workflow Banco antes da revisão do Claude.
Somente Claude mescla PRs em `main`.
