# Matrícula duplicada na mesma turma

Status: **decidida em 2026-10-06 pelo dono do projeto** (issue #13). Implementada na migration `20261007023948_matricula_duplicada.sql`.

## 1. Problema

O banco aceitava duas matrículas ativas do mesmo aluno na mesma turma. Isso gerava **duas mensalidades**, porque `gerar_cobrancas` trabalha por matrícula, e confundia o check-in (contornado com `distinct` em `fazer_checkin`).

## 2. Regra

O mesmo aluno não pode ter duas matrículas **não canceladas** (`pendente`, `ativa` ou `trancada`) com **períodos sobrepostos** que **compartilhem uma turma**.

- O período de uma matrícula é `[data_inicio, data_fim]`, fechado nas duas pontas. Sem `data_fim`, não tem fim.
- Duas matrículas se sobrepõem quando têm pelo menos um dia em comum. Terminar num dia e a outra começar no mesmo dia é sobreposição; terminar na véspera não é.
- Matrícula `cancelada` não disputa turma com ninguém.
- Matrícula `trancada` continua ocupando a turma: o aluno volta para ela.
- Matrículas do mesmo aluno em turmas diferentes podem coexistir (por exemplo, um plano de Jiu-Jitsu e outro de Muay Thai).
- A regra é por academia; o aluno já é de uma academia só.

A decisão foi **bloquear no banco**, e não só avisar na tela.

## 3. Troca de plano

Encerrar a matrícula antiga (`data_fim` = véspera) e abrir a nova a partir do dia seguinte. As duas podem apontar para as mesmas turmas porque os períodos só se encostam.

A antiga não precisa mudar de situação para a regra passar: basta a data de fim. A RPC `criar_matricula` (issue #14) é quem vai oferecer esse fluxo numa transação só.

## 4. Onde a regra é conferida

Uma função de gatilho, `matriculas_sem_duplicata()`, ligada a dois pontos:

| Gatilho | Quando | Confere |
|---|---|---|
| `matricula_turmas_sem_duplicata` | depois de insert ou update de `matricula_id`/`turma_id` em `matricula_turmas` | a turma que entrou |
| `matriculas_sem_duplicata` | depois de update de `status`, `data_inicio`, `data_fim` ou `aluno_id` em `matriculas`, quando a matrícula não fica cancelada | todas as turmas da matrícula |

O insert em `matriculas` não é conferido: a matrícula nasce sem turma.

A função é `security definer` com `search_path = ''`: a conferência enxerga todas as matrículas do aluno, qualquer que seja o RLS de quem grava. Não tem grant para `anon` nem `authenticated`.

**Concorrência.** Duas travas, nesta ordem:

1. No gatilho de `matricula_turmas`, a linha da matrícula é lida com `for share`. Se outra transação estiver mudando a situação, as datas ou o aluno dessa matrícula, esta espera e lê o valor já confirmado. (No gatilho de `matriculas`, a linha já está travada pelo próprio update.)
2. Depois, **antes de qualquer saída** (inclusive a de matrícula cancelada), uma trava de transação por aluno (`pg_advisory_xact_lock`). Duas gravações simultâneas para o mesmo aluno entram uma de cada vez, e a segunda já enxerga o que a primeira gravou.

A primeira versão lia a matrícula sem trava e saía antes da trava do aluno quando a lia como cancelada: uma reativação ainda não confirmada, numa transação, e a ligação da mesma matrícula a uma turma, em outra, passavam as duas (achado do Codex no PR #45). Um comando que grava para vários alunos pega as travas na ordem das linhas; dois comandos assim em ordens opostas podem cair em deadlock, que o Postgres resolve abortando um deles.

## 5. Erro

```
raise exception 'O aluno já tem matrícula na turma "<nome>" neste período'
  using hint = 'matricula_duplicada',
        detail = '{"matricula_id": "<uuid>", "turma_id": "<uuid>"}'
```

- `hint`: código estável `matricula_duplicada`. O front decide por ele.
- `detail` (no PostgREST, `error.details`): JSON com a matrícula que já ocupa a turma e a turma em conflito. Havendo mais de um conflito, vem o primeiro por nome de turma.
- A mensagem é em português e pode mudar.

## 6. Dados existentes

A migration cria os gatilhos e, **em seguida**, procura pares já duplicados. Se achar, **falha** com `hint = matricula_duplicada` e lista até 50 pares (academia, aluno, turma e as duas matrículas). Nada é corrigido sozinho: quem aplica decide qual matrícula de cada par cancelar ou encerrar e roda de novo.

A conferência vem depois dos gatilhos de propósito: a partir da criação deles nenhuma duplicata nova entra, então o que a conferência não achar não existe. Não há `lock table` porque a CLI do Supabase não aplica a migration dentro de um bloco de transação explícito (o comando é recusado). A função e os gatilhos são recriados a cada execução (`create or replace`, `drop trigger if exists`), então rodar de novo depois de resolver os pares é seguro, mesmo que a primeira tentativa tenha deixado os gatilhos criados.

## 7. Testes

`supabase/tests/matricula/duplicada.test.sql` (39 asserções), com duas academias:

- caso base, nos dois sentidos, com mensagem, `detail` e a linha recusada fora do banco;
- pendente e trancada disputam, cancelada não, e reativar a cancelada é barrado;
- troca de plano, datas que se encostam, estender, reabrir e antecipar;
- duas matrículas no mesmo insert, troca de `aluno_id` e matrícula sem turma;
- a regra vale em cada academia e uma não interfere na outra;
- pela API, como recepção, o erro é `matricula_duplicada`.

A conferência dos dados existentes (seção 6) não cabe no pgTAP, que roda depois das migrations. Foi verificada à parte: com um par duplicado a migration falha listando o par; depois de cancelar uma das duas, aplica.

**Concorrência**: `supabase/tests/matricula/concorrencia.test.sql` (12 asserções) abre duas transações de verdade, em conexões separadas (`dblink`), e confere que a segunda espera a primeira e é recusada depois do commit, em três intercalações: reativação aberta e ligação da turma; reabertura de período aberta e ligação de outra matrícula; ligação aberta e reativação. As fixtures desse arquivo são confirmadas por uma conexão própria e apagadas no fim. Sem a correção acima, as intercalações 1 e 3 deixam a duplicata passar.

## 8. Fora desta entrega

- `criar_matricula` e `aprovar_matricula` (issue #14).
- Tela da recepção tratando `matricula_duplicada` (issue #28).
- `fazer_checkin` já ignora matrícula com `data_fim` vencida, então a antiga de uma troca de plano não vale para o check-in mesmo com a situação `ativa`. Com a regra nova, um aluno não tem mais duas matrículas valendo na mesma turma no mesmo dia; o `distinct` de `fazer_checkin` fica só como proteção.
