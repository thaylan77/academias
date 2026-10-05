# Spec — Segurança do check-in

Status: **proposta, aguardando aprovação.** Nenhuma migration desta spec foi escrita.
Depende de `20261005120000_correcoes_e_financeiro.sql` (branch `claude/financeiro`): usa a data no fuso da academia e reescreve a `matricula_online` daquela migration.

## 1. Problema

Hoje `fazer_checkin(turma_id, aluno_id?)` só precisa do UUID da turma, que é fixo. Quem fotografou o QR uma vez faz check-in de casa, em qualquer dia e a qualquer hora. Os erros também chegam ao front só como texto, e o front precisa comparar frases para decidir o que mostrar.

## 2. O que muda

1. **Token rotativo**: o QR passa a carregar um token que muda a cada 30 a 60 segundos. `fazer_checkin` exige o token.
2. **Janela de horário**: check-in por QR só de X minutos antes do início até o fim da aula.
3. **Papel `totem`**: login do aparelho que exibe o QR. Não lê nenhuma tabela de negócio.
4. **Códigos de erro estáveis** no `hint` de `fazer_checkin`, `matricula_online` e das funções novas.

A presença lançada à mão pela equipe (insert em `presencas`) não muda: não exige token nem janela.

## 3. Decisões que precisam de aprovação

| # | Decisão | Recomendação | Por quê |
|---|---------|--------------|---------|
| D1 | Como gerar o token | **HMAC-SHA256 sem estado**: `hmac(turma_id + janela, segredo da academia)`, onde `janela = floor(epoch / período)` | Nenhuma escrita a cada rotação e nada para limpar. A alternativa (tabela de tokens emitidos) grava uma linha a cada 30 s por turma aberta. |
| D2 | Período | `academias.checkin_token_segundos`, de 30 a 60, padrão 30 | Era o intervalo pedido. Com a janela anterior aceita, um token vale de 30 a 60 s (período 30) ou de 60 a 120 s (período 60). |
| D3 | O que o totem enxerga | Só duas RPCs: `totem_turmas_agora` (turmas com check-in aberto neste momento: id, nome e horário) e `emitir_token_checkin` | "Não lê mais nada" foi lido como "nenhuma tabela". Sem a lista de turmas abertas, alguém da equipe teria de configurar a turma no aparelho a cada aula. |
| D4 | Turma sem horário cadastrado | Não aceita check-in por QR | Sem horário não há janela para validar. A equipe ainda lança a presença à mão. |
| D5 | Emitir token fora da janela | Recusado (`checkin_fora_do_horario`) | O totem só mostra QR quando a aula está aberta. |
| D6 | Ordem das verificações em `fazer_checkin` | token → academia suspensa → horário → matrícula → inadimplência. Turma inexistente ou inativa responde `checkin_token_invalido` | Sem token válido, a função não revela nada sobre a turma, a academia ou o aluno. |
| D7 | Erros fora da sua lista | Dois códigos a mais: `dados_invalidos` (nome vazio, termo não aceito, plano inválido, CPF malformado) e `sem_permissao` (emissão de token por quem não é equipe nem totem) | Sem eles o front continuaria comparando texto nesses casos. |
| D8 | Compatibilidade | Nenhuma: a `fazer_checkin(uuid, uuid)` antiga é **removida** | Manter a antiga deixaria o desvio aberto. A tela de check-in precisa ir ao ar junto com a migration. |

## 4. Token

- `janela = floor(extract(epoch from now()) / checkin_token_segundos)`.
- `token = hex(hmac_sha256(turma_id || ':' || janela, segredo))`, truncado em 32 caracteres (128 bits).
- `fazer_checkin` aceita o token da janela atual e o da anterior.
- O segredo é por academia, 32 bytes aleatórios, criado na primeira emissão. Fica em `checkin_segredos`, que ninguém lê (só as funções `security definer`).
- Conteúdo do QR: `{turma_id, token}`. O formato da URL fica com o front.
- O relógio é o do banco. O aparelho do aluno e o totem não entram na conta.

`emitir_token_checkin` devolve:

```json
{ "token": "…", "expira_em": "2026-10-05T19:00:30Z", "periodo_segundos": 30 }
```

`expira_em` é o fim da janela atual. O totem busca um token novo nesse instante.

**Limite conhecido:** quem está na aula pode mandar a foto do QR para um colega, que tem até 60 s (ou 120 s) para usá-la de fora. Token rotativo reduz o desvio a essa janela, não elimina. Fechar de vez exige geolocalização ou leitura pelo totem, fora desta spec.

## 5. Janela de horário

- Vale para `fazer_checkin` e para `emitir_token_checkin`.
- Aberta quando existe linha em `turma_horarios` tal que
  `data + hora_inicio - X min <= agora <= data + hora_fim`, com `agora` no fuso da academia e `dia_semana` igual ao dia da semana de `data`.
- `data` é testada como hoje e como amanhã. O segundo caso cobre aula que começa logo depois da meia-noite, com check-in antecipado ainda no dia anterior.
- A presença é gravada com `data` = dia da aula.
- `X = academias.checkin_antecedencia_min`, de 0 a 180, padrão 30.

## 6. Papel `totem`

