# Spec — Financeiro: gateway de pagamento e webhook

Status: **aprovada em 2026-10-05.** Schema e RLS implementados (seção 4); Edge Functions e telas pendentes.
Base: `supabase/migrations/20261005000000_schema_inicial.sql`.

## 1. Escopo

Cobre a cobrança do **aluno pela academia**: emitir uma cobrança no gateway, receber a confirmação por webhook e dar baixa.

Fora do escopo:

- Assinatura do SaaS (academia pagando a plataforma: `academias.plano_saas` e `status`).
- Agendamento da geração recorrente (pg_cron) e emissão automática. Esta spec entrega só a função `gerar_cobrancas` (seção 4.5).
- Cartão recorrente (fora do MVP).
- Lembretes de vencimento no WhatsApp.
- Checkout próprio. O aluno paga na página hospedada do gateway.

## 2. Decisões (aprovadas)

| # | Decisão | Recomendação | Por quê |
|---|---------|--------------|---------|
| D1 | Primeiro gateway | Asaas | Pix, boleto e cartão numa única fatura hospedada; webhook com token próprio; sandbox completo. O código fica atrás de um adaptador, então Efí e Mercado Pago entram depois sem mexer no banco. |
| D2 | De quem é a conta no gateway | Cada academia conecta a **própria conta** (chave de API dela) | O dinheiro cai direto na academia. A plataforma não intermedeia pagamento, não faz split e não responde por repasse. |
| D3 | Recorrência | Nós geramos cada cobrança; **não** usamos assinatura do gateway | Mantém `cobrancas` como fonte única e funciona igual em qualquer gateway. |
| D4 | Fonte da verdade no webhook | O corpo do webhook é só um aviso; o estado é **reconsultado na API do gateway** | Evento forjado, repetido ou fora de ordem deixa de ser problema. Custa uma chamada HTTP por evento. |
| D5 | `cobrancas.aluno_id on delete cascade` | Trocar para `restrict` | Hoje apagar um aluno apaga o histórico financeiro dele, inclusive cobranças pagas. |

Ajustes da aprovação: chave de API só de escrita na UI; o authToken do webhook resolve a academia; `competencia` nas cobranças; aluno é anonimizado, não apagado; baixa manual com `baixa_por` e `baixa_em`.

## 3. Fluxos

### 3.1 Conectar o gateway (dono ou admin)

1. A tela envia a chave de API para a Edge Function `gateway-conectar`.
2. A função valida a chave chamando o gateway, grava a chave no Supabase Vault e cria a linha em `gateway_contas`.
3. A função gera um authToken aleatório de 32 bytes, único por academia, guarda só o SHA-256 dele e registra o webhook no gateway apontando para
   `/functions/v1/gateway-webhook/{gateway}` com esse token.
4. A chave e o token nunca voltam para o front.

### 3.2 Emitir cobrança (dono, admin ou recepção)

Edge Function `cobranca-emitir`, entrada `{ cobranca_id }`.

1. Confere a permissão com o JWT do usuário e pega a conta ativa da academia em `gateway_contas`.
2. Chama `reservar_emissao_interna(cobranca_id, user_id, gateway_conta_id)`, que trava a linha, reconfere o papel e devolve `{estado, gateway_conta_id, tentativa}`:
   - `reservada`: segue para o passo 4;
   - `orfa` (reserva com mais de 2 minutos, sem `gateway_id`): quem chamou passa a ser o dono da emissão, com tentativa nova; passo 3;
   - `em_andamento`: responde "emissão em andamento" (não recebe tentativa);
   - `emitida`: devolve o `link_pagamento` existente.
3. Reserva órfã: consulta o Asaas por `externalReference = cobrancas.id` **antes de reemitir**, na conta devolvida (a da reserva antiga, que pode não ser mais a ativa).
   - Achou: grava com `registrar_emissao_interna` e encerra.
   - Não achou: chama `reservar_emissao_interna` de novo com `p_tentativa_conferida` = a tentativa que recebeu. Isso passa a reserva para a conta ativa e devolve outra tentativa.
