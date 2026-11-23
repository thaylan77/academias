-- Convite de membros sob concorrência (docs/specs/convite-membros.md, 4.3 e
-- 4.5). Duas transações de verdade, em conexões separadas (dblink):
--   A. dois aceites do mesmo convite: um membro só;
--   B. convidar o mesmo e-mail enquanto ele aceita outro convite: ja_membro;
--   C. dois donos saindo (delete) ao mesmo tempo: sobra um;
--   D. dois donos se desativando (update) ao mesmo tempo: sobra um;
--   E. o dono desativa o admin enquanto o convidado dele aceita: o aceite
--      espera a revogação e é recusado;
--   F. o mesmo, trocando o titular do vínculo de admin (user_id);
--   G. o e-mail do convidado muda no Auth enquanto o aceite espera a trava:
--      o aceite relê o e-mail e é recusado.
-- A espera é provada pelo pid: s2 está bloqueada e s1 está entre os que a
-- bloqueiam. As fixtures são gravadas e confirmadas por uma conexão própria,
-- apagadas antes (se uma execução anterior parou no meio) e depois, pela
-- conexão administrativa sem JWT, que o gatilho do último dono deixa passar.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(34);

create function pg_temp.conexao(p_nome text) returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database(), p_nome)
$$;

select extensions.dblink_connect('prep', pg_temp.conexao('teste_convite_prep'));
select extensions.dblink_connect('s1', pg_temp.conexao('teste_convite_s1'));
select extensions.dblink_connect('s2', pg_temp.conexao('teste_convite_s2'));
select extensions.dblink_exec('s1', 'set statement_timeout = ''20s''');
select extensions.dblink_exec('s2', 'set statement_timeout = ''20s''');

create temp table pids as
select (select pid from extensions.dblink('s1', 'select pg_backend_pid()') as t(pid int)) as s1,
       (select pid from extensions.dblink('s2', 'select pg_backend_pid()') as t(pid int)) as s2;

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

-- s2 está esperando uma trava que s1 segura (no máximo 10 s). Dentro de uma
-- transação, o pg_stat_activity guarda a primeira leitura; sem descartá-la a
-- cada volta, a espera nunca veria s2 mudar de estado.
create function pg_temp.s2_espera_s1() returns boolean language plpgsql as $$
declare
  v_s1 int := (select s1 from pids);
  v_s2 int := (select s2 from pids);
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
               where pid = v_s2 and state = 'active' and wait_event_type = 'Lock')
       and v_s1 = any (pg_blocking_pids(v_s2)) then
      return true;
    end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end
$$;

create function pg_temp.ninguem_esperando() returns boolean language plpgsql as $$
begin
  perform pg_stat_clear_snapshot();
  return cardinality(pg_blocking_pids((select s2 from pids))) = 0;
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

create function pg_temp.limpa() returns void language plpgsql as $$
begin
  perform extensions.dblink_exec('prep', $f$
    delete from public.academias where id in ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-00000000000b');
    delete from auth.users where id in (
      'e7d00000-0000-4000-8000-0000000000a1', 'e7d00000-0000-4000-8000-0000000000a2',
      'e7d00000-0000-4000-8000-0000000000b1', 'e7d00000-0000-4000-8000-0000000000b2',
      'e7d00000-0000-4000-8000-0000000000b3', 'e7d00000-0000-4000-8000-0000000000d3',
      'e7d00000-0000-4000-8000-0000000000b4', 'e7d00000-0000-4000-8000-0000000000d4',
      'e7d00000-0000-4000-8000-0000000000d5', 'e7d00000-0000-4000-8000-0000000000d6',
      'e7d00000-0000-4000-8000-0000000000d1', 'e7d00000-0000-4000-8000-0000000000d2');
  $f$);
end
$$;

-- ---------------------------------------------------------------------
-- Fixtures confirmadas.
--   K: donos a1 e a2; convite c1 (professor) para u1 e c3 (recepção) para u2.
--   L: donos b1 e b2 (cenário D); admin b3 e o convite c5 dele para u3 (E);
--      admin b4 e o convite c6 dele para u4 (F); convite c7 de b2 para u6 (G).
-- ---------------------------------------------------------------------
select pg_temp.limpa();
select extensions.dblink_exec('prep', $f$
  insert into auth.users (id, email, email_confirmed_at) values
    ('e7d00000-0000-4000-8000-0000000000a1', 'dono1@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000a2', 'dono2@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000b1', 'dono3@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000b2', 'dono4@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000d1', 'u1@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000d2', 'u2@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000b3', 'admin3@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000d3', 'u3@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000b4', 'admin4@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000d4', 'u4@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000d5', 'u5@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000d6', 'u6@concorre.test',    now());
  insert into public.academias (id, nome, slug, status) values
    ('e7d00000-0000-4000-8000-00000000000a', 'Concorre K', 'convite-concorre-k', 'ativa'),
    ('e7d00000-0000-4000-8000-00000000000b', 'Concorre L', 'convite-concorre-l', 'ativa');
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-0000000000a1', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-0000000000a2', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b1', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b2', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b3', 'admin'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b4', 'admin');
  insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em) values
    ('e7d00000-0000-4000-8000-0000000002c1', 'e7d00000-0000-4000-8000-00000000000a', 'u1@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000a1', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c3', 'e7d00000-0000-4000-8000-00000000000a', 'u2@concorre.test', 'recepcao',
     'e7d00000-0000-4000-8000-0000000000a1', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c5', 'e7d00000-0000-4000-8000-00000000000b', 'u3@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000b3', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c6', 'e7d00000-0000-4000-8000-00000000000b', 'u4@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000b4', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c7', 'e7d00000-0000-4000-8000-00000000000b', 'u6@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days');
$f$);

