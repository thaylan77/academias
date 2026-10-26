-- Matrícula pela recepção contra anonimização, sob concorrência (revisão do
-- Codex no PR #57).
--
-- anonimizar_aluno trava o aluno e só então cancela as matrículas dele.
-- criar_matricula e aprovar_matricula travam o aluno na mesma ordem: com a
-- anonimização aberta, elas esperam e, depois do commit, são recusadas; na
-- ordem inversa, a anonimização espera a aprovação e cancela a matrícula
-- recém-aprovada, sem deadlock.
--
-- Duas transações de verdade (dblink). As fixtures são gravadas e
-- confirmadas por uma conexão própria e apagadas no fim.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(13);

-- Mesma conexão de concorrencia.test.sql (ver o comentário lá).
create function pg_temp.conexao() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=teste_concorrencia',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database())
$$;

select extensions.dblink_connect('prep', pg_temp.conexao());
select extensions.dblink_connect('s1', pg_temp.conexao());
select extensions.dblink_connect('s2', pg_temp.conexao());
-- As duas sessões agem como o dono da academia. Nenhuma espera pode travar o CI.
select extensions.dblink_exec(c, $s$
  set statement_timeout = '20s';
  set role authenticated;
  set request.jwt.claim.sub = 'f9100000-0000-4000-8000-0000000000a1';
  set request.jwt.claims = '{"sub":"f9100000-0000-4000-8000-0000000000a1","role":"authenticated"}';
$s$) from unnest(array['s1', 's2']) c;

-- ---------------------------------------------------------------------
-- Fixtures confirmadas: academia ativa, dono, turma T e três alunos.
--   aluno 1: sem matrícula (criar_matricula contra anonimizar)
--   aluno 2: M2 pendente (aprovar contra anonimizar)
--   aluno 3: M3 pendente (anonimizar contra aprovar, ordem inversa)
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  insert into auth.users (id, email) values
    ('f9100000-0000-4000-8000-0000000000a1', 'dono@anon-concorrencia.test');
  insert into public.academias (id, nome, slug, status) values
    ('f9100000-0000-4000-8000-00000000000a', 'Anonimizar concorrência', 'anon-concorrencia-a', 'ativa');
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('f9100000-0000-4000-8000-00000000000a', 'f9100000-0000-4000-8000-0000000000a1', 'dono');
  insert into public.modalidades (id, academia_id, nome) values
    ('f9100000-0000-4000-8000-000000000201', 'f9100000-0000-4000-8000-00000000000a', 'Jiu-Jitsu');
  insert into public.turmas (id, academia_id, modalidade_id, nome) values
    ('f9100000-0000-4000-8000-0000000003a1', 'f9100000-0000-4000-8000-00000000000a', 'f9100000-0000-4000-8000-000000000201', 'Turma T');
  insert into public.alunos (id, academia_id, nome, status) values
    ('f9100000-0000-4000-8000-0000000001a1', 'f9100000-0000-4000-8000-00000000000a', 'Aluno 1', 'ativo'),
    ('f9100000-0000-4000-8000-0000000001a2', 'f9100000-0000-4000-8000-00000000000a', 'Aluno 2', 'pendente'),
    ('f9100000-0000-4000-8000-0000000001a3', 'f9100000-0000-4000-8000-00000000000a', 'Aluno 3', 'pendente');
  insert into public.matriculas (id, academia_id, aluno_id, status, origem, data_inicio) values
    ('f9100000-0000-4000-8000-000000000402', 'f9100000-0000-4000-8000-00000000000a', 'f9100000-0000-4000-8000-0000000001a2', 'pendente', 'online',
     public.hoje_academia('f9100000-0000-4000-8000-00000000000a')),
    ('f9100000-0000-4000-8000-000000000403', 'f9100000-0000-4000-8000-00000000000a', 'f9100000-0000-4000-8000-0000000001a3', 'pendente', 'online',
     public.hoje_academia('f9100000-0000-4000-8000-00000000000a'));
$f$);

-- Espera até uma sessão do teste estar bloqueada numa trava (no máximo 10 s).
create function pg_temp.alguem_esperando() returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
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

