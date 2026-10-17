-- Matrícula duplicada sob concorrência (issue #13, revisão do Codex no PR #45).
--
-- Duas transações de verdade, em conexões separadas (dblink), gravando para
-- o mesmo aluno ao mesmo tempo. A primeira fica aberta; a segunda precisa
-- esperar por ela e, depois do commit, ser recusada com matricula_duplicada.
--
-- As fixtures são gravadas e confirmadas por uma conexão própria (as outras
-- sessões não enxergariam a transação deste teste) e apagadas no fim.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(12);

-- Mesmo servidor, banco e porta da conexão deste teste. Pelo endereço de
-- rede, e não por localhost: no Supabase local o postgres não é
-- superusuário, e o dblink só aceita a conexão se a senha for de fato usada
-- (pelo loopback a autenticação do contêiner não pede senha). No Postgres
-- temporário de desenvolvimento o usuário é superusuário e a senha é
-- ignorada.
create function pg_temp.conexao() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=teste_concorrencia',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database())
$$;

select extensions.dblink_connect('prep', pg_temp.conexao());
select extensions.dblink_connect('s1', pg_temp.conexao());
select extensions.dblink_connect('s2', pg_temp.conexao());
-- Nenhuma espera pode travar o CI.
select extensions.dblink_exec('s1', 'set statement_timeout = ''20s''');
select extensions.dblink_exec('s2', 'set statement_timeout = ''20s''');

-- ---------------------------------------------------------------------
-- Fixtures confirmadas: academia, turma T e três alunos.
--   aluno 1: M1 ativa em T; M2 cancelada, sem turma, mesmo período.
--   aluno 2: M3 ativa em T, encerrada ontem; M4 ativa desde hoje, sem turma.
--   aluno 3: M5 ativa em T; M6 cancelada, sem turma.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  insert into public.academias (id, nome, slug, status) values
    ('f8000000-0000-4000-8000-00000000000a', 'Concorrência A', 'mat-concorrencia-a', 'ativa');
  insert into public.modalidades (id, academia_id, nome) values
    ('f8000000-0000-4000-8000-000000000201', 'f8000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu');
  insert into public.turmas (id, academia_id, modalidade_id, nome) values
    ('f8000000-0000-4000-8000-0000000003a1', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000201', 'Turma T');
  insert into public.alunos (id, academia_id, nome) values
    ('f8000000-0000-4000-8000-0000000001a1', 'f8000000-0000-4000-8000-00000000000a', 'Aluno 1'),
    ('f8000000-0000-4000-8000-0000000001a2', 'f8000000-0000-4000-8000-00000000000a', 'Aluno 2'),
    ('f8000000-0000-4000-8000-0000000001a3', 'f8000000-0000-4000-8000-00000000000a', 'Aluno 3');
  insert into public.matriculas (id, academia_id, aluno_id, status, data_inicio, data_fim) values
    ('f8000000-0000-4000-8000-000000000401', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-0000000001a1', 'ativa',     current_date, null),
    ('f8000000-0000-4000-8000-000000000402', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-0000000001a1', 'cancelada', current_date, null),
    ('f8000000-0000-4000-8000-000000000403', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-0000000001a2', 'ativa',     current_date - 60, current_date - 1),
    ('f8000000-0000-4000-8000-000000000404', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-0000000001a2', 'ativa',     current_date, null),
    ('f8000000-0000-4000-8000-000000000405', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-0000000001a3', 'ativa',     current_date, null),
    ('f8000000-0000-4000-8000-000000000406', 'f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-0000000001a3', 'cancelada', current_date, null);
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
    ('f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000401', 'f8000000-0000-4000-8000-0000000003a1'),
    ('f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000403', 'f8000000-0000-4000-8000-0000000003a1'),
    ('f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000405', 'f8000000-0000-4000-8000-0000000003a1');
$f$);

-- Espera até a sessão s2 estar bloqueada esperando outra (no máximo 10 s).
create function pg_temp.s2_esperando() returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    if exists (select 1 from pg_stat_activity
               where application_name = 'teste_concorrencia'
                 and wait_event_type = 'Lock'
                 and state = 'active') then
      return true;
    end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end
$$;

-- Resultado da consulta assíncrona de s2: 'ok' ou a mensagem de erro completa
-- (o dblink inclui as linhas DETAIL e HINT do erro remoto).
create function pg_temp.resultado_s2() returns text language plpgsql as $$
declare
  v_msg text;
begin
  perform * from extensions.dblink_get_result('s2', false) as r(x text);
  v_msg := extensions.dblink_error_message('s2');
  -- esvazia a fila de resultados da conexão
  perform * from extensions.dblink_get_result('s2', false) as r(x text);
  return case when v_msg is null or v_msg = 'OK' then 'ok' else v_msg end;
end
$$;

-- ---------------------------------------------------------------------
-- A. s1 reativa M2 (ainda sem turma) e não confirma; s2 liga M2 à turma T.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.matriculas set status = 'ativa' where id = 'f8000000-0000-4000-8000-000000000402'$$);
select is(extensions.dblink_send_query('s2', $$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values ('f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000402', 'f8000000-0000-4000-8000-0000000003a1')
$$), 1, 'A: s2 envia o vínculo da turma');
select ok(pg_temp.s2_esperando(), 'A: s2 espera a transação aberta de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +matricula_duplicada', 'A: depois do commit de s1, s2 é recusada (matricula_duplicada)');
select is((select count(*) from public.matricula_turmas where matricula_id = 'f8000000-0000-4000-8000-000000000402'),
  0::bigint, 'A: M2 não ficou na turma');

-- ---------------------------------------------------------------------
-- B. s1 reabre M3 (sem data de fim) e não confirma; s2 liga M4 à turma T.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.matriculas set data_fim = null where id = 'f8000000-0000-4000-8000-000000000403'$$);
select is(extensions.dblink_send_query('s2', $$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values ('f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000404', 'f8000000-0000-4000-8000-0000000003a1')
$$), 1, 'B: s2 envia o vínculo da turma');
select ok(pg_temp.s2_esperando(), 'B: s2 espera a transação aberta de s1 (trava do aluno)');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +matricula_duplicada', 'B: depois do commit de s1, s2 é recusada (matricula_duplicada)');
select is((select count(*) from public.matricula_turmas where matricula_id = 'f8000000-0000-4000-8000-000000000404'),
  0::bigint, 'B: M4 não ficou na turma');

-- ---------------------------------------------------------------------
-- C. Ordem inversa: s1 liga M6 (cancelada) à turma e não confirma; s2
--    reativa M6.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values ('f8000000-0000-4000-8000-00000000000a', 'f8000000-0000-4000-8000-000000000406', 'f8000000-0000-4000-8000-0000000003a1')
$$);
select is(extensions.dblink_send_query('s2', $$
  update public.matriculas set status = 'ativa' where id = 'f8000000-0000-4000-8000-000000000406'
$$), 1, 'C: s2 envia a reativação');
select ok(pg_temp.s2_esperando(), 'C: s2 espera a transação aberta de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +matricula_duplicada', 'C: depois do commit de s1, a reativação é recusada (matricula_duplicada)');
select is((select status from public.matriculas where id = 'f8000000-0000-4000-8000-000000000406'),
  'cancelada', 'C: M6 continua cancelada');

-- ---------------------------------------------------------------------
-- Limpeza das fixtures confirmadas.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  delete from public.matricula_turmas where academia_id = 'f8000000-0000-4000-8000-00000000000a';
  delete from public.matriculas      where academia_id = 'f8000000-0000-4000-8000-00000000000a';
  delete from public.alunos          where academia_id = 'f8000000-0000-4000-8000-00000000000a';
  delete from public.turmas          where academia_id = 'f8000000-0000-4000-8000-00000000000a';
  delete from public.modalidades     where academia_id = 'f8000000-0000-4000-8000-00000000000a';
  delete from public.academias       where id          = 'f8000000-0000-4000-8000-00000000000a';
$f$);
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
