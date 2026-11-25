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
--      o aceite relê o e-mail e é recusado;
--   (H e I testavam a exclusão lógica no Auth, que agora é proibida.)
--   J. duas academias convidam o mesmo e-mail ao mesmo tempo: a segunda
--      espera a trava do e-mail e esbarra nos 60 segundos.
--   K. um convite espera a trava da academia: o horário registrado do envio
--      é o de depois da espera, não o do início da transação;
--   L. o convite vence enquanto o aceite espera a trava: o aceite é recusado;
--   M. o mesmo, esperando só a linha do membro (aluno): o aceite reconfere a
--      validade e é recusado, sem mudar o papel.
--   N. liberar um envio recusado pelo provedor (outra transação) devolve a
--      cota e não muda nada do que a academia lê, nem o updated_at.
--   O. o portal grava o vínculo de aluno enquanto o aceite está no meio: o
--      aceite espera, relê o vínculo e troca o papel, sem erro de chave;
--   P. o mesmo, mas o convite vence na espera e o portal desfaz o vínculo:
--      o aceite é recusado, sem vínculo e com o convite pendente.
--   Q e R. em repeatable read ou serializable, a saída de um dono é
--      recusada (isolamento_nao_suportado): as travas supõem read committed.
--   S. o expurgo espera uma confirmação em andamento e não apaga a linha
--      confirmada.
--   T. o Auth (sessão supabase_auth_admin, sem JWT) apagando contas: o
--      último dono não sai; o admin que convidou sai, e o convite dele morre.
--   U. um dono promove um professor a dono pela API, a promoção espera a
--      linha do professor e, nesse meio, o autor é revogado: a promoção é
--      recusada.
--   V. a prova da senha nova muda enquanto o aceite espera a trava: o aceite
--      é recusado (senha_pendente), sem vínculo.
--   W. a sessão de quem aceita é revogada enquanto o aceite espera: a
--      revogação vence, e o convite, o vínculo e as sessões ficam intactos.
--   X. o aceite espera ao apagar uma outra sessão da conta por mais de um
--      segundo: vale_a_partir é calculado depois da espera.
-- A espera é provada pelo pid: s2 está bloqueada e s1 está entre os que a
-- bloqueiam. As fixtures são gravadas e confirmadas por uma conexão própria,
-- apagadas antes (se uma execução anterior parou no meio) e depois, pela
-- conexão administrativa sem JWT, que o gatilho do último dono deixa passar.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(93);

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
      p_user, json_build_object('sub', p_user, 'role', 'authenticated',
                              'iat', floor(extract(epoch from clock_timestamp()))::bigint + 1, 'session_id', p_user,
                              'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', 0)))::text));
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
    delete from public.convites_envios where email like '%@concorre.test';
    delete from public.academias where id in ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-00000000000c', 'e7d00000-0000-4000-8000-00000000000d', 'e7d00000-0000-4000-8000-00000000000e');
    delete from auth.users where id in (
      'e7d00000-0000-4000-8000-0000000000a1', 'e7d00000-0000-4000-8000-0000000000a2',
      'e7d00000-0000-4000-8000-0000000000b1', 'e7d00000-0000-4000-8000-0000000000b2',
      'e7d00000-0000-4000-8000-0000000000b3', 'e7d00000-0000-4000-8000-0000000000d3',
      'e7d00000-0000-4000-8000-0000000000b4', 'e7d00000-0000-4000-8000-0000000000d4',
      'e7d00000-0000-4000-8000-0000000000d5', 'e7d00000-0000-4000-8000-0000000000d6',
      'e7d00000-0000-4000-8000-0000000000b5', 'e7d00000-0000-4000-8000-0000000000d7',
      'e7d00000-0000-4000-8000-0000000000b6', 'e7d00000-0000-4000-8000-0000000000b7',
      'e7d00000-0000-4000-8000-0000000000d8', 'e7d00000-0000-4000-8000-0000000000d9',
      'e7d00000-0000-4000-8000-0000000000da', 'e7d00000-0000-4000-8000-0000000000b8',
      'e7d00000-0000-4000-8000-0000000000b9', 'e7d00000-0000-4000-8000-0000000000db',
      'e7d00000-0000-4000-8000-0000000000bc', 'e7d00000-0000-4000-8000-0000000000bd',
      'e7d00000-0000-4000-8000-0000000000dd', 'e7d00000-0000-4000-8000-0000000000de',
      'e7d00000-0000-4000-8000-0000000000df', 'e7d00000-0000-4000-8000-0000000000e0',
      'e7d00000-0000-4000-8000-0000000000d1', 'e7d00000-0000-4000-8000-0000000000d2');
  $f$);
