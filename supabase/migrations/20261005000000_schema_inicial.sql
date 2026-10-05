-- =====================================================================
-- Honor Team SaaS — schema inicial (multi-academia)
-- Supabase / Postgres 15+
--
-- Regras de ouro (ver AGENTS.md):
--   1. Toda tabela de negócio tem academia_id NOT NULL + RLS ligado.
--   2. Referências entre tabelas usam FK composta (academia_id, id),
--      então é impossível ligar um registro a outro de outra academia.
--   3. Escrita sensível (check-in do aluno, matrícula online, criar
--      academia) só via funções RPC SECURITY DEFINER.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Utilitário: updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;


-- =====================================================================
-- 1. TENANT
-- =====================================================================

create table public.academias (
  id                      uuid primary key default gen_random_uuid(),
  nome                    text not null check (length(trim(nome)) > 1),
  slug                    text not null unique
                          check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),  -- usado na URL pública
  cnpj                    text,
  telefone                text,
  logo_url                text,
  fuso                    text not null default 'America/Fortaleza',
  matricula_online_aberta boolean not null default false,
  dias_tolerancia         smallint not null default 5
                          check (dias_tolerancia between 0 and 60),  -- atraso antes de bloquear check-in
  configuracoes           jsonb not null default '{}'::jsonb,
  -- Assinatura do SaaS: só o backend (service_role) altera
  plano_saas              text not null default 'trial',
  status                  text not null default 'trial'
                          check (status in ('trial', 'ativa', 'suspensa', 'cancelada')),
  trial_ate               date not null default (current_date + 14),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.membros_academia (
  academia_id uuid not null references public.academias (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  papel       text not null
              check (papel in ('dono', 'admin', 'professor', 'recepcao', 'aluno')),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (academia_id, user_id)
);
create index membros_academia_user_idx on public.membros_academia (user_id);


-- =====================================================================
-- 2. CATÁLOGO DA ACADEMIA
-- =====================================================================

create table public.modalidades (
  id          uuid primary key default gen_random_uuid(),
  academia_id uuid not null references public.academias (id) on delete cascade,
  nome        text not null,
  ativa       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (academia_id, id),
  unique (academia_id, nome)
);

-- Faixas de cada modalidade. min_meses/min_aulas = carência para avançar
-- UM passo dentro desta faixa (próximo grau, ou próxima faixa no último grau).
create table public.faixas (
  id            uuid primary key default gen_random_uuid(),
  academia_id   uuid not null,
  modalidade_id uuid not null,
  nome          text not null,
  cor           text,                                   -- ex: '#1E40AF'
  ordem         smallint not null check (ordem > 0),    -- 1 = primeira faixa
  max_graus     smallint not null default 4 check (max_graus between 0 and 12),
  min_meses     smallint not null default 0 check (min_meses >= 0),
  min_aulas     smallint not null default 0 check (min_aulas >= 0),
  created_at    timestamptz not null default now(),
  unique (academia_id, id),
  unique (modalidade_id, ordem),
  foreign key (academia_id, modalidade_id)
    references public.modalidades (academia_id, id) on delete cascade
);

create table public.professores (
  id          uuid primary key default gen_random_uuid(),
  academia_id uuid not null references public.academias (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  nome        text not null,
  telefone    text,
  email       text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (academia_id, id)
);

create table public.turmas (
  id            uuid primary key default gen_random_uuid(),
  academia_id   uuid not null,
  modalidade_id uuid not null,
  professor_id  uuid,
  nome          text not null,
  publico       text not null default 'adulto'
                check (publico in ('adulto', 'infantil', 'misto', 'feminino')),
  capacidade    smallint check (capacidade > 0),
  ativa         boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (academia_id, id),
  foreign key (academia_id, modalidade_id)
    references public.modalidades (academia_id, id),
  foreign key (academia_id, professor_id)
    references public.professores (academia_id, id) on delete set null (professor_id)
);

create table public.turma_horarios (
  id          uuid primary key default gen_random_uuid(),
  academia_id uuid not null,
  turma_id    uuid not null,
  dia_semana  smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo
  hora_inicio time not null,
  hora_fim    time not null,
  check (hora_fim > hora_inicio),
  foreign key (academia_id, turma_id)
    references public.turmas (academia_id, id) on delete cascade
);
create index turma_horarios_turma_idx on public.turma_horarios (academia_id, turma_id);

create table public.planos (
  id               uuid primary key default gen_random_uuid(),
  academia_id      uuid not null references public.academias (id) on delete cascade,
  nome             text not null,
  valor            numeric(10, 2) not null check (valor >= 0),
  periodicidade    text not null default 'mensal'
                   check (periodicidade in ('mensal', 'trimestral', 'semestral', 'anual')),
  aulas_por_semana smallint check (aulas_por_semana > 0),  -- null = livre
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (academia_id, id)
);


-- =====================================================================
-- 3. ALUNOS E MATRÍCULAS
-- =====================================================================

create table public.alunos (
  id                   uuid primary key default gen_random_uuid(),
  academia_id          uuid not null references public.academias (id) on delete cascade,
  -- login do portal. Um mesmo usuário pode estar ligado a vários alunos
  -- (ex.: responsável com dois filhos matriculados).
  user_id              uuid references auth.users (id) on delete set null,
  nome                 text not null check (length(trim(nome)) > 1),
  cpf                  text check (cpf ~ '^\d{11}$'),             -- só dígitos
  data_nascimento      date,
  telefone             text,                                      -- E.164 p/ WhatsApp: 5585999999999
  email                text,
  foto_url             text,
  responsavel_nome     text,
  responsavel_cpf      text check (responsavel_cpf ~ '^\d{11}$'),
  responsavel_telefone text,
  contato_emergencia   text,
  observacoes_medicas  text,   -- dado sensível (LGPD): visível só p/ equipe e o próprio aluno
  status               text not null default 'ativo'
                       check (status in ('pendente', 'ativo', 'inativo')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (academia_id, id)
);
create unique index alunos_cpf_por_academia
  on public.alunos (academia_id, cpf) where cpf is not null;
create index alunos_user_idx on public.alunos (user_id) where user_id is not null;

create table public.matriculas (
  id              uuid primary key default gen_random_uuid(),
  academia_id     uuid not null,
  aluno_id        uuid not null,
  plano_id        uuid,
  status          text not null default 'ativa'
                  check (status in ('pendente', 'ativa', 'trancada', 'cancelada')),
  origem          text not null default 'recepcao' check (origem in ('recepcao', 'online')),
  data_inicio     date not null default current_date,
  data_fim        date,
  dia_vencimento  smallint check (dia_vencimento between 1 and 28),
  valor           numeric(10, 2) check (valor >= 0),   -- valor negociado (pode diferir do plano)
  termo_aceito_em timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (academia_id, id),
  foreign key (academia_id, aluno_id)
    references public.alunos (academia_id, id) on delete cascade,
  foreign key (academia_id, plano_id)
    references public.planos (academia_id, id)
);
create index matriculas_aluno_idx on public.matriculas (academia_id, aluno_id);

create table public.matricula_turmas (
  academia_id  uuid not null,
  matricula_id uuid not null,
  turma_id     uuid not null,
  primary key (matricula_id, turma_id),
  foreign key (academia_id, matricula_id)
    references public.matriculas (academia_id, id) on delete cascade,
  foreign key (academia_id, turma_id)
    references public.turmas (academia_id, id) on delete cascade
);
create index matricula_turmas_turma_idx on public.matricula_turmas (academia_id, turma_id);


-- =====================================================================
-- 4. FREQUÊNCIA, GRADUAÇÃO E FINANCEIRO
-- =====================================================================

create table public.presencas (
  id             uuid primary key default gen_random_uuid(),
  academia_id    uuid not null,
  aluno_id       uuid not null,
  turma_id       uuid not null,
  data           date not null,
  checkin_em     timestamptz not null default now(),
  origem         text not null default 'recepcao'
                 check (origem in ('qrcode', 'recepcao', 'professor')),
  registrado_por uuid default auth.uid() references auth.users (id) on delete set null,
  unique (aluno_id, turma_id, data),
  foreign key (academia_id, aluno_id)
    references public.alunos (academia_id, id) on delete cascade,
  foreign key (academia_id, turma_id)
    references public.turmas (academia_id, id) on delete cascade
);
create index presencas_academia_data_idx on public.presencas (academia_id, data);
create index presencas_aluno_data_idx on public.presencas (aluno_id, data);

-- Histórico de graduações. A graduação atual é a mais recente
-- por (aluno, modalidade) — ver vw_graduacao_atual.
create table public.graduacoes (
  id           uuid primary key default gen_random_uuid(),
  academia_id  uuid not null,
  aluno_id     uuid not null,
  faixa_id     uuid not null,
  grau         smallint not null default 0 check (grau >= 0),
  data         date not null default current_date,
  professor_id uuid,
  observacao   text,
  created_at   timestamptz not null default now(),
  foreign key (academia_id, aluno_id)
    references public.alunos (academia_id, id) on delete cascade,
  foreign key (academia_id, faixa_id)
    references public.faixas (academia_id, id),
  foreign key (academia_id, professor_id)
    references public.professores (academia_id, id) on delete set null (professor_id)
);
create index graduacoes_academia_idx on public.graduacoes (academia_id);
create index graduacoes_aluno_idx on public.graduacoes (aluno_id, data desc);

create table public.cobrancas (
  id              uuid primary key default gen_random_uuid(),
  academia_id     uuid not null,
  aluno_id        uuid not null,
  matricula_id    uuid,
  descricao       text,
  valor           numeric(10, 2) not null check (valor > 0),
  vencimento      date not null,
  status          text not null default 'pendente'
                  check (status in ('pendente', 'paga', 'cancelada', 'estornada')),
  pago_em         timestamptz,
  forma_pagamento text check (forma_pagamento in ('pix', 'boleto', 'cartao', 'dinheiro', 'outro')),
  gateway         text,   -- 'asaas', 'efi', 'mercadopago'...
  gateway_id      text,   -- id no gateway: garante idempotência do webhook
  link_pagamento  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status <> 'paga' or pago_em is not null),
  unique (gateway, gateway_id),
  foreign key (academia_id, aluno_id)
    references public.alunos (academia_id, id) on delete cascade,
  foreign key (academia_id, matricula_id)
    references public.matriculas (academia_id, id) on delete set null (matricula_id)
);
create index cobrancas_academia_status_idx on public.cobrancas (academia_id, status, vencimento);
create index cobrancas_aluno_idx on public.cobrancas (aluno_id);


-- updated_at
create trigger academias_updated_at  before update on public.academias  for each row execute function public.set_updated_at();
create trigger alunos_updated_at     before update on public.alunos     for each row execute function public.set_updated_at();
create trigger matriculas_updated_at before update on public.matriculas for each row execute function public.set_updated_at();
create trigger cobrancas_updated_at  before update on public.cobrancas  for each row execute function public.set_updated_at();


-- =====================================================================
-- 5. FUNÇÕES DE PERMISSÃO (usadas pelas políticas RLS)
--    SECURITY DEFINER para não cair em recursão de RLS.
-- =====================================================================

-- O usuário logado é membro ativo da academia (com um dos papéis, se informado)?
create or replace function public.tem_papel(p_academia_id uuid, p_papeis text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membros_academia m
    where m.academia_id = p_academia_id
      and m.user_id = auth.uid()
      and m.ativo
      and (p_papeis is null or m.papel = any (p_papeis))
  );
$$;

-- Assinatura do SaaS em dia (ativa, ou trial ainda válido)?
create or replace function public.academia_ativa(p_academia_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academias a
    where a.id = p_academia_id
      and (a.status = 'ativa' or (a.status = 'trial' and a.trial_ate >= current_date))
  );
$$;

-- Pode ESCREVER: tem o papel E a academia está com a assinatura em dia.
-- Academia suspensa continua lendo os dados, mas não altera nada.
create or replace function public.pode_gerir(p_academia_id uuid, p_papeis text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tem_papel(p_academia_id, p_papeis)
     and public.academia_ativa(p_academia_id);
$$;

-- O aluno informado está ligado ao usuário logado (ele mesmo ou responsável)?
create or replace function public.sou_o_aluno(p_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.alunos a
    where a.id = p_aluno_id and a.user_id = auth.uid()
  );
$$;


-- =====================================================================
-- 6. RLS
--    Grupos de papéis usados abaixo:
--      gestão     = dono, admin
--      secretaria = dono, admin, recepcao
--      ensino     = dono, admin, professor
--      equipe     = dono, admin, professor, recepcao
-- =====================================================================

-- academias ------------------------------------------------------------
alter table public.academias enable row level security;

create policy academias_select on public.academias
  for select to authenticated
  using (public.tem_papel(id));

create policy academias_update on public.academias
  for update to authenticated
  using (public.tem_papel(id, array['dono', 'admin']))
  with check (public.tem_papel(id, array['dono', 'admin']));

-- Criar academia só via criar_academia(). Slug, plano e status só via service_role.
revoke insert, update, delete on public.academias from anon, authenticated;
grant update (nome, cnpj, telefone, logo_url, fuso, matricula_online_aberta,
              dias_tolerancia, configuracoes)
  on public.academias to authenticated;

-- membros_academia -----------------------------------------------------
-- Admin gerencia a equipe, mas só o dono cria/altera/remove outro dono.
alter table public.membros_academia enable row level security;

create policy membros_select on public.membros_academia
  for select to authenticated
  using (user_id = (select auth.uid())
         or public.tem_papel(academia_id, array['dono', 'admin']));

create policy membros_insert on public.membros_academia
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin'])
              and (papel <> 'dono' or public.tem_papel(academia_id, array['dono'])));

create policy membros_update on public.membros_academia
  for update to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin'])
         and (papel <> 'dono' or public.tem_papel(academia_id, array['dono'])))
  with check (public.pode_gerir(academia_id, array['dono', 'admin'])
              and (papel <> 'dono' or public.tem_papel(academia_id, array['dono'])));

create policy membros_delete on public.membros_academia
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin'])
         and (papel <> 'dono' or public.tem_papel(academia_id, array['dono'])));

