-- Convite de membros da equipe (spec: docs/specs/convite-membros.md).
--
-- 1. convites_equipe: um convite por e-mail e academia, com RLS só de leitura
--    para dono e admin. Toda escrita passa pelas funções abaixo.
-- 2. criar_convite_interna (só service_role, chamada pela Edge Function
--    convidar-membro), cancelar_convite, meus_convites, aceitar_convite,
--    recusar_convite e equipe_da_academia.
-- 3. Gatilho do último dono em membros_academia.
--
-- Ordem das travas nas funções: primeiro a linha da academia (for no key
-- update: exclui as outras funções de convite e as revogações, mas não
-- bloqueia a checagem de FK de quem grava um vínculo com a academia), depois
-- a do convite e a do membro. Assim criar, aceitar e o gatilho do último
-- dono se serializam por academia. Papel e assinatura são relidos depois da trava.
-- Nenhuma função trava a academia de outro tenant: antes da trava, uma
-- consulta sem trava confere se quem chama tem motivo para mexer nela.
--
-- "Equipe" é dono, admin, professor e recepção. Aluno e totem não são equipe
-- e não entram por convite.

-- =====================================================================
-- 1. TABELA
-- =====================================================================

create table public.convites_equipe (
  id                   uuid primary key default gen_random_uuid(),
  academia_id          uuid not null references public.academias (id) on delete cascade,
  email                text not null,
  papel                text not null
                       check (papel in ('dono', 'admin', 'professor', 'recepcao')),
  status               text not null default 'pendente'
                       check (status in ('pendente', 'aceito', 'cancelado', 'recusado')),
  convidado_por        uuid references auth.users (id) on delete set null,
  expira_em            timestamptz not null,
  -- C10. Tentativas de envio desta academia (com e-mail ou sem): a última e o
  -- horário de cada uma das últimas 24 horas. A academia lê, e os limites
  -- dela usam estas colunas.
  ultimo_envio_em      timestamptz,
  envios_recentes      timestamptz[] not null default '{}',
  -- Os envios reais ficam em convites_envios (sem cascata, no projeto todo).
  aceito_por           uuid references auth.users (id) on delete set null,
  aceito_em            timestamptz,
  encerrado_por        uuid references auth.users (id) on delete set null,
  encerrado_em         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (academia_id, id),
  constraint convites_equipe_email_check
    check (email = lower(btrim(email))
           and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint convites_equipe_aceito_check
    check ((status = 'aceito') = (aceito_em is not null)),
  constraint convites_equipe_encerrado_check
    check ((status in ('cancelado', 'recusado')) = (encerrado_em is not null))
);

-- Um pendente por e-mail e academia (C9). "Vencido" não é status: é
-- pendente com expira_em no passado.
create unique index convites_equipe_pendente_uidx
  on public.convites_equipe (academia_id, email) where status = 'pendente';
create index convites_equipe_email_idx
  on public.convites_equipe (email) where status = 'pendente';
create index convites_equipe_academia_envio_idx
  on public.convites_equipe (academia_id, ultimo_envio_em);

create trigger convites_equipe_updated_at
  before update on public.convites_equipe
  for each row execute function public.set_updated_at();
create trigger convites_equipe_academia_imutavel
  before update of academia_id on public.convites_equipe
  for each row execute function public.bloqueia_troca_academia();

alter table public.convites_equipe enable row level security;

create policy convites_equipe_select on public.convites_equipe
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin']));

-- Sem política de escrita, e sem o privilégio também: insert, update e
-- delete direto dão "permission denied", não "zero linhas".
revoke all on public.convites_equipe from anon, authenticated;
grant select on public.convites_equipe to authenticated;

-- C10, envios de e-mail que de fato saíram ou estão saindo, no projeto todo.
-- Não é dado de tenant: é o registro que os limites por endereço usam, e por
-- isso não tem academia_id nem cascata (excluir uma academia não pode apagar
-- a cota que ainda vale para as outras). RLS ligado e nenhum privilégio para
-- anon e authenticated: ninguém lê pela API (revelaria se outra academia
-- convidou o endereço). Só as funções *_interna mexem aqui.
--   reservado_em: quando criar_convite_interna liberou o envio. A reserva
--     sem resultado bloqueia o endereço por 6 minutos (a Edge Function só
--     despacha até 4 minutos depois dela) e conta no teto de 5 por 24 horas
--     mais esses 4 minutos.
--   enviado_em: quando o provedor aceitou (confirmar_envio_convite_interna).
--     Conta 24 horas daí, e o intervalo de 60 segundos também.
--   liberado_em: quando o provedor recusou de vez
--     (liberar_envio_convite_interna). Não conta mais.
create table public.convites_envios (
  id           uuid primary key default gen_random_uuid(),
  email        text not null check (email = lower(btrim(email))),
  convite_id   uuid references public.convites_equipe (id) on delete set null,
  reservado_em timestamptz not null,
  enviado_em   timestamptz,
  liberado_em  timestamptz,
  check (enviado_em is null or liberado_em is null)
);

create index convites_envios_email_idx on public.convites_envios (email, reservado_em);

alter table public.convites_envios enable row level security;
revoke all on public.convites_envios from anon, authenticated;

-- =====================================================================
-- 2. AUXILIARES (nenhuma é chamável pela API)
-- =====================================================================

-- E-mail do login, normalizado, só se confirmado. Null caso contrário.
create or replace function public.convite_email_do_login()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email))
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and u.deleted_at is null
$$;