- `membros_academia.papel` passa a aceitar `'totem'`. Dono e admin criam o vínculo pela política que já existe.
- `tem_papel(academia_id)` **sem lista de papéis** deixa de valer para o totem. É essa chamada que libera a leitura de `academias` e do catálogo a "qualquer membro"; com a mudança, o totem sai de todas de uma vez.
- O totem continua lendo a própria linha em `membros_academia` (o front precisa saber em qual academia ele está).
- Nenhuma política de escrita lista `totem`, então ele não altera nada.

| Papel | Lê | Escreve |
|-------|----|---------|
| totem | só o próprio vínculo | nada; chama `totem_turmas_agora` e `emitir_token_checkin` |

## 7. Códigos de erro

O código vai no `hint` do erro (`raise exception '<mensagem em português>' using hint = '<codigo>'`). No PostgREST chega como `error.hint`. A mensagem continua em português e pode mudar; o código não.

| Código | Função | Quando |
|--------|--------|--------|
| `checkin_token_invalido` | `fazer_checkin` | token ausente, errado ou vencido; turma inexistente ou inativa |
| `academia_suspensa` | `fazer_checkin`, `emitir_token_checkin`, `totem_turmas_agora`, `matricula_online` | assinatura suspensa ou trial vencido |
| `checkin_fora_do_horario` | `fazer_checkin`, `emitir_token_checkin` | fora da janela, ou turma sem horário |
| `checkin_sem_matricula` | `fazer_checkin` | login sem aluno ativo com matrícula ativa na turma |
| `checkin_multiplos_alunos` | `fazer_checkin` | responsável com mais de um aluno na turma e sem `p_aluno_id` |
| `checkin_inadimplente` | `fazer_checkin` | cobrança pendente vencida além de `dias_tolerancia` |
| `matricula_fechada` | `matricula_online` | slug inexistente ou matrícula online fechada |
| `cpf_duplicado` | `matricula_online` | CPF já cadastrado na academia |
| `menor_sem_responsavel` | `matricula_online` | menor de 18 anos sem nome e CPF do responsável |
| `dados_invalidos` | `matricula_online` | nome vazio, termo não aceito, plano inválido, CPF malformado (D7) |
| `sem_permissao` | `emitir_token_checkin`, `totem_turmas_agora` | quem chama não é equipe nem totem da academia (D7) |

Em `matricula_online`, o caso "academia suspensa" hoje responde a mesma mensagem de "matrícula fechada". Passam a ser dois códigos.

## 8. Schema e funções (aguardando aprovação)

**`academias`**: `checkin_token_segundos smallint not null default 30 check (between 30 and 60)` e `checkin_antecedencia_min smallint not null default 30 check (between 0 and 180)`, as duas no grant de update de dono e admin.

**`membros_academia`**: `check` de `papel` com `'totem'`.

**`checkin_segredos`** (nova): `academia_id` PK com FK para `academias` (`on delete cascade`), `segredo bytea not null`, `created_at`. RLS ligado, sem políticas, sem grants para `anon` e `authenticated`.

**Funções** (todas `security definer`, `set search_path = ''`, `revoke` de `public` e `anon`):

| Função | Quem chama | Faz |
|--------|-----------|-----|
| `tem_papel(academia_id, papeis default null)` | políticas | Alterada: sem lista de papéis, não vale para `totem`. |
| `emitir_token_checkin(p_turma_id) returns jsonb` | equipe e totem | Token da janela atual. Exige academia em dia e janela de horário aberta. |
| `totem_turmas_agora(p_academia_id) returns jsonb` | equipe e totem | Turmas com janela aberta agora: `id`, `nome`, `hora_inicio`, `hora_fim`. |
| `fazer_checkin(p_turma_id, p_token, p_aluno_id default null) returns uuid` | aluno | Substitui a versão de dois parâmetros. Verificações na ordem de D6. |
| `matricula_online(p_slug, p_dados)` | anon | Mesma lógica, com os códigos no `hint`. |
| `checkin_token_da_janela(p_turma_id, p_janela) returns text` | interna | Calcula o HMAC. Sem grant para nenhum papel da API. |
| `checkin_data_aula(p_turma_id) returns date` | interna | Dia da aula se a janela está aberta; nulo se não. |

Dependência: `hmac` e `gen_random_bytes` do `pgcrypto`, que no Supabase fica no schema `extensions`.

## 9. Testes pgTAP (`supabase/tests/checkin/`)

- Um teste por código da seção 7, conferindo o `hint`.
- Token da janela atual e da anterior aceitos; de duas janelas atrás, recusado.
- Token da turma A não vale na turma B; token de uma academia não vale em outra.
- Check-in repetido no mesmo dia devolve a mesma presença.
- Totem: emite token; não lê `academias`, `turmas`, `alunos`, `presencas` nem `cobrancas`; não insere presença.
- Aluno e anônimo não emitem token (`sem_permissao` e permissão negada).
- A `fazer_checkin(uuid, uuid)` antiga não existe mais.

Os testes de janela usam um horário que cobre o dia inteiro de hoje e outro num dia da semana diferente, para não depender da hora em que rodam.

## 10. Impacto

- **Front (Antigravity)**: a tela do aluno envia `p_token`; a tela do totem troca o QR fixo por `emitir_token_checkin`, renovando em `expira_em`; os erros passam a ser tratados por `error.hint`.
- **Testes do Codex**: os casos de `fazer_checkin` em `rls.test.sql` mudam de assinatura.
- **AGENTS.md**: papel `totem` na tabela de papéis e as RPCs novas.
