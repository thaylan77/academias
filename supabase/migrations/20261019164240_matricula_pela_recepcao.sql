-- Matrícula pela recepção (issue #14; docs/specs/financeiro-gateway-webhook.md,
-- seção 9).
--
-- criar_matricula: matrícula e turmas numa transação, com cobrar_a_partir
-- opcional (sem ele, o gatilho matriculas_cobrar_a_partir põe o padrão).
-- aprovar_matricula: aprova a matrícula pendente que veio de
-- matricula_online.
--
-- Mesma permissão das políticas de matrículas: dono, admin e recepção, com a
-- assinatura em dia (pode_gerir). Nenhuma política muda. Nenhuma das duas
-- gera cobrança: isso continua em gerar_cobrancas_matricula.
--
-- Matrícula duplicada na mesma turma continua com os gatilhos da #13
-- (hint matricula_duplicada); aqui o erro só atravessa.

-- p_dados:
--   { "aluno_id": uuid, "plano_id": uuid | null, "turma_ids": [uuid, ...],
--     "data_inicio": "AAAA-MM-DD" | null (padrão: hoje na academia),
--     "data_fim": "AAAA-MM-DD" | null, "dia_vencimento": 1..28 | null,
--     "valor": número >= 0 | null (null: valor do plano),
--     "cobrar_a_partir": "AAAA-MM-01" | null }
--
-- Com plano, dia_vencimento é obrigatório: gerar_cobrancas pula matrícula
-- sem ele, e a matrícula ficaria ativa sem nunca ser cobrada. Sem plano, a
-- matrícula não é cobrada (gerar_cobrancas só cobra quem tem plano): é o
-- caso de bolsista ou isento.
create or replace function public.criar_matricula(p_academia_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_uuid       constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_data       constant text := '^\d{4}-\d{2}-\d{2}$';
  v_hoje       date;
  v_aluno      uuid;
  v_plano      uuid;
  v_turmas     uuid[];
  v_inicio     date;
  v_fim        date;
  v_dia        smallint;
  v_valor      numeric(10, 2);
  v_cobrar     date;
  v_id         uuid;
  v_t          jsonb;
begin
  if p_academia_id is null
     or not public.pode_gerir(p_academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Sem permissão para criar matrículas nesta academia'
      using hint = 'sem_permissao';
  end if;
  v_hoje := public.hoje_academia(p_academia_id);

  -- Formato da entrada.
  if p_dados is null or jsonb_typeof(p_dados) <> 'object'
     or jsonb_typeof(p_dados -> 'aluno_id') is distinct from 'string'
     or (p_dados ->> 'aluno_id') !~* c_uuid
     or coalesce(jsonb_typeof(p_dados -> 'plano_id'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'plano_id') = 'string' and (p_dados ->> 'plano_id') !~* c_uuid)
     or jsonb_typeof(p_dados -> 'turma_ids') is distinct from 'array'
     or coalesce(jsonb_typeof(p_dados -> 'data_inicio'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'data_inicio') = 'string' and (p_dados ->> 'data_inicio') !~ c_data)
     or coalesce(jsonb_typeof(p_dados -> 'data_fim'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'data_fim') = 'string' and (p_dados ->> 'data_fim') !~ c_data)
     or coalesce(jsonb_typeof(p_dados -> 'dia_vencimento'), 'null') not in ('null', 'number')
     or (jsonb_typeof(p_dados -> 'dia_vencimento') = 'number'
         and ((p_dados ->> 'dia_vencimento') !~ '^[0-9]{1,2}$'
              or (p_dados ->> 'dia_vencimento')::int not between 1 and 28))
     or coalesce(jsonb_typeof(p_dados -> 'valor'), 'null') not in ('null', 'number')
     or (jsonb_typeof(p_dados -> 'valor') = 'number'
         and ((p_dados ->> 'valor') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'))
     or coalesce(jsonb_typeof(p_dados -> 'cobrar_a_partir'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'cobrar_a_partir') = 'string' and (p_dados ->> 'cobrar_a_partir') !~ c_data)
  then
    raise exception 'Dados da matrícula inválidos' using hint = 'dados_invalidos';
  end if;

  for v_t in select * from jsonb_array_elements(p_dados -> 'turma_ids') loop
    if jsonb_typeof(v_t) <> 'string' or (v_t #>> '{}') !~* c_uuid then
      raise exception 'Dados da matrícula inválidos' using hint = 'dados_invalidos';
    end if;
  end loop;

  -- Datas que não existem no calendário (31/02) caem aqui.
  begin
    v_inicio := coalesce((p_dados ->> 'data_inicio')::date, v_hoje);
    v_fim    := (p_dados ->> 'data_fim')::date;
    v_cobrar := (p_dados ->> 'cobrar_a_partir')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dados da matrícula inválidos' using hint = 'dados_invalidos';
  end;

  v_aluno  := (p_dados ->> 'aluno_id')::uuid;
  v_plano  := (p_dados ->> 'plano_id')::uuid;
  v_dia    := (p_dados ->> 'dia_vencimento')::smallint;
  v_valor  := (p_dados ->> 'valor')::numeric;
  select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}')
    into v_turmas
    from jsonb_array_elements(p_dados -> 'turma_ids') e;

  if v_plano is not null and v_dia is null then
    raise exception 'Matrícula com plano precisa do dia de vencimento' using hint = 'dados_invalidos';
  end if;

  if v_fim is not null and v_fim < v_inicio then
    raise exception 'A data de fim não pode ser antes do início' using hint = 'dados_invalidos';
  end if;

  -- Mês inicial de cobrança: dia 1 e não antes do mês do cadastro (hoje). O
  -- gatilho confere de novo; aqui o erro sai com código.
  if v_cobrar is not null
     and (extract(day from v_cobrar) <> 1 or v_cobrar < date_trunc('month', v_hoje::timestamp)::date) then
    raise exception 'O mês inicial de cobrança é o dia 1 de um mês, a partir do mês atual'
      using hint = 'cobrar_a_partir_invalido';
  end if;

  -- Aluno (não anonimizado), plano ativo e turmas ativas, todos desta academia.
  if not exists (select 1 from public.alunos
                  where academia_id = p_academia_id and id = v_aluno and anonimizado_em is null)
     or (v_plano is not null and not exists (
           select 1 from public.planos
            where academia_id = p_academia_id and id = v_plano and ativo))
     or (select count(*) from public.turmas
          where academia_id = p_academia_id and id = any (v_turmas) and ativa) <> cardinality(v_turmas)
  then
    raise exception 'Aluno, plano ou turma não encontrado nesta academia (ou inativo)'
      using hint = 'dados_invalidos';
  end if;

  insert into public.matriculas
    (academia_id, aluno_id, plano_id, status, origem, data_inicio, data_fim, dia_vencimento, valor, cobrar_a_partir)
  values
    (p_academia_id, v_aluno, v_plano, 'ativa', 'recepcao', v_inicio, v_fim, v_dia, v_valor, v_cobrar)
  returning id into v_id;

  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  select p_academia_id, v_id, t from unnest(v_turmas) t;

  -- Matrícula ativa é aluno ativo (sem isso, gerar_cobrancas pula o aluno).
  update public.alunos
     set status = 'ativo'
   where academia_id = p_academia_id and id = v_aluno and status in ('pendente', 'inativo')
     and anonimizado_em is null;

  return v_id;
end
$$;

-- Aprova a matrícula pendente (da matrícula online). O aluno que veio junto
-- (pendente, ou inativo) passa a ativo.
--
-- A cobrança começa na aprovação, não no pedido: se a aprovação vem depois,
-- data_inicio vira hoje e cobrar_a_partir vira o mês atual. Sem isso, a
-- primeira cobrança seria calculada a partir do mês do pedido (vencimento
-- que pode nascer vencido; período trimestral, semestral ou anual contado
-- do mês errado). A matrícula online nasce sem dia de vencimento:
-- p_dia_vencimento (1 a 28) o define na aprovação; sem ele, a matrícula com
-- plano fica sem ser cobrada até alguém informar o dia.
create or replace function public.aprovar_matricula(p_matricula_id uuid, p_dia_vencimento smallint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_mat      public.matriculas;
  v_hoje     date;
begin
  -- Permissão antes da trava: quem não gere a academia não espera nem trava
  -- a linha. Inexistente ou de outra academia: a mesma resposta.
  select academia_id into v_academia from public.matriculas where id = p_matricula_id;
  if v_academia is null
     or not public.pode_gerir(v_academia, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão'
      using hint = 'sem_permissao';
  end if;

  if p_dia_vencimento is not null and p_dia_vencimento not between 1 and 28 then
    raise exception 'O dia de vencimento vai de 1 a 28' using hint = 'dados_invalidos';
  end if;

  select * into v_mat from public.matriculas where id = p_matricula_id for update;
  if v_mat.status <> 'pendente' then
    raise exception 'Só matrícula pendente pode ser aprovada'
      using hint = 'matricula_nao_pendente';
  end if;

  v_hoje := public.hoje_academia(v_academia);
  update public.matriculas
     set status          = 'ativa',
         data_inicio     = greatest(data_inicio, v_hoje),
         cobrar_a_partir = greatest(cobrar_a_partir, date_trunc('month', v_hoje::timestamp)::date),
         dia_vencimento  = coalesce(p_dia_vencimento, dia_vencimento)
   where id = v_mat.id;

  update public.alunos
     set status = 'ativo'
   where academia_id = v_academia and id = v_mat.aluno_id and status in ('pendente', 'inativo')
     and anonimizado_em is null;
end
$$;

revoke execute on function public.criar_matricula(uuid, jsonb), public.aprovar_matricula(uuid, smallint) from public, anon;
grant execute on function public.criar_matricula(uuid, jsonb), public.aprovar_matricula(uuid, smallint) to authenticated;