4. Garante o cliente no gateway (`gateway_clientes`). O pagador é o responsável quando `responsavel_cpf` está preenchido; senão, o próprio aluno. Sem CPF: erro "Informe o CPF do aluno ou do responsável para emitir a cobrança".
5. Cria a cobrança no gateway com valor, vencimento, descrição e **`externalReference = cobrancas.id`**, deixando o pagador escolher a forma de pagamento.
6. Grava com `registrar_emissao_interna(cobranca_id, tentativa, gateway_conta_id, gateway_id, link)`.
7. Falhas:
   - **Recusa explícita do gateway** (resposta 4xx de validação, ex.: CPF inválido): chama `liberar_emissao_interna(cobranca_id, tentativa, motivo)`. O motivo fica em `cobrancas.emissao_recusa` para a secretaria.
   - **Timeout, erro de rede ou 5xx**: **não libera**. A cobrança pode ter sido criada; a reserva fica para reconciliar por `externalReference` na próxima tentativa (passo 3) ou pelo webhook.

**Tentativa e retomada concorrente.** Cada reserva e cada renovação gera uma `emissao_tentativa` nova. Só a tentativa vigente registra, libera ou renova; qualquer outra recebe erro com `hint = 'reserva_substituida'`. O caso que isso fecha: o worker 1 trava depois de reservar, a reserva envelhece, o worker 2 assume, e o worker 1 volta atrasado.

Quando a Edge Function recebe `reserva_substituida`:

- **Em `registrar_emissao_interna`, depois de ter criado a cobrança no gateway**: relê a cobrança. Se o `gateway_id` gravado é o que ela mesma criou, outro processo já a adotou e não há nada a fazer. Se é outro (ou nulo), **cancela no gateway a cobrança que ela criou**, para não sobrar uma cobrança pagável sem registro.
- **Em `reservar` (renovação) ou `liberar`**: para sem fazer mais nada; a emissão é de outro processo.

**Webhook antes do registro.** Se o webhook chega primeiro e adota a cobrança por `externalReference`, o `registrar_emissao_interna` seguinte, com a mesma conta e o mesmo `gateway_id`, só completa o `link_pagamento` que estiver nulo. Não toca em status nem em pagamento.

Enquanto houver reserva, a cobrança conta como emitida: valor e vencimento travam, e baixa e cancelamento só pelas Edge Functions.

O aluno vê o `link_pagamento` no portal; a política `cobrancas_select` já permite.

### 3.3 Webhook

Edge Function `gateway-webhook`, pública (`verify_jwt = false`), usa `service_role`.

1. Calcula o SHA-256 do authToken do cabeçalho e busca a conta por `webhook_token_hash`, ativa ou não. Sem token ou sem conta: `401`. Nada é gravado.
2. O `academia_id` dessa conta vale para todo o resto da requisição; nada do corpo é usado para identificar a academia.
3. Insere em `gateway_eventos` com `on conflict (gateway_conta_id, evento_id) do nothing`. Evento já processado: `200` e encerra.
4. Reconsulta a cobrança na API do gateway com a chave **desta conta** e normaliza o estado para `pendente | paga | cancelada | estornada`.
5. Chama `aplicar_pagamento_gateway(...)`, que localiza a cobrança, trava a linha (`for update`), aplica a transição e marca o evento, tudo numa transação.
6. Responde `200`.

Regras:

- A cobrança é procurada **sempre com o `academia_id` resolvido pelo token**: primeiro por `(academia_id, gateway_conta_id, gateway_id)`, depois pela referência externa, e nesse caso só adota cobrança com reserva de emissão **para a mesma conta do token**. Sem esse filtro, uma academia conseguiria dar baixa em cobrança de outra enviando o `gateway_id` dela com o próprio token.
- Cobrança não encontrada é normal (a academia usa a mesma conta para outras vendas): evento marcado `ignorado`, resposta `200`.
- Falha nossa (banco, tempo esgotado no gateway): evento marcado `erro`, resposta `500` para o gateway reenviar.
- O webhook **não** verifica `academia_ativa`. Academia suspensa não emite, mas pagamento de aluno que chegar precisa ser registrado.
- Corpo acima de 100 KB: `413`.

### 3.4 Transições de estado

Aplicadas por `aplicar_pagamento_gateway`, que compara o estado atual com o estado reconsultado.

