-- Procedure gerar_cobrancas_agendado (issue #18): é o que o job chama. Ela faz
-- commit depois de cada academia, então não roda dentro da transação deste
-- teste: é chamada numa sessão própria (dblink), como service_role, com as
-- fixtures confirmadas por outra conexão e apagadas no fim.
--   - gera para a academia ativa e não registra a suspensa;
--   - uma academia em trial com fuso inválido fica com o erro no registro e
--     não para o lote;
--   - limpa do registro o que passou de 180 dias e mantém o resto.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(8);

-- Mesma conexão de matricula/concorrencia.test.sql (ver o comentário lá).
create function pg_temp.conexao() returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=teste_lote',
                coalesce(host(inet_server_addr()), 'localhost'),
                coalesce(inet_server_port(), current_setting('port')::int),
                current_database())
$$;

select extensions.dblink_connect('prep', pg_temp.conexao());
select extensions.dblink_connect('job', pg_temp.conexao());
select extensions.dblink_exec('job', $s$ set statement_timeout = '60s'; set role service_role; $s$);

create temp table t_inicio as select clock_timestamp() as em;

-- A ativa, com uma matrícula que gera hoje a primeira cobrança e dois registros
-- antigos (200 e 10 dias); C suspensa, com a mesma matrícula; Zero (id antes
-- do de A, para ser a primeira do lote) em trial com fuso inválido.
select extensions.dblink_exec('prep', $f$
  insert into public.academias (id, nome, slug, status) values
    ('fe500000-0000-4000-8000-00000000000a', 'Lote A', 'lote-a', 'ativa'),
    ('fe500000-0000-4000-8000-00000000000c', 'Lote C', 'lote-c', 'suspensa');
  insert into public.academias (id, nome, slug, status, fuso) values
    ('00000000-0000-4000-8000-0000000fe500', 'Lote Zero', 'lote-zero', 'trial', 'Fuso/Invalido');
  insert into public.planos (id, academia_id, nome, valor, ativo) values
    ('fe500000-0000-4000-8000-0000000004a1', 'fe500000-0000-4000-8000-00000000000a', 'Mensal', 150, true),
    ('fe500000-0000-4000-8000-0000000004c1', 'fe500000-0000-4000-8000-00000000000c', 'Mensal', 150, true);
  insert into public.alunos (id, academia_id, nome, status) values
    ('fe500000-0000-4000-8000-0000000001a1', 'fe500000-0000-4000-8000-00000000000a', 'Aluno A', 'ativo'),
    ('fe500000-0000-4000-8000-0000000001c1', 'fe500000-0000-4000-8000-00000000000c', 'Aluno C', 'ativo');
  insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, origem, data_inicio, dia_vencimento) values
    ('fe500000-0000-4000-8000-0000000005a1', 'fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-0000000001a1',
     'fe500000-0000-4000-8000-0000000004a1', 'ativa', 'recepcao', public.hoje_academia('fe500000-0000-4000-8000-00000000000a'), 28),
    ('fe500000-0000-4000-8000-0000000005c1', 'fe500000-0000-4000-8000-00000000000c', 'fe500000-0000-4000-8000-0000000001c1',
     'fe500000-0000-4000-8000-0000000004c1', 'ativa', 'recepcao', public.hoje_academia('fe500000-0000-4000-8000-00000000000c'), 28);
  insert into public.cobrancas_geracao_log (academia_id, executado_em, geradas) values
    ('fe500000-0000-4000-8000-00000000000a', now() - interval '200 days', 0),
    ('fe500000-0000-4000-8000-00000000000a', now() - interval '10 days', 0);
$f$);

select lives_ok($$select extensions.dblink_exec('job', 'call public.gerar_cobrancas_agendado()')$$,
  'o lote roda chamado como o job (sessão própria, com commit entre as academias)');

select is((select count(*)::int from public.cobrancas where academia_id = 'fe500000-0000-4000-8000-00000000000a'), 1,
  'A (ativa): gerou a cobrança');
select is((select count(*)::int from public.cobrancas where academia_id = 'fe500000-0000-4000-8000-00000000000c'), 0,
  'C (suspensa): nada gerado');
select is((select count(*)::int from public.cobrancas_geracao_log where academia_id = 'fe500000-0000-4000-8000-00000000000c'), 0,
  'C (suspensa): nada no registro');
select ok((select count(*) = 1 and bool_and(erro is not null) from public.cobrancas_geracao_log
            where academia_id = '00000000-0000-4000-8000-0000000fe500'), 'fuso inválido: erro no registro');
select is((select count(*)::int from public.cobrancas_geracao_log where academia_id = 'fe500000-0000-4000-8000-00000000000a'
            and executado_em >= (select em from t_inicio)), 1, 'e o lote seguiu para a academia seguinte');
select is((select string_agg(geradas::text, ',' order by executado_em) from public.cobrancas_geracao_log
            where academia_id = 'fe500000-0000-4000-8000-00000000000a'), '0,1',
  'A: o registro de 200 dias saiu; ficaram o de 10 dias e o de hoje, com 1 gerada');
select is((select count(*)::int from public.cobrancas_geracao_log where executado_em < now() - interval '180 days'), 0,
  'nada no registro passa de 180 dias');

-- Limpeza: fixtures e os registros que o lote criou (inclusive de outras
-- academias ativas do banco).
select extensions.dblink_exec('prep', format($f$
  delete from public.cobrancas_geracao_log where executado_em >= %L or academia_id in
    ('fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000fe500');
  delete from public.cobrancas   where academia_id in ('fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000fe500');
  delete from public.matriculas  where academia_id in ('fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000fe500');
  delete from public.alunos      where academia_id in ('fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000fe500');
  delete from public.planos      where academia_id in ('fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000fe500');
  delete from public.academias   where id in ('fe500000-0000-4000-8000-00000000000a', 'fe500000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000fe500');
$f$, (select em from t_inicio)));
select extensions.dblink_disconnect('job');
select extensions.dblink_disconnect('prep');

select * from finish();
rollback;
