# Spec — Convite de membros da equipe

Status: **rascunho, aguardando aprovação do dono do projeto.** Cai em dois
casos de aprovação prévia do `CLAUDE.md`: muda papéis e o vínculo de login.
Não cria exceção à regra "academia suspensa lê, mas não altera".
Base: `supabase/migrations/20261005000000_schema_inicial.sql`
(`membros_academia` e as políticas `membros_*`).

## 1. Escopo

O dono ou o admin convida uma pessoa pelo e-mail para a equipe da academia,
com um papel. A pessoa recebe o e-mail, entra e aceita, e passa a ser membro.

Entra:

- tabela de convites e as RPCs de listar, cancelar, aceitar e recusar;
- Edge Function que cria o convite e manda o e-mail;
- seção **Equipe** no painel: membros, convites, troca de papel e desativação;
- trava do **último dono** (hoje o banco deixa a academia sem dono).

Fica de fora:

- convite de **aluno**: aluno entra pelo link mágico com o e-mail do
  cadastro (`vincular_meu_cadastro_aluno`);
- convite de **totem**: o login do aparelho continua como hoje. Um fluxo
  próprio (login e senha criados pelo painel) fica para depois;
- e-mail com modelo próprio da academia: usa os modelos do Supabase Auth;
- transferência de propriedade como fluxo à parte: dá para convidar outro
  dono e depois sair.

## 2. Como é hoje

- `membros_academia (academia_id, user_id, papel, ativo)`, chave
  `(academia_id, user_id)`: **um papel por pessoa por academia**.
- RLS: dono e admin leem e escrevem a equipe. A escrita passa por
  `pode_gerir`, que exige assinatura em dia. Só o dono cria, altera ou
  remove outro dono.
- Não existe tela nem fluxo para pôr alguém na equipe. Só existem
  `criar_academia` (quem cria vira dono) e o `insert` direto.
- Nada impede o único dono de se rebaixar, se desativar ou se apagar.
- O cadastro público está ligado (`enable_signup = true`): qualquer pessoa
  cria uma conta com qualquer e-mail, sem confirmá-lo.

## 3. Decisões (para aprovar)