| Atual \ Gateway | pendente | paga | cancelada | estornada |
|-----------------|----------|------|-----------|-----------|
| **pendente**    | —        | paga | cancelada | estornada |
| **paga**        | pendente (baixa desfeita) | — | não aplica, evento `divergente` | estornada |
| **cancelada**   | pendente (restaurada) | **paga** | — | estornada |
| **estornada**   | não aplica | não aplica | não aplica | — |

- Ao virar `paga`: grava `pago_em` (data do gateway), `valor_pago` e `forma_pagamento`.
- `cancelada → paga` é intencional: Pix pago segundos depois do cancelamento é dinheiro real na conta.
- "Vencida" não é estado: continua sendo `pendente` com `vencimento` no passado.
- Cartão aprovado e ainda não liquidado conta como `paga`.
- Estorno parcial fica como `paga`: o adaptador passa `p_divergencia = 'estorno_parcial'` e o evento fica `divergente`.
- `cobrancas.divergencia` é um código: `pagamento_duplicado`, `cancelada_no_gateway`, `estado_apos_estorno` ou `estorno_parcial`. O texto para o usuário fica no front.
- Cobrança sem `gateway_id` nunca é tocada pelo webhook.
- Cobrança com `baixa_em` preenchido (baixa manual de cobrança emitida): evento `ignorado`, ou `divergente` se o gateway disser `paga` (pagamento em duplicidade); nesse caso `cobrancas.divergencia = 'pagamento_duplicado'`.

Pagar a cobrança libera o check-in sem código adicional: `fazer_checkin` já lê `cobrancas`.

### 3.5 Baixa manual e cancelamento

| Caso | Como | Faz |
|---------------|-------|-----|
| Cobrança sem `gateway_id` | RPC `baixar_cobranca_manual` e `cancelar_cobranca` | Marca `paga` (com `baixa_por` e `baixa_em`) ou `cancelada`. |
| Baixa de cobrança emitida | Edge Function `cobranca-baixar` | Cancela no gateway, para o boleto e o Pix pararem de valer, e chama `baixar_cobranca_interna`. Se o gateway recusar porque já recebeu: "Esta cobrança já foi paga pelo gateway". |
| Cancelamento de cobrança emitida | Edge Function `cobranca-cancelar` | Cancela no gateway e chama `cancelar_cobranca_interna`. Só a partir de `pendente`. |

Estorno de cobrança paga pelo gateway é feito no painel do gateway; o webhook traz o estado.

## 4. Schema e RLS (revisão 6, aprovada)

Implementado em `supabase/migrations/20261005120000_correcoes_e_financeiro.sql`. O schema inicial não foi editado.

### 4.1 Correções no schema inicial

**Data no fuso da academia**

- `hoje_academia(p_academia_id) returns date`: `(now() at time zone academias.fuso)::date`.
- Substitui `current_date` em `vw_inadimplentes`, `vw_progresso_graduacao`, `academia_ativa` e `matricula_online` (maioridade e `data_inicio`).
- Não muda: os defaults de coluna `matriculas.data_inicio`, `graduacoes.data` e `academias.trial_ate`, que continuam em UTC. O front e as RPCs enviam a data explícita.

**Nenhum registro muda de academia**

- Trigger `bloqueia_troca_academia` em toda tabela com `academia_id`: recusa update que altere a coluna, inclusive do dono do banco. Tabela nova precisa criar o mesmo trigger; um teste falha se alguma ficar sem.

**Academia suspensa não altera os próprios dados**

- `academias_update` usava `tem_papel`; passa a usar `pode_gerir(id, array['dono', 'admin'])` no `using` e no `with check`. Falha achada pelos testes de RLS do Codex.

**Aluno não se apaga, se anonimiza**

