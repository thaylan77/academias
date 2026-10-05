# Seed e testes do banco

`supabase/seed.sql` cria duas academias de demonstração (`honor-demo-a` e
`honor-demo-b`), cada uma com Jiu-Jitsu (cinco faixas adultas, da branca à
preta) e Muay Thai (sete graduações por prajied). Cores, graus e carências
são exemplos configuráveis por escola, não normas federativas. O catálogo
não contempla todas as faixas infantis ou de mestria do Jiu-Jitsu.

O seed é transacional e reaplicável: conflitos de ID da academia, nome da
modalidade e ordem da faixa são ignorados, preservando ajustes existentes.
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
supabase db start
supabase test db
```

## Suítes

| Arquivo | Testes | Cobertura |
|---------|--------|-----------|
| `database/rls.test.sql` | 282 | Isolamento entre tenants, papéis, portal, DELETE negado e RPCs de cancelamento/anonimização |
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

- RLS habilitado nas 17 tabelas e papel autenticado sem bypass.
- Leitura sem filtro de tenant e tentativas de INSERT, UPDATE e DELETE
  cruzados, incluindo views, UUIDs conhecidos e FKs compostas.
- Matriz de INSERT para dono, admin, professor, recepção e aluno.
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

## Validação local desta entrega

Após o rebase em `main` (`6d05fe7`), os quatro arquivos passaram no PGlite
com pgTAP 1.3.4: **379 testes, sem falhas**. O seed foi aplicado duas vezes
e o conteúdo completo permaneceu igual: 2 academias, 4 modalidades e
24 faixas. Foram usados auth e Vault simulados; o pgTAP oficial foi carregado
em `extensions`, omitindo `CREATE EXTENSION` somente na cópia temporária
de execução. Essa validação auxilia a iteração e não substitui o CI.

A branch contém apenas seed, testes e esta documentação. Migrations e
`src/types/database.ts` permanecem iguais aos de `main`. Não há
`package.json` nesta branch; lint/build/test de front-end não se aplicam.
O PR registra o SHA e o resultado do workflow Banco antes da revisão do Claude.
