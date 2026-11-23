# Spec — Convite de membros da equipe

Status: **rascunho, aguardando aprovação do dono do projeto.** Cai em dois
casos de aprovação prévia do `CLAUDE.md`: muda papéis e o vínculo de login.
Base: `supabase/migrations/20261005000000_schema_inicial.sql`
(`membros_academia` e as políticas `membros_*`).

## 1. Escopo

O dono ou o admin convida uma pessoa pelo e-mail para a equipe da academia,
com um papel. A pessoa recebe o e-mail, entra e aceita, e passa a ser membro.

Entra:

- tabela de convites, RPCs de criar, cancelar, listar e aceitar;
- Edge Function que cria o convite e manda o e-mail;
- seção **Equipe** no painel: membros, convites pendentes, troca de papel e
  desativação;
- trava do **último dono** (hoje o banco deixa a academia sem dono).

Fica de fora:

- convite de **aluno** (aluno entra pelo link mágico, pelo e-mail do
  cadastro: `vincular_meu_cadastro_aluno`);
- e-mail com modelo próprio da academia (usa os modelos do Supabase Auth);
- transferência de propriedade como fluxo à parte (dá para fazer convidando
  outro dono e depois saindo).

## 2. Como é hoje

- `membros_academia (academia_id, user_id, papel, ativo)`, chave
  `(academia_id, user_id)`: **um papel por pessoa por academia**.
- RLS: dono e admin leem e escrevem a equipe (`pode_gerir`, ou seja,
  assinatura em dia); só o dono cria, altera ou remove outro dono.
- Não existe tela nem fluxo para pôr alguém na equipe: só
  `criar_academia` (o criador vira dono) e o `insert` direto.
- Nada impede o único dono de se rebaixar, se desativar ou se apagar.

## 3. Decisões (para aprovar)

| # | Decisão | Proposta | Por quê |
|---|---------|----------|---------|
| C1 | Quem convida quem | Dono convida qualquer papel da equipe, inclusive `dono`. Admin convida `admin`, `professor`, `recepcao` e `totem`. Ninguém convida `aluno`. | É a regra que o RLS de `membros_academia` já aplica. |
| C2 | Validade | 7 dias. Reenviar renova a validade e manda o e-mail de novo. | Curto o bastante para um e-mail esquecido não virar porta aberta. |
| C3 | Como o convite prova quem aceita | Pelo **e-mail confirmado do login**: aceita quem entrou com o mesmo e-mail do convite (`auth.users.email_confirmed_at` preenchido). Sem token no link. | Mesmo critério de `vincular_meu_cadastro_aluno`. Link encaminhado não serve para outra pessoa, e não há segredo para guardar nem vazar. |
| C4 | E-mail que já tem conta | Recebe um link mágico para `/painel/convites`. Ao aceitar, o vínculo vai para a conta que já existe; nenhuma conta nova é criada. | Uma pessoa, um login, várias academias: é o modelo atual do painel. |
| C5 | E-mail sem conta | `auth.admin.inviteUserByEmail`, com volta para `/painel/convites`. No primeiro acesso, o painel pede uma senha. | O painel entra por e-mail e senha. |
| C6 | Academia suspensa | Não convida, não reenvia e **não aceita**: `pode_gerir` no criar e `academia_ativa` no aceitar (`hint = academia_suspensa`). Cancelar convite continua valendo. | "Suspensa lê, mas não altera", sem exceção nova. Cancelar só reduz acesso. |
| C7 | Quem já é da academia | Membro ativo da equipe: o convite é recusado (`hint = ja_membro`); troca de papel é na seção Equipe. Membro **inativo**: o aceite reativa com o papel do convite. Quem só tem o papel `aluno`: o aceite troca para o papel da equipe, e o acesso de aluno continua (vem de `alunos.user_id`, por `sou_o_aluno`). | A chave `(academia_id, user_id)` só cabe um papel; o de equipe prevalece, como já acontece em `vincular_meu_cadastro_aluno` (`on conflict do nothing`). |
| C8 | Último dono | Gatilho em `membros_academia`: recusa update ou delete que deixe a academia sem **nenhum dono ativo** (`hint = ultimo_dono`). Vale também para o dono mexendo em si mesmo. | Academia sem dono fica sem quem altere outro dono. Só `service_role` (billing, encerramento) passa. |
| C9 | Convite duplicado | Um convite pendente por e-mail e academia. Convidar de novo o mesmo e-mail atualiza o papel e a validade do pendente, se quem convida pode convidar aquele papel. | Evita dois convites com papéis diferentes para a mesma pessoa. |

