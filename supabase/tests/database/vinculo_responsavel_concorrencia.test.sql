-- Desvínculo do login sob concorrência (revisão do Codex no PR #73). Duas
-- transações em conexões separadas (dblink): a que chega depois espera a
-- trava do papel e decide com o que foi confirmado.
--   A. os dois últimos alunos do login saem ao mesmo tempo: o papel sai;
--   B. vínculo novo aberto e desvínculo do outro aluno: o papel fica;
--   C. ordem inversa de B: o papel sai e o vínculo o recria.
--
-- As fixtures são gravadas e confirmadas por uma conexão própria e apagadas
-- no fim.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(12);

-- Mesmo jeito de conectar de matricula/concorrencia.test.sql.
create function pg_temp.conexao() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=teste_concorrencia_vinculo',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database())
$$;

select extensions.dblink_connect('prep', pg_temp.conexao());
select extensions.dblink_connect('s1', pg_temp.conexao());
select extensions.dblink_connect('s2', pg_temp.conexao());
select extensions.dblink_exec('s1', 'set statement_timeout = ''20s''');
select extensions.dblink_exec('s2', 'set statement_timeout = ''20s''');

-- P: responsável com dois filhos ligados (cenário A). Q: responsável com um
-- filho ligado e outro ainda por ligar (B). R: idem (C).
select extensions.dblink_exec('prep', $f$
  insert into auth.users (id, email, email_confirmed_at) values
    ('fc000000-0000-4000-8000-0000000000e1', 'p@concorrencia-vinculo.test', now()),
    ('fc000000-0000-4000-8000-0000000000e2', 'q@concorrencia-vinculo.test', now()),
    ('fc000000-0000-4000-8000-0000000000e3', 'r@concorrencia-vinculo.test', now());
  insert into public.academias (id, nome, slug, status) values
    ('fc000000-0000-4000-8000-00000000000a', 'Concorrência Vínculo', 'concorrencia-vinculo', 'ativa');
  insert into public.alunos (id, academia_id, nome, responsavel_email, status, user_id) values
    ('fc000000-0000-4000-8000-0000000001a1', 'fc000000-0000-4000-8000-00000000000a', 'P1', 'p@concorrencia-vinculo.test', 'ativo', 'fc000000-0000-4000-8000-0000000000e1'),
    ('fc000000-0000-4000-8000-0000000001a2', 'fc000000-0000-4000-8000-00000000000a', 'P2', 'p@concorrencia-vinculo.test', 'ativo', 'fc000000-0000-4000-8000-0000000000e1'),
    ('fc000000-0000-4000-8000-0000000001b1', 'fc000000-0000-4000-8000-00000000000a', 'Q1', 'q@concorrencia-vinculo.test', 'ativo', 'fc000000-0000-4000-8000-0000000000e2'),
    ('fc000000-0000-4000-8000-0000000001b2', 'fc000000-0000-4000-8000-00000000000a', 'Q2', 'q@concorrencia-vinculo.test', 'ativo', null),
    ('fc000000-0000-4000-8000-0000000001c1', 'fc000000-0000-4000-8000-00000000000a', 'R1', 'r@concorrencia-vinculo.test', 'ativo', 'fc000000-0000-4000-8000-0000000000e3'),
    ('fc000000-0000-4000-8000-0000000001c2', 'fc000000-0000-4000-8000-00000000000a', 'R2', 'r@concorrencia-vinculo.test', 'ativo', null);
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000e1', 'aluno'),
    ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000e2', 'aluno'),
    ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000e3', 'aluno');
$f$);

create function pg_temp.esperando() returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
               where application_name = 'teste_concorrencia_vinculo'
                 and wait_event_type = 'Lock'
                 and state = 'active') then
      return true;
    end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end
$$;

create function pg_temp.resultado(p_con text) returns text language plpgsql as $$
declare
  v_msg text;
begin
  perform * from extensions.dblink_get_result(p_con, false) as r(x text);
  v_msg := extensions.dblink_error_message(p_con);
  perform * from extensions.dblink_get_result(p_con, false) as r(x text);
  return case when v_msg is null or v_msg = 'OK' then 'ok' else v_msg end;
end
$$;

