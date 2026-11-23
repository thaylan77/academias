-- Convite de membros sob concorrência (docs/specs/convite-membros.md, 4.3 e
-- 4.5). Duas transações de verdade, em conexões separadas (dblink):
--   A. dois aceites do mesmo convite: um membro só;
--   B. criar convite enquanto o mesmo e-mail aceita outro: ja_membro;
--   C. dois donos saindo ao mesmo tempo: sobra um.
-- As fixtures são gravadas e confirmadas por uma conexão própria e apagadas
-- no fim (pela conexão administrativa, sem JWT, que o gatilho do último dono
-- deixa passar).
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(12);

create function pg_temp.conexao() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=teste_convite',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database())
$$;

select extensions.dblink_connect('prep', pg_temp.conexao());
select extensions.dblink_connect('s1', pg_temp.conexao());
select extensions.dblink_connect('s2', pg_temp.conexao());
select extensions.dblink_exec('s1', 'set statement_timeout = ''20s''');
select extensions.dblink_exec('s2', 'set statement_timeout = ''20s''');

-- Põe a sessão no papel da API, como o usuário dado (ou como service_role).
create function pg_temp.como(p_conn text, p_user text) returns void language plpgsql as $$
begin
  perform extensions.dblink_exec(p_conn, 'reset role');
  if p_user = 'service_role' then
    perform extensions.dblink_exec(p_conn, $q$set request.jwt.claim.sub = ''; set request.jwt.claim.role = 'service_role'; set request.jwt.claims = '{"role":"service_role"}'$q$);
    perform extensions.dblink_exec(p_conn, 'set role service_role');
  else
    perform extensions.dblink_exec(p_conn, format($q$set request.jwt.claim.sub = %L; set request.jwt.claim.role = 'authenticated'; set request.jwt.claims = %L$q$,
      p_user, json_build_object('sub', p_user, 'role', 'authenticated')::text));
    perform extensions.dblink_exec(p_conn, 'set role authenticated');
  end if;
end
$$;

create function pg_temp.s2_esperando() returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
               where application_name = 'teste_convite'
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

-- ---------------------------------------------------------------------
-- Fixtures confirmadas. Academia K com os donos d1 e d2; u1 e u2 são
-- convidados; os convites c1 e c2 são de u1 (c2 será recriado), c3 de u2.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  insert into auth.users (id, email, email_confirmed_at) values
    ('e7d00000-0000-4000-8000-0000000000a1', 'dono1@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000a2', 'dono2@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000d1', 'u1@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000d2', 'u2@concorre.test',    now());
  insert into public.academias (id, nome, slug, status) values
    ('e7d00000-0000-4000-8000-00000000000a', 'Concorre K', 'convite-concorre-k', 'ativa');
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-0000000000a1', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-0000000000a2', 'dono');
  insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em) values
    ('e7d00000-0000-4000-8000-0000000002c1', 'e7d00000-0000-4000-8000-00000000000a', 'u1@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000a1', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c3', 'e7d00000-0000-4000-8000-00000000000a', 'u2@concorre.test', 'recepcao',
     'e7d00000-0000-4000-8000-0000000000a1', now() + interval '7 days');
$f$);

-- ---------------------------------------------------------------------
-- A. u1 aceita c1 em s1 (sem confirmar) e de novo em s2.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000d1');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d1');
select ok(not exists (select 1 from pg_stat_activity
                      where application_name = 'teste_convite' and wait_event_type = 'Lock'),
  'A: antes do envio, ninguém espera');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c1'); end $d$$q$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c1')$$),
  1, 'A: s2 envia o segundo aceite');
select ok(pg_temp.s2_esperando(), 'A: s2 espera o aceite aberto de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'A: o segundo aceite é recusado (convite_invalido)');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and user_id = 'e7d00000-0000-4000-8000-0000000000d1'),
  1::bigint, 'A: um membro só');

-- ---------------------------------------------------------------------
-- B. u2 aceita c3 em s1 (sem confirmar); s2, como a Edge Function, convida
--    o mesmo e-mail para outro papel.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000d2');
select pg_temp.como('s2', 'service_role');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c3'); end $d$$q$);
select is(extensions.dblink_send_query('s2', $$select public.criar_convite_interna(
    'e7d00000-0000-4000-8000-0000000000a1', 'e7d00000-0000-4000-8000-00000000000a', 'u2@concorre.test', 'admin')::text$$),
  1, 'B: s2 envia o convite novo');
select ok(pg_temp.s2_esperando(), 'B: o convite novo espera o aceite aberto');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +ja_membro', 'B: depois do aceite, o convite novo é recusado (ja_membro)');

-- ---------------------------------------------------------------------
-- C. d1 sai em s1 (sem confirmar); d2 sai em s2.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000a1');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000a2');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$delete from public.membros_academia
  where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and user_id = 'e7d00000-0000-4000-8000-0000000000a1'$$);
select is(extensions.dblink_send_query('s2', $$delete from public.membros_academia
  where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and user_id = 'e7d00000-0000-4000-8000-0000000000a2'$$),
  1, 'C: s2 envia a saída do segundo dono');
select ok(pg_temp.s2_esperando(), 'C: s2 espera a saída aberta de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +ultimo_dono', 'C: a segunda saída é recusada (ultimo_dono)');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and papel = 'dono' and ativo),
  1::bigint, 'C: sobrou um dono');

-- ---------------------------------------------------------------------
-- Limpeza (conexão administrativa, sem JWT).
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  delete from public.academias where id = 'e7d00000-0000-4000-8000-00000000000a';
  delete from auth.users where id in ('e7d00000-0000-4000-8000-0000000000a1', 'e7d00000-0000-4000-8000-0000000000a2',
                                      'e7d00000-0000-4000-8000-0000000000d1', 'e7d00000-0000-4000-8000-0000000000d2');
$f$);
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