-- Catálogo: qualquer membro (inclusive aluno) lê; só gestão escreve -----
do $$
declare
  t text;
begin
  foreach t in array array['modalidades', 'faixas', 'professores', 'turmas', 'turma_horarios', 'planos']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.tem_papel(academia_id))',
      t || '_select', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.pode_gerir(academia_id, array[''dono'', ''admin'']))',
      t || '_insert', t);

    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.pode_gerir(academia_id, array[''dono'', ''admin'']))
         with check (public.pode_gerir(academia_id, array[''dono'', ''admin'']))',
      t || '_update', t);

    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.pode_gerir(academia_id, array[''dono'', ''admin'']))',
      t || '_delete', t);
  end loop;
end
$$;

-- alunos ---------------------------------------------------------------
alter table public.alunos enable row level security;

create policy alunos_select on public.alunos
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin', 'professor', 'recepcao'])
         or user_id = (select auth.uid()));

create policy alunos_insert on public.alunos
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy alunos_update on public.alunos
  for update to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']))
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy alunos_delete on public.alunos
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin']));

-- matriculas -----------------------------------------------------------
alter table public.matriculas enable row level security;

create policy matriculas_select on public.matriculas
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin', 'professor', 'recepcao'])
         or public.sou_o_aluno(aluno_id));