-- Papel de quem convida: dono ou admin ativo da academia, com a conta do
-- Auth existente e não apagada (exclusão lógica também conta). Não olha a
-- assinatura. Null se não for.
create or replace function public.convite_papel_ativo(p_user_id uuid, p_academia_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.papel
  from public.membros_academia m
  join auth.users u on u.id = m.user_id
  where m.academia_id = p_academia_id
    and m.user_id = p_user_id
    and m.ativo
    and m.papel in ('dono', 'admin')
    and u.deleted_at is null
$$;

-- O convite ainda pode ser aceito do lado de quem convidou (passo 5 do
-- aceite): quem convidou é dono ou admin ativo, e dono se o convite é de dono.
create or replace function public.convite_de_quem_pode(p_convite public.convites_equipe)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when p_convite.papel = 'dono' then q.papel = 'dono' else true end
     from (select public.convite_papel_ativo(p_convite.convidado_por, p_convite.academia_id) as papel) q
     where q.papel is not null),
    false)
$$;

revoke execute on function public.convite_email_do_login() from public, anon, authenticated;
revoke execute on function public.convite_papel_ativo(uuid, uuid) from public, anon, authenticated;
-- academia_ativa com o relógio de agora (clock_timestamp) no fuso da
-- academia, para checagens feitas depois de esperar travas.
create or replace function public.academia_ativa_agora(p_academia_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.academias a
    where a.id = p_academia_id
      and (a.status = 'ativa'
           or (a.status = 'trial' and a.trial_ate >= (clock_timestamp() at time zone a.fuso)::date))
  )
$$;

revoke execute on function public.convite_de_quem_pode(public.convites_equipe) from public, anon, authenticated;
revoke execute on function public.academia_ativa_agora(uuid) from public, anon, authenticated;

-- =====================================================================
-- 3. CRIAR (Edge Function convidar-membro, com o user_id do JWT)
-- =====================================================================
-- Limites de envio (C10):
--   * 60 segundos entre dois e-mails para o mesmo endereço e no máximo 5 em
--     24 horas, contando convites cancelados e recusados e todas as
--     academias. Pelo histórico da própria academia, erro explícito; pelo
--     de outras, o convite é gravado sem envio (enviar = false), para não
--     revelar a atividade de outro tenant;
--   * no máximo 30 convites criados ou com envio nas últimas 24 horas por
--     academia.