end
$$;

-- ---------------------------------------------------------------------
-- Fixtures confirmadas.
--   K: donos a1 e a2; convite c1 (professor) para u1 e c3 (recepção) para u2.
--   L: donos b1 e b2 (cenário D); admin b3 e o convite c5 dele para u3 (E);
--      admin b4 e o convite c6 dele para u4 (F); convite c7 de b2 para u6 (G).
--      Admin b5 e o convite c8 dele para u7 (H).
--   M: dono b6 e admin b7 (I).
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
    ('e7d00000-0000-4000-8000-0000000000d6', 'u6@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000b5', 'admin5@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000d7', 'u7@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000b6', 'dono6@concorre.test',  now()),
    ('e7d00000-0000-4000-8000-0000000000b7', 'admin7@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000d8', 'u8@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000d9', 'u9@concorre.test',    now()),
    ('e7d00000-0000-4000-8000-0000000000da', 'u10@concorre.test',   now()),
    ('e7d00000-0000-4000-8000-0000000000b8', 'dono8@concorre.test',  now()),
    ('e7d00000-0000-4000-8000-0000000000b9', 'admin9@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000db', 'u11@concorre.test',   now()),
    ('e7d00000-0000-4000-8000-0000000000bc', 'dono12@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000bd', 'dono13@concorre.test', now()),
    ('e7d00000-0000-4000-8000-0000000000dd', 'u12@concorre.test',   now()),
    ('e7d00000-0000-4000-8000-0000000000de', 'u13@concorre.test',   now()),
    ('e7d00000-0000-4000-8000-0000000000df', 'u14@concorre.test',   now()),
    ('e7d00000-0000-4000-8000-0000000000e0', 'u15@concorre.test',   now());
  -- Senha nova já definida (concluir-senha), como pede o aceite.
  -- Cada usuário com uma sessão (id = o próprio id do usuário, como o
  -- session_id que pg_temp.como põe no JWT) e a senha nova definida nela.
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('senha_redefinida_em', 1, 'senha_redefinida_sessao', id::text)
   where email like '%@concorre.test';
  insert into auth.sessions (id, user_id) select id, id from auth.users where email like '%@concorre.test';
  insert into auth.sessions (id, user_id) values ('e7d00000-0000-4000-8000-0000000006e0', 'e7d00000-0000-4000-8000-0000000000e0');
  insert into public.academias (id, nome, slug, status) values
    ('e7d00000-0000-4000-8000-00000000000a', 'Concorre K', 'convite-concorre-k', 'ativa'),
    ('e7d00000-0000-4000-8000-00000000000b', 'Concorre L', 'convite-concorre-l', 'ativa'),
    ('e7d00000-0000-4000-8000-00000000000c', 'Concorre M', 'convite-concorre-m', 'ativa'),
    ('e7d00000-0000-4000-8000-00000000000d', 'Concorre N', 'convite-concorre-n', 'ativa'),
    ('e7d00000-0000-4000-8000-00000000000e', 'Concorre O', 'convite-concorre-o', 'ativa');
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-0000000000a1', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000a', 'e7d00000-0000-4000-8000-0000000000a2', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b1', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b2', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b3', 'admin'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b4', 'admin'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000b5', 'admin'),
    ('e7d00000-0000-4000-8000-00000000000c', 'e7d00000-0000-4000-8000-0000000000b6', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000c', 'e7d00000-0000-4000-8000-0000000000b7', 'admin'),
    ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000d8', 'aluno'),
    ('e7d00000-0000-4000-8000-00000000000d', 'e7d00000-0000-4000-8000-0000000000b8', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000d', 'e7d00000-0000-4000-8000-0000000000b9', 'admin'),
    ('e7d00000-0000-4000-8000-00000000000e', 'e7d00000-0000-4000-8000-0000000000bc', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000e', 'e7d00000-0000-4000-8000-0000000000bd', 'dono'),
    ('e7d00000-0000-4000-8000-00000000000e', 'e7d00000-0000-4000-8000-0000000000dd', 'professor');
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
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c8', 'e7d00000-0000-4000-8000-00000000000b', 'u7@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000b5', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002c9', 'e7d00000-0000-4000-8000-00000000000b', 'u2@concorre.test', 'recepcao',
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002ca', 'e7d00000-0000-4000-8000-00000000000b', 'u8@concorre.test', 'recepcao',
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days');
  insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em,
                                      ultimo_envio_em, envios_recentes) values
    ('e7d00000-0000-4000-8000-0000000002cb', 'e7d00000-0000-4000-8000-00000000000b', 'liberar@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days',
     '2026-11-23 10:00:00+00', array['2026-11-23 10:00:00+00'::timestamptz]);
  insert into public.convites_envios (id, email, convite_id, reservado_em) values
    ('e7d00000-0000-4000-8000-0000000003cb', 'liberar@concorre.test', 'e7d00000-0000-4000-8000-0000000002cb',
     '2026-11-23 10:00:00+00'),
    ('e7d00000-0000-4000-8000-0000000003cc', 'expurgo@concorre.test', null, now() - interval '4 days');
  insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em) values
    ('e7d00000-0000-4000-8000-0000000002cc', 'e7d00000-0000-4000-8000-00000000000b', 'u9@concorre.test', 'recepcao',
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002cd', 'e7d00000-0000-4000-8000-00000000000b', 'u10@concorre.test', 'recepcao',
     'e7d00000-0000-4000-8000-0000000000b2', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002ce', 'e7d00000-0000-4000-8000-00000000000d', 'u11@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000b9', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002cf', 'e7d00000-0000-4000-8000-00000000000e', 'u13@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000bd', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002d0', 'e7d00000-0000-4000-8000-00000000000e', 'u14@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000bd', now() + interval '7 days'),
    ('e7d00000-0000-4000-8000-0000000002d1', 'e7d00000-0000-4000-8000-00000000000e', 'u15@concorre.test', 'professor',
     'e7d00000-0000-4000-8000-0000000000bd', now() + interval '7 days');
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
-- F. O service_role (a API não troca mais o titular) passa o vínculo de
--    admin de b4 para u5 em s1 (sem confirmar); u4 aceita em s2 o convite
--    que b4 fez.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'service_role');
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
-- J. s1 (dono a2, em K) e s2 (dono b2, em L), como a Edge Function, convidam
--    o mesmo e-mail; s1 não confirma.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'service_role');
select pg_temp.como('s2', 'service_role');
select ok(pg_temp.ninguem_esperando(), 'J: antes do envio, s2 não espera ninguém');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.criar_convite_interna(
    'e7d00000-0000-4000-8000-0000000000a2', 'e7d00000-0000-4000-8000-00000000000a', 'disputa@concorre.test', 'professor'); end $d$$q$);
