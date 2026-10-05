# Spec — Segurança do check-in

Status: **aprovada em 2026-10-05 (D1 a D8, com ajustes).** Implementada em `supabase/migrations/20261005180000_checkin_seguranca.sql`.
**Merge junto com o PR do Antigravity que envia o token** (D8): sozinha, esta migration quebra a tela de check-in atual.

## 1. Problema

Hoje `fazer_checkin(turma_id, aluno_id?)` só precisa do UUID da turma, que é fixo. Quem fotografou o QR uma vez faz check-in de casa, em qualquer dia e a qualquer hora. Os erros também chegam ao front só como texto, e o front precisa comparar frases para decidir o que mostrar.

## 2. O que muda

1. **Token rotativo**: o QR passa a carregar um token que muda a cada 30 a 60 segundos. `fazer_checkin` exige o token.
2. **Janela de horário**: check-in por QR só de X minutos antes do início até o fim da aula.
3. **Papel `totem`**: login do aparelho que exibe o QR. Não lê nenhuma tabela de negócio.
4. **Códigos de erro estáveis** no `hint` de `fazer_checkin`, `matricula_online` e das funções novas.

A presença lançada à mão pela equipe (insert em `presencas`) não muda: não exige token nem janela.

## 3. Decisões (aprovadas)

| # | Decisão | Recomendação | Por quê |
|---|---------|--------------|---------|
| D1 | Como gerar o token | **HMAC-SHA256 sem estado**: `hmac(turma_id + janela, segredo da academia)`, onde `janela = floor(epoch / período)`. Segredo por academia em tabela sem grant para `authenticated`, com rotação. Token de 128 bits (mínimo aprovado: 64) | Nenhuma escrita a cada rotação e nada para limpar. A alternativa (tabela de tokens emitidos) grava uma linha a cada 30 s por turma aberta. |
| D2 | Período | `academias.checkin_token_segundos`, de 30 a 60, padrão 30 | Era o intervalo pedido. Com a janela anterior aceita, um token vale de 30 a 60 s (período 30) ou de 60 a 120 s (período 60). |
| D3 | O que o totem enxerga | Só duas RPCs: `totem_turmas_agora` (turmas com check-in aberto neste momento: id, nome e horário) e `emitir_token_checkin` | "Não lê mais nada" foi lido como "nenhuma tabela". Sem a lista de turmas abertas, alguém da equipe teria de configurar a turma no aparelho a cada aula. |
| D4 | Turma sem horário cadastrado | Não aceita check-in por QR | Sem horário não há janela para validar. A equipe ainda lança a presença à mão. |
| D5 | Emitir token fora da janela | Recusado (`checkin_fora_do_horario`) | O totem só mostra QR quando a aula está aberta. |
| D6 | Ordem das verificações em `fazer_checkin` | token → academia suspensa → horário → matrícula → inadimplência. Turma inexistente ou inativa responde `checkin_token_invalido` | Sem token válido, a função não revela nada sobre a turma, a academia ou o aluno. |
| D7 | Erros fora da lista original | Dois códigos a mais: `dados_invalidos` (nome vazio, termo não aceito, plano inválido, CPF malformado) e `sem_permissao` (emissão de token por quem não é equipe nem totem) | Sem eles o front continuaria comparando texto nesses casos. |
| D8 | Compatibilidade | Nenhuma: a `fazer_checkin(uuid, uuid)` antiga é **removida**. O merge acontece junto com o PR do Antigravity que envia o token | Manter a antiga deixaria o desvio aberto. |

## 4. Token

- `janela = floor(extract(epoch from now()) / checkin_token_segundos)`.
- `token = hex(hmac_sha256(turma_id || ':' || janela, segredo))`, truncado em 32 caracteres (128 bits).
- `fazer_checkin` aceita o token da janela atual e o da anterior.
- O segredo é por academia, 32 bytes aleatórios (`extensions.gen_random_bytes`), criado na primeira emissão. Fica em `checkin_segredos`, sem grant para `anon` nem `authenticated`: só as funções `security definer` leem.
- Dono e admin trocam o segredo com `rotacionar_segredo_checkin`. Os QR em exibição deixam de valer na hora e o totem busca outro sozinho.
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
| `academia_suspensa` | `fazer_checkin`, `emitir_token_checkin`, `totem_turmas_agora` | assinatura suspensa ou trial vencido. **Só em RPC autenticada.** |
| `checkin_fora_do_horario` | `fazer_checkin`, `emitir_token_checkin` | fora da janela, ou turma sem horário |
| `checkin_sem_matricula` | `fazer_checkin` | login sem aluno ativo com matrícula ativa na turma |
| `checkin_multiplos_alunos` | `fazer_checkin` | responsável com mais de um aluno na turma e sem `p_aluno_id` |
| `checkin_inadimplente` | `fazer_checkin` | cobrança pendente vencida além de `dias_tolerancia` |
| `matricula_fechada` | `matricula_online` | slug inexistente, matrícula online fechada **ou academia suspensa**: o visitante anônimo não fica sabendo da situação da assinatura |
| `cpf_duplicado` | `matricula_online` | CPF já cadastrado na academia |
| `menor_sem_responsavel` | `matricula_online` | menor de 18 anos sem nome e CPF do responsável |
| `dados_invalidos` | `matricula_online` | nome vazio, termo não aceito, plano inválido, CPF malformado (D7) |
| `sem_permissao` | `emitir_token_checkin`, `totem_turmas_agora`, `rotacionar_segredo_checkin` | quem chama não tem o papel na academia (D7) |