-- Resultado da consulta assíncrona de s2: 'ok' ou a mensagem de erro
-- completa (com as linhas DETAIL e HINT do erro remoto).
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

select ok(not exists (select 1 from pg_stat_activity
                      where application_name = 'teste_concorrencia' and wait_event_type = 'Lock'),
  'antes dos envios, nenhuma sessão do teste está esperando');

-- ---------------------------------------------------------------------
-- A. s1 anonimiza o aluno 1 e não confirma; s2 cria matrícula para ele.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$do $d$ begin perform public.anonimizar_aluno('f9100000-0000-4000-8000-0000000001a1'); end $d$ $$);
select is(extensions.dblink_send_query('s2', $$
  select public.criar_matricula('f9100000-0000-4000-8000-00000000000a',
    '{"aluno_id":"f9100000-0000-4000-8000-0000000001a1","plano_id":null,"turma_ids":["f9100000-0000-4000-8000-0000000003a1"]}')
$$), 1, 'A: s2 envia criar_matricula');
select ok(pg_temp.alguem_esperando(), 'A: criar_matricula espera a anonimização aberta (trava do aluno)');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +dados_invalidos', 'A: depois do commit, criar_matricula é recusada (aluno anonimizado)');
select is((select count(*)::int from public.matriculas where aluno_id = 'f9100000-0000-4000-8000-0000000001a1'), 0,
  'A: nenhuma matrícula nasceu para o aluno anonimizado');

-- ---------------------------------------------------------------------
-- B. s1 anonimiza o aluno 2 e não confirma; s2 aprova M2.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$do $d$ begin perform public.anonimizar_aluno('f9100000-0000-4000-8000-0000000001a2'); end $d$ $$);
select is(extensions.dblink_send_query('s2', $$
  select public.aprovar_matricula('f9100000-0000-4000-8000-000000000402')
$$), 1, 'B: s2 envia aprovar_matricula');
select ok(pg_temp.alguem_esperando(), 'B: aprovar_matricula espera a anonimização aberta');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +matricula_nao_pendente', 'B: depois do commit, a aprovação é recusada (a matrícula foi cancelada)');
select is((select status from public.matriculas where id = 'f9100000-0000-4000-8000-000000000402'), 'cancelada',
  'B: M2 continua cancelada');

-- ---------------------------------------------------------------------
-- C. Ordem inversa: s1 aprova M3 e não confirma; s2 anonimiza o aluno 3.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$do $d$ begin perform public.aprovar_matricula('f9100000-0000-4000-8000-000000000403'); end $d$ $$);
select is(extensions.dblink_send_query('s2', $$
  select public.anonimizar_aluno('f9100000-0000-4000-8000-0000000001a3')
$$), 1, 'C: s2 envia anonimizar_aluno');
select ok(pg_temp.alguem_esperando(), 'C: a anonimização espera a aprovação aberta');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'C: depois do commit, a anonimização termina (sem deadlock)');
select is((select status from public.matriculas where id = 'f9100000-0000-4000-8000-000000000403')
          || '|' || (select (anonimizado_em is not null)::text from public.alunos where id = 'f9100000-0000-4000-8000-0000000001a3'),
  'cancelada|true', 'C: a matrícula recém-aprovada foi cancelada pela anonimização');

-- ---------------------------------------------------------------------
-- Limpeza das fixtures confirmadas.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  delete from public.matricula_turmas where academia_id = 'f9100000-0000-4000-8000-00000000000a';
  delete from public.matriculas       where academia_id = 'f9100000-0000-4000-8000-00000000000a';
  delete from public.alunos           where academia_id = 'f9100000-0000-4000-8000-00000000000a';
  delete from public.turmas           where academia_id = 'f9100000-0000-4000-8000-00000000000a';
  delete from public.modalidades      where academia_id = 'f9100000-0000-4000-8000-00000000000a';
  delete from public.membros_academia where academia_id = 'f9100000-0000-4000-8000-00000000000a';
  delete from public.academias        where id          = 'f9100000-0000-4000-8000-00000000000a';
  delete from auth.users              where id          = 'f9100000-0000-4000-8000-0000000000a1';
$f$);
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