select is(extensions.dblink_send_query('s2', $$select public.criar_convite_interna(
    'e7d00000-0000-4000-8000-0000000000b2', 'e7d00000-0000-4000-8000-00000000000b', 'disputa@concorre.test', 'professor')::text$$),
  1, 'J: s2 envia o convite pela outra academia');
select ok(pg_temp.s2_espera_s1(), 'J: o segundo convite espera a trava do e-mail');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'J: o segundo convite não dá erro que revele a outra academia');
select is((select string_agg(a.slug || '=' || (exists (select 1 from public.convites_envios v where v.convite_id = c.id))::text, ',' order by a.slug)
           from public.convites_equipe c join public.academias a on a.id = c.academia_id
           where c.email = 'disputa@concorre.test'),
  'convite-concorre-k=true,convite-concorre-l=false', 'J: um envio real só para o endereço; o de L fica gravado sem envio real');

-- ---------------------------------------------------------------------
-- K. s2 abre a transação; s1 segura a academia L; depois de 1,5 s, s2
--    convida em L e espera; s1 confirma.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'reset role');
select extensions.dblink_exec('s1', $q$set request.jwt.claim.sub = ''; set request.jwt.claim.role = ''; set request.jwt.claims = ''$q$);
select pg_temp.como('s2', 'service_role');
select extensions.dblink_exec('s2', 'begin');
create temp table inicio_s2 as
select x::timestamptz as t from extensions.dblink('s2', 'select now()::text') as r(x text);
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.academias set updated_at = updated_at where id = 'e7d00000-0000-4000-8000-00000000000b'$$);
select pg_sleep(1.5);
select is(extensions.dblink_send_query('s2', $$select public.criar_convite_interna(
    'e7d00000-0000-4000-8000-0000000000b2', 'e7d00000-0000-4000-8000-00000000000b', 'relogio@concorre.test', 'professor')::text$$),
  1, 'K: s2 envia o convite');