- Sem política de delete e sem grant de delete em `alunos`.
- Insert e update por coluna: `user_id`, `anonimizado_em`, `created_at` e `updated_at` não são graváveis pela API; no update, `id` e `academia_id` também não. `user_id` só muda por `vincular_meu_cadastro_aluno` e `anonimizado_em` só por `anonimizar_aluno`.
- `cobrancas.aluno_id` com `on delete restrict`.
- `alunos.anonimizado_em timestamptz`; um trigger recusa update em aluno com o marcador, salvo a própria limpeza.
- O aluno só conta como anonimizado quando o marcador existe **e** os dados pessoais já saíram. Marcador presente com dados ainda preenchidos: `anonimizar_aluno` limpa.
- `anonimizar_aluno(p_aluno_id)`, só dono e admin. Usa `tem_papel`, **sem checar a assinatura**: pedido de titular (LGPD) não depende de pagamento. É a única exceção à regra "suspensa lê, mas não altera".
  - recusa se houver cobrança `pendente`;
  - `nome = 'Aluno anonimizado'`; zera CPF, nascimento, telefone, e-mail, foto, dados do responsável, contato de emergência, observações médicas e `user_id`;
  - `status = 'inativo'`, `anonimizado_em = now()`;
  - matrículas não canceladas viram `cancelada`, com `data_fim = hoje_academia`;
  - apaga `gateway_clientes` do aluno e esvazia o `payload` dos eventos das cobranças dele;
  - remove o papel `aluno` do login, se ele não tiver outro aluno na academia;
  - mantém presenças, graduações e cobranças.
- O cadastro do pagador no gateway continua lá: é a conta da academia.

### 4.2 `academias` e `matriculas`

- `matriculas.cobrar_a_partir date not null`: dia 1 da primeira competência cobrada.
  - Padrão: mês do cadastro, no fuso da academia. Se `data_inicio` é posterior ao cadastro, vale o mês de `data_inicio`; senão a matrícula que começa no mês que vem teria duas cobranças naquele mês.
  - A secretaria edita só enquanto a matrícula não tem nenhuma cobrança.
  - Nunca anterior ao mês do cadastro: competência passada fica fora da janela de geração e nunca seria cobrada.
  - Aluno antigo importado: a secretaria informa o mês seguinte.

- `dias_antecedencia_cobranca smallint not null default 10`, de 1 a 28, editável por dono e admin.

### 4.3 `cobrancas`

A coluna `gateway` (text) saiu; a cobrança aponta para a conta que a emitiu.

| Coluna nova | Tipo | Nota |
|-------------|------|------|
| `gateway_conta_id` | uuid | FK composta `(academia_id, gateway_conta_id) → gateway_contas (academia_id, id)` |
| `competencia` | date | dia 1 do mês de referência; nula em cobrança avulsa |
| `valor_pago` | numeric(10,2) | |
| `baixa_por` | uuid | FK `auth.users`, `on delete set null`; só em baixa manual |
| `baixa_em` | timestamptz | só em baixa manual |
| `emissao_iniciada_em` | timestamptz | reserva da emissão |
| `emissao_gateway_conta_id` | uuid | conta para a qual a emissão foi reservada; FK composta; preenchida junto com `emissao_iniciada_em` |
| `emissao_tentativa` | uuid | muda a cada reserva ou renovação; só a vigente registra, libera ou renova |
| `emissao_recusa` | text | motivo da última recusa explícita do gateway |
| `divergencia` | text | código com `check`: `pagamento_duplicado`, `cancelada_no_gateway`, `estado_apos_estorno`, `estorno_parcial` |

Restrições:

- `unique (academia_id, id)`.
- `unique (matricula_id, competencia)`. Vale também para `cancelada`: competência cancelada não é regerada; para cobrar de novo, cria-se uma avulsa.
- `unique (gateway_conta_id, gateway_id)`.
- `check ((gateway_conta_id is null) = (gateway_id is null))`.

**"Emitida"** = `gateway_id is not null` **ou** `emissao_iniciada_em is not null`. A definição vale no trigger de valor e vencimento, em `baixar_cobranca_manual` e em `cancelar_cobranca`, sempre com a linha travada (`for update`).

Permissões de `authenticated`:

- insert só em `academia_id, aluno_id, matricula_id, competencia, descricao, valor, vencimento`;
- update só em `descricao, valor, vencimento`, e um trigger recusa mudar `valor` e `vencimento` de cobrança emitida ou que saiu de `pendente`;
- **sem delete**: nem política, nem grant. Cobrança se cancela.

O aluno lê as próprias cobrancas e, com elas, a coluna `divergencia`.

### 4.4 Tabelas novas