## 4. Schema

### 4.1 `convites_equipe`

```sql
create table public.convites_equipe (
  id             uuid primary key default gen_random_uuid(),
  academia_id    uuid not null references public.academias (id) on delete cascade,
  email          text not null,               -- sempre lower(trim(...))
  papel          text not null
                 check (papel in ('dono', 'admin', 'professor', 'recepcao', 'totem')),
  status         text not null default 'pendente'
                 check (status in ('pendente', 'aceito', 'cancelado')),
  convidado_por  uuid not null references auth.users (id),
  expira_em      timestamptz not null,
  aceito_por     uuid references auth.users (id),
  aceito_em      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (academia_id, id),
  check (email = lower(trim(email)) and email like '%_@_%')
);

create unique index convites_equipe_pendente_uidx
  on public.convites_equipe (academia_id, email) where status = 'pendente';
```

- Trigger `convites_equipe_academia_imutavel` (`bloqueia_troca_academia`).
- "Expirado" não é status gravado: é `status = 'pendente' and expira_em <= now()`.
  Assim nenhum job precisa varrer a tabela.
- `convidado_por` e `aceito_por` sem `on delete cascade`: o convite é
  histórico de quem deu acesso a quem.

### 4.2 RLS

- `select`: dono e admin da academia (`tem_papel(academia_id, '{dono,admin}')`).
  O convidado **não** lê pela tabela; vê os próprios convites pela RPC
  `meus_convites()`.
- Sem `insert`, `update` nem `delete` para `authenticated`: tudo pelas RPCs.

### 4.3 RPCs (todas `security definer`, `set search_path = ''`, sem `anon`)

| RPC | Quem chama | Faz |
|-----|-----------|-----|
| `criar_convite(p_academia_id, p_email, p_papel)` | dono, admin | Valida o papel (C1) e a assinatura (C6), normaliza o e-mail, recusa `ja_membro` (C7) e cria ou atualiza o pendente (C9). Devolve `{convite_id, usuario_existe}`. |
| `cancelar_convite(p_convite_id)` | dono, admin | Só pendente. Admin não cancela convite de `dono`. Não checa assinatura (C6). |
| `meus_convites()` | logado | Convites pendentes e não vencidos para o e-mail confirmado do login, com o nome da academia e o papel. E-mail não confirmado: lista vazia. |
| `aceitar_convite(p_convite_id)` | logado | Trava o convite (`for update`), confere pendente, não vencido, e-mail confirmado igual ao do convite (C3) e academia ativa (C6). Grava em `membros_academia` (insert, reativação ou troca do papel `aluno`, C7), marca `aceito`. |
| `recusar_convite(p_convite_id)` | logado | O próprio convidado cancela o convite dele. |

`criar_convite` não é chamada pelo front direto: só pela Edge Function, que
precisa do `usuario_existe` para escolher o e-mail (4.4). Mesmo assim fica
com `grant` para `authenticated`, porque a função a chama **com o JWT de quem
convida**, e é o banco que decide a permissão.

Códigos novos no `hint`, para a lista de `docs/specs/checkin-seguranca.md`:

| Código | Onde | Quando |
|--------|------|--------|
| `sem_permissao` (existente) | `criar_convite`, `cancelar_convite` | quem chama não é dono ou admin, ou é admin mexendo com papel `dono` |
| `academia_suspensa` (existente) | `criar_convite`, `aceitar_convite` | assinatura vencida |
| `dados_invalidos` (existente) | `criar_convite` | e-mail malformado, papel fora da lista |
| `ja_membro` | `criar_convite` | o e-mail já é membro ativo da equipe nesta academia |
| `convite_invalido` | `aceitar_convite`, `recusar_convite`, `cancelar_convite` | convite inexistente, não pendente, vencido ou de outro e-mail (um código só: não revela qual) |
| `email_nao_confirmado` (existente) | `aceitar_convite` | login sem e-mail confirmado |
| `ultimo_dono` | gatilho de `membros_academia` | a alteração deixaria a academia sem dono ativo |

