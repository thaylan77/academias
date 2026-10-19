-- Lista de check-ins da aula na ficha da turma (#16): a mesma leitura que o
-- painel faz em `presencas` (academia, turma e dia, com o nome do aluno).
-- O RLS deixa a equipe da academia ver, e mais ninguém: o professor de
-- outra academia não vê nada, nem sabendo os UUIDs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- ---------------------------------------------------------------------
-- Fixtures
--   Academia A: professor, recepção, login de aluno (a1); turma ta
--   Academia B: professor; turma tb
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f6000000-0000-4000-8000-0000000000a2', 'professor-a@aula.test'),
  ('f6000000-0000-4000-8000-0000000000a3', 'recepcao-a@aula.test'),
  ('f6000000-0000-4000-8000-0000000000c1', 'aluno1@aula.test'),
  ('f6000000-0000-4000-8000-0000000000b2', 'professor-b@aula.test');

insert into public.academias (id, nome, slug, status) values
  ('f6000000-0000-4000-8000-00000000000a', 'Aula A', 'aula-teste-a', 'ativa'),
  ('f6000000-0000-4000-8000-00000000000b', 'Aula B', 'aula-teste-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000000a2', 'professor'),
  ('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000000a3', 'recepcao'),
  ('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000000c1', 'aluno'),
  ('f6000000-0000-4000-8000-00000000000b', 'f6000000-0000-4000-8000-0000000000b2', 'professor');

insert into public.modalidades (id, academia_id, nome) values
  ('f6000000-0000-4000-8000-000000000201', 'f6000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
  ('f6000000-0000-4000-8000-000000000202', 'f6000000-0000-4000-8000-00000000000b', 'Jiu-Jitsu');

insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('f6000000-0000-4000-8000-0000000003a1', 'f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-000000000201', 'Turma A'),
  ('f6000000-0000-4000-8000-0000000003b1', 'f6000000-0000-4000-8000-00000000000b', 'f6000000-0000-4000-8000-000000000202', 'Turma B');

insert into public.alunos (id, academia_id, nome, user_id) values
  ('f6000000-0000-4000-8000-0000000001a1', 'f6000000-0000-4000-8000-00000000000a', 'Aluno 1', 'f6000000-0000-4000-8000-0000000000c1'),
  ('f6000000-0000-4000-8000-0000000001a2', 'f6000000-0000-4000-8000-00000000000a', 'Aluno 2', null),
  ('f6000000-0000-4000-8000-0000000001b1', 'f6000000-0000-4000-8000-00000000000b', 'Aluno de B', null);

-- Dois check-ins hoje e um ontem na turma de A; um hoje na turma de B.
insert into public.presencas (academia_id, aluno_id, turma_id, data, checkin_em, origem) values
  ('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000001a1', 'f6000000-0000-4000-8000-0000000003a1',
   public.hoje_academia('f6000000-0000-4000-8000-00000000000a'), now() - interval '10 minutes', 'qrcode'),
  ('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000001a2', 'f6000000-0000-4000-8000-0000000003a1',
   public.hoje_academia('f6000000-0000-4000-8000-00000000000a'), now() - interval '5 minutes', 'professor'),
  ('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000001a2', 'f6000000-0000-4000-8000-0000000003a1',
   public.hoje_academia('f6000000-0000-4000-8000-00000000000a') - 1, now() - interval '1 day', 'recepcao'),
  ('f6000000-0000-4000-8000-00000000000b', 'f6000000-0000-4000-8000-0000000001b1', 'f6000000-0000-4000-8000-0000000003b1',
   public.hoje_academia('f6000000-0000-4000-8000-00000000000b'), now(), 'qrcode');

-- A leitura do painel, como o PostgREST a executa (o nome vem de alunos,
-- também sob RLS).
create function pg_temp.lista(p_academia uuid, p_turma uuid)
returns text
language sql
as $$
  select coalesce(string_agg(coalesce(a.nome, '?') || '/' || p.origem, ', ' order by p.checkin_em desc), '')
  from public.presencas p
  left join public.alunos a on a.academia_id = p.academia_id and a.id = p.aluno_id
  where p.academia_id = p_academia
    and p.turma_id = p_turma
    and p.data = public.hoje_academia(p_academia)
$$;

-- ---------------------------------------------------------------------
-- Equipe de A
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f6000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000003a1'),
  'Aluno 2/professor, Aluno 1/qrcode',
  'professor de A vê os check-ins de hoje da turma, com nome, mais recentes primeiro (o de ontem fica de fora)');
select is((select count(*)::int from public.presencas where turma_id = 'f6000000-0000-4000-8000-0000000003a1'), 3,
  'professor de A vê também o histórico da turma');
select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000b', 'f6000000-0000-4000-8000-0000000003b1'), '',
  'professor de A não vê a turma de B');
select is((select count(*)::int from public.presencas where academia_id = 'f6000000-0000-4000-8000-00000000000b'), 0,
  'professor de A não lê nenhuma presença de B');

set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims = '{"sub":"f6000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000003a1'),
  'Aluno 2/professor, Aluno 1/qrcode', 'recepção de A vê a lista');

-- ---------------------------------------------------------------------
-- Professor de B, sabendo os UUIDs de A
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-0000000000b2';
set local request.jwt.claims = '{"sub":"f6000000-0000-4000-8000-0000000000b2","role":"authenticated"}';

select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000003a1'), '',
  'professor de B não vê os check-ins da turma de A');
select is((select count(*)::int from public.presencas where academia_id = 'f6000000-0000-4000-8000-00000000000a'), 0,
  'professor de B não lê nenhuma presença de A');
select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000b', 'f6000000-0000-4000-8000-0000000003b1'),
  'Aluno de B/qrcode', 'professor de B vê a própria turma');

-- ---------------------------------------------------------------------
-- Aluno de A: só a própria presença, nunca a lista da turma
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-0000000000c1';
set local request.jwt.claims = '{"sub":"f6000000-0000-4000-8000-0000000000c1","role":"authenticated"}';

select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000003a1'),
  'Aluno 1/qrcode', 'aluno vê só o próprio check-in, não o dos colegas');

-- ---------------------------------------------------------------------
-- Visitante anônimo
-- ---------------------------------------------------------------------
reset role;
set local role anon;
select is((select count(*)::int from public.presencas), 0, 'anônimo não lê presenças');

-- ---------------------------------------------------------------------
-- Academia suspensa: a equipe continua lendo (só a escrita para)
-- ---------------------------------------------------------------------
reset role;
update public.academias set status = 'suspensa' where id = 'f6000000-0000-4000-8000-00000000000a';
set local role authenticated;
set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f6000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000003a1'),
  'Aluno 2/professor, Aluno 1/qrcode', 'academia suspensa: professor ainda vê a lista');

-- Membro removido da academia deixa de ver.
reset role;
delete from public.membros_academia
 where academia_id = 'f6000000-0000-4000-8000-00000000000a' and user_id = 'f6000000-0000-4000-8000-0000000000a2';
set local role authenticated;
set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f6000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is(pg_temp.lista('f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-0000000003a1'), '',
  'professor removido da academia não vê mais a lista');

reset role;
select * from finish();
rollback;
