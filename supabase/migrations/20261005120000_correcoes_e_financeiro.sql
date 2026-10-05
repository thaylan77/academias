-- =====================================================================
-- Honor Team SaaS — correções do schema inicial + financeiro (gateway)
-- Spec: docs/specs/financeiro-gateway-webhook.md
--
--   1. hoje_academia(): data de negócio no fuso da academia
--   2. Aluno não se apaga: anonimizar_aluno() (LGPD)
--   3. Contas de gateway, clientes e eventos de webhook
--   4. cobrancas: competência, baixa manual, emissão, permissões
--   5. Funções do financeiro
--
-- Lembrete: no Supabase, função nova em public nasce com execute para
-- anon e authenticated. Por isso todo revoke abaixo cita os dois.
-- =====================================================================


-- =====================================================================
-- 1. DATA NO FUSO DA ACADEMIA
-- =====================================================================

create or replace function public.hoje_academia(p_academia_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone a.fuso)::date
  from public.academias a
  where a.id = p_academia_id;
$$;

revoke execute on function public.hoje_academia(uuid) from public, anon;
grant execute on function public.hoje_academia(uuid) to authenticated, service_role;

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
      and (a.status = 'ativa'
           or (a.status = 'trial' and a.trial_ate >= public.hoje_academia(a.id)))
  );
$$;

create or replace view public.vw_progresso_graduacao
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
    (extract(year from age(public.hoje_academia(ga.academia_id), ga.graduado_em)) * 12
      + extract(month from age(public.hoje_academia(ga.academia_id), ga.graduado_em)))::int as meses_desde
) x
where a.status = 'ativo';

create or replace view public.vw_inadimplentes
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
  and c.vencimento < public.hoje_academia(c.academia_id)
group by c.academia_id, c.aluno_id, a.nome, a.telefone;

