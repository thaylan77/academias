-- salvar_turma (issue #27): turma e horários numa transação, só dono e admin
-- com a assinatura em dia, sempre dentro da própria academia.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function public.__erro_de(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return jsonb_build_object('hint', 'sem erro');
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return jsonb_build_object('hint', coalesce(nullif(v_hint, ''), 'sem hint'),
                            'mensagem', sqlerrm, 'sqlstate', sqlstate);
end
$$;
grant execute on function public.__erro_de(text) to authenticated;

create function public.__hint_de(p_sql text)
returns text
language sql
as $$ select public.__erro_de(p_sql) ->> 'hint' $$;
grant execute on function public.__hint_de(text) to authenticated;

-- Monta o p_dados com valores padrão (modalidade de A, horário de segunda).
create function public.__turma(p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'nome', 'Jiu-Jitsu Adulto',
    'modalidade_id', 'fa000000-0000-4000-8000-0000000002a1',
    'professor_id', 'fa000000-0000-4000-8000-0000000003a1',
    'publico', 'adulto',
    'capacidade', 20,
    'ativa', true,
    'horarios', jsonb_build_array(
      jsonb_build_object('dia_semana', 1, 'hora_inicio', '19:00', 'hora_fim', '20:30'),
      jsonb_build_object('dia_semana', 3, 'hora_inicio', '19:00', 'hora_fim', '20:30'))
  ) || p_extra
$$;
grant execute on function public.__turma(jsonb) to authenticated;

insert into auth.users (id, email) values
  ('fa000000-0000-4000-8000-0000000000a1', 'dono-a@turma.test'),
  ('fa000000-0000-4000-8000-0000000000a2', 'admin-a@turma.test'),
  ('fa000000-0000-4000-8000-0000000000a3', 'professor-a@turma.test'),
  ('fa000000-0000-4000-8000-0000000000a4', 'recepcao-a@turma.test'),
  ('fa000000-0000-4000-8000-0000000000b1', 'dono-b@turma.test');

insert into public.academias (id, nome, slug, status) values
  ('fa000000-0000-4000-8000-00000000000a', 'Turmas A', 'turmas-a', 'ativa'),
  ('fa000000-0000-4000-8000-00000000000b', 'Turmas B', 'turmas-b', 'ativa'),
  ('fa000000-0000-4000-8000-00000000000c', 'Turmas C (suspensa)', 'turmas-c', 'suspensa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fa000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-0000000000a1', 'dono'),
  ('fa000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-0000000000a2', 'admin'),
  ('fa000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-0000000000a3', 'professor'),
  ('fa000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-0000000000a4', 'recepcao'),
  ('fa000000-0000-4000-8000-00000000000b', 'fa000000-0000-4000-8000-0000000000b1', 'dono'),
  ('fa000000-0000-4000-8000-00000000000c', 'fa000000-0000-4000-8000-0000000000a1', 'dono');

insert into public.modalidades (id, academia_id, nome) values
  ('fa000000-0000-4000-8000-0000000002a1', 'fa000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
  ('fa000000-0000-4000-8000-0000000002b1', 'fa000000-0000-4000-8000-00000000000b', 'Jiu-Jitsu'),
  ('fa000000-0000-4000-8000-0000000002c1', 'fa000000-0000-4000-8000-00000000000c', 'Jiu-Jitsu');

insert into public.professores (id, academia_id, nome) values
  ('fa000000-0000-4000-8000-0000000003a1', 'fa000000-0000-4000-8000-00000000000a', 'Mestre A'),
  ('fa000000-0000-4000-8000-0000000003b1', 'fa000000-0000-4000-8000-00000000000b', 'Mestre B');

insert into public.alunos (id, academia_id, nome) values
  ('fa000000-0000-4000-8000-0000000001a1', 'fa000000-0000-4000-8000-00000000000a', 'Aluno A');

select ok(not has_function_privilege('anon', 'public.salvar_turma(uuid, uuid, jsonb)', 'execute'),
          'anon não executa salvar_turma');

-- ---------------------------------------------------------------------
-- Dono de A
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"fa000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

create temp table t_ids (nome text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

insert into t_ids values ('turma',
  public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma()));

select is((select count(*)::int from public.turmas where id = (select id from t_ids where nome = 'turma')
             and academia_id = 'fa000000-0000-4000-8000-00000000000a'), 1,
          'dono cria a turma na própria academia');
select is((select count(*)::int from public.turma_horarios where turma_id = (select id from t_ids where nome = 'turma')), 2,
          'com os dois horários');
select is((select hora_inicio from public.turma_horarios
            where turma_id = (select id from t_ids where nome = 'turma') and dia_semana = 1), '19:00'::time,
          'horário gravado como hora local (sem fuso)');

-- Edição troca os horários e os campos.
select is(public.__hint_de(format($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', %L, public.__turma(%L))$$,
            (select id from t_ids where nome = 'turma'),
            '{"nome":"Jiu-Jitsu Noite","capacidade":null,"horarios":[{"dia_semana":5,"hora_inicio":"20:00","hora_fim":"21:00"}]}')),
          'sem erro', 'edição aceita');
select is((select nome || '|' || coalesce(capacidade::text, 'null') from public.turmas
            where id = (select id from t_ids where nome = 'turma')), 'Jiu-Jitsu Noite|null',
          'nome e capacidade atualizados');
select is((select string_agg(dia_semana::text, ',') from public.turma_horarios
            where turma_id = (select id from t_ids where nome = 'turma')), '5',
          'horários trocados (só sexta)');

-- Erros com código; nenhum deles mexe nos horários já gravados.
select is(public.__hint_de(format($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', %L, public.__turma(%L))$$,
            (select id from t_ids where nome = 'turma'),
            '{"horarios":[{"dia_semana":2,"hora_inicio":"10:00","hora_fim":"11:00"},{"dia_semana":2,"hora_inicio":"10:30","hora_fim":"12:00"}]}')),
          'horario_sobreposto', 'horários sobrepostos no mesmo dia: horario_sobreposto');
select is((select string_agg(dia_semana::text, ',') from public.turma_horarios
            where turma_id = (select id from t_ids where nome = 'turma')), '5',
          'a gravação recusada não apagou os horários antigos (tudo numa transação)');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null,
            public.__turma('{"horarios":[{"dia_semana":2,"hora_inicio":"10:00","hora_fim":"11:00"},{"dia_semana":2,"hora_inicio":"11:00","hora_fim":"12:00"}]}'))$$),
          'sem erro', 'horários encostados (um termina quando o outro começa) valem');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null,
            public.__turma('{"horarios":[{"dia_semana":2,"hora_inicio":"11:00","hora_fim":"10:00"}]}'))$$),
          'horario_invalido', 'fim antes do início: horario_invalido');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null,
            public.__turma('{"horarios":[{"dia_semana":7,"hora_inicio":"10:00","hora_fim":"11:00"}]}'))$$),
          'horario_invalido', 'dia da semana 7: horario_invalido');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null,
            public.__turma('{"horarios":[{"dia_semana":1,"hora_inicio":"25:00","hora_fim":"26:00"}]}'))$$),
          'horario_invalido', 'hora fora do relógio: horario_invalido');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma('{"nome":" "}'))$$),
          'dados_invalidos', 'nome vazio: dados_invalidos');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma('{"capacidade":0}'))$$),
          'dados_invalidos', 'capacidade 0: dados_invalidos');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma('{"publico":"x"}'))$$),
          'dados_invalidos', 'público fora da lista: dados_invalidos');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma('{"horarios":{}}'))$$),
          'dados_invalidos', 'horarios que não é lista: dados_invalidos');

