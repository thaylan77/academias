-- Geração de cobranças contra trancar e encerrar, sob concorrência (revisão
-- do Codex no PR #64).
--
-- gerar_cobrancas trava a matrícula (for share). Com um trancamento ou
-- encerramento aberto, ela espera e, depois do commit, reavalia a matrícula
-- já atualizada: não cobra a trancada nem o vencimento depois do fim. Na
-- ordem inversa, trancar espera a geração e conta a cobrança que ela gravou.
-- Contra anonimizar_aluno (que trava o aluno e depois cancela as matrículas),
-- a geração trava o aluno antes da matrícula: espera, e não há ciclo.
-- Nenhuma das ordens trava em deadlock (as RPCs travam o aluno com
-- "for no key update", que não conflita com a chave estrangeira de cobrancas).
--
-- Duas transações de verdade (dblink). As fixtures são gravadas e
-- confirmadas por uma conexão própria e apagadas no fim.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(20);

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
-- As duas sessões agem como o dono da academia (anonimizar é de dono e admin). Nenhuma espera pode travar o CI.
select extensions.dblink_exec(c, $s$
  set statement_timeout = '20s';
  set role authenticated;
  set request.jwt.claim.sub = 'f9200000-0000-4000-8000-0000000000a1';
  set request.jwt.claims = '{"sub":"f9200000-0000-4000-8000-0000000000a1","role":"authenticated"}';
$s$) from unnest(array['s1', 's2']) c;

-- ---------------------------------------------------------------------
-- Fixtures confirmadas: academia ativa, dono, plano e quatro alunos, cada um
-- com uma matrícula ativa cadastrada hoje, que gera agora a primeira cobrança
-- (vence hoje): M1 (trancar), M2 (encerrar, início 5 dias atrás), M3 (ordem
-- inversa), M4 (anonimizar).
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  insert into auth.users (id, email) values
    ('f9200000-0000-4000-8000-0000000000a1', 'dono@gerar-concorrencia.test');
  insert into public.academias (id, nome, slug, status) values
    ('f9200000-0000-4000-8000-00000000000a', 'Gerar concorrência', 'gerar-concorrencia-a', 'ativa');
  insert into public.membros_academia (academia_id, user_id, papel) values
    ('f9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-0000000000a1', 'dono');
  insert into public.planos (id, academia_id, nome, valor, ativo) values
    ('f9200000-0000-4000-8000-0000000004a1', 'f9200000-0000-4000-8000-00000000000a', 'Mensal', 150, true);
  insert into public.alunos (id, academia_id, nome, status) values
    ('f9200000-0000-4000-8000-0000000001a1', 'f9200000-0000-4000-8000-00000000000a', 'Aluno 1', 'ativo'),
    ('f9200000-0000-4000-8000-0000000001a2', 'f9200000-0000-4000-8000-00000000000a', 'Aluno 2', 'ativo'),
    ('f9200000-0000-4000-8000-0000000001a3', 'f9200000-0000-4000-8000-00000000000a', 'Aluno 3', 'ativo'),
    ('f9200000-0000-4000-8000-0000000001a4', 'f9200000-0000-4000-8000-00000000000a', 'Aluno 4', 'ativo');
  insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, origem, data_inicio, dia_vencimento) values
    ('f9200000-0000-4000-8000-000000000401', 'f9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-0000000001a1',
     'f9200000-0000-4000-8000-0000000004a1', 'ativa', 'recepcao', public.hoje_academia('f9200000-0000-4000-8000-00000000000a'), 28),
    ('f9200000-0000-4000-8000-000000000402', 'f9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-0000000001a2',
     'f9200000-0000-4000-8000-0000000004a1', 'ativa', 'recepcao', public.hoje_academia('f9200000-0000-4000-8000-00000000000a') - 5, 28),
    ('f9200000-0000-4000-8000-000000000403', 'f9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-0000000001a3',
     'f9200000-0000-4000-8000-0000000004a1', 'ativa', 'recepcao', public.hoje_academia('f9200000-0000-4000-8000-00000000000a'), 28),
    ('f9200000-0000-4000-8000-000000000404', 'f9200000-0000-4000-8000-00000000000a', 'f9200000-0000-4000-8000-0000000001a4',
     'f9200000-0000-4000-8000-0000000004a1', 'ativa', 'recepcao', public.hoje_academia('f9200000-0000-4000-8000-00000000000a'), 28);
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

-- Resultado inteiro da consulta assíncrona de s2, ou a mensagem de erro.
create function pg_temp.resultado_s2() returns text language plpgsql as $$
declare
  v_val text;
  v_msg text;
begin
  select n into v_val from extensions.dblink_get_result('s2', false) as r(n text);
  v_msg := extensions.dblink_error_message('s2');
  perform * from extensions.dblink_get_result('s2', false) as r(n text);
  return case when v_msg is null or v_msg = 'OK' then coalesce(v_val, 'nulo') else v_msg end;
end
$$;

create function pg_temp.cobrancas_de(p_matricula uuid) returns int language sql as $$
  select count(*)::int from public.cobrancas where matricula_id = p_matricula
$$;

select ok(not exists (select 1 from pg_stat_activity
                      where application_name = 'teste_concorrencia' and wait_event_type = 'Lock'),
  'antes dos envios, nenhuma sessão do teste está esperando');