## 8. Schema e funções

**`academias`**: `checkin_token_segundos smallint not null default 30 check (between 30 and 60)` e `checkin_antecedencia_min smallint not null default 30 check (between 0 and 180)`, as duas no grant de update de dono e admin.

**`membros_academia`**: `check` de `papel` com `'totem'`.

**`checkin_segredos`** (nova): `academia_id` PK com FK para `academias` (`on delete cascade`), `segredo bytea not null`, `created_at`, `rotacionado_em`. RLS ligado, sem políticas, sem grants para `anon` e `authenticated`, com o trigger de academia imutável.

**Funções** (todas `security definer`, `set search_path = ''`, `revoke` de `public` e `anon`):

| Função | Quem chama | Faz |
|--------|-----------|-----|
| `tem_papel(academia_id, papeis default null)` | políticas | Alterada: sem lista de papéis, não vale para `totem`. |
| `emitir_token_checkin(p_turma_id) returns jsonb` | equipe e totem | Token da janela atual. Exige academia em dia e janela de horário aberta. |
| `totem_turmas_agora(p_academia_id) returns jsonb` | equipe e totem | Turmas com janela aberta agora: `id`, `nome`, `hora_inicio`, `hora_fim`. |
| `fazer_checkin(p_turma_id, p_token, p_aluno_id default null) returns uuid` | aluno | Substitui a versão de dois parâmetros. Verificações na ordem de D6. |
| `matricula_online(p_slug, p_dados)` | anon | Mesma lógica, com os códigos no `hint`. |
| `rotacionar_segredo_checkin(p_academia_id)` | dono, admin | Troca o segredo; invalida os tokens em uso. |
| `checkin_janela_atual`, `checkin_token_da_janela`, `checkin_aulas_abertas`, `checkin_data_aula` | internas | Janela, HMAC e horário. Sem grant para nenhum papel da API. |

Dependência: `pgcrypto` no schema `extensions`, sempre com chamada qualificada (`extensions.hmac`, `extensions.gen_random_bytes`).

## 9. Testes pgTAP (`supabase/tests/checkin/`, 76 asserções)

| Arquivo | Asserções | Cobre |
|---------|-----------|-------|
| `checkin.test.sql` | 63 | um teste por código de `fazer_checkin` e das RPCs do totem; token atual e anterior aceitos, de duas janelas atrás recusado; token de outra turma e de outra academia recusados; check-in repetido devolve a mesma presença; totem emite token, vê só a turma aberta e não lê `academias`, catálogo, `alunos`, matrículas, presenças, graduações, cobranças nem as três views; aluno e anônimo não emitem; rotação do segredo; a função antiga não existe mais |
| `matricula_online.test.sql` | 13 | cada código de `matricula_online`; slug inexistente, matrícula fechada e academia suspensa com o mesmo código |

A janela "aberta" usa um horário que cobre o dia inteiro de hoje e a "fechada" um dia da semana que não é hoje nem amanhã, para o teste não depender da hora em que roda.

## 10. Impacto

- **Front (Antigravity)**: a tela do aluno envia `p_token`; a tela do totem troca o QR fixo por `totem_turmas_agora` + `emitir_token_checkin`, renovando em `expira_em`; os erros passam a ser tratados por `error.hint`.
- **Testes do Codex**: cinco casos de `fazer_checkin` em `rls.test.sql` usam a assinatura antiga e precisam passar o token.
- **AGENTS.md**: papel `totem`, RPCs novas e a convenção de código no `hint`.

## 11. Backlog

- **Pareamento do totem**: Edge Function que cria o usuário do aparelho, dá o papel `totem` e devolve um código de uso único para o aparelho entrar. Hoje o vínculo é criado à mão por dono ou admin.
- **Lista de check-ins em tempo real para o professor**: quem acabou de entrar na aula, na tela da turma.
- Fechar o repasse da foto do QR (seção 4): geolocalização ou leitura pelo totem.