-- Turma sem horário é aceita (a tela avisa que não haverá check-in por QR).
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma('{"horarios":[]}'))$$),
          'sem erro', 'turma sem horário é aceita');

-- Academia suspensa: o mesmo dono não grava lá.
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000c', null,
            public.__turma('{"modalidade_id":"fa000000-0000-4000-8000-0000000002c1","professor_id":null}'))$$),
          'sem_permissao', 'academia suspensa: sem_permissao');

reset role;

-- Desativar não apaga presença.
insert into public.presencas (academia_id, aluno_id, turma_id, data)
values ('fa000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-0000000001a1',
        (select id from t_ids where nome = 'turma'), current_date);

set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"fa000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is(public.__hint_de(format($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', %L, public.__turma('{"ativa":false}'))$$,
            (select id from t_ids where nome = 'turma'))),
          'sem erro', 'admin desativa a turma');
reset role;
select is((select count(*)::int from public.presencas where turma_id = (select id from t_ids where nome = 'turma')), 1,
          'desativar a turma mantém o histórico de presença');
select is((select ativa from public.turmas where id = (select id from t_ids where nome = 'turma')), false,
          'turma ficou inativa');

-- ---------------------------------------------------------------------
-- Professor e recepção de A não gravam
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims = '{"sub":"fa000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma())$$),
          'sem_permissao', 'professor: sem_permissao');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-0000000000a4';
set local request.jwt.claims = '{"sub":"fa000000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma())$$),
          'sem_permissao', 'recepção: sem_permissao');
reset role;

-- ---------------------------------------------------------------------
-- Dono de B não alcança A
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fa000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims = '{"sub":"fa000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000a', null, public.__turma())$$),
          'sem_permissao', 'dono de B gravando em A: sem_permissao');
select is(public.__hint_de($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000b', null, public.__turma())$$),
          'dados_invalidos', 'dono de B com a modalidade e o professor de A: dados_invalidos');
select is(public.__hint_de(format($$select public.salvar_turma('fa000000-0000-4000-8000-00000000000b', %L,
            public.__turma('{"modalidade_id":"fa000000-0000-4000-8000-0000000002b1","professor_id":"fa000000-0000-4000-8000-0000000003b1"}'))$$,
            (select id from t_ids where nome = 'turma'))),
          'turma_nao_encontrada', 'dono de B editando turma de A pela própria academia: turma_nao_encontrada');
reset role;

select * from finish();
rollback;