select ok(pg_temp.s2_espera_s1(), 'K: o convite espera a trava da academia');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'K: o convite passa depois da espera');
select extensions.dblink_exec('s2', 'commit');
select ok((select c.ultimo_envio_em >= (select t from inicio_s2) + interval '1 second'
                  and c.envios_recentes[1] = c.ultimo_envio_em
           from public.convites_equipe c where c.email = 'relogio@concorre.test'),
  'K: o envio registrado é o horário de depois da espera');

-- ---------------------------------------------------------------------
-- L. O convite c9 (de b2 para u2, em L) passa a vencer em 2 s; s1 segura a
--    academia L; u2 aceita em s2 e espera; o convite vence; s1 confirma.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $$update public.convites_equipe set expira_em = clock_timestamp() + interval '2 seconds'
  where id = 'e7d00000-0000-4000-8000-0000000002c9'$$);
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d2');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.academias set updated_at = updated_at where id = 'e7d00000-0000-4000-8000-00000000000b'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002c9')$$),
  1, 'L: s2 envia o aceite antes do vencimento');
select ok(pg_temp.s2_espera_s1(), 'L: o aceite espera a trava da academia');
select pg_sleep(2.5);
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'L: o convite venceu durante a espera: o aceite é recusado');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d2'),
  0::bigint, 'L: u2 não entrou na equipe de L');

-- ---------------------------------------------------------------------
-- M. O convite c10 (de b2 para u8, que é aluno em L) passa a vencer em 2 s;
--    s1 trava só a linha de membro de u8; u8 aceita em s2 e espera; o
--    convite vence; s1 confirma.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $$update public.convites_equipe set expira_em = clock_timestamp() + interval '2 seconds'
  where id = 'e7d00000-0000-4000-8000-0000000002ca'$$);
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d8');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.membros_academia set ativo = ativo
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d8'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002ca')$$),
  1, 'M: s2 envia o aceite antes do vencimento');
select ok(pg_temp.s2_espera_s1(), 'M: o aceite espera só a linha do membro');
select pg_sleep(2.5);
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'M: o convite venceu durante a espera: o aceite é recusado');
select is((select papel from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d8'),
  'aluno', 'M: u8 continua só aluno');

-- ---------------------------------------------------------------------
-- N. s1, como a Edge Function, libera o envio de c11 (já confirmado antes).
-- ---------------------------------------------------------------------
create temp table antes_n as
select to_jsonb(c) as visivel
from public.convites_equipe c where c.id = 'e7d00000-0000-4000-8000-0000000002cb';
select pg_temp.como('s1', 'service_role');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.liberar_envio_convite_interna(
    'e7d00000-0000-4000-8000-0000000003cb'); end $d$$q$);
