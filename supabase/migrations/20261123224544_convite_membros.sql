-- Convite de membros da equipe (spec: docs/specs/convite-membros.md).
--
-- 1. convites_equipe: um convite por e-mail e academia, com RLS só de leitura
--    para dono e admin. Toda escrita passa pelas funções abaixo.
-- 2. criar_convite_interna (só service_role, chamada pela Edge Function
--    convidar-membro), cancelar_convite, meus_convites, aceitar_convite,
--    recusar_convite e equipe_da_academia.
-- 3. Gatilho do último dono em membros_academia.
--
-- Ordem das travas, em todo lugar: primeiro a linha da academia, depois a
-- do convite. Assim criar, aceitar e o gatilho do último dono se
-- serializam por academia, sem deadlock.

-- =====================================================================
-- 1. TABELA
-- =====================================================================

create table public.convites_equipe (
  id              uuid primary key default gen_random_uuid(),
  academia_id     uuid not null references public.academias (id) on delete cascade,
  email           text not null,
  papel           text not null
                  check (papel in ('dono', 'admin', 'professor', 'recepcao')),
  status          text not null default 'pendente'
                  check (status in ('pendente', 'aceito', 'cancelado', 'recusado')),
  convidado_por   uuid references auth.users (id) on delete set null,
  expira_em       timestamptz not null,
  ultimo_envio_em timestamptz,
  aceito_por      uuid references auth.users (id) on delete set null,
  aceito_em       timestamptz,
  encerrado_por   uuid references auth.users (id) on delete set null,
  encerrado_em    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
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
create index convites_equipe_academia_criado_idx
  on public.convites_equipe (academia_id, created_at);

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

-- =====================================================================
-- 2. AUXILIARES
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
$$;

-- O membro é dono ou admin ativo da academia (sem olhar a assinatura)?
create or replace function public.convite_papel_ativo(p_user_id uuid, p_academia_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.papel
  from public.membros_academia m
  where m.academia_id = p_academia_id
    and m.user_id = p_user_id
    and m.ativo
    and m.papel in ('dono', 'admin')
$$;

revoke execute on function public.convite_email_do_login() from public, anon, authenticated;
revoke execute on function public.convite_papel_ativo(uuid, uuid) from public, anon, authenticated;

-- =====================================================================
-- 3. CRIAR (Edge Function convidar-membro, com o user_id do JWT)
-- =====================================================================

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
  v_membro    public.membros_academia;
  v_pendente  public.convites_equipe;
  v_id        uuid;
  v_conta     text;
  v_conta_id  uuid;
begin
  -- 1. Entrada.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_papel is null
     or p_papel not in ('dono', 'admin', 'professor', 'recepcao') then
    raise exception 'Informe um e-mail válido e um papel da equipe (dono, admin, professor ou recepção).'
      using hint = 'dados_invalidos';
  end if;

  -- 2. Quem convida: dono ou admin ativo, com a assinatura em dia.
  v_papel_eu := public.convite_papel_ativo(p_user_id, p_academia_id);
  if v_papel_eu is null then
    raise exception 'Só o dono ou um admin da academia convida para a equipe.'
      using hint = 'sem_permissao';
  end if;
  if not public.academia_ativa(p_academia_id) then
    raise exception 'A assinatura da academia está suspensa: não é possível convidar.'
      using hint = 'academia_suspensa';
  end if;

  -- 3. Só o dono convida outro dono.
  if p_papel = 'dono' and v_papel_eu <> 'dono' then
    raise exception 'Só o dono convida outro dono.'
      using hint = 'sem_permissao';
  end if;

  -- 4. Serializa com o aceite e com o gatilho do último dono.
  perform 1 from public.academias a where a.id = p_academia_id for update;

  -- 5. O e-mail já é da equipe?
  select m.* into v_membro
  from public.membros_academia m
  join auth.users u on u.id = m.user_id
  where m.academia_id = p_academia_id
    and lower(btrim(u.email)) = v_email;

  if found then
    if v_membro.ativo and v_membro.papel <> 'aluno' then
      raise exception 'Este e-mail já faz parte da equipe da academia.'
        using hint = 'ja_membro';
    end if;
    if not v_membro.ativo and v_membro.papel = 'dono' and v_papel_eu <> 'dono' then
      raise exception 'Só o dono convida de volta um dono inativo.'
        using hint = 'sem_permissao';
    end if;
  end if;

  -- 6. Pendente para o mesmo e-mail: atualiza (C9), respeitando o intervalo
  --    de reenvio (C10).
  select c.* into v_pendente
  from public.convites_equipe c
  where c.academia_id = p_academia_id
    and c.email = v_email
    and c.status = 'pendente'
  for update;

  if found then
    if v_pendente.papel = 'dono' and v_papel_eu <> 'dono' then
      raise exception 'Este e-mail tem um convite de dono pendente; só o dono pode alterá-lo.'
        using hint = 'sem_permissao';
    end if;
    if v_pendente.ultimo_envio_em > now() - interval '60 seconds' then
      raise exception 'O convite acabou de ser enviado. Espere um minuto para reenviar.'
        using hint = 'convite_reenvio_cedo';
    end if;
    update public.convites_equipe c
       set papel = p_papel,
           expira_em = now() + interval '7 days',
           convidado_por = p_user_id,
           ultimo_envio_em = now()
     where c.id = v_pendente.id;
    v_id := v_pendente.id;
  else
    -- 7. Convite novo, com o limite diário da academia (C10).
    if (select count(*) from public.convites_equipe c
        where c.academia_id = p_academia_id
          and c.created_at > now() - interval '24 hours') >= 30 then
      raise exception 'A academia chegou ao limite de 30 convites em 24 horas.'
        using hint = 'limite_convites';
    end if;
    insert into public.convites_equipe (academia_id, email, papel, convidado_por, expira_em, ultimo_envio_em)
    values (p_academia_id, v_email, p_papel, p_user_id, now() + interval '7 days', now())
    returning id into v_id;
  end if;

  -- Estado da conta com esse e-mail: só para a Edge Function escolher o envio.
  select u.id,
         case when u.email_confirmed_at is null then 'nao_confirmada' else 'confirmada' end
    into v_conta_id, v_conta
  from auth.users u
  where lower(btrim(u.email)) = v_email
  order by u.created_at
  limit 1;

  return jsonb_build_object(
    'convite_id', v_id,
    'email', v_email,
    'conta', coalesce(v_conta, 'nenhuma'),
    'user_id', v_conta_id
  );
end
$$;

revoke execute on function public.criar_convite_interna(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.criar_convite_interna(uuid, uuid, text, text) to service_role;

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
  select c.academia_id into v_academia from public.convites_equipe c where c.id = p_convite_id;
  v_papel_eu := public.convite_papel_ativo(auth.uid(), v_academia);

  -- 1. Inexistente ou de academia que quem chama não gere: o mesmo código.
  if v_academia is null or v_papel_eu is null then
    raise exception 'Convite não encontrado.' using hint = 'convite_invalido';
  end if;

  perform 1 from public.academias a where a.id = v_academia for update;
  select c.* into v_conv from public.convites_equipe c where c.id = p_convite_id for update;

  -- 2. Só pendente (vencido também, que continua pendente).
  if v_conv.status <> 'pendente' then
    raise exception 'Este convite não está mais pendente.' using hint = 'convite_invalido';
  end if;

  -- 3. Admin não mexe em convite de dono.
  if v_conv.papel = 'dono' and v_papel_eu <> 'dono' then
    raise exception 'Só o dono cancela um convite de dono.' using hint = 'sem_permissao';
  end if;

  -- 4. Academia suspensa não altera (C6).
  if not public.academia_ativa(v_academia) then
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
  order by c.created_at
$$;

revoke execute on function public.meus_convites() from public, anon;
grant execute on function public.meus_convites() to authenticated;

-- Passos comuns de aceitar e recusar: e-mail confirmado, travas e convite
-- válido para este login. Devolve o convite travado. p_exige_senha separa o
-- aceite (que exige a senha definida) da recusa.
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

  select c.academia_id into v_academia from public.convites_equipe c where c.id = p_convite_id;
  if v_academia is not null then
    perform 1 from public.academias a where a.id = v_academia for update;
  end if;
  select c.* into v_conv from public.convites_equipe c where c.id = p_convite_id for update;

  if v_conv.id is null
     or v_conv.status <> 'pendente'
     or v_conv.expira_em <= now()
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
  -- 1 a 4: e-mail, senha, travas e convite válido.
  v_conv := public.convite_do_login_travado(p_convite_id, true);

  -- 5. Quem convidou ainda pode dar esse acesso.
  v_papel_quem := public.convite_papel_ativo(v_conv.convidado_por, v_conv.academia_id);
  if v_papel_quem is null or (v_conv.papel = 'dono' and v_papel_quem <> 'dono') then
    raise exception 'Convite não encontrado, vencido ou já respondido.'
      using hint = 'convite_invalido';
  end if;

  -- 6. Academia suspensa não aceita (C6).
  if not public.academia_ativa(v_conv.academia_id) then
    raise exception 'A assinatura da academia está suspensa: o convite não pode ser aceito agora.'
      using hint = 'academia_suspensa';
  end if;

  select m.* into v_membro
  from public.membros_academia m
  where m.academia_id = v_conv.academia_id and m.user_id = auth.uid()
  for update;

  if found then
    -- 7. Já é da equipe (inclusive se foi reativado depois do convite).
    if v_membro.ativo and v_membro.papel <> 'aluno' then
      raise exception 'Você já faz parte da equipe desta academia.'
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
  else
    -- 9b. Membro novo.
    insert into public.membros_academia (academia_id, user_id, papel)
    values (v_conv.academia_id, auth.uid(), v_conv.papel);
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

  if not public.academia_ativa(v_conv.academia_id) then
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
    and m.papel <> 'aluno'
  order by m.ativo desc, m.papel, u.email;
end
$$;

revoke execute on function public.equipe_da_academia(uuid) from public, anon;
grant execute on function public.equipe_da_academia(uuid) to authenticated;

-- =====================================================================
-- 7. ÚLTIMO DONO
-- =====================================================================
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

create or replace function public.membros_ultimo_dono()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel_req text := nullif(auth.role(), '');
begin
  -- Só importa quando a linha antiga é dono ativo e deixa de ser.
  if old.papel <> 'dono' or not old.ativo then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.papel = 'dono' and new.ativo then
    return new;
  end if;

  if v_papel_req = 'service_role'
     or (v_papel_req is null and session_user in ('postgres', 'supabase_admin')) then
    return coalesce(new, old);
  end if;

  perform 1 from public.academias a where a.id = old.academia_id for update;
  if not found then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1 from public.membros_academia m
    where m.academia_id = old.academia_id
      and m.papel = 'dono'
      and m.ativo
      and m.user_id <> old.user_id
  ) then
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
