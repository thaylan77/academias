-- =====================================================================
-- Honor Team SaaS — segurança do check-in
-- Spec: docs/specs/checkin-seguranca.md
--
--   1. Configuração por academia e papel 'totem'
--   2. Segredo do token (HMAC) por academia
--   3. Token rotativo e janela de horário
--   4. fazer_checkin exige token; RPCs do totem
--   5. Códigos de erro estáveis no hint (check-in e matrícula online)
--
-- Convenção: raise exception '<mensagem em português>' using hint = '<codigo>'.
-- A mensagem pode mudar; o código não. No PostgREST chega como error.hint.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;


-- =====================================================================
-- 1. CONFIGURAÇÃO E PAPEL TOTEM
-- =====================================================================

alter table public.academias
  add column checkin_token_segundos smallint not null default 30
    check (checkin_token_segundos between 30 and 60),     -- o QR muda a cada N segundos
  add column checkin_antecedencia_min smallint not null default 30
    check (checkin_antecedencia_min between 0 and 180);   -- check-in abre N min antes da aula

grant update (checkin_token_segundos, checkin_antecedencia_min)
  on public.academias to authenticated;

-- 'totem': login do aparelho que exibe o QR. Não lê nenhuma tabela de negócio.
alter table public.membros_academia
  drop constraint membros_academia_papel_check,
  add constraint membros_academia_papel_check
    check (papel in ('dono', 'admin', 'professor', 'recepcao', 'aluno', 'totem'));

-- Sem lista de papéis, tem_papel() significava "qualquer membro" e é o que
-- libera a leitura de academias e do catálogo. O totem fica de fora: só
-- entra quando a lista de papéis o cita.
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
      and case when p_papeis is null then m.papel <> 'totem'
               else m.papel = any (p_papeis) end
  );
$$;


-- =====================================================================
-- 2. SEGREDO DO TOKEN
-- =====================================================================

-- Um segredo por academia, criado na primeira emissão. Ninguém lê pela API:
-- só as funções security definer abaixo. Rotacionar invalida os tokens em uso.
create table public.checkin_segredos (
  academia_id    uuid primary key references public.academias (id) on delete cascade,
  segredo        bytea not null default extensions.gen_random_bytes(32),
  created_at     timestamptz not null default now(),
  rotacionado_em timestamptz
);

alter table public.checkin_segredos enable row level security;
revoke all on public.checkin_segredos from anon, authenticated;

create trigger checkin_segredos_academia_imutavel
  before update of academia_id on public.checkin_segredos
  for each row execute function public.bloqueia_troca_academia();


-- =====================================================================
-- 3. TOKEN E JANELA DE HORÁRIO (funções internas, sem grant para a API)
-- =====================================================================

