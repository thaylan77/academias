-- gerar_cobrancas_da_academia e cobrancas_geracao_log (issue #18): gera e
-- registra; a suspensa não gera nem registra; fuso inválido vira erro no
-- registro; o erro de uma academia fica no registro e
-- desfaz só o dela; rodar de novo não duplica; só dono e admin leem o
-- registro, e só o da própria academia; só service_role executa.
-- A procedure do lote (com commit) está em geracao_agendada_lote.test.sql e o
-- agendamento (pg_cron) em agendamento_cron.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ---------------------------------------------------------------------
-- Fixtures: academias A e B (ativas), C (suspensa) e D (ativa, mas a gravação
-- das cobranças dela falha), cada uma com uma matrícula que gera hoje a
-- primeira cobrança; E em trial com fuso inválido (academia_ativa falha).
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('fe400000-0000-4000-8000-0000000000a1', 'dono-a@agendada.test'),
  ('fe400000-0000-4000-8000-0000000000a2', 'admin-a@agendada.test'),
  ('fe400000-0000-4000-8000-0000000000a3', 'recepcao-a@agendada.test'),
  ('fe400000-0000-4000-8000-0000000000a4', 'professor-a@agendada.test'),
  ('fe400000-0000-4000-8000-0000000000b1', 'dono-b@agendada.test');

insert into public.academias (id, nome, slug, status) values
  ('fe400000-0000-4000-8000-00000000000a', 'Agendada A', 'agendada-a', 'ativa'),
  ('fe400000-0000-4000-8000-00000000000b', 'Agendada B', 'agendada-b', 'ativa'),
  ('fe400000-0000-4000-8000-00000000000c', 'Agendada C', 'agendada-c', 'suspensa'),
  ('fe400000-0000-4000-8000-00000000000d', 'Agendada D', 'agendada-d', 'ativa');
insert into public.academias (id, nome, slug, status, fuso) values
  ('fe400000-0000-4000-8000-00000000000e', 'Agendada E', 'agendada-e', 'trial', 'Fuso/Invalido');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe400000-0000-4000-8000-00000000000a', 'fe400000-0000-4000-8000-0000000000a1', 'dono'),
  ('fe400000-0000-4000-8000-00000000000a', 'fe400000-0000-4000-8000-0000000000a2', 'admin'),
  ('fe400000-0000-4000-8000-00000000000a', 'fe400000-0000-4000-8000-0000000000a3', 'recepcao'),
  ('fe400000-0000-4000-8000-00000000000a', 'fe400000-0000-4000-8000-0000000000a4', 'professor'),
  ('fe400000-0000-4000-8000-00000000000b', 'fe400000-0000-4000-8000-0000000000b1', 'dono');

insert into public.planos (id, academia_id, nome, valor, ativo)
select ('fe400000-0000-4000-8000-0000000004' || x || '1')::uuid, ('fe400000-0000-4000-8000-00000000000' || x)::uuid, 'Mensal', 150, true
from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.alunos (id, academia_id, nome, status)
select ('fe400000-0000-4000-8000-0000000001' || x || '1')::uuid, ('fe400000-0000-4000-8000-00000000000' || x)::uuid, 'Aluno ' || x, 'ativo'
from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, origem, data_inicio, dia_vencimento)
select ('fe400000-0000-4000-8000-0000000005' || x || '1')::uuid, ('fe400000-0000-4000-8000-00000000000' || x)::uuid,
       ('fe400000-0000-4000-8000-0000000001' || x || '1')::uuid, ('fe400000-0000-4000-8000-0000000004' || x || '1')::uuid,
       'ativa', 'recepcao', public.hoje_academia(('fe400000-0000-4000-8000-00000000000' || x)::uuid), 28
from unnest(array['a', 'b', 'c', 'd']) x;

-- A gravação das cobranças da academia D falha (só neste teste).
create function pg_temp.falha_em_d() returns trigger language plpgsql as $$
begin
  if new.academia_id = 'fe400000-0000-4000-8000-00000000000d' then
    raise exception 'falha simulada na academia D';
  end if;
  return new;
end
$$;
create trigger falha_em_d before insert on public.cobrancas for each row execute function pg_temp.falha_em_d();

create function pg_temp.cobrancas(p_academia text) returns int language sql as $$
  select count(*)::int from public.cobrancas where academia_id = p_academia::uuid
$$;
create function pg_temp.log(p_academia text) returns text language sql as $$
  select coalesce(string_agg(geradas || ':' || coalesce(erro, '-'), ',' order by executado_em, id), '')
  from public.cobrancas_geracao_log where academia_id = p_academia::uuid
$$;