-- Igual à versão inicial, trocando current_date pela data da academia
-- (maioridade e data_inicio da matrícula).
create or replace function public.matricula_online(p_slug text, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acad         public.academias;
  v_hoje         date;
  v_nasc         date := nullif(p_dados ->> 'data_nascimento', '')::date;
  v_plano_id     uuid := nullif(p_dados ->> 'plano_id', '')::uuid;
  v_aluno_id     uuid;
  v_matricula_id uuid;
begin
  select * into v_acad from public.academias where slug = lower(trim(p_slug));
  if not found or not v_acad.matricula_online_aberta or not public.academia_ativa(v_acad.id) then
    raise exception 'Matrícula online indisponível. Procure a direção da escola.';
  end if;
  v_hoje := public.hoje_academia(v_acad.id);

  if coalesce(trim(p_dados ->> 'nome'), '') = '' then
    raise exception 'Informe o nome completo';
  end if;

  if coalesce((p_dados ->> 'aceite_termo')::boolean, false) is not true then
    raise exception 'É preciso aceitar o termo de responsabilidade';
  end if;

  if v_nasc is not null
     and v_nasc > v_hoje - interval '18 years'
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

  insert into public.matriculas (academia_id, aluno_id, plano_id, status, origem, data_inicio, termo_aceito_em)
  values (v_acad.id, v_aluno_id, v_plano_id, 'pendente', 'online', v_hoje, now())
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


-- =====================================================================
-- 2. ALUNO NÃO SE APAGA (LGPD: anonimizar_aluno, no fim do arquivo)
-- =====================================================================

alter table public.alunos add column anonimizado_em timestamptz;

drop policy alunos_delete on public.alunos;
revoke delete on public.alunos from anon, authenticated;

create or replace function public.alunos_bloqueia_anonimizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonimizado_em is not null then
    raise exception 'Cadastro anonimizado não pode ser alterado';
  end if;
  return new;
end
$$;

create trigger alunos_bloqueia_anonimizado
  before update on public.alunos
  for each row execute function public.alunos_bloqueia_anonimizado();


-- =====================================================================
-- 3. GATEWAY: CONTAS, CLIENTES E EVENTOS
-- =====================================================================

alter table public.academias
  add column dias_antecedencia_cobranca smallint not null default 10
  check (dias_antecedencia_cobranca between 1 and 28);  -- gera a cobrança N dias antes do vencimento

grant update (dias_antecedencia_cobranca) on public.academias to authenticated;

-- Conta da própria academia no gateway. A chave de API fica no Vault.
-- Uma academia pode acumular contas (trocou de gateway ou de conta), mas
-- só uma fica ativa para emitir. As inativas continuam recebendo o
-- webhook das cobranças que emitiram.
create table public.gateway_contas (
  id                 uuid primary key default gen_random_uuid(),
  academia_id        uuid not null references public.academias (id) on delete cascade,
  gateway            text not null check (gateway in ('asaas', 'efi', 'mercadopago')),
  ambiente           text not null check (ambiente in ('sandbox', 'producao')),
  conta_externa_id   text not null,          -- id da conta no gateway: distingue reconexão de conta nova
  ativa              boolean not null default true,
  api_key_secret_id  uuid not null,          -- vault.secrets.id
  webhook_token_hash text not null unique,   -- SHA-256 (hex) do authToken; é por ele que o webhook acha a conta
  conectada_em       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (academia_id, id),
  unique (academia_id, gateway, ambiente, conta_externa_id)
);
create unique index gateway_contas_uma_ativa_idx
  on public.gateway_contas (academia_id) where ativa;

create trigger gateway_contas_updated_at before update on public.gateway_contas
  for each row execute function public.set_updated_at();

-- Cliente (pagador) do aluno em cada conta de gateway.
create table public.gateway_clientes (
  academia_id        uuid not null,
  gateway_conta_id   uuid not null,
  aluno_id           uuid not null,
  gateway_cliente_id text not null,
  cpf_pagador        text not null check (cpf_pagador ~ '^\d{11}$'),
  created_at         timestamptz not null default now(),
  primary key (gateway_conta_id, aluno_id),
  foreign key (academia_id, gateway_conta_id)
    references public.gateway_contas (academia_id, id) on delete cascade,
  foreign key (academia_id, aluno_id)
    references public.alunos (academia_id, id) on delete cascade
);
create index gateway_clientes_aluno_idx on public.gateway_clientes (academia_id, aluno_id);


-- =====================================================================
-- 4. COBRANÇAS
-- =====================================================================

-- gateway (text) sai; a cobrança passa a apontar para a conta que a emitiu.
alter table public.cobrancas drop column gateway;   -- leva junto o unique (gateway, gateway_id)

alter table public.cobrancas
  add column gateway_conta_id    uuid,
  add column competencia         date check (extract(day from competencia) = 1),  -- dia 1 do mês; nula = avulsa
  add column valor_pago          numeric(10, 2) check (valor_pago > 0),
  add column baixa_por           uuid references auth.users (id) on delete set null,  -- só em baixa manual
  add column baixa_em            timestamptz,
  add column emissao_iniciada_em      timestamptz,   -- reserva da emissão no gateway
  add column emissao_gateway_conta_id uuid,          -- conta para a qual a emissão foi reservada
  add column emissao_recusa           text,          -- motivo da última recusa explícita do gateway
  add column divergencia              text           -- gateway e sistema discordam: revisar à mão
    check (divergencia in ('pagamento_duplicado', 'cancelada_no_gateway',
                           'estado_apos_estorno', 'estorno_parcial'));

-- Aluno com cobrança não pode ser apagado (era cascade): histórico financeiro fica.
alter table public.cobrancas
  drop constraint cobrancas_academia_id_aluno_id_fkey,
  add constraint cobrancas_academia_id_aluno_id_fkey
    foreign key (academia_id, aluno_id) references public.alunos (academia_id, id) on delete restrict,
  add constraint cobrancas_academia_id_id_key unique (academia_id, id),
  add constraint cobrancas_matricula_competencia_key unique (matricula_id, competencia),
  add constraint cobrancas_conta_gateway_id_key unique (gateway_conta_id, gateway_id),
  add constraint cobrancas_gateway_par_check
    check ((gateway_conta_id is null) = (gateway_id is null)),
  add constraint cobrancas_reserva_par_check
    check ((emissao_iniciada_em is null) = (emissao_gateway_conta_id is null)),
  add constraint cobrancas_academia_id_emissao_gateway_conta_id_fkey
    foreign key (academia_id, emissao_gateway_conta_id) references public.gateway_contas (academia_id, id),
  add constraint cobrancas_academia_id_gateway_conta_id_fkey
    foreign key (academia_id, gateway_conta_id) references public.gateway_contas (academia_id, id);

-- Caixa de entrada do webhook: idempotência e auditoria.
create table public.gateway_eventos (
  id               uuid primary key default gen_random_uuid(),
  academia_id      uuid not null,   -- vem da conta achada pelo token, nunca do corpo
  gateway_conta_id uuid not null,
  evento_id        text not null,
  tipo             text,
  cobranca_id      uuid,
  status           text not null default 'recebido'
                   check (status in ('recebido', 'processado', 'ignorado', 'divergente', 'erro')),
  payload          jsonb not null default '{}'::jsonb,   -- tem nome e CPF do pagador: reter 90 dias
  erro             text,
  recebido_em      timestamptz not null default now(),
  processado_em    timestamptz,
  unique (gateway_conta_id, evento_id),
  foreign key (academia_id, gateway_conta_id)
    references public.gateway_contas (academia_id, id) on delete cascade,
  foreign key (academia_id, cobranca_id)
    references public.cobrancas (academia_id, id) on delete set null (cobranca_id)
);
create index gateway_eventos_cobranca_idx on public.gateway_eventos (academia_id, cobranca_id);
create index gateway_eventos_recebido_idx on public.gateway_eventos (recebido_em);

-- Valor e vencimento travam quando a cobrança foi emitida (ou está sendo)
-- ou saiu de pendente.
create or replace function public.cobrancas_protege_emitida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.valor is distinct from old.valor or new.vencimento is distinct from old.vencimento)
     and (old.status <> 'pendente'
          or old.gateway_id is not null
          or old.emissao_iniciada_em is not null) then
    raise exception 'Cobrança emitida ou finalizada: valor e vencimento não podem mudar. Cancele e crie outra.';
  end if;
  return new;
