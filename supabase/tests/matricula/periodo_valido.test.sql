-- Matrícula com período invertido (issue #47): o check
-- matriculas_periodo_valido recusa data_fim antes de data_inicio em qualquer
-- caminho (gravação direta, encerrar_matricula), e fim no mesmo dia do início
-- continua valendo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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

-- ---------------------------------------------------------------------
-- Caminhos que mexem nas datas sem passar pela RPC de encerrar (revisão do
-- Codex no PR #65).
--   anonimizar_aluno com matrícula que ainda não começou, na academia ativa
--   e na suspensa (a anonimização não depende da assinatura);
--   anonimizar_aluno mantém o fim da matrícula que já tinha terminado;
--   aprovar_matricula de pedido cujo fim já passou, com fim hoje e sem fim.
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('fe200000-0000-4000-8000-0000000000a2', 'dono@periodo.test'),
  ('fe200000-0000-4000-8000-0000000000c2', 'dono-c@periodo.test');
insert into public.academias (id, nome, slug, status) values
  ('fe200000-0000-4000-8000-00000000000c', 'Período C', 'periodo-c', 'suspensa');
insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000000a2', 'dono'),
  ('fe200000-0000-4000-8000-00000000000c', 'fe200000-0000-4000-8000-0000000000c2', 'dono');
insert into public.alunos (id, academia_id, nome, cpf) values
  ('fe200000-0000-4000-8000-0000000001a2', 'fe200000-0000-4000-8000-00000000000a', 'Aluno futuro', '52998224725'),
  ('fe200000-0000-4000-8000-0000000001a3', 'fe200000-0000-4000-8000-00000000000a', 'Aluno pedidos', null),
  ('fe200000-0000-4000-8000-0000000001c1', 'fe200000-0000-4000-8000-00000000000c', 'Aluno futuro C', null);
insert into public.matriculas (id, academia_id, aluno_id, status, origem, data_inicio, data_fim) values
  ('fe200000-0000-4000-8000-000000000502', 'fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a2',
   'ativa', 'recepcao', public.hoje_academia('fe200000-0000-4000-8000-00000000000a') + 10, null),
  ('fe200000-0000-4000-8000-000000000503', 'fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a3',
   'pendente', 'online', public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 5, public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 1),
  ('fe200000-0000-4000-8000-000000000504', 'fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a3',
   'pendente', 'online', public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 5, public.hoje_academia('fe200000-0000-4000-8000-00000000000a')),
  ('fe200000-0000-4000-8000-000000000505', 'fe200000-0000-4000-8000-00000000000c', 'fe200000-0000-4000-8000-0000000001c1',
   'ativa', 'recepcao', public.hoje_academia('fe200000-0000-4000-8000-00000000000c') + 10, null),
  ('fe200000-0000-4000-8000-000000000506', 'fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a2',
   'ativa', 'recepcao', public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 60, public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 10),
  ('fe200000-0000-4000-8000-000000000507', 'fe200000-0000-4000-8000-00000000000a', 'fe200000-0000-4000-8000-0000000001a3',
   'pendente', 'online', public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 5, null);

set local role authenticated;
set local request.jwt.claim.sub = 'fe200000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"fe200000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is(pg_temp.hint_de($$select public.anonimizar_aluno('fe200000-0000-4000-8000-0000000001a2')$$),
          'sem erro', 'anonimizar aluno com matrícula que ainda não começou funciona');
select is(pg_temp.hint_de($$select public.aprovar_matricula('fe200000-0000-4000-8000-000000000503')$$),
          'matricula_vencida', 'aprovar pedido cujo fim já passou: matricula_vencida');
select is(pg_temp.hint_de($$select public.aprovar_matricula('fe200000-0000-4000-8000-000000000504')$$),
          'sem erro', 'aprovar pedido com fim hoje funciona (início vira hoje)');
select is(pg_temp.hint_de($$select public.aprovar_matricula('fe200000-0000-4000-8000-000000000507')$$),
          'sem erro', 'aprovar pedido sem fim funciona');
set local request.jwt.claim.sub = 'fe200000-0000-4000-8000-0000000000c2';
set local request.jwt.claims = '{"sub":"fe200000-0000-4000-8000-0000000000c2","role":"authenticated"}';
select is(pg_temp.hint_de($$select public.anonimizar_aluno('fe200000-0000-4000-8000-0000000001c1')$$),
          'sem erro', 'na academia suspensa, a anonimização com matrícula futura também funciona');
reset role;

select is((select m.status || '|' || (m.data_fim = m.data_inicio)::text || '|' || (a.cpf is null)::text
             from public.matriculas m join public.alunos a on a.id = m.aluno_id
            where m.id = 'fe200000-0000-4000-8000-000000000502'),
          'cancelada|true|true', 'a matrícula futura fica cancelada com fim no próprio início, e os dados pessoais saem');
select is((select status || '|' || data_inicio || '|' || data_fim from public.matriculas where id = 'fe200000-0000-4000-8000-000000000503'),
          'pendente|' || (public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 5) || '|' || (public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 1),
          'o pedido vencido continua como estava');
select is((select status || '|' || data_inicio || '|' || data_fim from public.matriculas where id = 'fe200000-0000-4000-8000-000000000504'),
          'ativa|' || public.hoje_academia('fe200000-0000-4000-8000-00000000000a') || '|' || public.hoje_academia('fe200000-0000-4000-8000-00000000000a'),
          'o aprovado com fim hoje vale só hoje');
select is((select m.status || '|' || (a.anonimizado_em is not null)::text
             from public.matriculas m join public.alunos a on a.id = m.aluno_id
            where m.id = 'fe200000-0000-4000-8000-000000000505'),
          'cancelada|true', 'na suspensa, matrícula cancelada e aluno anonimizado');

select is((select status || '|' || data_fim from public.matriculas where id = 'fe200000-0000-4000-8000-000000000506'),
          'cancelada|' || (public.hoje_academia('fe200000-0000-4000-8000-00000000000a') - 10), 'a anonimização cancela a matrícula que já tinha terminado sem mudar o fim dela');
select is((select status || '|' || data_inicio || '|' || coalesce(data_fim::text, 'sem fim') from public.matriculas where id = 'fe200000-0000-4000-8000-000000000507'),
          'ativa|' || public.hoje_academia('fe200000-0000-4000-8000-00000000000a') || '|sem fim', 'o aprovado sem fim começa hoje e segue sem fim');

select * from finish();
rollback;