create policy matriculas_insert on public.matriculas
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy matriculas_update on public.matriculas
  for update to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']))
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy matriculas_delete on public.matriculas
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin']));

-- matricula_turmas -----------------------------------------------------
alter table public.matricula_turmas enable row level security;

create policy matricula_turmas_select on public.matricula_turmas
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin', 'professor', 'recepcao'])
         or exists (select 1 from public.matriculas m
                    where m.id = matricula_id and public.sou_o_aluno(m.aluno_id)));

create policy matricula_turmas_insert on public.matricula_turmas
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy matricula_turmas_delete on public.matricula_turmas
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

-- presencas ------------------------------------------------------------
-- Aluno não insere direto: usa fazer_checkin().
alter table public.presencas enable row level security;

create policy presencas_select on public.presencas
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin', 'professor', 'recepcao'])
         or public.sou_o_aluno(aluno_id));

create policy presencas_insert on public.presencas
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'professor', 'recepcao']));

create policy presencas_update on public.presencas
  for update to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'professor', 'recepcao']))
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'professor', 'recepcao']));

create policy presencas_delete on public.presencas
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'professor', 'recepcao']));

-- graduacoes -----------------------------------------------------------
alter table public.graduacoes enable row level security;

create policy graduacoes_select on public.graduacoes
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin', 'professor', 'recepcao'])
         or public.sou_o_aluno(aluno_id));