create function pg_temp.tem_papel_aluno(p_user text) returns boolean language sql as $$
  select exists (select 1 from public.membros_academia
                 where academia_id = 'fc000000-0000-4000-8000-00000000000a'
                   and user_id = p_user::uuid and papel = 'aluno')
$$;

create function pg_temp.troca_email(p_aluno text) returns text language sql as $$
  select format($q$update public.alunos set responsavel_email = 'outro@concorrencia-vinculo.test' where id = %L$q$, p_aluno)
$$;

create function pg_temp.como(p_user text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('s1', 'set role authenticated');
  perform extensions.dblink_exec('s1', format('set request.jwt.claim.sub = %L', p_user));
  perform extensions.dblink_exec('s1', format('set request.jwt.claims = %L',
    json_build_object('sub', p_user, 'role', 'authenticated')::text));
end
$$;

-- ---------------------------------------------------------------------
-- A. s1 tira P1 do login e não confirma; s2 tira P2.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', pg_temp.troca_email('fc000000-0000-4000-8000-0000000001a1'));
select is(extensions.dblink_send_query('s2', pg_temp.troca_email('fc000000-0000-4000-8000-0000000001a2')), 1,
  'A: s2 envia o desvínculo do outro filho');
select ok(pg_temp.esperando(), 'A: s2 espera a trava do papel, aberta por s1');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado('s2'), 'ok', 'A: depois do commit, s2 termina');
select ok(not pg_temp.tem_papel_aluno('fc000000-0000-4000-8000-0000000000e1'),
  'A: sem nenhum filho ligado, P perde o papel aluno');

-- ---------------------------------------------------------------------
-- B. s1 (como Q) liga Q2 e não confirma; s2 tira Q1.
-- ---------------------------------------------------------------------
select pg_temp.como('fc000000-0000-4000-8000-0000000000e2');
select extensions.dblink_exec('s1', 'begin');
select is((select n from extensions.dblink('s1', 'select public.vincular_meu_cadastro_aluno()') as r(n int)), 1,
  'B: s1 liga Q2');
select is(extensions.dblink_send_query('s2', pg_temp.troca_email('fc000000-0000-4000-8000-0000000001b1')), 1,
  'B: s2 envia o desvínculo de Q1');
select ok(pg_temp.esperando(), 'B: s2 espera o vínculo aberto de s1');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado('s2'), 'ok', 'B: depois do commit, s2 termina');
select ok(pg_temp.tem_papel_aluno('fc000000-0000-4000-8000-0000000000e2'),
  'B: com Q2 ligado, Q continua com o papel aluno');
select extensions.dblink_exec('s1', 'reset role');

-- ---------------------------------------------------------------------
-- C. Ordem inversa: s2 tira R1 e não confirma; s1 (como R) liga R2.
-- ---------------------------------------------------------------------
select pg_temp.como('fc000000-0000-4000-8000-0000000000e3');
select extensions.dblink_exec('s2', 'begin');
select extensions.dblink_exec('s2', pg_temp.troca_email('fc000000-0000-4000-8000-0000000001c1'));
select is(extensions.dblink_send_query('s1', 'select public.vincular_meu_cadastro_aluno()'), 1,
  'C: s1 envia o vínculo de R2');
select ok(pg_temp.esperando(), 'C: s1 espera o desvínculo aberto de s2');
select extensions.dblink_exec('s2', 'commit');
select pg_temp.resultado('s1');
select ok(pg_temp.tem_papel_aluno('fc000000-0000-4000-8000-0000000000e3'),
  'C: o vínculo de R2 recria o papel que o desvínculo de R1 tirou');
select extensions.dblink_exec('s1', 'reset role');

-- ---------------------------------------------------------------------
-- Limpeza das fixtures confirmadas.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  delete from public.membros_academia where academia_id = 'fc000000-0000-4000-8000-00000000000a';
  delete from public.alunos           where academia_id = 'fc000000-0000-4000-8000-00000000000a';
  delete from public.academias        where id          = 'fc000000-0000-4000-8000-00000000000a';
  delete from auth.users              where id::text like 'fc000000-0000-4000-8000-0000000000e_';
$f$);
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