end
$$;

create trigger cobrancas_protege_emitida
  before update of valor, vencimento on public.cobrancas
  for each row execute function public.cobrancas_protege_emitida();


-- =====================================================================
-- 5. RLS E PERMISSÕES
-- =====================================================================

-- academias: a política inicial usava tem_papel, então academia suspensa ou
-- com trial vencido conseguia alterar os próprios dados. Escrita = pode_gerir.
drop policy academias_update on public.academias;

create policy academias_update on public.academias
  for update to authenticated
  using (public.pode_gerir(id, array['dono', 'admin']))
  with check (public.pode_gerir(id, array['dono', 'admin']));

-- cobrancas: a equipe cria e ajusta descrição/valor/vencimento. Status,
-- pagamento, baixa e campos do gateway só mudam pelas funções abaixo.
-- Não existe delete: cobrança se cancela.
drop policy cobrancas_delete on public.cobrancas;
revoke insert, update, delete on public.cobrancas from anon, authenticated;
grant insert (academia_id, aluno_id, matricula_id, competencia, descricao, valor, vencimento)
  on public.cobrancas to authenticated;
grant update (descricao, valor, vencimento) on public.cobrancas to authenticated;

-- gateway_contas: gestão vê que existe conta conectada, nunca os segredos.
alter table public.gateway_contas enable row level security;

create policy gateway_contas_select on public.gateway_contas
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin']));

revoke all on public.gateway_contas from anon, authenticated;
grant select (id, academia_id, gateway, ambiente, ativa, conectada_em)
  on public.gateway_contas to authenticated;

-- gateway_clientes e gateway_eventos: só service_role (sem políticas).
alter table public.gateway_clientes enable row level security;
alter table public.gateway_eventos  enable row level security;
revoke all on public.gateway_clientes, public.gateway_eventos from anon, authenticated;


-- =====================================================================
-- 6. FUNÇÕES DO FINANCEIRO
--    *_interna: só service_role (Edge Functions). Recebem o user_id de
--    quem pediu e reconferem o papel aqui, sem confiar na Edge Function.
-- =====================================================================

-- pode_gerir() para um user_id explícito (service_role não tem auth.uid()).
create or replace function public.membro_pode_gerir(p_user_id uuid, p_academia_id uuid, p_papeis text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
       select 1
       from public.membros_academia m
       where m.academia_id = p_academia_id
         and m.user_id = p_user_id
         and m.ativo
         and m.papel = any (p_papeis)
     )
     and public.academia_ativa(p_academia_id);
$$;

