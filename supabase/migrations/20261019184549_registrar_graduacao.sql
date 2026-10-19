-- Painel: graduações (issue #30).
--
-- registrar_graduacao grava a graduação conferindo o que a política de
-- insert não confere: data no dia da academia (o default da coluna é
-- current_date, em UTC) e nunca no futuro, grau dentro do máximo da faixa,
-- aluno ativo, faixa e professor da própria academia.
--
-- Mesma permissão da política graduacoes_insert: dono, admin e professor,
-- com a assinatura em dia (pode_gerir). Nenhuma política muda.
--
-- A graduação nova vira a "atual" em vw_graduacao_atual (a mais recente por
-- data, faixa e grau) e zera o progresso em vw_progresso_graduacao, que
-- conta presenças e meses desde graduado_em.
--
-- p_dados:
--   { "aluno_id": uuid, "faixa_id": uuid, "grau": 0..max_graus da faixa,
--     "data": "AAAA-MM-DD" | null (padrão: hoje na academia),
--     "professor_id": uuid | null, "observacao": texto até 500 | null }
create or replace function public.registrar_graduacao(p_academia_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_uuid      constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_hoje      date;
  v_aluno     uuid;
  v_faixa     public.faixas;
  v_grau      smallint;
  v_data      date;
  v_professor uuid;
  v_obs       text;
  v_id        uuid;
begin
  if p_academia_id is null
     or not public.pode_gerir(p_academia_id, array['dono', 'admin', 'professor']) then
    raise exception 'Sem permissão para registrar graduações nesta academia'
      using hint = 'sem_permissao';
  end if;
  v_hoje := public.hoje_academia(p_academia_id);

  if p_dados is null or jsonb_typeof(p_dados) <> 'object'
     or jsonb_typeof(p_dados -> 'aluno_id') is distinct from 'string'
     or (p_dados ->> 'aluno_id') !~* c_uuid
     or jsonb_typeof(p_dados -> 'faixa_id') is distinct from 'string'
     or (p_dados ->> 'faixa_id') !~* c_uuid
     or jsonb_typeof(p_dados -> 'grau') is distinct from 'number'
     or (p_dados ->> 'grau') !~ '^[0-9]{1,2}$'
     or coalesce(jsonb_typeof(p_dados -> 'data'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'data') = 'string' and (p_dados ->> 'data') !~ '^\d{4}-\d{2}-\d{2}$')
     or coalesce(jsonb_typeof(p_dados -> 'professor_id'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'professor_id') = 'string' and (p_dados ->> 'professor_id') !~* c_uuid)
     or coalesce(jsonb_typeof(p_dados -> 'observacao'), 'null') not in ('null', 'string')
     or length(coalesce(p_dados ->> 'observacao', '')) > 500
  then
    raise exception 'Dados da graduação inválidos' using hint = 'dados_invalidos';
  end if;

  begin
    v_data := coalesce((p_dados ->> 'data')::date, v_hoje);
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dados da graduação inválidos' using hint = 'dados_invalidos';
  end;
  if v_data > v_hoje or v_data < date '1900-01-01' then
    raise exception 'A data da graduação não pode ser no futuro' using hint = 'dados_invalidos';
  end if;

  v_aluno     := (p_dados ->> 'aluno_id')::uuid;
  v_grau      := (p_dados ->> 'grau')::smallint;
  v_professor := (p_dados ->> 'professor_id')::uuid;
  v_obs       := nullif(trim(p_dados ->> 'observacao'), '');

  select * into v_faixa from public.faixas
   where academia_id = p_academia_id and id = (p_dados ->> 'faixa_id')::uuid;

  -- Aluno ativo (não anonimizado), faixa e professor desta academia.
  if v_faixa.id is null
     or not exists (select 1 from public.alunos
                     where academia_id = p_academia_id and id = v_aluno
                       and status = 'ativo' and anonimizado_em is null)
     or (v_professor is not null and not exists (
           select 1 from public.professores
            where academia_id = p_academia_id and id = v_professor))
  then
    raise exception 'Aluno, faixa ou professor não encontrado nesta academia (ou aluno não ativo)'
      using hint = 'dados_invalidos';
  end if;

  if v_grau > v_faixa.max_graus then
    raise exception 'A faixa % vai até o grau %', v_faixa.nome, v_faixa.max_graus
      using hint = 'grau_invalido';
  end if;

  -- Clique duplo ou nova tentativa não repete a graduação. A trava por aluno
  -- serializa duas chamadas simultâneas para o mesmo aluno.
  perform pg_advisory_xact_lock(hashtextextended('graduacao:' || v_aluno::text, 0));
  if exists (select 1 from public.graduacoes
              where academia_id = p_academia_id and aluno_id = v_aluno
                and faixa_id = v_faixa.id and grau = v_grau and data = v_data) then
    raise exception 'Esta graduação já foi registrada para o aluno nesta data'
      using hint = 'graduacao_repetida';
  end if;

  insert into public.graduacoes (academia_id, aluno_id, faixa_id, grau, data, professor_id, observacao)
  values (p_academia_id, v_aluno, v_faixa.id, v_grau, v_data, v_professor, v_obs)
  returning id into v_id;

  return v_id;
end
$$;

revoke execute on function public.registrar_graduacao(uuid, jsonb) from public, anon;
grant execute on function public.registrar_graduacao(uuid, jsonb) to authenticated;

-- As regras de dado valem também para a gravação direta na tabela (a
-- política graduacoes_insert continua permitindo; só a RPC conferia):
-- grau dentro do máximo da faixa e data nunca depois de hoje na academia.
-- security definer: lê faixas e academias sem depender do RLS de quem grava.
create or replace function public.graduacoes_valida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max smallint;
begin
  select max_graus into v_max from public.faixas
   where academia_id = new.academia_id and id = new.faixa_id;
  if v_max is not null and new.grau > v_max then
    raise exception 'O grau passa do máximo da faixa' using hint = 'grau_invalido';
  end if;
  if new.data > public.hoje_academia(new.academia_id) then
    raise exception 'A data da graduação não pode ser no futuro' using hint = 'dados_invalidos';
  end if;
  return new;
end
$$;

create trigger graduacoes_valida
  before insert or update of grau, faixa_id, data on public.graduacoes
  for each row execute function public.graduacoes_valida();

revoke execute on function public.graduacoes_valida() from public, anon, authenticated;