create policy graduacoes_insert on public.graduacoes
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'professor']));

create policy graduacoes_update on public.graduacoes
  for update to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'professor']))
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'professor']));

create policy graduacoes_delete on public.graduacoes
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin']));

-- cobrancas ------------------------------------------------------------
-- Professor não vê financeiro. Webhook do gateway usa service_role.
alter table public.cobrancas enable row level security;

create policy cobrancas_select on public.cobrancas
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin', 'recepcao'])
         or public.sou_o_aluno(aluno_id));

create policy cobrancas_insert on public.cobrancas
  for insert to authenticated
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy cobrancas_update on public.cobrancas
  for update to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']))
  with check (public.pode_gerir(academia_id, array['dono', 'admin', 'recepcao']));

create policy cobrancas_delete on public.cobrancas
  for delete to authenticated
  using (public.pode_gerir(academia_id, array['dono', 'admin']));


-- =====================================================================
-- 7. VIEWS (security_invoker = respeitam o RLS de quem consulta)
-- =====================================================================

create view public.vw_graduacao_atual
with (security_invoker = true) as
select distinct on (g.aluno_id, f.modalidade_id)
  g.academia_id,
  g.aluno_id,
  f.modalidade_id,
  g.faixa_id,
  f.nome  as faixa,
  f.cor,
  f.ordem,
  g.grau,
  g.data  as graduado_em
