-- Portal do aluno, parte do banco (issue #20; plano aprovado pelo dono do
-- projeto na sessão, por mexer no vínculo de login).
--
-- Decisão do dono na #20: login por e-mail com link mágico, e o responsável
-- também entra, pelo e-mail dele.
--   1. alunos.responsavel_email: entra pela matrícula online e pela equipe
--      (grant por coluna). Guardado como veio; toda comparação é em minúsculas.
--   2. vincular_meu_cadastro_aluno liga o login de e-mail confirmado aos alunos
--      ativos cujo email OU responsavel_email é esse e-mail. Cada cadastro tem
--      um login só (alunos.user_id): quem vincular primeiro fica com ele, e o
--      vínculo existente nunca é trocado.
--   3. anonimizar_aluno e aluno_sem_dados_pessoais passam a limpar e conferir
--      responsavel_email (LGPD).

-- ---------------------------------------------------------------------
-- 1. Coluna e grants
-- ---------------------------------------------------------------------
alter table public.alunos add column responsavel_email text;

grant insert (responsavel_email), update (responsavel_email) on public.alunos to authenticated;

create or replace function public.matricula_online(p_slug text, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_uuid constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_acad         public.academias;
  v_hoje         date;
  v_nasc_txt     text;
  v_nasc         date;
  v_plano_txt    text;
  v_plano_id     uuid;
  v_turmas       jsonb;
  v_aluno_id     uuid;
  v_matricula_id uuid;
begin
  select * into v_acad from public.academias where slug = lower(trim(p_slug));
  if not found or not v_acad.matricula_online_aberta or not public.academia_ativa(v_acad.id) then
    raise exception 'Matrícula online indisponível. Procure a direção da escola.'
      using hint = 'matricula_fechada';
  end if;
  v_hoje := public.hoje_academia(v_acad.id);

  -- Formato dos dados. Nenhuma conversão acontece fora daqui: entrada
  -- malformada sai como dados_invalidos, não como erro técnico do Postgres.
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Dados da matrícula inválidos'
      using hint = 'dados_invalidos';
  end if;

  if coalesce(trim(p_dados ->> 'nome'), '') = '' then
    raise exception 'Informe o nome completo'
      using hint = 'dados_invalidos';
  end if;

  -- só o booleano true vale como aceite
  if (p_dados -> 'aceite_termo') is distinct from 'true'::jsonb then
    raise exception 'É preciso aceitar o termo de responsabilidade'
      using hint = 'dados_invalidos';
  end if;

  v_nasc_txt := nullif(trim(p_dados ->> 'data_nascimento'), '');
  if v_nasc_txt is not null then
    if v_nasc_txt !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data de nascimento inválida: use o formato AAAA-MM-DD'
        using hint = 'dados_invalidos';
    end if;

    begin
      v_nasc := v_nasc_txt::date;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        raise exception 'Data de nascimento inválida'
          using hint = 'dados_invalidos';
    end;

    if v_nasc > v_hoje then
      raise exception 'Data de nascimento inválida'
        using hint = 'dados_invalidos';
    end if;
  end if;

  if v_nasc is not null
     and v_nasc > v_hoje - interval '18 years'
     and (coalesce(trim(p_dados ->> 'responsavel_nome'), '') = ''
          or coalesce(p_dados ->> 'responsavel_cpf', '') = '') then
    raise exception 'Menores de idade precisam de responsável (nome e CPF)'
      using hint = 'menor_sem_responsavel';
  end if;

  v_plano_txt := nullif(trim(p_dados ->> 'plano_id'), '');
  if v_plano_txt is not null then
    if v_plano_txt !~ c_uuid then
      raise exception 'Plano inválido'
        using hint = 'dados_invalidos';
    end if;
    v_plano_id := v_plano_txt::uuid;

    if not exists (
      select 1 from public.planos
      where id = v_plano_id and academia_id = v_acad.id and ativo
    ) then
      raise exception 'Plano inválido'
        using hint = 'dados_invalidos';
    end if;
  end if;

  -- turma_ids: ausente, null ou lista de uuids em texto
  v_turmas := p_dados -> 'turma_ids';
  if v_turmas is null or jsonb_typeof(v_turmas) = 'null' then
    v_turmas := '[]'::jsonb;
  elsif jsonb_typeof(v_turmas) <> 'array' then
    raise exception 'Turmas inválidas'
      using hint = 'dados_invalidos';
  elsif exists (
    select 1 from jsonb_array_elements(v_turmas) e
    where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ c_uuid
  ) then
    raise exception 'Turmas inválidas'
      using hint = 'dados_invalidos';
  end if;

  insert into public.alunos (
    academia_id, nome, cpf, data_nascimento, telefone, email,
    responsavel_nome, responsavel_cpf, responsavel_telefone, responsavel_email,
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
    lower(nullif(trim(p_dados ->> 'responsavel_email'), '')),
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
    and t.id in (
      select (e #>> '{}')::uuid from jsonb_array_elements(v_turmas) e
    );

  return v_matricula_id;
exception
  when unique_violation then
    raise exception 'Já existe um cadastro com esse CPF nesta academia. Procure a recepção.'
      using hint = 'cpf_duplicado';
  when check_violation then
    raise exception 'Dados inválidos: confira CPF (11 dígitos) e nome'
      using hint = 'dados_invalidos';
end
$$;

-- ---------------------------------------------------------------------
-- 2. Vínculo do login
-- ---------------------------------------------------------------------
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
   where (lower(a.email) = v_email or lower(a.responsavel_email) = v_email)
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

-- ---------------------------------------------------------------------
-- 3. Anonimização (LGPD)
-- ---------------------------------------------------------------------
create or replace function public.aluno_sem_dados_pessoais(p_aluno public.alunos)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_aluno.nome = 'Aluno anonimizado'
     and p_aluno.status = 'inativo'
     and p_aluno.cpf is null
     and p_aluno.data_nascimento is null
     and p_aluno.telefone is null
     and p_aluno.email is null
     and p_aluno.foto_url is null
     and p_aluno.responsavel_nome is null
     and p_aluno.responsavel_cpf is null
     and p_aluno.responsavel_telefone is null
     and p_aluno.responsavel_email is null
     and p_aluno.contato_emergencia is null
     and p_aluno.observacoes_medicas is null
     and p_aluno.user_id is null;
$$;

-- Mesmo corpo de 20261028122643, limpando também responsavel_email.
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
    raise exception 'Aluno não encontrado ou sem permissão para anonimizar'
      using hint = 'sem_permissao';
  end if;

  -- só está pronto se o marcador existe E os dados pessoais já saíram
  if v_aluno.anonimizado_em is not null and public.aluno_sem_dados_pessoais(v_aluno) then
    return;
  end if;

  if exists (
    select 1 from public.cobrancas
    where academia_id = v_aluno.academia_id and aluno_id = p_aluno_id and status = 'pendente'
  ) then
    raise exception 'Cancele ou dê baixa nas cobranças pendentes antes de anonimizar'
      using hint = 'anonimizar_cobranca_pendente';
  end if;

  update public.matriculas
     set status = 'cancelada',
         -- Fim hoje, mas a que já terminou mantém o fim dela, e a que ainda nem
         -- começou termina no próprio início (o fim nunca fica antes do início:
         -- check matriculas_periodo_valido).
         data_fim = greatest(data_inicio,
                             least(coalesce(data_fim, public.hoje_academia(v_aluno.academia_id)),
                                   public.hoje_academia(v_aluno.academia_id)))
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
         responsavel_email    = null,
         contato_emergencia   = null,
         observacoes_medicas  = null,
         user_id              = null,
         status               = 'inativo',
         anonimizado_em       = coalesce(anonimizado_em, now())
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