-- ---------------------------------------------------------------------
-- A. u1 aceita c1 em s1 (sem confirmar) e de novo em s2.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000d1');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d1');
select ok(pg_temp.ninguem_esperando(), 'A: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c1'); end $d$$q$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c1')$$),
  1, 'A: s2 envia o segundo aceite');
select ok(pg_temp.s2_espera_s1(), 'A: s2 espera a trava de s1');
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
select ok(pg_temp.ninguem_esperando(), 'B: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c3'); end $d$$q$);
select is(extensions.dblink_send_query('s2', $$select public.criar_convite_interna(
    'e7d00000-0000-4000-8000-0000000000a1', 'e7d00000-0000-4000-8000-00000000000a', 'u2@concorre.test', 'admin')::text$$),
  1, 'B: s2 envia o convite novo');
select ok(pg_temp.s2_espera_s1(), 'B: o convite novo espera a trava do aceite');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +ja_membro', 'B: depois do aceite, o convite novo é recusado (ja_membro)');
select is((select papel from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and user_id = 'e7d00000-0000-4000-8000-0000000000d2'),
  'recepcao', 'B: u2 ficou com o papel do convite aceito');
select is((select count(*) from public.convites_equipe
           where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and email = 'u2@concorre.test' and status = 'pendente'),
  0::bigint, 'B: nenhum convite pendente sobrou para u2');

-- ---------------------------------------------------------------------
-- C. a1 sai em s1 (sem confirmar); a2 sai em s2.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000a1');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000a2');
select ok(pg_temp.ninguem_esperando(), 'C: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$delete from public.membros_academia
  where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and user_id = 'e7d00000-0000-4000-8000-0000000000a1'$$);
select is(extensions.dblink_send_query('s2', $$delete from public.membros_academia
  where academia_id = 'e7d00000-0000-4000-8000-00000000000a' and user_id = 'e7d00000-0000-4000-8000-0000000000a2'$$),
  1, 'C: s2 envia a saída do segundo dono');
select ok(pg_temp.s2_espera_s1(), 'C: s2 espera a trava de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +ultimo_dono', 'C: a segunda saída é recusada (ultimo_dono)');

-- ---------------------------------------------------------------------
-- D. b1 se desativa em s1 (sem confirmar); b2 se rebaixa em s2.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000b1');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000b2');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.membros_academia set ativo = false
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000b1'$$);
select is(extensions.dblink_send_query('s2', $$update public.membros_academia set papel = 'admin'
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000b2'$$),
  1, 'D: s2 envia o rebaixamento do segundo dono');
select ok(pg_temp.s2_espera_s1(), 'D: s2 espera a trava de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +ultimo_dono', 'D: o rebaixamento é recusado (ultimo_dono)');

select is((select string_agg(a.slug || '=' || (select count(*) from public.membros_academia m
                                                where m.academia_id = a.id and m.papel = 'dono' and m.ativo), ',' order by a.slug)
           from public.academias a where a.id in ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-00000000000b')),
  'convite-concorre-k=1,convite-concorre-l=1', 'C e D: cada academia ficou com um dono ativo');

-- ---------------------------------------------------------------------
-- E. b2 (dono) desativa o admin b3 em s1 (sem confirmar); u3 aceita em s2 o
--    convite que b3 fez.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000b2');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d3');
select ok(pg_temp.ninguem_esperando(), 'E: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.membros_academia set ativo = false
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000b3'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c5')$$),
  1, 'E: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'E: o aceite espera a revogação de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'E: depois da revogação, o aceite é recusado (convite_invalido)');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d3'),
  0::bigint, 'E: u3 não entrou na equipe');

-- ---------------------------------------------------------------------
-- F. b2 passa o vínculo de admin de b4 para u5 em s1 (sem confirmar); u4
--    aceita em s2 o convite que b4 fez.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'e7d00000-0000-4000-8000-0000000000b2');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d4');
select ok(pg_temp.ninguem_esperando(), 'F: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.membros_academia set user_id = 'e7d00000-0000-4000-8000-0000000000d5'
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000b4'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c6')$$),
  1, 'F: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'F: o aceite espera a troca de titular de s1');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'F: depois da troca, o aceite é recusado (convite_invalido)');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d4'),
  0::bigint, 'F: u4 não entrou na equipe');

-- ---------------------------------------------------------------------
-- G. s1 segura a academia L (conexão administrativa); u6 aceita em s2 e
--    espera; enquanto isso, o e-mail de u6 muda no Auth.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'reset role');
select extensions.dblink_exec('s1', $q$set request.jwt.claim.sub = ''; set request.jwt.claim.role = ''; set request.jwt.claims = ''$q$);
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d6');
select ok(pg_temp.ninguem_esperando(), 'G: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.academias set updated_at = updated_at where id = 'e7d00000-0000-4000-8000-00000000000b'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c7')$$),
  1, 'G: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'G: o aceite espera a trava da academia');
select extensions.dblink_exec('prep', $$update auth.users set email = 'u6-novo@concorre.test' where id = 'e7d00000-0000-4000-8000-0000000000d6'$$);
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'G: com o e-mail trocado, o aceite é recusado (convite_invalido)');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d6'),
  0::bigint, 'G: u6 não entrou na equipe');

-- ---------------------------------------------------------------------
-- Limpeza.
-- ---------------------------------------------------------------------
select pg_temp.limpa();
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