-- Número da janela de tempo atual da academia.
create or replace function public.checkin_janela_atual(p_academia_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select floor(extract(epoch from now()) / a.checkin_token_segundos)::bigint
  from public.academias a
  where a.id = p_academia_id;
$$;

-- Token da turma numa janela: HMAC-SHA256(turma:janela, segredo), 128 bits em hex.
-- Nulo se a academia ainda não tem segredo.
create or replace function public.checkin_token_da_janela(p_turma_id uuid, p_janela bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select substr(
           encode(
             extensions.hmac(
               convert_to(p_turma_id::text || ':' || p_janela::text, 'UTF8'),
               s.segredo,
               'sha256'),
             'hex'),
           1, 32)
  from public.turmas t
  join public.checkin_segredos s on s.academia_id = t.academia_id
  where t.id = p_turma_id;
$$;

-- Aulas com check-in aberto agora: de N minutos antes do início até o fim,
-- no fuso da academia. Testa hoje e amanhã: a aula que começa logo depois da
-- meia-noite abre o check-in ainda no dia anterior.
create or replace function public.checkin_aulas_abertas(p_academia_id uuid)
returns table (turma_id uuid, dia date, hora_inicio time, hora_fim time)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, d.dia, h.hora_inicio, h.hora_fim
  from public.academias a
  cross join lateral (select (now() at time zone a.fuso) as agora) n
  cross join lateral (values (n.agora::date), (n.agora::date + 1)) as d (dia)
  join public.turmas t on t.academia_id = a.id and t.ativa
  join public.turma_horarios h
    on h.academia_id = t.academia_id
   and h.turma_id = t.id
   and h.dia_semana = extract(dow from d.dia)::int
  where a.id = p_academia_id
    and n.agora >= (d.dia + h.hora_inicio) - make_interval(mins => a.checkin_antecedencia_min::int)
    and n.agora <= (d.dia + h.hora_fim);
$$;

-- Dia da aula se o check-in da turma está aberto agora; nulo se não.
create or replace function public.checkin_data_aula(p_turma_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select x.dia
  from public.turmas t
  cross join lateral public.checkin_aulas_abertas(t.academia_id) x
  where t.id = p_turma_id
    and x.turma_id = t.id
  order by x.dia
  limit 1;
$$;


-- =====================================================================
-- 4. RPCs
-- =====================================================================

-- Equipe e totem: token da janela atual para o QR da turma.
create or replace function public.emitir_token_checkin(p_turma_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turma   public.turmas;
  v_periodo integer;
  v_janela  bigint;
begin
  select * into v_turma from public.turmas where id = p_turma_id and ativa;
  if not found
     or not public.tem_papel(v_turma.academia_id,
                             array['dono', 'admin', 'professor', 'recepcao', 'totem']) then
    raise exception 'Sem permissão para gerar o QR desta turma'
      using hint = 'sem_permissao';
  end if;

  if not public.academia_ativa(v_turma.academia_id) then
    raise exception 'Academia com acesso suspenso'
      using hint = 'academia_suspensa';
  end if;

  if public.checkin_data_aula(p_turma_id) is null then
    raise exception 'O check-in desta turma só abre perto do horário da aula'
      using hint = 'checkin_fora_do_horario';
  end if;

  insert into public.checkin_segredos (academia_id)
  values (v_turma.academia_id)
  on conflict (academia_id) do nothing;

  select a.checkin_token_segundos into v_periodo
  from public.academias a where a.id = v_turma.academia_id;
  v_janela := public.checkin_janela_atual(v_turma.academia_id);

  return jsonb_build_object(
    'token', public.checkin_token_da_janela(p_turma_id, v_janela),
    'expira_em', to_timestamp((v_janela + 1) * v_periodo),
    'periodo_segundos', v_periodo);
end
$$;

-- Equipe e totem: turmas com check-in aberto agora (o totem não lê turmas).
create or replace function public.totem_turmas_agora(p_academia_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tem_papel(p_academia_id,
                          array['dono', 'admin', 'professor', 'recepcao', 'totem']) then
    raise exception 'Sem permissão para ver as turmas desta academia'
      using hint = 'sem_permissao';
  end if;

  if not public.academia_ativa(p_academia_id) then
    raise exception 'Academia com acesso suspenso'
      using hint = 'academia_suspensa';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id,
             'nome', t.nome,
             'hora_inicio', x.hora_inicio,
             'hora_fim', x.hora_fim)
           order by x.dia, x.hora_inicio, t.nome)
    from public.checkin_aulas_abertas(p_academia_id) x
    join public.turmas t on t.id = x.turma_id
  ), '[]'::jsonb);
end
$$;

-- Dono e admin: troca o segredo. Todos os QR em exibição deixam de valer
-- na hora; o totem busca um token novo sozinho.
create or replace function public.rotacionar_segredo_checkin(p_academia_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pode_gerir(p_academia_id, array['dono', 'admin']) then
    raise exception 'Sem permissão para trocar o segredo do check-in'
      using hint = 'sem_permissao';
  end if;

  insert into public.checkin_segredos (academia_id)
  values (p_academia_id)
  on conflict (academia_id) do update
    set segredo = extensions.gen_random_bytes(32),
        rotacionado_em = now();
end
$$;

-- Check-in do aluno pelo QR. A versão sem token deixa de existir: mantê-la
-- deixaria o desvio aberto.
drop function public.fazer_checkin(uuid, uuid);

-- Ordem das verificações: token -> assinatura -> horário -> matrícula ->
-- inadimplência. Sem token válido, a função não revela nada sobre a turma.
-- Aceita o token da janela atual e o da anterior.
-- p_aluno_id só é necessário quando o login é de um responsável com mais de
-- um aluno na turma.
create or replace function public.fazer_checkin(
  p_turma_id uuid,
  p_token    text,
  p_aluno_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turma     public.turmas;
  v_acad      public.academias;
  v_janela    bigint;
  v_dia       date;
  v_hoje      date;
  v_alunos    uuid[];
  v_aluno_id  uuid;
  v_id        uuid;
begin
  select * into v_turma from public.turmas where id = p_turma_id and ativa;

  if found then
    v_janela := public.checkin_janela_atual(v_turma.academia_id);
  end if;

  if v_turma.id is null
     or p_token is null
     or coalesce(
          p_token = public.checkin_token_da_janela(p_turma_id, v_janela)
          or p_token = public.checkin_token_da_janela(p_turma_id, v_janela - 1),
          false) is not true then
    raise exception 'QR code inválido ou vencido. Leia o código de novo.'
      using hint = 'checkin_token_invalido';
  end if;

  if not public.academia_ativa(v_turma.academia_id) then
    raise exception 'Academia com acesso suspenso'
      using hint = 'academia_suspensa';
  end if;

  v_dia := public.checkin_data_aula(p_turma_id);
  if v_dia is null then
    raise exception 'O check-in desta turma só abre perto do horário da aula'
      using hint = 'checkin_fora_do_horario';
  end if;

  select * into v_acad from public.academias where id = v_turma.academia_id;
  v_hoje := public.hoje_academia(v_acad.id);

  -- alunos deste login com matrícula ativa nesta turma
  select array_agg(a.id) into v_alunos
  from public.alunos a
  join public.matriculas m on m.aluno_id = a.id
  join public.matricula_turmas mt on mt.matricula_id = m.id
  where a.academia_id = v_turma.academia_id
    and a.user_id = auth.uid()
    and a.status = 'ativo'
    and m.status = 'ativa'
    and (m.data_fim is null or m.data_fim >= v_dia)
    and mt.turma_id = p_turma_id
    and (p_aluno_id is null or a.id = p_aluno_id);

  if v_alunos is null then
    raise exception 'Nenhuma matrícula ativa nesta turma para este login'
      using hint = 'checkin_sem_matricula';
  elsif cardinality(v_alunos) > 1 then
    raise exception 'Mais de um aluno neste login: escolha quem está fazendo o check-in'
      using hint = 'checkin_multiplos_alunos';
  end if;
  v_aluno_id := v_alunos[1];

  if exists (
    select 1 from public.cobrancas c
    where c.aluno_id = v_aluno_id
      and c.status = 'pendente'
      and c.vencimento < v_hoje - v_acad.dias_tolerancia
  ) then
    raise exception 'Check-in bloqueado: mensalidade em atraso. Procure a recepção.'
      using hint = 'checkin_inadimplente';
  end if;

  insert into public.presencas (academia_id, aluno_id, turma_id, data, origem, registrado_por)
  values (v_turma.academia_id, v_aluno_id, p_turma_id, v_dia, 'qrcode', auth.uid())
  on conflict (aluno_id, turma_id, data) do nothing
  returning id into v_id;

  if v_id is null then  -- já tinha check-in nesta aula: devolve o existente
    select id into v_id from public.presencas
    where aluno_id = v_aluno_id and turma_id = p_turma_id and data = v_dia;
  end if;

  return v_id;
end
$$;

-- Matrícula online: mesma lógica da versão anterior, com o código no hint.
-- Slug inexistente, matrícula fechada e academia suspensa respondem o MESMO
-- código público (matricula_fechada): o visitante anônimo não fica sabendo
-- da situação da assinatura.
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
    raise exception 'Matrícula online indisponível. Procure a direção da escola.'
      using hint = 'matricula_fechada';
  end if;
  v_hoje := public.hoje_academia(v_acad.id);

  if coalesce(trim(p_dados ->> 'nome'), '') = '' then
    raise exception 'Informe o nome completo'
      using hint = 'dados_invalidos';
  end if;

  if coalesce((p_dados ->> 'aceite_termo')::boolean, false) is not true then
    raise exception 'É preciso aceitar o termo de responsabilidade'
      using hint = 'dados_invalidos';
  end if;

  if v_nasc is not null
     and v_nasc > v_hoje - interval '18 years'
     and (coalesce(trim(p_dados ->> 'responsavel_nome'), '') = ''
          or coalesce(p_dados ->> 'responsavel_cpf', '') = '') then
    raise exception 'Menores de idade precisam de responsável (nome e CPF)'
      using hint = 'menor_sem_responsavel';
  end if;

  if v_plano_id is not null and not exists (
    select 1 from public.planos
    where id = v_plano_id and academia_id = v_acad.id and ativo
  ) then
    raise exception 'Plano inválido'
      using hint = 'dados_invalidos';
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
    raise exception 'Já existe um cadastro com esse CPF nesta academia. Procure a recepção.'
      using hint = 'cpf_duplicado';
  when check_violation then
    raise exception 'Dados inválidos: confira CPF (11 dígitos) e nome'
      using hint = 'dados_invalidos';
end
$$;


-- =====================================================================
-- 5. PERMISSÕES DAS FUNÇÕES
-- =====================================================================

revoke execute on function
  public.checkin_janela_atual(uuid),
  public.checkin_token_da_janela(uuid, bigint),
  public.checkin_aulas_abertas(uuid),
  public.checkin_data_aula(uuid),
  public.emitir_token_checkin(uuid),
  public.totem_turmas_agora(uuid),
  public.rotacionar_segredo_checkin(uuid),
  public.fazer_checkin(uuid, text, uuid)
from public, anon, authenticated;

grant execute on function
  public.emitir_token_checkin(uuid),
  public.totem_turmas_agora(uuid),
  public.rotacionar_segredo_checkin(uuid),
  public.fazer_checkin(uuid, text, uuid)
to authenticated;