from public.graduacoes g
join public.faixas f on f.id = g.faixa_id
order by g.aluno_id, f.modalidade_id, g.data desc, f.ordem desc, g.grau desc;

-- Quem já cumpriu a carência para o próximo grau/faixa
create view public.vw_progresso_graduacao
with (security_invoker = true) as
select
  ga.academia_id,
  ga.aluno_id,
  a.nome as aluno,
  ga.modalidade_id,
  ga.faixa,
  ga.grau,
  ga.graduado_em,
  case when ga.grau < f.max_graus then 'grau ' || (ga.grau + 1) else 'próxima faixa' end as proximo_passo,
  x.aulas_desde,
  f.min_aulas,
  x.meses_desde,
  f.min_meses,
  (x.aulas_desde >= f.min_aulas and x.meses_desde >= f.min_meses) as apto
from public.vw_graduacao_atual ga
join public.faixas f on f.id = ga.faixa_id
join public.alunos a on a.id = ga.aluno_id
cross join lateral (
  select
    (select count(*)
       from public.presencas p
       join public.turmas t on t.id = p.turma_id
      where p.aluno_id = ga.aluno_id
        and t.modalidade_id = ga.modalidade_id
        and p.data > ga.graduado_em)::int as aulas_desde,
    (extract(year from age(current_date, ga.graduado_em)) * 12
      + extract(month from age(current_date, ga.graduado_em)))::int as meses_desde
) x
where a.status = 'ativo';

create view public.vw_inadimplentes
with (security_invoker = true) as
select
  c.academia_id,
  c.aluno_id,
  a.nome,
  a.telefone,
  count(*)          as cobrancas_atrasadas,
  sum(c.valor)      as total_atrasado,
  min(c.vencimento) as vencimento_mais_antigo
from public.cobrancas c
join public.alunos a on a.id = c.aluno_id
where c.status = 'pendente'
  and c.vencimento < current_date
group by c.academia_id, c.aluno_id, a.nome, a.telefone;

revoke all on public.vw_graduacao_atual, public.vw_progresso_graduacao, public.vw_inadimplentes from anon;


-- =====================================================================
-- 8. RPCs (fluxos que não podem ser um INSERT direto)
-- =====================================================================

