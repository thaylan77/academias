-- Apagar turma não apaga o histórico (issue #54): com presença ou matrícula
-- ligada, o delete pela API falha e nada some; turma sem nada ligado ainda se
-- apaga (com os horários); outra academia nem alcança.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function public.__sqlstate_de(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  return sqlstate;
end
$$;
grant execute on function public.__sqlstate_de(text) to authenticated;

create function public.__como(p_user text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end
$$;
grant execute on function public.__como(text) to authenticated;

insert into auth.users (id, email) values
  ('fe700000-0000-4000-8000-0000000000a1', 'dono-a@historico.test'),
  ('fe700000-0000-4000-8000-0000000000b1', 'dono-b@historico.test');

insert into public.academias (id, nome, slug, status) values
  ('fe700000-0000-4000-8000-00000000000a', 'Historico A', 'historico-a', 'ativa'),
  ('fe700000-0000-4000-8000-00000000000b', 'Historico B', 'historico-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000000a1', 'dono'),
  ('fe700000-0000-4000-8000-00000000000b', 'fe700000-0000-4000-8000-0000000000b1', 'dono');

insert into public.modalidades (id, academia_id, nome) values
  ('fe700000-0000-4000-8000-0000000002a1', 'fe700000-0000-4000-8000-00000000000a', 'Jiu-Jitsu');

-- t1: com presença; t2: só com matrícula; t3: sem nada, só com horário.
insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('fe700000-0000-4000-8000-0000000003a1', 'fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000002a1', 'Com presença'),
  ('fe700000-0000-4000-8000-0000000003a2', 'fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000002a1', 'Com matrícula'),
  ('fe700000-0000-4000-8000-0000000003a3', 'fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000002a1', 'Criada por engano');
insert into public.turma_horarios (academia_id, turma_id, dia_semana, hora_inicio, hora_fim) values
  ('fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000003a3', 1, '19:00', '20:00');

insert into public.alunos (id, academia_id, nome) values
  ('fe700000-0000-4000-8000-0000000001a1', 'fe700000-0000-4000-8000-00000000000a', 'Aluno A');
insert into public.matriculas (id, academia_id, aluno_id, status, data_inicio) values
  ('fe700000-0000-4000-8000-0000000005a1', 'fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000001a1', 'ativa', current_date);
insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
  ('fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000005a1', 'fe700000-0000-4000-8000-0000000003a2');
insert into public.presencas (academia_id, aluno_id, turma_id, data) values
  ('fe700000-0000-4000-8000-00000000000a', 'fe700000-0000-4000-8000-0000000001a1', 'fe700000-0000-4000-8000-0000000003a1', current_date - 7);

-- ---------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------
select is((select confdeltype::text from pg_constraint where conname = 'presencas_academia_id_turma_id_fkey'), 'a',
          'presencas -> turmas sem cascade (no action)');
select is((select confdeltype::text from pg_constraint where conname = 'matricula_turmas_academia_id_turma_id_fkey'), 'a',
          'matricula_turmas -> turmas sem cascade (no action)');
select is((select confdeltype::text from pg_constraint where conname = 'turma_horarios_academia_id_turma_id_fkey'), 'c',
          'turma_horarios continua em cascade');

-- ---------------------------------------------------------------------
-- Dono de B não alcança a turma de A
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe700000-0000-4000-8000-0000000000b1');
select is(public.__sqlstate_de($$delete from public.turmas where id = 'fe700000-0000-4000-8000-0000000003a3'$$), 'sem erro',
          'dono de B: o delete da turma de A não acha nada (RLS)');
reset role;
select is((select count(*)::int from public.turmas where id = 'fe700000-0000-4000-8000-0000000003a3'), 1,
          'e a turma de A continua lá');

-- ---------------------------------------------------------------------
-- Dono de A pela API
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe700000-0000-4000-8000-0000000000a1');
select is(public.__sqlstate_de($$delete from public.turmas where id = 'fe700000-0000-4000-8000-0000000003a1'$$), '23503',
          'turma com presença: o delete falha');
select is(public.__sqlstate_de($$delete from public.turmas where id = 'fe700000-0000-4000-8000-0000000003a2'$$), '23503',
          'turma com matrícula: o delete falha');
select is(public.__sqlstate_de($$delete from public.turmas where id = 'fe700000-0000-4000-8000-0000000003a3'$$), 'sem erro',
          'turma sem nada ligado: apaga');
reset role;
select is((select count(*)::int from public.presencas where turma_id = 'fe700000-0000-4000-8000-0000000003a1'), 1,
          'a presença continua');
select is((select count(*)::int from public.matricula_turmas where turma_id = 'fe700000-0000-4000-8000-0000000003a2'), 1,
          'o vínculo de matrícula continua');
select is((select count(*)::int from public.turma_horarios where turma_id = 'fe700000-0000-4000-8000-0000000003a3'), 0,
          'os horários da turma apagada foram junto');

select * from finish();
rollback;