-- ---------------------------------------------------------------------
-- 1. Estrutura e privilégios
-- ---------------------------------------------------------------------
select has_trigger('public', 'cobrancas_geracao_log', 'cobrancas_geracao_log_academia_imutavel', 'registro com academia imutável');
select ok((select relrowsecurity from pg_class where oid = 'public.cobrancas_geracao_log'::regclass), 'registro com RLS ligado');
select ok(not has_function_privilege('anon', 'public.gerar_cobrancas_da_academia(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.gerar_cobrancas_agendado()', 'execute'), 'anon não executa a geração agendada');
select ok(not has_function_privilege('authenticated', 'public.gerar_cobrancas_da_academia(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.gerar_cobrancas_agendado()', 'execute'), 'authenticated não executa a geração agendada');
select ok(has_function_privilege('service_role', 'public.gerar_cobrancas_da_academia(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.gerar_cobrancas_agendado()', 'execute'), 'service_role executa a geração agendada');

-- ---------------------------------------------------------------------
-- 2. A execução
-- ---------------------------------------------------------------------
select is(public.gerar_cobrancas_da_academia('fe400000-0000-4000-8000-00000000000a'), 1, 'A: devolve quantas gerou');
select public.gerar_cobrancas_da_academia(x::uuid) from unnest(array[
  'fe400000-0000-4000-8000-00000000000b', 'fe400000-0000-4000-8000-00000000000c', 'fe400000-0000-4000-8000-00000000000d']) x;
select is(pg_temp.cobrancas('fe400000-0000-4000-8000-00000000000a'), 1, 'A: gerou a cobrança');
select is(pg_temp.cobrancas('fe400000-0000-4000-8000-00000000000b'), 1, 'B: gerou a cobrança');
select is(pg_temp.cobrancas('fe400000-0000-4000-8000-00000000000c'), 0, 'C (suspensa): nada gerado');
select is(pg_temp.cobrancas('fe400000-0000-4000-8000-00000000000d'), 0, 'D: a falha desfez só o que era dela');
select is(pg_temp.log('fe400000-0000-4000-8000-00000000000a'), '1:-', 'A: registro com 1 gerada, sem erro');
select is(pg_temp.log('fe400000-0000-4000-8000-00000000000d'), '0:falha simulada na academia D', 'D: registro com o erro');
select is(pg_temp.log('fe400000-0000-4000-8000-00000000000c'), '', 'C (suspensa): sai sem gerar nem registrar');
select is(public.gerar_cobrancas_da_academia('fe400000-0000-4000-8000-00000000000e'), 0, 'E (fuso inválido): devolve zero sem estourar');
select ok((select erro is not null and geradas = 0 from public.cobrancas_geracao_log
            where academia_id = 'fe400000-0000-4000-8000-00000000000e'), 'E: registro com o erro do fuso');

select public.gerar_cobrancas_da_academia('fe400000-0000-4000-8000-00000000000a');
select is(pg_temp.cobrancas('fe400000-0000-4000-8000-00000000000a'), 1, 'rodar de novo não duplica');
select is(pg_temp.log('fe400000-0000-4000-8000-00000000000a'), '1:-,0:-', 'e registra a segunda execução, com zero');

-- ---------------------------------------------------------------------
-- 3. Quem lê o registro
-- ---------------------------------------------------------------------
create function pg_temp.vejo(p_user text, p_academia text) returns int language plpgsql as $$
declare v int;
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*)::int into v from public.cobrancas_geracao_log where academia_id = p_academia::uuid;
  reset role;
  return v;
end
$$;
select is(pg_temp.vejo('fe400000-0000-4000-8000-0000000000a1', 'fe400000-0000-4000-8000-00000000000a'), 2, 'dono de A lê o registro de A');
select is(pg_temp.vejo('fe400000-0000-4000-8000-0000000000a2', 'fe400000-0000-4000-8000-00000000000a'), 2, 'admin de A lê o registro de A');
select is(pg_temp.vejo('fe400000-0000-4000-8000-0000000000a3', 'fe400000-0000-4000-8000-00000000000a'), 0, 'recepção não lê o registro');
select is(pg_temp.vejo('fe400000-0000-4000-8000-0000000000a4', 'fe400000-0000-4000-8000-00000000000a'), 0, 'professor não lê o registro');
select is(pg_temp.vejo('fe400000-0000-4000-8000-0000000000a1', 'fe400000-0000-4000-8000-00000000000b'), 0, 'dono de A não lê o registro de B');
select is(pg_temp.vejo('fe400000-0000-4000-8000-0000000000b1', 'fe400000-0000-4000-8000-00000000000b'), 1, 'dono de B lê o de B');

set local role authenticated;
set local request.jwt.claim.sub = 'fe400000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"fe400000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.cobrancas_geracao_log (academia_id, geradas) values ('fe400000-0000-4000-8000-00000000000a', 9)$$,
  '42501', null, 'ninguém grava no registro pela API, nem o dono');
reset role;

select * from finish();
rollback;