select ok((select liberado_em is not null from public.convites_envios where id = 'e7d00000-0000-4000-8000-0000000003cb'),
  'N: a liberação devolve a cota');
select is((select to_jsonb(c)
           from public.convites_equipe c where c.id = 'e7d00000-0000-4000-8000-0000000002cb'),
  (select visivel from antes_n), 'N: nada do que a academia lê mudou, nem o updated_at');

-- ---------------------------------------------------------------------
-- O. s1 grava (sem confirmar) o vínculo de aluno de u9, como o portal; u9
--    aceita em s2 o convite de recepção.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'reset role');
select extensions.dblink_exec('s1', $q$set request.jwt.claim.sub = ''; set request.jwt.claim.role = ''; set request.jwt.claims = ''$q$);
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000d9');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$insert into public.membros_academia (academia_id, user_id, papel)
  values ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000d9', 'aluno')$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002cc')$$),
  1, 'O: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'O: o aceite espera o vínculo em gravação');
select ok(exists (select 1 from pg_locks l
                  where l.pid = (select s2 from pids)
                    and l.relation = 'public.membros_academia'::regclass
                    and l.mode = 'RowExclusiveLock' and l.granted),
  'O: a espera é na chave do vínculo (o aceite já chegou ao insert), não na academia');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'O: o aceite passa, sem erro de chave duplicada');
select is((select papel from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000d9'),
  'recepcao', 'O: o vínculo de aluno virou recepção');

-- ---------------------------------------------------------------------
-- P. O convite c13 (de b2 para u10) passa a vencer em 2 s; s1 grava (sem
--    confirmar) o vínculo de aluno de u10; u10 aceita em s2 e espera na
--    chave; o convite vence; s1 desfaz.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $$update public.convites_equipe set expira_em = clock_timestamp() + interval '2 seconds'
  where id = 'e7d00000-0000-4000-8000-0000000002cd'$$);
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000da');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$insert into public.membros_academia (academia_id, user_id, papel)
  values ('e7d00000-0000-4000-8000-00000000000b', 'e7d00000-0000-4000-8000-0000000000da', 'aluno')$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002cd')$$),
  1, 'P: s2 envia o aceite antes do vencimento');
select ok(pg_temp.s2_espera_s1(), 'P: o aceite espera a chave do vínculo em gravação');
select pg_sleep(2.5);
select extensions.dblink_exec('s1', 'rollback');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'P: o convite venceu na espera: o aceite é recusado');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000da'),
  0::bigint, 'P: nenhum vínculo ficou gravado');
select is((select status from public.convites_equipe where id = 'e7d00000-0000-4000-8000-0000000002cd'),
  'pendente', 'P: o convite continua pendente (vencido)');

-- ---------------------------------------------------------------------
-- Q. b2 (dono de L) tenta sair numa transação repeatable read.
-- ---------------------------------------------------------------------
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000b2');
select extensions.dblink_exec('s2', 'begin isolation level repeatable read');
select extensions.dblink_send_query('s2', $$delete from public.membros_academia
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000b2'$$);
select matches(pg_temp.resultado_s2(), 'HINT: +isolamento_nao_suportado',
  'Q: em repeatable read, a saída de dono é recusada');
select extensions.dblink_exec('s2', 'rollback');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and papel = 'dono' and ativo),
  1::bigint, 'Q: o dono continua');

-- R. O mesmo em serializable.
select extensions.dblink_exec('s2', 'begin isolation level serializable');
select extensions.dblink_send_query('s2', $$delete from public.membros_academia
  where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and user_id = 'e7d00000-0000-4000-8000-0000000000b2'$$);
select matches(pg_temp.resultado_s2(), 'HINT: +isolamento_nao_suportado',
  'R: em serializable, a saída de dono também é recusada');
select extensions.dblink_exec('s2', 'rollback');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000b' and papel = 'dono' and ativo),
  1::bigint, 'R: o dono continua');

