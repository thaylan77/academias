-- Troca de modalidade x primeira presença, sob concorrência (revisão do
-- Codex no PR #56). Duas transações em conexões separadas (dblink); a que
-- chega depois espera a outra e decide com o que foi confirmado.
--
-- As fixtures são gravadas e confirmadas por uma conexão própria e apagadas
-- no fim.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(12);

-- Mesmo jeito de conectar de matricula/concorrencia.test.sql.
create function pg_temp.conexao() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=teste_concorrencia_turma',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database())
$$;

select extensions.dblink_connect('prep', pg_temp.conexao());
select extensions.dblink_connect('s1', pg_temp.conexao());
select extensions.dblink_connect('s2', pg_temp.conexao());
select extensions.dblink_exec('s1', 'set statement_timeout = ''20s''');
select extensions.dblink_exec('s2', 'set statement_timeout = ''20s''');

-- Academia com duas modalidades, três turmas em Jiu-Jitsu (sem presença), um
-- aluno e um dono (para a RPC).
select extensions.dblink_exec('prep', $f$
  insert into auth.users (id, email) values
    ('fb000000-0000-4000-8000-0000000000a1', 'dono@concorrencia-turma.test');
  insert into public.academias (id, nome, slug, status) values
    ('fb000000-0000-4000-8000-00000000000a', 'Concorrência Turma', 'concorrencia-turma', 'ativa');
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('fb000000-0000-4000-8000-00000000000a', 'fb000000-0000-4000-8000-0000000000a1', 'dono');
  insert into public.modalidades (id, academia_id, nome) values
    ('fb000000-0000-4000-8000-000000000201', 'fb000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
    ('fb000000-0000-4000-8000-000000000202', 'fb000000-0000-4000-8000-00000000000a', 'Judô');
  insert into public.turmas (id, academia_id, modalidade_id, nome) values
    ('fb000000-0000-4000-8000-0000000003a1', 'fb000000-0000-4000-8000-00000000000a', 'fb000000-0000-4000-8000-000000000201', 'Turma A'),
    ('fb000000-0000-4000-8000-0000000003a2', 'fb000000-0000-4000-8000-00000000000a', 'fb000000-0000-4000-8000-000000000201', 'Turma B'),
    ('fb000000-0000-4000-8000-0000000003a3', 'fb000000-0000-4000-8000-00000000000a', 'fb000000-0000-4000-8000-000000000201', 'Turma C');
  insert into public.alunos (id, academia_id, nome) values
    ('fb000000-0000-4000-8000-0000000001a1', 'fb000000-0000-4000-8000-00000000000a', 'Aluno');
$f$);

create function pg_temp.s2_esperando() returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
               where application_name = 'teste_concorrencia_turma'
                 and wait_event_type = 'Lock'
                 and state = 'active') then
      return true;
    end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end
$$;

create function pg_temp.resultado_s2() returns text language plpgsql as $$
declare
  v_msg text;
begin
  perform * from extensions.dblink_get_result('s2', false) as r(x text);
  v_msg := extensions.dblink_error_message('s2');
  perform * from extensions.dblink_get_result('s2', false) as r(x text);
  return case when v_msg is null or v_msg = 'OK' then 'ok' else v_msg end;
end
$$;

create function pg_temp.presenca(p_turma text) returns text language sql as $$
  select format($q$insert into public.presencas (academia_id, aluno_id, turma_id, data)
                  values ('fb000000-0000-4000-8000-00000000000a', 'fb000000-0000-4000-8000-0000000001a1', %L, current_date)$q$,
                p_turma)
$$;

-- ---------------------------------------------------------------------
-- A. s1 grava a primeira presença da Turma A e não confirma; s2 troca a
--    modalidade direto na tabela.
-- ---------------------------------------------------------------------
select ok(not exists (select 1 from pg_stat_activity
                      where application_name = 'teste_concorrencia_turma' and wait_event_type = 'Lock'),
  'A: antes do envio, nenhuma sessão do teste está esperando');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', pg_temp.presenca('fb000000-0000-4000-8000-0000000003a1'));
select is(extensions.dblink_send_query('s2', $$
  update public.turmas set modalidade_id = 'fb000000-0000-4000-8000-000000000202'
   where id = 'fb000000-0000-4000-8000-0000000003a1'
$$), 1, 'A: s2 envia a troca de modalidade');
select ok(pg_temp.s2_esperando(), 'A: s2 espera a presença aberta de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +turma_com_presencas', 'A: depois do commit, a troca é recusada (turma_com_presencas)');
select is((select modalidade_id from public.turmas where id = 'fb000000-0000-4000-8000-0000000003a1'),
  'fb000000-0000-4000-8000-000000000201'::uuid, 'A: a Turma A continua em Jiu-Jitsu');

-- ---------------------------------------------------------------------
-- B. Mesmo cenário pela salvar_turma, como o dono.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s2', 'set role authenticated');
select extensions.dblink_exec('s2', $$set request.jwt.claim.sub = 'fb000000-0000-4000-8000-0000000000a1'$$);
select extensions.dblink_exec('s2', $$set request.jwt.claims = '{"sub":"fb000000-0000-4000-8000-0000000000a1","role":"authenticated"}'$$);
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', pg_temp.presenca('fb000000-0000-4000-8000-0000000003a2'));
select is(extensions.dblink_send_query('s2', $$
  select public.salvar_turma('fb000000-0000-4000-8000-00000000000a',
    '{"nome":"Turma B","modalidade_id":"fb000000-0000-4000-8000-000000000202","professor_id":null,
      "publico":"adulto","capacidade":null,"ativa":true,"horarios":[]}'::jsonb,
    'fb000000-0000-4000-8000-0000000003a2')
$$), 1, 'B: s2 envia a troca pela salvar_turma');
select ok(pg_temp.s2_esperando(), 'B: s2 espera a presença aberta de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +turma_com_presencas', 'B: depois do commit, a salvar_turma é recusada (turma_com_presencas)');
select is((select modalidade_id from public.turmas where id = 'fb000000-0000-4000-8000-0000000003a2'),
  'fb000000-0000-4000-8000-000000000201'::uuid, 'B: a Turma B continua em Jiu-Jitsu');