-- Onboarding do SaaS: cria a academia em trial e torna o usuário dono.
create or replace function public.criar_academia(p_nome text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Faça login para criar uma academia';
  end if;

  insert into public.academias (nome, slug)
  values (trim(p_nome), lower(trim(p_slug)))
  returning id into v_id;

  insert into public.membros_academia (academia_id, user_id, papel)
  values (v_id, auth.uid(), 'dono');

  return v_id;
exception
  when unique_violation then
    raise exception 'Esse endereço (slug) já está em uso';
end
$$;

-- Check-in do aluno pelo app (QR code da turma).
-- p_aluno_id só é necessário quando o login é de um responsável com mais de um aluno na turma.
create or replace function public.fazer_checkin(p_turma_id uuid, p_aluno_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turma     public.turmas;
  v_acad      public.academias;
  v_hoje      date;
  v_alunos    uuid[];
  v_aluno_id  uuid;
  v_id        uuid;
begin
  select * into v_turma from public.turmas where id = p_turma_id and ativa;
  if not found then
    raise exception 'Turma não encontrada';
  end if;

  if not public.academia_ativa(v_turma.academia_id) then
    raise exception 'Academia com acesso suspenso';
  end if;

  select * into v_acad from public.academias where id = v_turma.academia_id;
  v_hoje := (now() at time zone v_acad.fuso)::date;

  -- alunos deste login com matrícula ativa nesta turma
  select array_agg(a.id) into v_alunos
  from public.alunos a
  join public.matriculas m on m.aluno_id = a.id
  join public.matricula_turmas mt on mt.matricula_id = m.id
  where a.academia_id = v_turma.academia_id
    and a.user_id = auth.uid()
    and a.status = 'ativo'
    and m.status = 'ativa'
    and (m.data_fim is null or m.data_fim >= v_hoje)
    and mt.turma_id = p_turma_id
    and (p_aluno_id is null or a.id = p_aluno_id);

  if v_alunos is null then
    raise exception 'Nenhuma matrícula ativa nesta turma para este login';
  elsif cardinality(v_alunos) > 1 then
    raise exception 'Mais de um aluno neste login: informe qual (p_aluno_id)';
  end if;
  v_aluno_id := v_alunos[1];

  if exists (
    select 1 from public.cobrancas c
    where c.aluno_id = v_aluno_id
      and c.status = 'pendente'
      and c.vencimento < v_hoje - v_acad.dias_tolerancia
  ) then
    raise exception 'Check-in bloqueado: mensalidade em atraso. Procure a recepção.';
  end if;

  insert into public.presencas (academia_id, aluno_id, turma_id, data, origem, registrado_por)
  values (v_turma.academia_id, v_aluno_id, p_turma_id, v_hoje, 'qrcode', auth.uid())
  on conflict (aluno_id, turma_id, data) do nothing
  returning id into v_id;

  if v_id is null then  -- já tinha check-in hoje: devolve o existente
    select id into v_id from public.presencas
    where aluno_id = v_aluno_id and turma_id = p_turma_id and data = v_hoje;
  end if;

  return v_id;
end
$$;

-- Dados públicos da academia para a página de matrícula online.
create or replace function public.academia_publica(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'nome', a.nome,
    'logo_url', a.logo_url,
    'matricula_online_aberta', a.matricula_online_aberta and public.academia_ativa(a.id),
    'modalidades', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome) order by m.nome)
      from public.modalidades m
      where m.academia_id = a.id and m.ativa), '[]'::jsonb),
    'turmas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'nome', t.nome,
               'modalidade_id', t.modalidade_id,
               'publico', t.publico,
               'horarios', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'dia_semana', h.dia_semana,
                          'inicio', h.hora_inicio,
                          'fim', h.hora_fim) order by h.dia_semana, h.hora_inicio)
                 from public.turma_horarios h
                 where h.turma_id = t.id), '[]'::jsonb)
             ) order by t.nome)
      from public.turmas t
      where t.academia_id = a.id and t.ativa), '[]'::jsonb),
    'planos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'nome', p.nome,
               'valor', p.valor,
               'periodicidade', p.periodicidade) order by p.valor)
      from public.planos p
      where p.academia_id = a.id and p.ativo), '[]'::jsonb)
  )
  from public.academias a
  where a.slug = lower(trim(p_slug));
$$;

