-- Matrícula com período invertido (issue #47): o check
-- matriculas_periodo_valido recusa data_fim antes de data_inicio em qualquer
-- caminho (gravação direta, encerrar_matricula), e fim no mesmo dia do início
-- continua valendo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_check('public', 'matriculas', 'matriculas tem check');
select col_has_check('public', 'matriculas', array['data_fim', 'data_inicio'], 'o check cobre início e fim');

insert into auth.users (id, email) values ('fe200000-0000-4000-8000-0000000000a1', 'recepcao@periodo.test');
insert into public.academias (id, nome, slug, status) values
  ('fe200000-0000-4000-8000-00000000000a', 'Período A', 'periodo-a', 'ativa');
insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000000a1', 'recepcao');
insert into public.alunos (id, academia_id, nome) values
  ('fe200000-0000-4000-8000-0000000001a1', 'fe200000-0000-4000-8000-00000000000a', 'Aluno 1');
insert into public.matriculas (id, academia_id, aluno_id, status, data_inicio) values
  ('fe200000-0000-4000-8000-000000000501', 'fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a1',
   'ativa', '2026-03-10');

select throws_ok(
  $$insert into public.matriculas (academia_id, aluno_id, status, data_inicio, data_fim)
    values ('fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a1', 'cancelada', '2026-03-10', '2026-03-09')$$,
  '23514', null, 'gravação direta com fim antes do início é recusada (até cancelada)');
select throws_ok(
  $$update public.matriculas set data_fim = '2026-03-09' where id = 'fe200000-0000-4000-8000-000000000501'$$,
  '23514', null, 'pôr o fim antes do início é recusado');
select throws_ok(
  $$update public.matriculas set data_inicio = '2026-04-01', data_fim = '2026-03-31' where id = 'fe200000-0000-4000-8000-000000000501'$$,
  '23514', null, 'empurrar o início para depois do fim é recusado');
select lives_ok(
  $$update public.matriculas set data_fim = '2026-03-10' where id = 'fe200000-0000-4000-8000-000000000501'$$,
  'fim no mesmo dia do início vale');
select lives_ok(
  $$update public.matriculas set data_fim = null where id = 'fe200000-0000-4000-8000-000000000501'$$,
  'sem fim vale');

-- Pela RPC, a recusa continua com o hint de antes (a RPC confere primeiro).
set local role authenticated;
set local request.jwt.claim.sub = 'fe200000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"fe200000-0000-4000-8000-0000000000a1","role":"authenticated"}';
create function pg_temp.hint_de(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return coalesce(nullif(v, ''), 'sem hint: ' || sqlerrm);
end
$f$;
select is(pg_temp.hint_de($$select public.encerrar_matricula('fe200000-0000-4000-8000-000000000501', '2026-03-09')$$),
          'dados_invalidos', 'encerrar_matricula antes do início: dados_invalidos, como antes');
reset role;

select * from finish();
rollback;