-- ---------------------------------------------------------------------
-- A. s1 tranca M1 e não confirma; s2 gera as cobranças de M1.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select is((select n from extensions.dblink('s1', $$select public.trancar_matricula('f9200000-0000-4000-8000-000000000401')$$) as r(n int)),
  0, 'A: trancar conta zero pendentes (ainda não há cobrança)');
select is(extensions.dblink_send_query('s2', $$
  select public.gerar_cobrancas_matricula('f9200000-0000-4000-8000-000000000401')::text
$$), 1, 'A: s2 envia a geração');
select ok(pg_temp.alguem_esperando(), 'A: a geração espera o trancamento aberto (trava da matrícula)');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), '0', 'A: depois do commit, a geração não cobra a matrícula trancada');
select is(pg_temp.cobrancas_de('f9200000-0000-4000-8000-000000000401'), 0, 'A: nenhuma cobrança para M1');

-- ---------------------------------------------------------------------
-- B. s1 encerra M2 ontem e não confirma; s2 gera as cobranças de M2.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select is((select n from extensions.dblink('s1', $$select public.encerrar_matricula('f9200000-0000-4000-8000-000000000402',
             public.hoje_academia('f9200000-0000-4000-8000-00000000000a') - 1)$$) as r(n int)),
  0, 'B: encerrar conta zero pendentes depois do fim');
select is(extensions.dblink_send_query('s2', $$
  select public.gerar_cobrancas_matricula('f9200000-0000-4000-8000-000000000402')::text
$$), 1, 'B: s2 envia a geração');
select ok(pg_temp.alguem_esperando(), 'B: a geração espera o encerramento aberto');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), '0', 'B: depois do commit, a geração não cobra vencimento depois do fim');
select is(pg_temp.cobrancas_de('f9200000-0000-4000-8000-000000000402'), 0, 'B: nenhuma cobrança para M2');

-- ---------------------------------------------------------------------
-- C. Ordem inversa: s1 gera as cobranças de M3 e não confirma; s2 tranca M3.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select is((select n from extensions.dblink('s1', $$select public.gerar_cobrancas_matricula('f9200000-0000-4000-8000-000000000403')$$) as r(n int)),
  1, 'C: a geração aberta grava a primeira cobrança');
select is(extensions.dblink_send_query('s2', $$
  select public.trancar_matricula('f9200000-0000-4000-8000-000000000403')::text
$$), 1, 'C: s2 envia o trancamento');
select ok(pg_temp.alguem_esperando(), 'C: o trancamento espera a geração aberta');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), '1', 'C: depois do commit, trancar termina (sem deadlock) e conta a cobrança gravada');

-- ---------------------------------------------------------------------
-- D. s1 trava o aluno 4 (o primeiro passo de anonimizar_aluno) e não
--    confirma; s2 gera as cobranças de M4; então s1 anonimiza o aluno.
--    Se a geração travasse a matrícula antes do aluno, as duas se
--    esperariam (deadlock): a anonimização vai cancelar M4.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('s1', 'begin');
select extensions.dblink_exec('s1', $$do $d$ begin
  perform 1 from public.alunos where id = 'f9200000-0000-4000-8000-0000000001a4' for update;
end $d$ $$);
select is(extensions.dblink_send_query('s2', $$
  select public.gerar_cobrancas_matricula('f9200000-0000-4000-8000-000000000404')::text
$$), 1, 'D: s2 envia a geração');
select ok(pg_temp.alguem_esperando(), 'D: a geração espera o aluno travado');
-- Síncrono: se o Postgres abortar s1 por deadlock, o teste para aqui com o erro;
-- se abortar s2, o resultado dela (abaixo) traz o erro.
select is((select r from extensions.dblink('s1', $$
  select 'sem deadlock' from (select public.anonimizar_aluno('f9200000-0000-4000-8000-0000000001a4')) x
$$) as t(r text)), 'sem deadlock', 'D: a anonimização segue sem esperar a geração');
select extensions.dblink_exec('s1', 'commit');
select is(pg_temp.resultado_s2(), '0', 'D: depois do commit, a geração termina (sem deadlock) e não cobra o aluno anonimizado');
select is((select m.status || '|' || (a.anonimizado_em is not null)::text || '|' || pg_temp.cobrancas_de(m.id)
             from public.matriculas m join public.alunos a on a.id = m.aluno_id
            where m.id = 'f9200000-0000-4000-8000-000000000404'),
  'cancelada|true|0', 'D: aluno anonimizado, matrícula cancelada e nenhuma cobrança');

-- ---------------------------------------------------------------------
-- Limpeza das fixtures confirmadas.
-- ---------------------------------------------------------------------
select extensions.dblink_exec('prep', $f$
  delete from public.cobrancas        where academia_id = 'f9200000-0000-4000-8000-00000000000a';
  delete from public.matriculas       where academia_id = 'f9200000-0000-4000-8000-00000000000a';
  delete from public.alunos           where academia_id = 'f9200000-0000-4000-8000-00000000000a';
  delete from public.planos           where academia_id = 'f9200000-0000-4000-8000-00000000000a';
  delete from public.membros_academia where academia_id = 'f9200000-0000-4000-8000-00000000000a';
  delete from public.academias        where id          = 'f9200000-0000-4000-8000-00000000000a';
  delete from auth.users              where id          = 'f9200000-0000-4000-8000-0000000000a1';
$f$);
select extensions.dblink_disconnect('s2');
select extensions.dblink_disconnect('s1');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