-- ---------------------------------------------------------------------
-- S. s1 confirma (sem commit) uma reserva de 4 dias; s2 roda o expurgo.
-- ---------------------------------------------------------------------
select pg_temp.como('s1', 'service_role');
select pg_temp.como('s2', 'service_role');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $q$do $d$ begin perform public.confirmar_envio_convite_interna(
    'e7d00000-0000-4000-8000-0000000003cc'); end $d$$q$);
select is(extensions.dblink_send_query('s2', $$select public.expurgar_convites_envios()$$),
  1, 'S: s2 envia o expurgo');
select ok(pg_temp.s2_espera_s1(), 'S: o expurgo espera a confirmação em andamento');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'S: o expurgo termina sem erro');
select ok((select enviado_em is not null from public.convites_envios where id = 'e7d00000-0000-4000-8000-0000000003cc'),
  'S: a linha confirmada durante o expurgo continua');

-- ---------------------------------------------------------------------
-- T. Conexão como o Auth: session_user supabase_auth_admin, sem JWT.
-- ---------------------------------------------------------------------
select extensions.dblink_connect('auth', replace(pg_temp.conexao('teste_convite_auth'), 'user=postgres', 'user=supabase_auth_admin'));
create function pg_temp.resultado(p_conn text) returns text language plpgsql as $$
declare
  v_msg text;
begin
  perform * from extensions.dblink_get_result(p_conn, false) as r(x text);
  v_msg := extensions.dblink_error_message(p_conn);
  perform * from extensions.dblink_get_result(p_conn, false) as r(x text);
  return case when v_msg is null or v_msg = 'OK' then 'ok' else v_msg end;
end
$$;
select extensions.dblink_send_query('auth', $$delete from auth.users where id = 'e7d00000-0000-4000-8000-0000000000b8'$$);
select matches(pg_temp.resultado('auth'), 'HINT: +ultimo_dono', 'T: o Auth não apaga a conta do único dono');
select ok(exists (select 1 from auth.users where id = 'e7d00000-0000-4000-8000-0000000000b8')
          and exists (select 1 from public.membros_academia
                      where academia_id = 'e7d00000-0000-4000-8000-00000000000d'
                        and user_id = 'e7d00000-0000-4000-8000-0000000000b8' and papel = 'dono' and ativo),
  'T: a conta e o vínculo do único dono ficam');
select extensions.dblink_send_query('auth', $$delete from auth.users where id = 'e7d00000-0000-4000-8000-0000000000b9'$$);
select is(pg_temp.resultado('auth'), 'ok', 'T: o Auth apaga a conta do admin');
select is((select count(*) from public.membros_academia where user_id = 'e7d00000-0000-4000-8000-0000000000b9'),
  0::bigint, 'T: o vínculo do admin saiu junto');
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000db');
select extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002ce')$$);
select matches(pg_temp.resultado_s2(), 'HINT: +convite_invalido', 'T: o convite do admin apagado não pode mais ser aceito');
select ok((select status = 'cancelado' and encerrado_em is not null from public.convites_equipe
           where id = 'e7d00000-0000-4000-8000-0000000002ce'),
  'T: o convite do admin apagado ficou cancelado, não pendente');
select extensions.dblink_disconnect('auth');

-- ---------------------------------------------------------------------
-- U. s1 (administrativa) segura a linha do professor u12; o dono b12 o
--    promove a dono em s2 e espera; prep revoga b12; s1 confirma.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'reset role');
select extensions.dblink_exec('s1', $q$set request.jwt.claim.sub = ''; set request.jwt.claim.role = ''; set request.jwt.claims = ''$q$);
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000bc');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.membros_academia set ativo = ativo
  where academia_id = 'e7d00000-0000-4000-8000-00000000000e' and user_id = 'e7d00000-0000-4000-8000-0000000000dd'$$);
select is(extensions.dblink_send_query('s2', $$update public.membros_academia set papel = 'dono'
  where academia_id = 'e7d00000-0000-4000-8000-00000000000e' and user_id = 'e7d00000-0000-4000-8000-0000000000dd'$$),
  1, 'U: s2 envia a promoção');