select extensions.dblink_exec('s2', 'reset role');

-- ---------------------------------------------------------------------
-- C. Ordem inversa: s1 troca a modalidade da Turma C e não confirma; s2
--    grava a primeira presença. A presença espera e entra na modalidade nova.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$
  update public.turmas set modalidade_id = 'fb000000-0000-4000-8000-000000000202'
   where id = 'fb000000-0000-4000-8000-0000000003a3'
$$);
select is(extensions.dblink_send_query('s2', pg_temp.presenca('fb000000-0000-4000-8000-0000000003a3')), 1,
  'C: s2 envia a presença');
select ok(pg_temp.s2_esperando(), 'C: a presença espera a troca aberta de s1');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'C: depois do commit, a presença entra (na modalidade nova)');

-- ---------------------------------------------------------------------
-- Limpeza das fixtures confirmadas (presenças saem com as turmas).
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  delete from public.presencas        where academia_id = 'fb000000-0000-4000-8000-00000000000a';
  delete from public.turmas           where academia_id = 'fb000000-0000-4000-8000-00000000000a';
  delete from public.alunos           where academia_id = 'fb000000-0000-4000-8000-00000000000a';
  delete from public.modalidades      where academia_id = 'fb000000-0000-4000-8000-00000000000a';
  delete from public.membros_academia where academia_id = 'fb000000-0000-4000-8000-00000000000a';
  delete from public.academias        where id          = 'fb000000-0000-4000-8000-00000000000a';
  delete from auth.users              where id          = 'fb000000-0000-4000-8000-0000000000a1';
$f$);
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