-- Matrícula online (página pública). Cria aluno 'pendente' + matrícula 'pendente';
-- a recepção aprova no painel. TODO: mover para trás de uma Edge Function com captcha.
create or replace function public.matricula_online(p_slug text, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acad         public.academias;
  v_nasc         date := nullif(p_dados ->> 'data_nascimento', '')::date;
  v_plano_id     uuid := nullif(p_dados ->> 'plano_id', '')::uuid;
  v_aluno_id     uuid;
  v_matricula_id uuid;
begin
  select * into v_acad from public.academias where slug = lower(trim(p_slug));
  if not found or not v_acad.matricula_online_aberta or not public.academia_ativa(v_acad.id) then
    raise exception 'Matrícula online indisponível. Procure a direção da escola.';
  end if;

  if coalesce(trim(p_dados ->> 'nome'), '') = '' then
    raise exception 'Informe o nome completo';
  end if;

  if coalesce((p_dados ->> 'aceite_termo')::boolean, false) is not true then
    raise exception 'É preciso aceitar o termo de responsabilidade';
  end if;

  if v_nasc is not null
     and v_nasc > current_date - interval '18 years'
     and (coalesce(trim(p_dados ->> 'responsavel_nome'), '') = ''
          or coalesce(p_dados ->> 'responsavel_cpf', '') = '') then
    raise exception 'Menores de idade precisam de responsável (nome e CPF)';
  end if;

  if v_plano_id is not null and not exists (
    select 1 from public.planos
    where id = v_plano_id and academia_id = v_acad.id and ativo
  ) then
    raise exception 'Plano inválido';
  end if;

  insert into public.alunos (
    academia_id, nome, cpf, data_nascimento, telefone, email,
    responsavel_nome, responsavel_cpf, responsavel_telefone,
    contato_emergencia, observacoes_medicas, status
  ) values (
    v_acad.id,
    trim(p_dados ->> 'nome'),
    nullif(regexp_replace(coalesce(p_dados ->> 'cpf', ''), '\D', '', 'g'), ''),
    v_nasc,
    nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
    lower(nullif(trim(p_dados ->> 'email'), '')),
    nullif(trim(p_dados ->> 'responsavel_nome'), ''),
    nullif(regexp_replace(coalesce(p_dados ->> 'responsavel_cpf', ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_dados ->> 'responsavel_telefone', ''), '\D', '', 'g'), ''),
    nullif(trim(p_dados ->> 'contato_emergencia'), ''),
    nullif(trim(p_dados ->> 'observacoes_medicas'), ''),
    'pendente'
  )
  returning id into v_aluno_id;

  insert into public.matriculas (academia_id, aluno_id, plano_id, status, origem, termo_aceito_em)
  values (v_acad.id, v_aluno_id, v_plano_id, 'pendente', 'online', now())
  returning id into v_matricula_id;

  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  select v_acad.id, v_matricula_id, t.id
  from public.turmas t
  where t.academia_id = v_acad.id
    and t.ativa
    and t.id::text in (
      select jsonb_array_elements_text(coalesce(p_dados -> 'turma_ids', '[]'::jsonb))
    );

  return v_matricula_id;
exception
  when unique_violation then
    raise exception 'Já existe um cadastro com esse CPF nesta academia. Procure a recepção.';
  when check_violation then
    raise exception 'Dados inválidos: confira CPF (11 dígitos) e nome';
end
$$;

-- Portal do aluno: liga o login (e-mail confirmado) aos cadastros de aluno
-- ATIVOS com o mesmo e-mail e dá o papel 'aluno' nessas academias.
create or replace function public.vincular_meu_cadastro_aluno()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_qtd   integer;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception 'Confirme seu e-mail antes de acessar o portal do aluno';
  end if;

  update public.alunos a
     set user_id = auth.uid()
   where lower(a.email) = v_email
     and a.user_id is null
     and a.status = 'ativo';
  get diagnostics v_qtd = row_count;

  insert into public.membros_academia (academia_id, user_id, papel)
  select distinct a.academia_id, auth.uid(), 'aluno'
  from public.alunos a
  where a.user_id = auth.uid()
  on conflict (academia_id, user_id) do nothing;

  return v_qtd;
end
$$;

-- Permissões das RPCs
revoke execute on function
  public.criar_academia(text, text),
  public.fazer_checkin(uuid, uuid),
  public.vincular_meu_cadastro_aluno(),
  public.academia_publica(text),
  public.matricula_online(text, jsonb)
from public, anon;

grant execute on function
  public.criar_academia(text, text),
  public.fazer_checkin(uuid, uuid),
  public.vincular_meu_cadastro_aluno()
to authenticated;

grant execute on function
  public.academia_publica(text),
  public.matricula_online(text, jsonb)
to anon, authenticated;