select ok(pg_temp.s2_espera_s1(), 'U: a promoção espera a linha do professor');
select extensions.dblink_exec('prep', $$update public.membros_academia set ativo = false
  where academia_id = 'e7d00000-0000-4000-8000-00000000000e' and user_id = 'e7d00000-0000-4000-8000-0000000000bc'$$);
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +sem_permissao', 'U: o autor foi revogado no meio: a promoção é recusada');
select is((select papel from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000e' and user_id = 'e7d00000-0000-4000-8000-0000000000dd'),
  'professor', 'U: o professor não virou dono');

-- ---------------------------------------------------------------------
-- V. s1 (administrativa) segura a academia O; u13 aceita em s2 e espera;
--    prep troca a prova de senha de u13 para outra sessão; s1 confirma.
-- ---------------------------------------------------------------------
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000de');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update public.academias set updated_at = updated_at where id = 'e7d00000-0000-4000-8000-00000000000e'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002cf')$$),
  1, 'V: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'V: o aceite espera a trava da academia');
select extensions.dblink_exec('prep', $$update auth.users
  set raw_app_meta_data = raw_app_meta_data || '{"senha_redefinida_sessao": "e7d00000-0000-4000-8000-0000000005ff"}'
  where id = 'e7d00000-0000-4000-8000-0000000000de'$$);
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +senha_pendente', 'V: com a prova trocada no meio, o aceite é recusado');
select is((select count(*) from public.membros_academia
           where academia_id = 'e7d00000-0000-4000-8000-00000000000e' and user_id = 'e7d00000-0000-4000-8000-0000000000de'),
  0::bigint, 'V: u13 não entrou na equipe');

-- ---------------------------------------------------------------------
-- W. s1 (administrativa) apaga, sem confirmar, a sessão de u14; u14 aceita em
--    s2 com essa sessão e espera; s1 confirma a revogação.
-- ---------------------------------------------------------------------
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000df');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$delete from auth.sessions where id = 'e7d00000-0000-4000-8000-0000000000df'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002d0')$$),
  1, 'W: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'W: o aceite espera a revogação da sessão');
select extensions.dblink_exec('s1', 'commit');
select matches(pg_temp.resultado_s2(), 'HINT: +convite_exige_link', 'W: a revogação venceu: o aceite é recusado');
select is((select (select count(*) from public.membros_academia
                   where academia_id = 'e7d00000-0000-4000-8000-00000000000e'
                     and user_id = 'e7d00000-0000-4000-8000-0000000000df')::text
                  || '/' || status
           from public.convites_equipe where id = 'e7d00000-0000-4000-8000-0000000002d0'),
  '0/pendente', 'W: sem vínculo, e o convite continua pendente');

-- ---------------------------------------------------------------------
-- X. s1 (administrativa) trava a outra sessão de u15; u15 aceita em s2 e
--    espera ao apagá-la; passa mais de um segundo; s1 confirma.
-- ---------------------------------------------------------------------
select pg_temp.como('s2', 'e7d00000-0000-4000-8000-0000000000e0');
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$update auth.sessions set updated_at = updated_at where id = 'e7d00000-0000-4000-8000-0000000006e0'$$);
select is(extensions.dblink_send_query('s2', $$select public.aceitar_convite('e7d00000-0000-4000-8000-0000000002d1')$$),
  1, 'X: s2 envia o aceite');
select ok(pg_temp.s2_espera_s1(), 'X: o aceite espera ao apagar a outra sessão');
select pg_sleep(1.2);
create temp table antes_x as select floor(extract(epoch from clock_timestamp()))::bigint as t;
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), 'ok', 'X: o aceite termina');
select ok((select extract(epoch from m.vale_a_partir) > (select t from antes_x)
           from public.membros_academia m
           where m.academia_id = 'e7d00000-0000-4000-8000-00000000000e' and m.user_id = 'e7d00000-0000-4000-8000-0000000000e0'),
  'X: vale_a_partir foi calculado depois da espera (um token emitido durante ela não vale)');

-- ---------------------------------------------------------------------
-- Limpeza.
-- ---------------------------------------------------------------------
select pg_temp.limpa();
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