Todas com `academia_id not null`, RLS ligado e FK composta.

**`gateway_contas`** — conta da academia no gateway.

| Coluna | Tipo | Nota |
|--------|------|------|
| `id` | uuid PK | `unique (academia_id, id)` |
| `academia_id` | uuid not null | FK `academias` |
| `gateway` | text | `asaas`, `efi` ou `mercadopago` |
| `ambiente` | text | `sandbox` ou `producao` |
| `conta_externa_id` | text | id da conta no gateway; `unique (academia_id, gateway, ambiente, conta_externa_id)` |
| `ativa` | boolean | no máximo uma ativa por academia (índice único parcial) |
| `api_key_secret_id` | uuid | segredo no Vault |
| `webhook_token_hash` | text | SHA-256 do authToken, `unique` |
| `conectada_em`, `created_at`, `updated_at` | timestamptz | |

- Não há `unique (academia_id, gateway)`: a academia pode acumular contas. Só a ativa emite; **as inativas continuam recebendo o webhook das cobranças que emitiram**.
- `conta_externa_id` distingue reconexão (mesma conta: troca chave e token) de conta nova (desativa a anterior).
- Dono e admin leem `id, academia_id, gateway, ambiente, ativa, conectada_em`. Nenhuma escrita por `authenticated`.

**`gateway_clientes`** — PK `(gateway_conta_id, aluno_id)`; `gateway_cliente_id`, `cpf_pagador`. Só `service_role`.

**`gateway_eventos`** — `gateway_conta_id`, `evento_id` (`unique (gateway_conta_id, evento_id)`), `tipo`, `cobranca_id`, `status` (`recebido`, `processado`, `ignorado`, `divergente`, `erro`), `payload`, `erro`, `recebido_em`, `processado_em`. Só `service_role`. Retenção de 90 dias (job na etapa seguinte).

### 4.5 Funções

Todas `security definer`, `set search_path = ''`, com `revoke execute from public, anon, authenticated` e grant explícito.

Para `authenticated`:

| Função | Papel | Faz |
|--------|-------|-----|
| `baixar_cobranca_manual(cobranca, forma, pago_em, valor_pago)` | secretaria | Só `pendente` não emitida. Marca `paga`, grava `baixa_por` e `baixa_em`. |
| `cancelar_cobranca(cobranca)` | secretaria | Só `pendente` não emitida. |
| `gerar_cobrancas_matricula(matricula)` | secretaria | Gera na hora as cobranças da matrícula, sem esperar o job. |
| `anonimizar_aluno(aluno)` | dono, admin | Seção 4.1. |

Só para `service_role`. As que recebem `p_user_id` **reconferem no SQL** se esse usuário tem o papel na academia e se a assinatura está em dia (`membro_pode_gerir`):

| Função | Faz |
|--------|-----|
| `reservar_emissao_interna(cobranca, user_id, conta, tentativa_conferida default null) returns jsonb` | `{estado, gateway_conta_id, tentativa}`. Estados: `reservada`, `orfa`, `em_andamento` ou `emitida`. Só reserva para conta ativa. Com `tentativa_conferida`, renova a órfã se ela ainda for a vigente; senão `reserva_substituida`. |
| `registrar_emissao_interna(cobranca, tentativa, conta, gateway_id, link)` | Grava a emissão. Exige a tentativa vigente e reserva para a mesma conta. Se a cobrança já tem essa conta e esse `gateway_id`, só completa o link nulo. |
| `liberar_emissao_interna(cobranca, tentativa, recusa)` | Solta a reserva. Exige a tentativa vigente e a recusa explícita do gateway, que fica em `emissao_recusa`. |
| `baixar_cobranca_interna(cobranca, user_id, forma, pago_em, valor_pago)` | Usada por `cobranca-baixar` depois de cancelar no gateway. Aceita também `cancelada` emitida. |
| `cancelar_cobranca_interna(cobranca, user_id)` | Usada por `cobranca-cancelar`. |
| `aplicar_pagamento_gateway(conta, evento_id, gateway_id, referencia, estado, pago_em, valor_pago, forma, divergencia) returns text` | Transições da seção 3.4 e registro do evento. Devolve `aplicado`, `sem_mudanca`, `ignorado` ou `divergente`. |
| `gateway_salvar_conta(academia, user_id, gateway, ambiente, conta_externa_id, api_key, token_hash) returns uuid` | Só dono e admin. Chave no Vault. |
| `gateway_credencial(conta) returns text` | Lê a chave no Vault. |
| `gerar_cobrancas(academia default null, matricula default null) returns integer` | Recorrência. |