-- Baixa manual ---------------------------------------------------------
-- Aceita também cobrança cancelada que foi emitida: a Edge Function cancela
-- no gateway antes de chamar, e o webhook desse cancelamento pode chegar primeiro.
create or replace function public.baixar_cobranca_interna(
  p_cobranca_id uuid,
  p_user_id     uuid,
  p_forma       text default 'dinheiro',
  p_pago_em     timestamptz default now(),
  p_valor_pago  numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.membro_pode_gerir(p_user_id, v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para dar baixa';
  end if;

  if v_cob.status = 'paga' and v_cob.baixa_em is not null then
    return;  -- repetição da mesma baixa
  end if;

  if v_cob.status = 'paga' then
    raise exception 'Esta cobrança já foi paga pelo gateway';
  end if;

  if not (v_cob.status = 'pendente'
          or (v_cob.status = 'cancelada' and v_cob.gateway_id is not null)) then
    raise exception 'Só é possível dar baixa em cobrança pendente';
  end if;

  if p_forma is null or p_forma not in ('pix', 'boleto', 'cartao', 'dinheiro', 'outro') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if p_pago_em is null or p_pago_em > now() + interval '1 day' then
    raise exception 'Data de pagamento inválida';
  end if;

  if coalesce(p_valor_pago, v_cob.valor) <= 0 then
    raise exception 'Valor pago inválido';
  end if;

  update public.cobrancas
     set status          = 'paga',
         pago_em         = p_pago_em,
         valor_pago      = coalesce(p_valor_pago, v_cob.valor),
         forma_pagamento = p_forma,
         baixa_por       = p_user_id,
         baixa_em        = now()
   where id = p_cobranca_id;
end
$$;

-- Painel: baixa de cobrança que nunca foi para o gateway.
create or replace function public.baixar_cobranca_manual(
  p_cobranca_id uuid,
  p_forma       text default 'dinheiro',
  p_pago_em     timestamptz default now(),
  p_valor_pago  numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.pode_gerir(v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para dar baixa';
  end if;

  if v_cob.gateway_id is not null or v_cob.emissao_iniciada_em is not null then
    raise exception 'Cobrança emitida no gateway: a baixa precisa cancelar a cobrança lá primeiro';
  end if;

  if v_cob.status <> 'pendente' then
    raise exception 'Só é possível dar baixa em cobrança pendente';
  end if;

  perform public.baixar_cobranca_interna(p_cobranca_id, auth.uid(), p_forma, p_pago_em, p_valor_pago);
end
$$;

-- Cancelamento ---------------------------------------------------------
create or replace function public.cancelar_cobranca_interna(p_cobranca_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.membro_pode_gerir(p_user_id, v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para cancelar';
  end if;

  if v_cob.status = 'cancelada' then
    return;
  end if;

  if v_cob.status <> 'pendente' then
    raise exception 'Só é possível cancelar cobrança pendente';
  end if;

  update public.cobrancas set status = 'cancelada' where id = p_cobranca_id;
end
$$;

create or replace function public.cancelar_cobranca(p_cobranca_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.pode_gerir(v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para cancelar';
  end if;

  if v_cob.gateway_id is not null or v_cob.emissao_iniciada_em is not null then
    raise exception 'Cobrança emitida no gateway: o cancelamento precisa acontecer lá primeiro';
  end if;

  perform public.cancelar_cobranca_interna(p_cobranca_id, auth.uid());
end
$$;

-- Emissão --------------------------------------------------------------
-- Reserva a emissão para uma conta de gateway. Devolve {estado, gateway_conta_id}:
--   'reservada'    pode criar no gateway, na conta devolvida
--   'orfa'         havia reserva antiga sem gateway_id. Antes de reemitir,
--                  consultar a conta devolvida (a da reserva antiga) por
--                  externalReference = cobrancas.id. Achou: registrar_emissao_interna.
--                  Não achou: chamar de novo com p_orfa_conferida = true.
--   'em_andamento' outra chamada reservou há menos de 2 minutos
--   'emitida'      já tem gateway_id
create or replace function public.reservar_emissao_interna(
  p_cobranca_id      uuid,
  p_user_id          uuid,
  p_gateway_conta_id uuid,
  p_orfa_conferida   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.membro_pode_gerir(p_user_id, v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para emitir';
  end if;

  if v_cob.gateway_id is not null then
    return jsonb_build_object('estado', 'emitida', 'gateway_conta_id', v_cob.gateway_conta_id);
  end if;

  if v_cob.status <> 'pendente' then
    raise exception 'Só é possível emitir cobrança pendente';
  end if;

  if not exists (
    select 1 from public.gateway_contas
    where id = p_gateway_conta_id and academia_id = v_cob.academia_id and ativa
  ) then
    raise exception 'Conecte uma conta de gateway antes de emitir a cobrança';
  end if;

  if v_cob.emissao_iniciada_em is null or p_orfa_conferida then
    update public.cobrancas
       set emissao_iniciada_em = now(),
           emissao_gateway_conta_id = p_gateway_conta_id,
           emissao_recusa = null
     where id = p_cobranca_id;
    return jsonb_build_object('estado', 'reservada', 'gateway_conta_id', p_gateway_conta_id);
  end if;

  if v_cob.emissao_iniciada_em > now() - interval '2 minutes' then
    return jsonb_build_object('estado', 'em_andamento', 'gateway_conta_id', v_cob.emissao_gateway_conta_id);
  end if;

  -- órfã: renova o prazo e mantém a conta da reserva antiga
  update public.cobrancas set emissao_iniciada_em = now() where id = p_cobranca_id;
  return jsonb_build_object('estado', 'orfa', 'gateway_conta_id', v_cob.emissao_gateway_conta_id);
end
$$;

create or replace function public.registrar_emissao_interna(
  p_cobranca_id      uuid,
  p_gateway_conta_id uuid,
  p_gateway_id       text,
  p_link_pagamento   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found then
    raise exception 'Cobrança não encontrada';
  end if;

  if v_cob.gateway_id is not null then
    if v_cob.gateway_id <> p_gateway_id or v_cob.gateway_conta_id <> p_gateway_conta_id then
      raise exception 'Cobrança já emitida com outro identificador no gateway';
    end if;
    return;  -- repetição
  end if;

  if v_cob.emissao_gateway_conta_id is distinct from p_gateway_conta_id then
    raise exception 'Cobrança sem reserva de emissão para esta conta de gateway';
  end if;

  update public.cobrancas
     set gateway_conta_id = p_gateway_conta_id,
         gateway_id       = p_gateway_id,
         link_pagamento   = p_link_pagamento
   where id = p_cobranca_id;
end
$$;

-- Solta a reserva. SÓ quando o gateway recusou explicitamente a criação
-- (ex.: CPF inválido): p_recusa é o motivo, guardado para a secretaria.
-- Timeout e erro 5xx NÃO liberam: a reserva fica para reconciliar por
-- externalReference na próxima tentativa ou pelo webhook.
create or replace function public.liberar_emissao_interna(p_cobranca_id uuid, p_recusa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(p_recusa), '') = '' then
    raise exception 'Informe a recusa do gateway para liberar a reserva';
  end if;

  update public.cobrancas
     set emissao_iniciada_em = null,
         emissao_gateway_conta_id = null,
         emissao_recusa = left(trim(p_recusa), 300)
   where id = p_cobranca_id
     and gateway_id is null;
end
$$;

-- Webhook --------------------------------------------------------------
-- Aplica o estado reconsultado no gateway (p_estado já normalizado).
-- A academia vem da conta, que a Edge Function achou pelo token.
-- p_referencia = externalReference (cobrancas.id): adota emissão órfã, mas só
-- se a cobrança tiver reserva para esta mesma conta.
-- p_divergencia: código vindo do adaptador (ex.: 'estorno_parcial').
-- Devolve 'aplicado', 'sem_mudanca', 'ignorado' ou 'divergente'.
create or replace function public.aplicar_pagamento_gateway(
  p_gateway_conta_id uuid,
  p_evento_id        text,
  p_gateway_id       text,
  p_referencia       uuid,
  p_estado           text,
  p_pago_em          timestamptz default null,
  p_valor_pago       numeric default null,
  p_forma            text default null,
  p_divergencia      text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta public.gateway_contas;
  v_cob   public.cobrancas;
  v_novo  text;            -- novo status, se houver transição
  v_div   text := p_divergencia;
  v_res   text;
begin
  select * into v_conta from public.gateway_contas where id = p_gateway_conta_id;
  if not found then
    raise exception 'Conta de gateway não encontrada';
  end if;

  if p_estado is null or p_estado not in ('pendente', 'paga', 'cancelada', 'estornada') then
    raise exception 'Estado de pagamento desconhecido: %', p_estado;
  end if;

  if p_forma is not null and p_forma not in ('pix', 'boleto', 'cartao', 'dinheiro', 'outro') then
    raise exception 'Forma de pagamento desconhecida: %', p_forma;
  end if;

  if p_divergencia is not null and p_divergencia not in ('estorno_parcial') then
    raise exception 'Código de divergência desconhecido: %', p_divergencia;
  end if;

  select * into v_cob
  from public.cobrancas
  where academia_id = v_conta.academia_id
    and gateway_conta_id = v_conta.id
    and gateway_id = p_gateway_id
  for update;

  -- emissão que caiu antes de gravar o gateway_id: adota pela referência,
  -- desde que a reserva seja para a conta deste token
  if not found and p_referencia is not null then
    select * into v_cob
    from public.cobrancas
    where academia_id = v_conta.academia_id
      and id = p_referencia
      and gateway_id is null
      and emissao_gateway_conta_id = v_conta.id
    for update;

    if found then
      update public.cobrancas
         set gateway_conta_id = v_conta.id, gateway_id = p_gateway_id
       where id = v_cob.id;
    end if;
  end if;

  if v_cob.id is null then
    v_res := 'ignorado';   -- cobrança que a academia criou fora do sistema

  elsif v_cob.baixa_em is not null then
    -- baixa manual: a cobrança do gateway foi cancelada por nós
    if p_estado = 'paga' then
      v_div := 'pagamento_duplicado';
      v_res := 'divergente';
    else
      v_res := 'ignorado';
    end if;

  elsif v_cob.status = p_estado then
    v_res := 'sem_mudanca';

  elsif v_cob.status = 'estornada' then
    v_div := 'estado_apos_estorno';
    v_res := 'divergente';

  elsif v_cob.status = 'paga' and p_estado = 'cancelada' then
    v_div := 'cancelada_no_gateway';
    v_res := 'divergente';

  else
    -- pendente -> paga | cancelada | estornada
    -- paga -> pendente (recebimento desfeito) | estornada
    -- cancelada -> pendente (restaurada) | paga (pago depois do cancelamento) | estornada
    v_novo := p_estado;
    v_res  := 'aplicado';
  end if;

  if v_novo = 'paga' then
    update public.cobrancas
       set status          = 'paga',
           pago_em         = coalesce(p_pago_em, now()),
           valor_pago      = coalesce(p_valor_pago, valor),
           forma_pagamento = coalesce(p_forma, forma_pagamento)
     where id = v_cob.id;
  elsif v_novo = 'pendente' then
    update public.cobrancas
       set status = 'pendente', pago_em = null, valor_pago = null, forma_pagamento = null
     where id = v_cob.id;
  elsif v_novo is not null then   -- cancelada | estornada
    update public.cobrancas
       set status  = v_novo,
           pago_em = coalesce(pago_em, p_pago_em)
     where id = v_cob.id;
  end if;

  if v_div is not null and v_cob.id is not null then
    update public.cobrancas set divergencia = v_div where id = v_cob.id;
    v_res := 'divergente';
  end if;

  insert into public.gateway_eventos as e
    (academia_id, gateway_conta_id, evento_id, cobranca_id, status, processado_em)
  values (
    v_conta.academia_id, v_conta.id, p_evento_id, v_cob.id,
    case v_res when 'ignorado' then 'ignorado' when 'divergente' then 'divergente' else 'processado' end,
    now()
  )
  on conflict (gateway_conta_id, evento_id) do update
    set cobranca_id   = excluded.cobranca_id,
        status        = excluded.status,
        processado_em = excluded.processado_em,
        erro          = null;

  return v_res;
end
$$;

-- Conta do gateway -----------------------------------------------------
-- Mesma conta externa: troca chave e token (reconexão). Conta nova:
-- desativa a anterior e cria outra. A chave vai para o Vault.
create or replace function public.gateway_salvar_conta(
  p_academia_id        uuid,
  p_user_id            uuid,
  p_gateway            text,
  p_ambiente           text,
  p_conta_externa_id   text,
  p_api_key            text,
  p_webhook_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_secret_id uuid;
begin
  if not public.membro_pode_gerir(p_user_id, p_academia_id, array['dono', 'admin']) then
    raise exception 'Sem permissão para conectar o gateway desta academia';
  end if;

  if coalesce(p_api_key, '') = '' or coalesce(p_webhook_token_hash, '') = ''
     or coalesce(p_conta_externa_id, '') = '' then
    raise exception 'Dados da conta do gateway incompletos';
  end if;

  select id, api_key_secret_id into v_id, v_secret_id
  from public.gateway_contas
  where academia_id = p_academia_id
    and gateway = p_gateway
    and ambiente = p_ambiente
    and conta_externa_id = p_conta_externa_id
  for update;

  update public.gateway_contas
     set ativa = false
   where academia_id = p_academia_id
     and ativa
     and id is distinct from v_id;

  if v_id is not null then
    perform vault.update_secret(v_secret_id, p_api_key);
    update public.gateway_contas
       set ativa = true, webhook_token_hash = p_webhook_token_hash, conectada_em = now()
     where id = v_id;
  else
    v_id := gen_random_uuid();
    v_secret_id := vault.create_secret(p_api_key, 'gateway_conta_' || v_id::text);
    insert into public.gateway_contas
      (id, academia_id, gateway, ambiente, conta_externa_id, api_key_secret_id, webhook_token_hash)
    values
      (v_id, p_academia_id, p_gateway, p_ambiente, p_conta_externa_id, v_secret_id, p_webhook_token_hash);
  end if;

  return v_id;
end
$$;

create or replace function public.gateway_credencial(p_gateway_conta_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from public.gateway_contas c
  join vault.decrypted_secrets s on s.id = c.api_key_secret_id
  where c.id = p_gateway_conta_id;
$$;

-- Recorrência ----------------------------------------------------------
-- Uma cobrança por matrícula e competência. O intervalo vem do plano
-- (1, 3, 6 ou 12 meses), contado do mês de data_inicio.
--   Primeira: competência = mês de data_inicio; vence no maior entre
--             data_inicio e o dia do cadastro da matrícula (fuso da academia),
--             então matrícula retroativa no mesmo mês gera a primeira para hoje.
--   Demais:   vencimento = dia_vencimento no mês da competência; não gera
--             com vencimento anterior ao cadastro (aluno importado não nasce devendo).
-- Gera a partir de N dias antes do vencimento (academias.dias_antecedencia_cobranca)
-- e só para a competência corrente e a seguinte.
-- Competência cancelada não é regerada (o unique barra).
create or replace function public.gerar_cobrancas(
  p_academia_id  uuid default null,
  p_matricula_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd integer;
begin
  insert into public.cobrancas
    (academia_id, aluno_id, matricula_id, competencia, descricao, valor, vencimento)
  select
    m.academia_id, m.aluno_id, m.id, g.competencia,
    p.nome || ' — ' || to_char(g.competencia, 'MM/YYYY'),
    coalesce(m.valor, p.valor),
    x.vencimento
  from public.matriculas m
  join public.academias a on a.id = m.academia_id
  join public.planos p on p.academia_id = m.academia_id and p.id = m.plano_id
  join public.alunos al on al.academia_id = m.academia_id and al.id = m.aluno_id
  cross join lateral (
    select
      (now() at time zone a.fuso)::date as hoje,
      case p.periodicidade
        when 'mensal' then 1 when 'trimestral' then 3 when 'semestral' then 6 else 12
      end as intervalo,
      date_trunc('month', m.data_inicio::timestamp)::date as primeira,
      (m.created_at at time zone a.fuso)::date as cadastro
  ) b
  cross join lateral (
    select s::date as competencia
    from generate_series(
      date_trunc('month', b.hoje::timestamp),
      date_trunc('month', b.hoje::timestamp) + interval '1 month',
      interval '1 month') s
  ) g
  cross join lateral (
    select case when g.competencia = b.primeira
                then greatest(m.data_inicio, b.cadastro)
                else g.competencia + (m.dia_vencimento - 1)
           end as vencimento
  ) x
  where m.status = 'ativa'
    and al.status = 'ativo'
    and m.dia_vencimento is not null
    and coalesce(m.valor, p.valor) > 0
    and public.academia_ativa(a.id)
    and (p_academia_id is null or m.academia_id = p_academia_id)
    and (p_matricula_id is null or m.id = p_matricula_id)
    and g.competencia >= b.primeira
    and ((extract(year from g.competencia) - extract(year from b.primeira)) * 12
         + extract(month from g.competencia) - extract(month from b.primeira))::int % b.intervalo = 0
    and b.hoje >= x.vencimento - a.dias_antecedencia_cobranca
    and (g.competencia = b.primeira or x.vencimento >= b.cadastro)
    and (m.data_fim is null or x.vencimento <= m.data_fim)
  on conflict (matricula_id, competencia) do nothing;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end
$$;

-- Painel: gera na hora as cobranças de uma matrícula (ex.: logo após
-- ativar), sem esperar o job diário.
create or replace function public.gerar_cobrancas_matricula(p_matricula_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia_id uuid;
begin
  select academia_id into v_academia_id from public.matriculas where id = p_matricula_id;
  if not found
     or not public.pode_gerir(v_academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão';
  end if;

  return public.gerar_cobrancas(v_academia_id, p_matricula_id);
end
$$;

-- LGPD -----------------------------------------------------------------
-- Substitui o delete de aluno: apaga os dados pessoais e mantém presenças,
-- graduações e cobranças (histórico da academia, sem identificação).
-- Usa tem_papel, não pode_gerir: pedido de titular (LGPD) não depende de a
-- academia estar com a assinatura em dia. Única exceção à regra
-- "suspensa lê, mas não altera" (ver AGENTS.md).
create or replace function public.anonimizar_aluno(p_aluno_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aluno public.alunos;
begin
  select * into v_aluno from public.alunos where id = p_aluno_id for update;
  if not found
     or not public.tem_papel(v_aluno.academia_id, array['dono', 'admin']) then
    raise exception 'Aluno não encontrado ou sem permissão para anonimizar';
  end if;

  if v_aluno.anonimizado_em is not null then
    return;
  end if;

  if exists (
    select 1 from public.cobrancas
    where academia_id = v_aluno.academia_id and aluno_id = p_aluno_id and status = 'pendente'
  ) then
    raise exception 'Cancele ou dê baixa nas cobranças pendentes antes de anonimizar';
  end if;

  update public.matriculas
     set status = 'cancelada',
         data_fim = public.hoje_academia(v_aluno.academia_id)
   where academia_id = v_aluno.academia_id
     and aluno_id = p_aluno_id
     and status <> 'cancelada';

  delete from public.gateway_clientes
   where academia_id = v_aluno.academia_id and aluno_id = p_aluno_id;

  update public.gateway_eventos e
     set payload = '{}'::jsonb
    from public.cobrancas c
   where c.academia_id = v_aluno.academia_id
     and c.aluno_id = p_aluno_id
     and e.academia_id = c.academia_id
     and e.cobranca_id = c.id;

  update public.alunos
     set nome                 = 'Aluno anonimizado',
         cpf                  = null,
         data_nascimento      = null,
         telefone             = null,
         email                = null,
         foto_url             = null,
         responsavel_nome     = null,
         responsavel_cpf      = null,
         responsavel_telefone = null,
         contato_emergencia   = null,
         observacoes_medicas  = null,
         user_id              = null,
         status               = 'inativo',
         anonimizado_em       = now()
   where id = p_aluno_id;

  -- o login perde o papel de aluno se não tiver outro aluno na academia
  if v_aluno.user_id is not null then
    delete from public.membros_academia m
     where m.academia_id = v_aluno.academia_id
       and m.user_id = v_aluno.user_id
       and m.papel = 'aluno'
       and not exists (
         select 1 from public.alunos a
         where a.academia_id = v_aluno.academia_id and a.user_id = v_aluno.user_id
       );
  end if;
end
$$;


-- =====================================================================
-- 7. PERMISSÕES DAS FUNÇÕES
-- =====================================================================

revoke execute on function
  public.alunos_bloqueia_anonimizado(),
  public.cobrancas_protege_emitida(),
  public.membro_pode_gerir(uuid, uuid, text[]),
  public.baixar_cobranca_interna(uuid, uuid, text, timestamptz, numeric),
  public.baixar_cobranca_manual(uuid, text, timestamptz, numeric),
  public.cancelar_cobranca_interna(uuid, uuid),
  public.cancelar_cobranca(uuid),
  public.reservar_emissao_interna(uuid, uuid, uuid, boolean),
  public.registrar_emissao_interna(uuid, uuid, text, text),
  public.liberar_emissao_interna(uuid, text),
  public.aplicar_pagamento_gateway(uuid, text, text, uuid, text, timestamptz, numeric, text, text),
  public.gateway_salvar_conta(uuid, uuid, text, text, text, text, text),
  public.gateway_credencial(uuid),
  public.gerar_cobrancas(uuid, uuid),
  public.gerar_cobrancas_matricula(uuid),
  public.anonimizar_aluno(uuid)
from public, anon, authenticated;

grant execute on function
  public.baixar_cobranca_manual(uuid, text, timestamptz, numeric),
  public.cancelar_cobranca(uuid),
  public.gerar_cobrancas_matricula(uuid),
  public.anonimizar_aluno(uuid)
to authenticated;

grant execute on function
  public.membro_pode_gerir(uuid, uuid, text[]),
  public.baixar_cobranca_interna(uuid, uuid, text, timestamptz, numeric),
  public.cancelar_cobranca_interna(uuid, uuid),
  public.reservar_emissao_interna(uuid, uuid, uuid, boolean),
  public.registrar_emissao_interna(uuid, uuid, text, text),
  public.liberar_emissao_interna(uuid, text),
  public.aplicar_pagamento_gateway(uuid, text, text, uuid, text, timestamptz, numeric, text, text),
  public.gateway_salvar_conta(uuid, uuid, text, text, text, text, text),
  public.gateway_credencial(uuid),
  public.gerar_cobrancas(uuid, uuid)
to service_role;