| # | Decisão | Proposta | Por quê |
|---|---------|----------|---------|
| C1 | Quem convida quem | O dono convida `dono`, `admin`, `professor` e `recepcao`. O admin convida `admin`, `professor` e `recepcao`. Ninguém convida `aluno` nem `totem`. | É a regra que o RLS de `membros_academia` já aplica. Totem e aluno têm entrada própria (seção 1). |
| C2 | Validade | 7 dias. Reenviar renova a validade e manda o e-mail de novo. | Curto o bastante para um e-mail esquecido não virar porta aberta. |
| C3 | Como o convite prova quem aceita | Pelo **e-mail confirmado do login**: aceita quem entrou com o mesmo e-mail do convite (`auth.users.email_confirmed_at` preenchido). O link não carrega token. Na implementação, o aceite também exige que a sessão tenha sido aberta por um link enviado ao e-mail (`amr` do JWT: link mágico, OTP, convite, recuperação ou confirmação de cadastro; `hint = convite_exige_link`), e a confirmação de e-mail fica ligada no Auth (`enable_confirmations`): o e-mail confirmado sozinho não prova a posse se o Auth estiver configurado sem confirmação. | Mesmo critério de `vincular_meu_cadastro_aluno`. Um link encaminhado não serve para outra pessoa, e não há segredo para guardar nem vazar. |
| C4 | E-mail com conta confirmada | Recebe um link mágico para `/painel/convites`. Ao aceitar, o vínculo vai para a conta que já existe; nenhuma conta nova é criada. | Uma pessoa, um login, várias academias: é o modelo atual do painel. |
| C5 | E-mail sem conta, ou com conta **não confirmada** | Sem conta: `auth.admin.inviteUserByEmail`. Conta não confirmada: a função troca a senha dela por uma aleatória que ninguém conhece e manda o link mágico. Nos dois casos, a conta é marcada para definir senha (4.4), e o painel pede a senha antes do aceite. | A conta não confirmada pode ter sido criada por outra pessoa, com uma senha que ela conhece (4.4, passo 2). |
| C6 | Academia suspensa | Não convida, não reenvia, não cancela, não aceita e não recusa (`hint = academia_suspensa`). | "Suspensa lê, mas não altera", sem exceção nova. Um convite parado não abre acesso, porque o aceite também está bloqueado. |
| C7 | Quem já é da academia | Membro ativo da equipe (papel diferente de `aluno`): o convite é recusado (`ja_membro`), no criar e no aceitar; troca de papel é na seção Equipe. Membro **inativo**: o aceite reativa com o papel do convite. Quem só tem o papel `aluno`: o aceite troca para o papel da equipe, e o acesso de aluno continua (vem de `alunos.user_id`, por `sou_o_aluno`). | A chave `(academia_id, user_id)` só cabe um papel. O de equipe prevalece, como já acontece em `vincular_meu_cadastro_aluno` (`on conflict do nothing`). Sem totem no convite, nenhum aluno vira totem e perde o catálogo. |
| C8 | Último dono | Gatilho em `membros_academia`: recusa o update ou delete que deixe a academia sem **nenhum dono ativo** (`hint = ultimo_dono`). Vale também para o dono que altera a própria linha. Só passa o `service_role`, ou o delete em cascata de uma academia que está sendo apagada (4.5). | Uma academia sem dono fica sem ninguém que possa alterar outro dono. |
| C9 | Convite duplicado | Um convite pendente por e-mail e academia. Convidar de novo o mesmo e-mail atualiza o papel, a validade e o `convidado_por` do pendente, se quem convida pode convidar **o papel novo e o papel do pendente**. | Evita dois convites com papéis diferentes para a mesma pessoa, e impede que um admin rebaixe o convite de um dono. |
| C10 | Limite de envio | No máximo 1 e-mail para o mesmo endereço a cada 60 segundos e 5 em 24 horas, contando todas as academias e os convites cancelados e recusados; e 30 convites criados ou com envio por academia em 24 horas (`limite_convites`). Pelo histórico da própria academia (tentativas, com e-mail ou sem), o erro é explícito (`convite_reenvio_cedo`, `limite_convites`); pelos envios reais de outras, o convite e a tentativa são gravados como num envio, mas o e-mail não sai (`enviar = false`). A resposta ao front, as colunas que a academia lê e os próximos limites ficam iguais nos dois casos; os envios reais ficam em `convites_envios`, tabela do projeto todo que `authenticated` não lê e que não some quando uma academia é apagada. Assim nada revela a atividade de outro tenant. Os limites por endereço valem no projeto todo (decisão do dono do projeto na revisão do PR #82): uma academia em trial não usa outras para mandar spam ao mesmo endereço. | Qualquer login cria uma academia em trial. Sem limite, uma conta abusiva gasta a cota de SMTP de todo o SaaS. |

## 4. Schema e banco

### 4.1 `convites_equipe`

```sql
create table public.convites_equipe (
  id             uuid primary key default gen_random_uuid(),
  academia_id    uuid not null references public.academias (id) on delete cascade,
  email          text not null,
  papel          text not null
                 check (papel in ('dono', 'admin', 'professor', 'recepcao')),
  status         text not null default 'pendente'
                 check (status in ('pendente', 'aceito', 'cancelado', 'recusado')),
  convidado_por  uuid references auth.users (id) on delete set null,
  expira_em      timestamptz not null,
  ultimo_envio_em timestamptz,
  aceito_por     uuid references auth.users (id) on delete set null,
  aceito_em      timestamptz,
  encerrado_por  uuid references auth.users (id) on delete set null,  -- quem cancelou ou recusou
  encerrado_em   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (academia_id, id),
  check (email = lower(btrim(email))
         and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  check ((status = 'aceito') = (aceito_em is not null)),
  check ((status in ('cancelado', 'recusado')) = (encerrado_em is not null))
);

create unique index convites_equipe_pendente_uidx
  on public.convites_equipe (academia_id, email) where status = 'pendente';
create index convites_equipe_email_idx
  on public.convites_equipe (email) where status = 'pendente';
```

- Gatilhos `convites_equipe_academia_imutavel` (`bloqueia_troca_academia`)
  e `convites_equipe_updated_at` (`set_updated_at`).
- **Expirado não é um status gravado**: é `status = 'pendente' and expira_em <= now()`.
  Assim nenhum job precisa varrer a tabela. O convite vencido continua
  pendente: pode ser reenviado (o que renova a validade) ou cancelado, e
  nunca pode ser aceito.
- As referências a `auth.users` usam `on delete set null`. O convite fica
  como histórico e não impede apagar a conta. A checagem de
  `aceito_por is not null` fica de fora do `check` por isso.
- `convidado_por` nulo (conta de quem convidou apagada) torna o convite
  inaceitável (4.3, aceite, passo 5).

### 4.2 RLS

- `select`: dono e admin da academia (`tem_papel(academia_id, '{dono,admin}')`).
  O convidado **não** lê pela tabela: vê os próprios convites pela RPC
  `meus_convites()`.
- Nenhuma política de `insert`, `update` ou `delete` para `authenticated`.
  Tudo passa pelas RPCs e pela Edge Function.

### 4.3 Funções

Todas são `security definer` com `set search_path = ''`, usam nomes
qualificados, levam `revoke execute ... from public, anon` e têm `grant`
explícito: para `authenticated` nas RPCs do front, e só para `service_role`
nas `*_interna`.

| Função | Quem chama | Faz |
|--------|-----------|-----|
| `criar_convite_interna(p_user_id, p_academia_id, p_email, p_papel)` | Edge Function (`service_role`) | Ver abaixo. Devolve `{convite_id, email, conta}`, com `conta` igual a `nenhuma`, `nao_confirmada` ou `confirmada`, mais o `user_id` da conta. |
| `equipe_da_academia(p_academia_id)` | dono, admin | Membros com papel diferente de `aluno`: `user_id`, e-mail (de `auth.users`), papel, ativo, `created_at`. O e-mail vem só de vínculo verificado (`membros_academia.verificado`); vínculos gravados antes do convite, sem o aceite da conta, vêm com e-mail nulo até um aceite. |
| `cancelar_convite(p_convite_id)` | dono, admin | Ver abaixo. |
| `meus_convites()` | logado | Convites pendentes e não vencidos para o e-mail confirmado do login, com o nome da academia, o papel e a validade. Com e-mail não confirmado, devolve a lista vazia. |
| `aceitar_convite(p_convite_id)` | logado | Ver abaixo. |
| `recusar_convite(p_convite_id)` | logado | Passos 1, 3, 4 e 6 do aceite (e-mail confirmado, travas, convite válido, academia ativa). Não exige a senha definida. Marca `recusado`, com `encerrado_por` e `encerrado_em`. |

O front **não cria convites**: não existe uma RPC de criação para
`authenticated`. A Edge Function confere o JWT e chama
`criar_convite_interna` com o `user_id` dele. A função interna reconfere o
papel (como `reservar_emissao_interna` faz no financeiro), e a existência de
uma conta com o e-mail só volta para a Edge Function, nunca para o front.

**`criar_convite_interna`**, em ordem:

1. Normaliza o e-mail (`lower(btrim(...))`) e valida o e-mail e o papel. Se
   falhar, devolve `dados_invalidos`.
2. `membro_pode_gerir(p_user_id, p_academia_id, '{dono,admin}')`. Se falhar,
   devolve `sem_permissao` quando o usuário é membro ativo da academia e
   `academia_suspensa` quando é a assinatura que falta. Quem não é membro
   recebe `sem_permissao`, sem saber se a academia existe.
3. `p_papel = 'dono'` e quem chama não é dono: devolve `sem_permissao`.
4. Trava a academia (`select ... from academias where id = ... for update`).
   Isso serializa a criação e o aceite dos convites dessa academia.
5. Se o e-mail pertence a um membro ativo com papel diferente de `aluno`,
   devolve `ja_membro`. Se pertence a um membro **inativo** com papel `dono`
   e quem chama não é dono, devolve `sem_permissao`.
6. Já existe pendente para o e-mail:
   - o pendente é `dono` e quem chama não é dono: `sem_permissao`;
   - `ultimo_envio_em` foi há menos de 60 segundos: `convite_reenvio_cedo`;
   - senão, atualiza o papel, `expira_em = now() + 7 dias`,
     `convidado_por` e `ultimo_envio_em`.
7. Não existe pendente: se a academia já criou 30 convites nas últimas 24
   horas, devolve `limite_convites`. Senão, insere.

**`cancelar_convite`**, em ordem:

1. Trava o convite. Se ele não existe, ou se a academia dele não é uma em
   que quem chama é dono ou admin ativo, devolve `convite_invalido`.
2. Convite não pendente: `convite_invalido`.
3. Quem chama é admin e o convite é `dono`: `sem_permissao`.
4. `pode_gerir` falha: `academia_suspensa`.
5. Marca `cancelado`, com `encerrado_por` e `encerrado_em`.

**`aceitar_convite`**, em ordem. A ordem existe para não revelar nada a
quem não é o convidado:

1. Login sem e-mail confirmado: `email_nao_confirmado`.
2. Conta marcada para definir senha (4.4): `senha_pendente`. O painel pede
   a senha e tenta de novo.
3. Trava a academia do convite e depois o convite (mesma ordem de
   `criar_convite_interna`, para não haver deadlock).
4. Convite inexistente, não pendente, vencido ou de outro e-mail:
   `convite_invalido`. É um código só, para não revelar qual dos casos é.
5. `convidado_por` nulo, ou que já não é dono ou admin ativo da academia,
   ou que é admin num convite `dono`: `convite_invalido`. O convite morre
   com o acesso de quem o fez: a revogação (desativar, rebaixar, apagar ou
   trocar o titular do vínculo) já cancela os convites pendentes que a
   pessoa não pode mais conceder, e recuperar o papel não os traz de volta.
6. `academia_ativa` falha: `academia_suspensa`. Na implementação, esta
   checagem roda no fim, depois de todas as esperas, com o relógio de agora
   no fuso da academia (um trial que vence durante a espera não aceita).
7. Quem aceita já é membro ativo com papel diferente de `aluno`:
   `ja_membro`. Isso cobre quem foi reativado pela tela Equipe depois do
   convite.
8. A linha existente é `dono` inativo, o convite é de outro papel e
   `convidado_por` não é dono: `convite_invalido`.
9. Grava em `membros_academia` (insert, reativação ou troca do papel
   `aluno`) e marca `aceito`, com `aceito_por` e `aceito_em`.

**Corrida entre o criar e o aceite.** Os dois travam primeiro a linha da
academia. Por isso um convite novo nunca nasce para quem acabou de virar
membro, nem o contrário.

**Códigos de erro**, para a lista de `docs/specs/checkin-seguranca.md`:

| Código | Onde | Quando |
|--------|------|--------|
| `sem_permissao` (existente) | `criar_convite_interna`, `cancelar_convite`, `equipe_da_academia` | quem chama não é dono nem admin; admin mexendo com convite ou membro `dono` |
| `academia_suspensa` (existente) | `criar_convite_interna`, `cancelar_convite`, `aceitar_convite`, `recusar_convite` | assinatura vencida |
| `dados_invalidos` (existente) | `criar_convite_interna` | e-mail malformado, papel fora da lista |
| `email_nao_confirmado` (existente) | `aceitar_convite`, `recusar_convite` | login sem e-mail confirmado |
| `ja_membro` | `criar_convite_interna`, `aceitar_convite` | o e-mail já é membro ativo da equipe nesta academia |
| `convite_invalido` | `cancelar_convite`, `aceitar_convite`, `recusar_convite` | inexistente, de outra academia, não pendente, vencido (no aceite), de outro e-mail, ou de quem perdeu o acesso |
| `convite_reenvio_cedo` | `criar_convite_interna` | menos de 60 segundos desde o último envio |
| `limite_convites` | `criar_convite_interna` | 30 convites novos na academia nas últimas 24 horas |
| `senha_pendente` | `aceitar_convite` | conta criada ou protegida pelo convite e ainda sem senha definida |
| `ultimo_dono` | gatilho de `membros_academia` | a alteração deixaria a academia sem dono ativo |

### 4.4 Edge Function `convidar-membro`

A entrada é `{ academia_id, email, papel }`, com o JWT de quem convida.

1. Valida o JWT e chama
   `criar_convite_interna(user_id do JWT, academia_id, email, papel)`. Se der
   erro, devolve o `hint` ao front e não faz mais nada.
2. Com `service_role`, segundo a `conta` devolvida:
   - `nenhuma`: chama `auth.admin.inviteUserByEmail(email, { redirectTo })` e
     marca `app_metadata.definir_senha = true` por
     `marcar_definir_senha_interna`, com a conta travada e só se a pessoa
     ainda não gravou a senha nova (o link sai antes da marca). Se alguém se
     cadastrou com senha entre a leitura e o convite (o Auth reaproveita a
     conta sem tocar na senha), a mesma função neutraliza a conta, e a
     Edge Function manda um link novo;
   - `nao_confirmada`: chama `neutralizar_conta_nao_confirmada_interna`,
     que, com a conta travada e só se o e-mail continuar não confirmado,
     troca a senha por uma aleatória que ninguém recebe, derruba as sessões
     e os tokens de uso único e marca `app_metadata.definir_senha = true`.
     Depois manda o link mágico. Isso derruba a senha de quem tenha criado a
     conta com o e-mail de outra pessoa, sem tirar a de quem confirmou o
     cadastro no meio-tempo; numa conta sem senha (a criada agora pelo convite
     do Auth, ou a que o Auth limpou ao emitir o link) só marca
     `definir_senha`, sem apagar o link já entregue; a neutralização é idempotente (guarda em
     `app_metadata.neutralizada` o hash da senha que gravou): uma segunda
     chamada, por exemplo de outra academia com o envio suprimido, não
     invalida o link já entregue;
   - `confirmada`: manda o link mágico (`signInWithOtp`,
     `shouldCreateUser: false`).

   Se `criar_convite_interna` devolve `enviar = false` (limite por endereço
   estourado pelo histórico de outra academia), a função não manda e-mail e
   responde ao front exatamente como num envio: o front não distingue os
   dois casos.

   O `redirectTo` é `SITE_URL + "/painel/convites"`, com `SITE_URL` vindo de
   variável de ambiente da função, nunca do pedido. O e-mail usado é o
   **normalizado**, devolvido pela função interna.
3. Se o e-mail não sair, o convite fica pendente e a falha fica no log da
   função. A resposta não diz se o e-mail saiu (revisão do Codex no PR 84):
   a tela mostra "Convite criado. Se o e-mail não chegar em alguns minutos,
   reenvie."
   Para cada envio liberado (`enviar = true`), o `envio_id` devolvido é
   uma reserva: com o provedor aceitando, a função chama
   `confirmar_envio_convite_interna(envio_id)`, e o intervalo de
   60 segundos passa a contar dali; com o provedor recusando de vez, chama
   `liberar_envio_convite_interna(envio_id)`, e o envio sai da
   cota do endereço no projeto todo, para a falha não suprimir convites de
   outras academias. Enquanto a reserva não tem resultado, ela bloqueia o
   intervalo de 60 segundos e conta no teto de 5. A função deve resolver cada
   reserva logo; se cair antes de saber o resultado, o endereço fica seguro
   até o expurgo diário apagar a reserva, depois de 3 dias (lado seguro
   contra spam).

Reenviar é chamar a mesma função com o mesmo e-mail (C9 e C10). No
reenvio, a conta criada pelo primeiro convite aparece como `nao_confirmada`
(ou `confirmada`, se a pessoa já clicou) e continua marcada para definir
senha. A pessoa não fica sem senha.

Para aceitar, toda conta (nova ou antiga) define uma senha nova na sessão
aberta pelo link do convite: a `concluir-senha` grava
`app_metadata.senha_redefinida_em` (epoch) e `senha_redefinida_sessao` (o
`session_id` do JWT), e o aceite exige que a troca seja posterior ao login
pelo link e tenha sido feita na mesma sessão, que precisa existir no Auth. O aceite também apaga as outras sessões da
conta, e o vínculo só vale para tokens emitidos depois dele
((`membros_academia.vale_a_partir`, o primeiro segundo inteiro depois do aceite,
comparado com o `iat` inteiro do JWT): o front renova a sessão a partir desse
segundo e, se o token novo ainda vier com `iat` menor, renova de novo.
Isso protege contas criadas enquanto a confirmação de e-mail estava
desligada (a senha antiga pode estar com outra pessoa). A `concluir-senha` grava a
senha e a prova numa só operação, chamando
`definir_senha_comprovada_interna(user_id, session_id, senha)` com a conta
travada (nenhuma troca concorrente fica entre a senha e a prova), e guarda
também o hash da senha comprovada: o vínculo aceito por convite só
vale enquanto a senha atual for essa, e uma troca fora desse fluxo suspende o
acesso da equipe até uma nova prova. A
`criar_convite_interna` recebe o `iat` do token que a Edge Function conferiu.

`app_metadata` só é gravado com `service_role`, então o usuário não
consegue apagar a marca sozinho. Quem tira a marca é uma segunda Edge
Function, `concluir-senha`: o painel manda a senha nova para ela (não usa
`auth.updateUser`), e ela confere o JWT e chama
`definir_senha_comprovada_interna`, que grava a senha e remove
`definir_senha`. A função `aceitar_convite` lê a marca em
`auth.users.raw_app_meta_data`.

A função não grava em tabela de negócio fora de `criar_convite_interna`. O
`service_role` serve só para o Auth. O log não leva o e-mail completo.

**Contrato implementado** (`supabase/functions/`, PR 2):

- A resposta sai logo depois de `criar_convite_interna`: a neutralização da
  conta, o envio e a resolução da reserva rodam depois dela
  (`EdgeRuntime.waitUntil`), para o tempo de resposta também não revelar a
  conta nem a cota usada por outra academia. Logo antes de chamar o Auth, o
  worker assume a reserva (`assumir_envio_convite_interna`, que grava
  `convites_envios.tentativa_em`); se ela já foi liberada, não envia. Uma
  reserva que nenhum worker assumiu em 2 minutos (o worker caiu antes do
  Auth) é liberada pelo job `liberar-reservas-convite-abandonadas`, a cada
  minuto. A assumida e sem resultado segura o endereço até o expurgo, porque
  o e-mail pode ter saído.
- Resposta de sucesso da `convidar-membro`: `{ convite_id }`, igual para o
  envio que saiu, o suprimido (`enviar = false`) e o que falhou no Auth. O
  resultado do Auth revelaria se a conta existe e se outra academia convidou
  o mesmo endereço; ele fica só no log e no tratamento da reserva. Em todos
  os casos o convite fica pendente e pode ser reenviado.
- Erro: `{ erro: <hint> }`, só o código estável, nunca o texto do banco.
  Status 401 para `sem_sessao`, 403 para `sem_permissao`, 429 para
  `limite_convites` e `convite_reenvio_cedo`, 400 para os demais e 500 para
  `erro_interno`.
- Reserva de envio: confirmada quando o Auth aceita o envio; liberada quando
  ele recusa com 4xx (menos 408) ou quando o envio nem chega a ser tentado
  (falha ao neutralizar a conta não confirmada); mantida (até o expurgo)
  quando a falha é 5xx, 408 ou de rede, porque aí não se sabe se o e-mail
  saiu. As RPCs da reserva têm uma nova tentativa e, se falharem de novo,
  ficam no log com o id da reserva e o código do erro.
- A conta `nao_confirmada` é neutralizada mesmo quando `enviar = false`.
- Token recusado pelo Auth (4xx) dá `sem_sessao`; falha do próprio Auth
  (5xx, rede) dá `erro_interno`, para o front não encerrar a sessão por
  isso. `SITE_URL` é validada na subida da função (http ou https, sem query
  nem fragmento).
- O link mágico das contas existentes sai pelo endpoint público do Auth
  (`signInWithOtp`), sujeito ao limite por IP do projeto (`sign_in_sign_ups`
  e `max_frequency`): com muitos convites ao mesmo tempo, o envio pode ser
  recusado com 429; o convite fica pendente e a falha, no log. Com SMTP próprio,
  dimensione esses limites no painel do Auth; mandar o link por um provedor
  transacional próprio fica para depois.
- A `concluir-senha` recebe `{ senha }` e só aceita token de sessão aberta
  por link (`amr` com `otp`, `magiclink`, `invite`, `recovery`,
  `email/signup` ou `email_change`, a mesma lista do aceite) e com `session_id`; senão, `convite_exige_link`.
  Só grava para conta com convite pendente e válido para o e-mail
  confirmado ou com vínculo já aceito por convite (refazer a prova); fora
  disso, `convite_invalido`. Conta comum troca a senha pelo Auth. Conta com
  fator MFA verificado só grava com o token apresentado em aal2 (o `aal` do
  JWT vai para o banco) e a sessão viva também em aal2, como a troca de
  senha do Auth; senão, `mfa_necessario`.
  Sucesso: `{ ok: true }`, e o front renova a sessão.

**Dependência de ambiente:** o SMTP padrão do Supabase só entrega para os
e-mails da equipe do projeto e tem limite baixo por hora. Para convidar
gente de fora no `honorteam-dev`, é preciso configurar um SMTP próprio no
projeto. O link mágico do portal do aluno já depende disso.

### 4.5 Gatilho do último dono

`membros_academia_ultimo_dono`, `before update or delete`, por linha. Só
age quando a linha antiga é `dono` ativo e deixa de ser (papel trocado,
`ativo = false` ou delete).

1. Se `auth.role() = 'service_role'`, deixa passar. O critério é o papel da
   requisição, e não o `current_user`: uma função `security definer` roda
   como dona da função e não pode furar a trava por isso.
2. Trava a academia (`for update`). Se ela não existe mais, deixa passar: é
   o delete em cascata de uma academia sendo apagada.
3. Conta os outros donos ativos. Se não houver nenhum, recusa com
   `ultimo_dono`.

Como os dois lados travam a academia antes de contar, dois donos saindo ao
mesmo tempo esperam um pelo outro, e o segundo é recusado.

Apagar no Auth a conta do último dono de uma academia (o delete em cascata
de `auth.users`) também é recusado, porque o Auth não roda como
`service_role`. A exclusão lógica (`deleted_at`) é proibida (decisão do dono do projeto
na revisão do PR #82): um gatilho em `auth.users` a recusa com
`exclusao_logica_bloqueada`, porque uma conta apagada logicamente, com um JWT
emitido antes, continuaria passando pelo RLS em vários pontos. Vale para todos,
inclusive o SQL do projeto. Conta se apaga de verdade, e o delete em cascata
leva os vínculos e solta os cadastros de aluno e professor. A conta só pode ser apagada depois de passar a academia
para outro dono. Pedido de titular (LGPD) com essa conta é tratado
manualmente, pelo SQL do projeto.

## 5. Telas

- **Painel → Equipe**, para dono e admin. Academia suspensa vê, mas não
  altera:
  - membros (`equipe_da_academia`), ativos e inativos, com papel. Permite
    trocar o papel e desativar, pelo RLS que já existe e com o gatilho do
    último dono. O admin não vê as ações sobre `dono`;
  - convites pendentes, vencidos à parte, com reenviar e cancelar;
  - formulário de convite com e-mail e papel. O admin não vê a opção
    `dono`.
- **`/painel/convites`**, para qualquer login: mostra `meus_convites()`,
  com aceitar e recusar. Se a conta está marcada para definir senha, pede a
  senha antes (pela `concluir-senha`). Ao aceitar, vai
  para a escolha de academia.

`convites` precisa entrar na lista de segmentos que o painel reconhece. Não
é slug de academia, porque fica dentro de `/painel`.

## 6. Testes obrigatórios

**pgTAP com 2 academias.** As corridas usam conexões separadas por
`dblink`, como `supabase/tests/matricula/concorrencia.test.sql`.

1. Isolamento: o admin de A não cria convite em B, mesmo sabendo o id, não
   lê `convites_equipe` de B, não cancela convite de B (`convite_invalido`,
   igual ao de um id inexistente) e não lista a equipe de B.
2. Papéis: o admin convida professor; o admin convida dono e recebe
   `sem_permissao`; o dono convida dono. Papel `aluno` ou `totem`, ou
   e-mail malformado, dá `dados_invalidos`.
3. C9: o admin tenta sobrescrever um pendente `dono` e recebe
   `sem_permissao`, com o convite intacto. O dono convida de novo e fica um
   pendente só, com o papel, a validade e o `convidado_por` novos.
4. C10: o reenvio antes de 60 segundos dá `convite_reenvio_cedo`; o 31º
   convite novo em 24 horas dá `limite_convites`.
5. Academia suspensa: criar, cancelar, aceitar e recusar dão
   `academia_suspensa`.
6. Aceite inválido: outro e-mail, vencido, cancelado, recusado ou já
   aceito dão `convite_invalido`; e-mail não confirmado dá
   `email_nao_confirmado`; marca `definir_senha` dá `senha_pendente`.
   Nenhum desses casos grava membro.
7. Aceite depois de perder o acesso: quem convidou é desativado ou
   rebaixado, ou a conta dele é apagada (`convidado_por` nulo), e o aceite
   dá `convite_invalido`.
8. C7: um membro ativo convidado dá `ja_membro` no criar. Um membro
   reativado pela tela depois do convite dá `ja_membro` no aceite. Um
   membro inativo tem o aceite reativando com o papel novo. Quem só tem o
   papel `aluno` passa para o papel da equipe, e `sou_o_aluno` continua
   verdadeiro. Um admin não reativa um `dono` inativo com outro papel.
9. Concorrência (`dblink`): dois aceites do mesmo convite geram um membro e
   um `aceito`. Criar e aceitar ao mesmo tempo para o mesmo e-mail não
   deixa pendente para membro ativo.
10. Último dono: rebaixar, desativar ou apagar o único dono ativo dá
    `ultimo_dono`, inclusive por função `security definer`. Com dois donos,
    um pode sair. Dois donos saindo ao mesmo tempo (`dblink`): sobra um.
    `service_role` passa, e apagar a academia apaga os membros.
11. Acesso: professor, recepção, aluno e totem não leem `convites_equipe`
    nem chamam `equipe_da_academia`. `anon` não executa nenhuma das RPCs.
    `authenticated` não executa `criar_convite_interna`. Nenhum
    `insert`, `update` ou `delete` direto em `convites_equipe` passa. O
    gatilho de academia imutável recusa a troca.
12. `meus_convites()`: só os do e-mail confirmado do login, sem vencidos,
    aceitos, cancelados nem recusados; com e-mail não confirmado, lista
    vazia.

**Edge Functions (Deno test, com o Auth simulado):** os três ramos da
`conta`, a senha trocada na conta não confirmada, o `redirectTo` vindo só
da variável de ambiente, a falha de envio mantendo o pendente, o `hint`
repassado sem texto cru e o log sem o e-mail.

**Front (Vitest):** a seção Equipe por papel (admin sem a opção `dono`), a
tela `/painel/convites` com definição de senha e as mensagens por `hint`.

## 7. Entrega em PRs

1. **Migration e testes pgTAP**: tabela, RLS, funções e o gatilho do último
   dono, mais os tipos gerados pelo CI.
2. **Edge Functions `convidar-membro` e `concluir-senha`**, com os testes em
   Deno. São as primeiras do repositório: o PR cria `supabase/functions/` e
   acrescenta ao CI o passo de checagem e teste delas.
3. **Telas**: Equipe e `/painel/convites`.

## 8. Perguntas em aberto

- **C10:** os números (60 segundos, 30 por dia) são um palpite. Dá para
  ajustar depois sem mudar o desenho.
- **Conta do último dono no Auth (4.5):** a proposta é recusar o delete e
  tratar à mão. A alternativa é deixar o Auth apagar e a academia ficar sem
  dono até o suporte intervir.