**Recorrência (`gerar_cobrancas`)**

- Considera matrícula `ativa` de aluno `ativo`, com plano, `dia_vencimento` e valor `coalesce(matriculas.valor, planos.valor) > 0`, em academia com assinatura em dia.
- O plano define o intervalo em meses (1, 3, 6, 12), contado de `cobrar_a_partir`.
- **Primeira mensalidade**: competência = `cobrar_a_partir`; vence em `greatest(data_inicio, dia do cadastro)`, então nunca nasce vencida.
  - Exceção: se `cobrar_a_partir` é um mês posterior a essa data (importado, cobrança adiada), vence no `dia_vencimento` daquele mês. Sem isso, o aluno importado receberia hoje a cobrança do mês seguinte.
- **Demais**: vencimento = `dia_vencimento` no mês da competência, sem regra especial.
- Não há pró-rata: quem começa dia 25 com vencimento no dia 5 paga a primeira no dia 25 e a segunda no dia 5 seguinte.
- Gera quando `hoje_academia >= vencimento - dias_antecedencia_cobranca`, dentro de `data_fim`.
- Só a competência corrente e a seguinte.
- `on conflict (matricula_id, competencia) do nothing`.

O agendamento no pg_cron e a emissão automática ficam para a etapa seguinte.

### 4.6 Validação

Testes pgTAP em `supabase/tests/financeiro/` (97 asserções):

| Arquivo | Cobre |
|---------|-------|
| `emissao_webhook.test.sql` | token de A com id ou `externalReference` de cobrança de B; baixa, cancelamento e ajuste de valor recusados durante a reserva; reserva mantida sem recusa explícita; retomada concorrente (registro, liberação e renovação com tentativa antiga recusados); webhook antes do registro e link completado depois; adoção por `externalReference` só para a conta da reserva; evento repetido; pagamento em duplicidade |
| `recorrencia.test.sql` | padrão de `cobrar_a_partir`; gerar duas vezes sem duplicata; competência cancelada não volta; `data_inicio` no mês anterior ao cadastro; importado com `cobrar_a_partir` no mês seguinte; `cobrar_a_partir` travado depois da primeira cobrança |
| `permissoes.test.sql` | delete em `alunos` e `cobrancas` negado; status só por função; academia suspensa e trial vencido não atualizam a academia; `anonimizar_aluno` funciona com a academia suspensa; recepção não grava `user_id`, `anonimizado_em` nem `academia_id` em aluno; marcador presente com dados preenchidos é limpo; aluno e turma não mudam de academia; toda tabela com `academia_id` tem o trigger |

Rodam no GitHub Actions (`.github/workflows/banco.yml`: `supabase db start` e `supabase test db`) a cada push e pull request. Localmente, sem Docker, os 97 passaram num Postgres embutido (PGlite) com pgTAP 1.3.4 e com `auth`, Vault e os papéis do Supabase simulados; o CI é a validação na stack real.

## 5. Adaptador de gateway

`supabase/functions/_shared/gateway/`, uma implementação por gateway:

```ts
interface Gateway {
  validarCredencial(): Promise<void>
  registrarWebhook(url: string, token: string): Promise<void>
  garantirCliente(pagador: Pagador): Promise<string>
  buscarPorReferencia(cobrancaId: string): Promise<CobrancaGateway | null>
  criarCobranca(dados: NovaCobranca): Promise<CobrancaGateway>
  consultar(gatewayId: string): Promise<CobrancaGateway>
  cancelar(gatewayId: string): Promise<void>
  lerWebhook(req: Request): { token: string; eventoId: string; tipo: string; gatewayId: string }
}

type CobrancaGateway = {
  gatewayId: string
  referencia: string | null
  estado: 'pendente' | 'paga' | 'cancelada' | 'estornada'
  pagoEm: string | null
  valorPago: number | null
  forma: 'pix' | 'boleto' | 'cartao' | 'dinheiro' | 'outro' | null
  link: string
}
```