create or replace function public.criar_convite_interna(
  p_user_id     uuid,
  p_academia_id uuid,
  p_email       text,
  p_papel       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_papel_eu  text;
  v_pendente  public.convites_equipe;
  v_id        uuid;
  v_conta     text;
  v_conta_id  uuid;
  v_agora     timestamptz;
  v_enviar    boolean;
  v_envio_id  uuid;
begin
  -- 1. Entrada.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_papel is null
     or p_papel not in ('dono', 'admin', 'professor', 'recepcao') then
    raise exception 'Informe um e-mail válido e um papel da equipe (dono, admin, professor ou recepção).'
      using hint = 'dados_invalidos';
  end if;

  -- 2. Antes de travar: quem não é dono nem admin da academia sai aqui.
  if public.convite_papel_ativo(p_user_id, p_academia_id) is null then
    raise exception 'Só o dono ou um admin da academia convida para a equipe.'
      using hint = 'sem_permissao';
  end if;

  -- 3. Trava a academia e relê papel e assinatura.
  perform 1 from public.academias a where a.id = p_academia_id for no key update;
  v_papel_eu := public.convite_papel_ativo(p_user_id, p_academia_id);
  if v_papel_eu is null then
    raise exception 'Só o dono ou um admin da academia convida para a equipe.'
      using hint = 'sem_permissao';
  end if;
  if not public.academia_ativa(p_academia_id) then
    raise exception 'A assinatura da academia está suspensa: não é possível convidar.'
      using hint = 'academia_suspensa';
  end if;
  if p_papel = 'dono' and v_papel_eu <> 'dono' then
    raise exception 'Só o dono convida outro dono.'
      using hint = 'sem_permissao';
  end if;

  -- 4. O e-mail já está na academia? (contas apagadas no Auth não contam)
  if exists (
    select 1
    from public.membros_academia m
    join auth.users u on u.id = m.user_id
    where m.academia_id = p_academia_id
      and lower(btrim(u.email)) = v_email
      and u.deleted_at is null
      and (m.papel = 'totem' or (m.ativo and m.papel <> 'aluno'))
  ) then
    raise exception 'Este e-mail já faz parte da academia.'
      using hint = 'ja_membro';
  end if;
  if v_papel_eu <> 'dono' and exists (
    select 1
    from public.membros_academia m
    join auth.users u on u.id = m.user_id
    where m.academia_id = p_academia_id
      and lower(btrim(u.email)) = v_email
      and u.deleted_at is null
      and m.papel = 'dono'
  ) then
    raise exception 'Só o dono convida de volta um dono inativo.'
      using hint = 'sem_permissao';
  end if;

  -- 5. Pendente para o mesmo e-mail: o admin não mexe no de dono (C9).
  select c.* into v_pendente
  from public.convites_equipe c
  where c.academia_id = p_academia_id
    and c.email = v_email
    and c.status = 'pendente'
  for update;
  if v_pendente.papel = 'dono' and v_papel_eu <> 'dono' then
    raise exception 'Este e-mail tem um convite de dono pendente; só o dono pode alterá-lo.'
      using hint = 'sem_permissao';
  end if;

  -- 6. Limites por endereço (C10), no projeto todo: todos os convites do
  --    e-mail, em qualquer academia. A trava pelo e-mail (depois da trava da
  --    academia, sempre nessa ordem) serializa convites de academias
  --    diferentes para o mesmo endereço.
  perform pg_advisory_xact_lock(hashtextextended('convite_email:' || v_email, 0));
  -- Relógio lido depois das travas: uma espera longa não deixa o envio
  -- registrado com um horário antigo (now() é o início da transação).
  v_agora := clock_timestamp();
  -- A assinatura de novo, com o relógio de agora: a espera pelas travas pode
  -- ter passado da virada do dia do trial.
  if not public.academia_ativa_agora(p_academia_id) then
    raise exception 'A assinatura da academia está suspensa: não é possível convidar.'
      using hint = 'academia_suspensa';
  end if;

  -- 6a. Com o histórico desta academia, o erro é explícito: só revela dados
  --     dela mesma.
  if exists (
    select 1 from public.convites_equipe c
    where c.academia_id = p_academia_id
      and c.email = v_email
      and c.ultimo_envio_em > v_agora - interval '60 seconds'
  ) then
    raise exception 'O convite acabou de ser enviado. Espere um minuto para reenviar.'
      using hint = 'convite_reenvio_cedo';
  end if;
  if (select count(*)
      from public.convites_equipe c
      cross join lateral unnest(c.envios_recentes) as e(enviado_em)
      where c.academia_id = p_academia_id
        and c.email = v_email
        and e.enviado_em > v_agora - interval '24 hours') >= 5 then
    raise exception 'Este e-mail já recebeu 5 convites da academia nas últimas 24 horas.'
      using hint = 'limite_convites';
  end if;

  -- 6b. Contando os envios reais de todas as academias (convites_envios): se
  --     o limite estoura, o convite e a tentativa são gravados como num
  --     envio, mas o e-mail não sai (enviar = false). O que a academia vê
  --     (resposta, colunas que lê, próximos limites) é igual nos dois casos:
  --     um erro ou uma diferença aqui revelaria que outra academia convidou o
  --     endereço.
  v_enviar := not (
    exists (
      select 1 from public.convites_envios v
      where v.email = v_email
        and v.liberado_em is null
        and (v.enviado_em > v_agora - interval '60 seconds'
             or (v.enviado_em is null and v.reservado_em > v_agora - interval '6 minutes'))
    )
    -- Envio confirmado conta 24 horas do horário real. Reserva sem resultado
    -- conta 24 horas mais o prazo de despacho (4 minutos): o e-mail pode ter
    -- saído até 4 minutos depois dela.
    or (select count(*)
        from public.convites_envios v
        where v.email = v_email
          and v.liberado_em is null
          and (v.enviado_em > v_agora - interval '24 hours'
               or (v.enviado_em is null
                   and v.reservado_em > v_agora - interval '24 hours 4 minutes'))) >= 5
  );

  -- 7. Limite da academia (C10): convites criados ou com envio nas últimas
  --    24 horas, sem contar o pendente que está sendo reenviado se ele já
  --    está nelas.
  if (select count(*) from public.convites_equipe c
      where c.academia_id = p_academia_id
        and (c.created_at > v_agora - interval '24 hours'
             or c.ultimo_envio_em > v_agora - interval '24 hours')
        and c.id is distinct from v_pendente.id) >= 30
     and (v_pendente.id is null
          or (v_pendente.created_at <= v_agora - interval '24 hours'
              and (v_pendente.ultimo_envio_em is null
                   or v_pendente.ultimo_envio_em <= v_agora - interval '24 hours'))) then
    raise exception 'A academia chegou ao limite de 30 convites em 24 horas.'
      using hint = 'limite_convites';
  end if;

  if v_pendente.id is not null then
    -- 8a. Reenvio do pendente: atualiza papel, validade e quem convidou (C9).
    --     A tentativa é registrada sempre; o envio real, só se vai sair.
    update public.convites_equipe c
       set papel = p_papel,
           expira_em = v_agora + interval '7 days',
           convidado_por = p_user_id,
           ultimo_envio_em = v_agora,
           envios_recentes = array(
             select e from unnest(c.envios_recentes) as e
             where e > v_agora - interval '24 hours'
             order by e) || v_agora
     where c.id = v_pendente.id;
    v_id := v_pendente.id;
  else
    -- 8b. Convite novo.
    insert into public.convites_equipe (academia_id, email, papel, convidado_por, expira_em,
                                        ultimo_envio_em, envios_recentes)
    values (p_academia_id, v_email, p_papel, p_user_id, v_agora + interval '7 days',
            v_agora, array[v_agora])
    returning id into v_id;
  end if;

  -- 9. Reserva do envio real, se vai sair. Registros velhos do endereço
  --    (fora de qualquer janela) saem aqui.
  delete from public.convites_envios v
   where v.email = v_email and v.reservado_em < v_agora - interval '2 days';
  if v_enviar then
    insert into public.convites_envios (email, convite_id, reservado_em)
    values (v_email, v_id, v_agora)
    returning id into v_envio_id;
  end if;

  -- Estado da conta com esse e-mail, só para a Edge Function escolher o
  -- envio. Conta apagada no Auth não conta; havendo mais de uma, a
  -- confirmada vem primeiro.
  select u.id,
         case when u.email_confirmed_at is null then 'nao_confirmada' else 'confirmada' end
    into v_conta_id, v_conta
  from auth.users u
  where lower(btrim(u.email)) = v_email
    and u.deleted_at is null
  order by (u.email_confirmed_at is null), u.created_at
  limit 1;

  return jsonb_build_object(
    'convite_id', v_id,
    'email', v_email,
    'conta', coalesce(v_conta, 'nenhuma'),
    'user_id', v_conta_id,
    'enviar', v_enviar,
    'envio_id', v_envio_id
  );
end
$$;

revoke execute on function public.criar_convite_interna(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.criar_convite_interna(uuid, uuid, text, text) to service_role;

-- Contrato com a Edge Function para cada envio liberado (enviar = true), com
-- o envio_id devolvido por criar_convite_interna (a reserva):
--   * provedor aceitou: confirmar_envio_convite_interna. O envio passa a
--     contar do horário da confirmação (o intervalo de 60 segundos conta do
--     envio de verdade, não da reserva);
--   * provedor recusou de vez: liberar_envio_convite_interna. O envio sai da
--     cota do projeto todo, para a falha não suprimir convites de outras
--     academias. A tentativa continua registrada no convite (é o que a
--     academia vê).
-- As duas valem para qualquer reserva ainda sem resultado (cada uma tem o
-- próprio id, mesmo depois de um reenvio) e são idempotentes. A Edge
-- Function só despacha até 4 minutos depois da reserva; passado isso,
-- libera. Como cada reserva bloqueia o endereço por 6 minutos, o envio
-- aceito fica a mais de 60 s do próximo, não importa quando a confirmação
-- chegue. Reserva abandonada (a função caiu antes de saber) bloqueia por 6
-- minutos e conta no teto de 5 por 24 horas mais o prazo de despacho: lado
-- seguro contra spam. Só mexem em convites_envios: nada do que a academia lê
-- muda.
create or replace function public.confirmar_envio_convite_interna(p_envio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select v.email into v_email from public.convites_envios v where v.id = p_envio_id;
  if v_email is null then
    return;
  end if;

  -- Mesma trava do endereço de criar_convite_interna.
  perform pg_advisory_xact_lock(hashtextextended('convite_email:' || v_email, 0));

  update public.convites_envios v
     set enviado_em = clock_timestamp()
   where v.id = p_envio_id
     and v.enviado_em is null
     and v.liberado_em is null;
end
$$;

revoke execute on function public.confirmar_envio_convite_interna(uuid) from public, anon, authenticated;
grant execute on function public.confirmar_envio_convite_interna(uuid) to service_role;

create or replace function public.liberar_envio_convite_interna(p_envio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select v.email into v_email from public.convites_envios v where v.id = p_envio_id;
  if v_email is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('convite_email:' || v_email, 0));

  update public.convites_envios v
     set liberado_em = clock_timestamp()
   where v.id = p_envio_id
     and v.enviado_em is null
     and v.liberado_em is null;
end
$$;

revoke execute on function public.liberar_envio_convite_interna(uuid) from public, anon, authenticated;
grant execute on function public.liberar_envio_convite_interna(uuid) to service_role;

-- =====================================================================
-- 4. CANCELAR (dono, admin)
-- =====================================================================

create or replace function public.cancelar_convite(p_convite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_conv     public.convites_equipe;
  v_papel_eu text;
begin
  -- 1. Inexistente ou de academia que quem chama não gere: o mesmo código,
  --    e sem travar nada.
  select c.academia_id into v_academia from public.convites_equipe c where c.id = p_convite_id;
  if v_academia is null or public.convite_papel_ativo(auth.uid(), v_academia) is null then
    raise exception 'Convite não encontrado.' using hint = 'convite_invalido';
  end if;

  -- Trava e relê.
  perform 1 from public.academias a where a.id = v_academia for no key update;
  select c.* into v_conv from public.convites_equipe c where c.id = p_convite_id for update;
  v_papel_eu := public.convite_papel_ativo(auth.uid(), v_academia);
  if v_conv.id is null or v_papel_eu is null then
    raise exception 'Convite não encontrado.' using hint = 'convite_invalido';
  end if;

  -- 2. Só pendente (vencido também, que continua pendente).
  if v_conv.status <> 'pendente' then
    raise exception 'Este convite não está mais pendente.' using hint = 'convite_invalido';
  end if;

  -- 3. Admin não mexe em convite de dono.
  if v_conv.papel = 'dono' and v_papel_eu <> 'dono' then
    raise exception 'Só o dono cancela um convite de dono.' using hint = 'sem_permissao';
  end if;

  -- 4. Academia suspensa não altera (C6).
  if not public.academia_ativa_agora(v_academia) then
    raise exception 'A assinatura da academia está suspensa: não é possível alterar convites.'
      using hint = 'academia_suspensa';
  end if;

  update public.convites_equipe c
     set status = 'cancelado', encerrado_por = auth.uid(), encerrado_em = now()
   where c.id = p_convite_id;
end
$$;

revoke execute on function public.cancelar_convite(uuid) from public, anon;
grant execute on function public.cancelar_convite(uuid) to authenticated;

-- =====================================================================
-- 5. CONVIDADO: listar, aceitar e recusar
-- =====================================================================

-- Só os convites que o login ainda pode aceitar: pendentes, não vencidos,
-- de quem ainda pode dar o acesso, e de academias em que ele não é equipe.
create or replace function public.meus_convites()
returns table (
  convite_id    uuid,
  academia_id   uuid,
  academia_nome text,
  papel         text,
  expira_em     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.academia_id, a.nome, c.papel, c.expira_em
  from public.convites_equipe c
  join public.academias a on a.id = c.academia_id
  where c.email = public.convite_email_do_login()
    and c.status = 'pendente'
    and c.expira_em > now()
    and public.convite_de_quem_pode(c)
    and not exists (
      select 1 from public.membros_academia m
      where m.academia_id = c.academia_id
        and m.user_id = auth.uid()
        and (m.papel = 'totem' or (m.ativo and m.papel <> 'aluno'))
    )
  order by c.created_at
$$;

revoke execute on function public.meus_convites() from public, anon;
grant execute on function public.meus_convites() to authenticated;

-- Passos comuns de aceitar e recusar: e-mail confirmado, senha (só no
-- aceite), convite deste login e travas. Devolve o convite travado. Um
-- convite de outro e-mail não trava a academia dele.
create or replace function public.convite_do_login_travado(p_convite_id uuid, p_exige_senha boolean)
returns public.convites_equipe
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email    text := public.convite_email_do_login();
  v_academia uuid;
  v_conv     public.convites_equipe;
begin
  if v_email is null then
    raise exception 'Confirme o seu e-mail antes de responder ao convite.'
      using hint = 'email_nao_confirmado';
  end if;

  if p_exige_senha and exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and coalesce(u.raw_app_meta_data ->> 'definir_senha', 'false') = 'true'
  ) then
    raise exception 'Defina a sua senha antes de aceitar o convite.'
      using hint = 'senha_pendente';
  end if;

  select c.academia_id into v_academia
  from public.convites_equipe c
  where c.id = p_convite_id and c.email = v_email and c.status = 'pendente';

  if v_academia is not null then
    perform 1 from public.academias a where a.id = v_academia for no key update;
    select c.* into v_conv from public.convites_equipe c where c.id = p_convite_id for update;
    -- Trava a própria conta (uma troca de e-mail no Auth espera o aceite) e
    -- relê e-mail e senha: podem ter mudado enquanto esperava as travas.
    perform 1 from auth.users u where u.id = auth.uid() for share;
    v_email := public.convite_email_do_login();
    if v_email is null then
      raise exception 'Confirme o seu e-mail antes de responder ao convite.'
        using hint = 'email_nao_confirmado';
    end if;
    if p_exige_senha and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and coalesce(u.raw_app_meta_data ->> 'definir_senha', 'false') = 'true'
    ) then
      raise exception 'Defina a sua senha antes de aceitar o convite.'
        using hint = 'senha_pendente';
    end if;
  end if;

  if v_conv.id is null
     or v_conv.status <> 'pendente'
     or v_conv.expira_em <= clock_timestamp()  -- depois das travas, não o início da transação
     or v_conv.email <> v_email then
    raise exception 'Convite não encontrado, vencido ou já respondido.'
      using hint = 'convite_invalido';
  end if;

  return v_conv;
end
$$;

revoke execute on function public.convite_do_login_travado(uuid, boolean) from public, anon, authenticated;

create or replace function public.aceitar_convite(p_convite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv       public.convites_equipe;
  v_papel_quem text;
  v_membro     public.membros_academia;
begin
  -- 1 a 4: e-mail, senha, convite deste login e travas.
  v_conv := public.convite_do_login_travado(p_convite_id, true);

  -- 5. Quem convidou ainda pode dar esse acesso.
  if not public.convite_de_quem_pode(v_conv) then
    raise exception 'Convite não encontrado, vencido ou já respondido.'
      using hint = 'convite_invalido';
  end if;
  v_papel_quem := public.convite_papel_ativo(v_conv.convidado_por, v_conv.academia_id);

  -- 6. A assinatura (C6) é conferida no fim, depois de todas as esperas.

  -- 7 a 9. O vínculo pode aparecer no meio do caminho (o portal grava o papel
  -- aluno sem a trava da academia): se o insert esbarrar nele, relê, trava e
  -- aplica as mesmas regras.
  loop
    select m.* into v_membro
    from public.membros_academia m
    where m.academia_id = v_conv.academia_id and m.user_id = auth.uid()
    for update;

    -- A linha do membro pode ter ficado travada por outra transação: o
    -- convite pode ter vencido nessa espera.
    if v_conv.expira_em <= clock_timestamp() then
      raise exception 'Convite não encontrado, vencido ou já respondido.'
        using hint = 'convite_invalido';
    end if;

    if v_membro.user_id is not null then
      -- 7. Já está na academia como equipe (inclusive reativado depois do
      --    convite) ou como totem.
      if v_membro.papel = 'totem' or (v_membro.ativo and v_membro.papel <> 'aluno') then
        raise exception 'Você já faz parte desta academia.'
          using hint = 'ja_membro';
      end if;
      -- 8. Dono inativo só volta com outro papel por convite de um dono.
      if v_membro.papel = 'dono' and v_conv.papel <> 'dono' and v_papel_quem <> 'dono' then
        raise exception 'Convite não encontrado, vencido ou já respondido.'
          using hint = 'convite_invalido';
      end if;
      -- 9a. Reativação, ou troca do papel aluno pelo da equipe.
      update public.membros_academia m
         set papel = v_conv.papel, ativo = true
       where m.academia_id = v_conv.academia_id and m.user_id = auth.uid();
      exit;
    end if;

    -- 9b. Membro novo. Se o vínculo apareceu agora, volta ao começo.
    insert into public.membros_academia (academia_id, user_id, papel)
    values (v_conv.academia_id, auth.uid(), v_conv.papel)
    on conflict (academia_id, user_id) do nothing;
    exit when found;
  end loop;

  -- O insert pode ter esperado a chave de um vínculo que depois foi desfeito:
  -- confere a validade de novo antes de marcar o aceite (o erro desfaz a
  -- gravação do vínculo).
  if v_conv.expira_em <= clock_timestamp() then
    raise exception 'Convite não encontrado, vencido ou já respondido.'
      using hint = 'convite_invalido';
  end if;

  -- 6. Academia suspensa não aceita (C6). Conferida aqui, depois de todas as
  --    esperas, com o relógio de agora no fuso da academia (academia_ativa
  --    usa o now() do início da transação): um trial que vence durante a
  --    espera não aceita. Uma mudança de status espera a trava da academia,
  --    que este aceite segura. O erro desfaz a gravação do vínculo.
  if not public.academia_ativa_agora(v_conv.academia_id) then
    raise exception 'A assinatura da academia está suspensa: o convite não pode ser aceito agora.'
      using hint = 'academia_suspensa';
  end if;

  update public.convites_equipe c
     set status = 'aceito', aceito_por = auth.uid(), aceito_em = now()
   where c.id = v_conv.id;

  return v_conv.academia_id;
end
$$;

revoke execute on function public.aceitar_convite(uuid) from public, anon;
grant execute on function public.aceitar_convite(uuid) to authenticated;

create or replace function public.recusar_convite(p_convite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.convites_equipe;
begin
  v_conv := public.convite_do_login_travado(p_convite_id, false);

  if not public.academia_ativa_agora(v_conv.academia_id) then
    raise exception 'A assinatura da academia está suspensa: o convite não pode ser respondido agora.'
      using hint = 'academia_suspensa';
  end if;

  update public.convites_equipe c
     set status = 'recusado', encerrado_por = auth.uid(), encerrado_em = now()
   where c.id = v_conv.id;
end
$$;

revoke execute on function public.recusar_convite(uuid) from public, anon;
grant execute on function public.recusar_convite(uuid) to authenticated;

-- =====================================================================
-- 6. EQUIPE DA ACADEMIA (dono, admin; academia suspensa também lê)
-- =====================================================================

create or replace function public.equipe_da_academia(p_academia_id uuid)
returns table (
  user_id    uuid,
  email      text,
  papel      text,
  ativo      boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tem_papel(p_academia_id, array['dono', 'admin']) then
    raise exception 'Só o dono ou um admin vê a equipe da academia.'
      using hint = 'sem_permissao';
  end if;

  return query
  select m.user_id, u.email::text, m.papel, m.ativo, m.created_at
  from public.membros_academia m
  join auth.users u on u.id = m.user_id
  where m.academia_id = p_academia_id
    and m.papel in ('dono', 'admin', 'professor', 'recepcao')
  order by m.ativo desc, m.papel, u.email;
end
$$;

revoke execute on function public.equipe_da_academia(uuid) from public, anon;
grant execute on function public.equipe_da_academia(uuid) to authenticated;

-- =====================================================================
-- 7. ÚLTIMO DONO E REVOGAÇÃO
-- =====================================================================
-- Outro dono ativo, com a conta do Auth existente e sem deleted_at (a
-- exclusão lógica é proibida; o filtro é só defesa).
create or replace function public.academia_tem_outro_dono(p_academia_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membros_academia m
    join auth.users u on u.id = m.user_id
    where m.academia_id = p_academia_id
      and m.papel = 'dono'
      and m.ativo
      and m.user_id <> p_user_id
      and u.deleted_at is null
  )
$$;

revoke execute on function public.academia_tem_outro_dono(uuid, uuid) from public, anon, authenticated;

-- Quando um dono ou admin ativo perde poder (delete, desativação,
-- rebaixamento ou troca do titular do vínculo), trava a linha da academia,
-- a mesma que as funções de convite travam: a revogação e o aceite de um
-- convite feito por essa pessoa se serializam.
--
-- Recusa o update ou delete que deixe a academia sem nenhum dono ativo.
-- Passa:
--   * requisição com papel service_role (billing, Edge Functions);
--   * sessão administrativa sem JWT (SQL direto do projeto, migrations,
--     pg_cron), reconhecida por não ter papel de requisição e rodar como
--     postgres ou supabase_admin;
--   * delete em cascata de uma academia sendo apagada (a linha da academia
--     já não existe).
-- Não passa: RPC security definer chamada pela API (tem o papel da
-- requisição, mesmo rodando como postgres) e o Auth apagando a conta
-- (roda como supabase_auth_admin).
--
-- O gatilho trava a academia depois da linha do membro (o update já travou
-- a linha). Uma alteração direta em dono concorrendo com uma função que
-- trava a academia antes pode terminar em deadlock; o Postgres desfaz uma
-- das duas (40P01) e nenhuma deixa a academia sem dono.

create or replace function public.membros_ultimo_dono()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel_req text := nullif(auth.role(), '');
begin
  -- Só importa quando um dono ou admin ativo perde poder: sai, é desativado,
  -- é rebaixado ou o vínculo passa para outra pessoa (admin promovido a dono
  -- não perde nada).
  if not old.ativo or old.papel not in ('dono', 'admin') then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.ativo and new.user_id = old.user_id
     and (new.papel = old.papel or (old.papel = 'admin' and new.papel = 'dono')) then
    return new;
  end if;

  -- Trava a academia: a revogação espera o aceite em andamento, e o aceite
  -- que vier depois já vê quem convidou sem o acesso.
  perform 1 from public.academias a where a.id = old.academia_id for no key update;
  if not found then
    return coalesce(new, old);  -- academia sendo apagada (cascata)
  end if;

  -- Os convites pendentes que essa pessoa não pode mais conceder morrem de
  -- vez: recuperar o papel depois não os ressuscita.
  update public.convites_equipe c
     set status = 'cancelado', encerrado_em = clock_timestamp()
   where c.academia_id = old.academia_id
     and c.convidado_por = old.user_id
     and c.status = 'pendente'
     and (tg_op = 'DELETE'
          or not new.ativo
          or new.user_id <> old.user_id
          or new.papel not in ('dono', 'admin')
          or (c.papel = 'dono' and new.papel <> 'dono'));

  if old.papel <> 'dono'
     or (tg_op = 'UPDATE' and new.papel = 'dono' and new.ativo and new.user_id = old.user_id) then
    return coalesce(new, old);
  end if;

  if v_papel_req = 'service_role'
     or (v_papel_req is null and session_user in ('postgres', 'supabase_admin')) then
    return coalesce(new, old);
  end if;

  if not public.academia_tem_outro_dono(old.academia_id, old.user_id) then
    raise exception 'A academia precisa de pelo menos um dono ativo. Convide outro dono antes de sair.'
      using hint = 'ultimo_dono';
  end if;

  return coalesce(new, old);
end
$$;

revoke execute on function public.membros_ultimo_dono() from public, anon, authenticated;

create trigger membros_academia_ultimo_dono
  before update or delete on public.membros_academia
  for each row execute function public.membros_ultimo_dono();

-- Exclusão lógica no Auth (auth.users.deleted_at) é proibida neste projeto
-- (decisão do dono do projeto), para todos, inclusive o SQL do projeto:
-- conta se apaga de verdade, e o delete em cascata leva os vínculos
-- (membros_academia) e solta os cadastros de aluno e professor. Uma conta
-- apagada logicamente, com um JWT emitido antes, continuaria passando pelo
-- RLS e pelas RPCs (vínculo, sou_o_aluno, criar_academia).
create or replace function public.auth_exclusao_logica()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    raise exception 'A exclusão lógica de contas está desativada: apague a conta de verdade.'
      using hint = 'exclusao_logica_bloqueada';
  end if;
  return new;
end
$$;

revoke execute on function public.auth_exclusao_logica() from public, anon, authenticated;

create trigger auth_users_exclusao_logica
  before update of deleted_at on auth.users
  for each row execute function public.auth_exclusao_logica();