### 4.4 Edge Function `convidar-membro`

Entrada `{ academia_id, email, papel }`, com o JWT de quem convida.

1. Chama `criar_convite` com um cliente **no nome do usuário** (JWT dele).
   Erro: devolve o `hint` ao front, sem mais nada.
2. Com `service_role`:
   - `usuario_existe = false`: `auth.admin.inviteUserByEmail(email, { redirectTo: <site>/painel/convites })`.
   - `usuario_existe = true`: link mágico (`signInWithOtp`, `shouldCreateUser: false`) com volta para `/painel/convites`.
3. Falha no envio do e-mail: o convite fica pendente e a tela mostra
   "Convite criado, mas o e-mail não saiu. Tente reenviar."

Reenviar = chamar a mesma função com o mesmo e-mail (C9).

A função não grava nada fora de `criar_convite`, e o `service_role` serve só
para mandar o e-mail. Log sem e-mail completo.

**Dependência de ambiente:** o SMTP padrão do Supabase só entrega para os
e-mails da equipe do projeto e tem limite baixo por hora. Para convidar
gente de fora no `honorteam-dev`, é preciso configurar um SMTP próprio no
projeto. O link mágico do portal do aluno já depende disso.

## 5. Telas

- **Painel → Equipe** (dono e admin; academia suspensa vê, mas não altera):
  - membros ativos e inativos, com papel; trocar papel e desativar
    (pelo RLS que já existe, com o gatilho do último dono);
  - convites pendentes, com validade, reenviar e cancelar;
  - formulário de convite: e-mail e papel (o admin não vê a opção `dono`).
- **`/painel/convites`** (qualquer login): lista de `meus_convites()`, com
  aceitar e recusar. Login novo, sem senha: pede a senha antes
  (`auth.updateUser`). Ao aceitar, vai para a escolha de academia.

`convites` precisa entrar na lista de segmentos que o painel reconhece; não
é slug de academia porque fica dentro de `/painel`.

## 6. Testes obrigatórios (pgTAP, com 2 academias)

1. Admin de A não cria convite em B (nem sabendo o id), não lê convites de B.
2. Admin convida professor: ok. Admin convida dono: `sem_permissao`. Dono convida dono: ok.
3. Academia suspensa: `criar_convite` e `aceitar_convite` dão `academia_suspensa`; `cancelar_convite` funciona.
4. Aceitar com outro e-mail, com e-mail não confirmado, vencido ou cancelado: `convite_invalido` ou `email_nao_confirmado`, sem gravar membro.
5. Dois aceites simultâneos do mesmo convite: um membro só, um `aceito`.
6. Convidar de novo o mesmo e-mail: um pendente só, com o papel e a validade novos.
7. Membro ativo da equipe: `ja_membro`. Membro inativo: o aceite reativa com o papel novo. Quem só é `aluno`: o aceite troca o papel e `sou_o_aluno` continua verdadeiro.
8. Último dono: rebaixar, desativar ou apagar o único dono ativo dá `ultimo_dono`; com dois donos, um pode sair. Dois donos saindo ao mesmo tempo: sobra um.
9. Professor, recepção, aluno e totem não leem `convites_equipe` nem chamam `criar_convite` com sucesso.

Front (Vitest): seção Equipe por papel (admin sem opção `dono`), tela
`/painel/convites`, mensagens por `hint`.

## 7. Entrega em PRs

1. **Migration e testes pgTAP** (tabela, RLS, RPCs, gatilho do último dono)
   e tipos do CI.
2. **Edge Function `convidar-membro`** (primeira Edge Function do repositório:
   cria `supabase/functions/` e o passo de deploy, se o CI for publicá-las).
3. **Telas** (Equipe e `/painel/convites`).

## 8. Perguntas em aberto

- O gatilho do último dono (C8) muda uma regra que hoje não existe. Se o
  billing do SaaS ou um futuro `encerrar_academia()` precisar remover o
  último dono, ele roda como `service_role`, que o gatilho deixa passar.
- Convite de `totem`: o aparelho precisa de um e-mail de verdade para
  receber o convite. Se for comum usar um e-mail só para o aparelho, pode
  valer um fluxo à parte (criar o login do totem com senha pelo painel).