O mapeamento dos status e dos nomes de evento do Asaas para os quatro estados fica dentro do adaptador e deve ser **validado no sandbox contra a documentação atual** antes do merge. Status que o adaptador não conhece gera erro (evento `erro`, resposta `500`), nunca um palpite.

## 6. Segurança

- `service_role` só nas Edge Functions. Toda função chamada pelo painel valida o JWT e o papel antes de usá-lo.
- Chave de API só no Vault. Nunca em `academias.configuracoes`, em log ou em resposta.
- Token do webhook por conta, guardado como hash, comparado em tempo constante.
- Mensagens de erro ao usuário em português, sem repassar a mensagem crua do gateway.
- Log das funções sem CPF e sem corpo de requisição.

## 7. Testes obrigatórios

1. Mesmo evento entregue duas vezes: uma única transição, as duas respostas `200`.
2. Eventos fora de ordem (pago chega antes de criado): estado final `paga`.
3. Dois eventos simultâneos da mesma cobrança: sem erro e sem estado inconsistente.
4. Token errado: `401`, nada gravado.
5. **Duas academias**: conta de A enviando o `gateway_id` de uma cobrança de B, com o token de A: cobrança de B intacta, evento `ignorado`.
6. Cobrança desconhecida na conta: `200`, `ignorado`.
7. Gateway fora do ar na reconsulta: `500`, evento `erro`; o reenvio processa.
8. Emissão com duplo clique: uma única cobrança no gateway.
9. Emissão que cai depois de criar no gateway: a nova tentativa reaproveita pela referência externa.
10. `cancelada → paga` e `paga → estornada`.
11. Recepção tentando `update cobrancas set status = 'paga'` direto: negado.
12. Professor não lê `cobrancas` nem `gateway_contas`; recepção não lê `gateway_contas`.
13. Academia suspensa: emissão negada, webhook processa.

## 8. Divisão do trabalho

| Etapa | Agente | Entrega |
|-------|--------|---------|
| 1 | Claude | Migration da seção 4 (feita) |
| 2 | Codex | Adaptador Asaas, as cinco Edge Functions, todos os testes da seção 7 em pgTAP e ajuste de `rls.test.sql` (delete em `alunos` e `cobrancas` agora dá permissão negada) |
| 3 | Antigravity | Tela de conexão do gateway, ações de emitir, baixar e cancelar, link de pagamento no portal |
| Revisão | Claude revisa 2 e 3; Codex revisa 1 | |

## 9. Fase seguinte

- **Matrícula duplicada na mesma turma**: o banco aceita duas matrículas ativas do mesmo aluno na mesma turma. Além de confundir o check-in (corrigido com `distinct` em `fazer_checkin`), isso gera **duas mensalidades**, porque `gerar_cobrancas` trabalha por matrícula. Avaliar bloqueio por trigger em `matricula_turmas` e `matriculas` (uma matrícula ativa por aluno e turma) ou, no mínimo, aviso na tela da recepção antes de salvar. Decidir antes de `criar_matricula`, que é onde a regra passa a morar.
- **Matrícula pela recepção via RPC**: `criar_matricula` (com `cobrar_a_partir` opcional; matrícula e turmas na mesma transação) e `aprovar_matricula` para as matrículas online. `cobrar_a_partir` fica **sem default** de coluna: o default seria aplicado antes do trigger, que não distinguiria valor explícito de padrão e quebraria o aluno importado. Por isso o tipo gerado marca o campo como obrigatório no insert direto; a tela usa a RPC.

- `encerrar_academia()`: hoje apagar uma academia falha no schema inicial quando ela tem matrícula com plano (FK `matriculas → planos`), e passa a falhar também com cobrança (`cobrancas → alunos` é `restrict`). Falta uma função de encerramento que defina o que é apagado, o que é anonimizado e o que é retido por obrigação fiscal.
- Reconciliação diária: reconsultar cobranças `pendente` emitidas, para cobrir webhook perdido.
- Painel de eventos `erro` e `divergente` para dono e admin.
- Alterar valor ou vencimento de cobrança já emitida.
