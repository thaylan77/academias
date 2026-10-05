-- Permissões do financeiro: sem delete em alunos e cobrancas, status só por
-- função, academia suspensa não altera nada, e a exceção da LGPD
-- (anonimizar_aluno funciona mesmo com a assinatura vencida).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ---------------------------------------------------------------------
-- Fixtures
--   A: ativa.  S: suspensa.  T: trial vencido.  Cada uma com um dono.
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f3000000-0000-4000-8000-0000000000a1', 'dono-a@perm.test'),
  ('f3000000-0000-4000-8000-0000000000a2', 'recepcao-a@perm.test'),
  ('f3000000-0000-4000-8000-0000000000e1', 'dono-s@perm.test'),
  ('f3000000-0000-4000-8000-0000000000e2', 'recepcao-s@perm.test'),
  ('f3000000-0000-4000-8000-0000000000f1', 'dono-t@perm.test');

insert into public.academias (id, nome, slug, status, trial_ate) values
  ('f3000000-0000-4000-8000-00000000000a', 'Permissões A', 'fin-perm-a', 'ativa',    current_date + 14),
  ('f3000000-0000-4000-8000-00000000000e', 'Permissões S', 'fin-perm-s', 'suspensa', current_date + 14),
  ('f3000000-0000-4000-8000-00000000000f', 'Permissões T', 'fin-perm-t', 'trial',    current_date - 5);

insert into public.membros_academia (academia_id, user_id, papel) values
  ('f3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-0000000000a1', 'dono'),
  ('f3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-0000000000a2', 'recepcao'),
  ('f3000000-0000-4000-8000-00000000000e', 'f3000000-0000-4000-8000-0000000000e1', 'dono'),
  ('f3000000-0000-4000-8000-00000000000e', 'f3000000-0000-4000-8000-0000000000e2', 'recepcao'),
  ('f3000000-0000-4000-8000-00000000000f', 'f3000000-0000-4000-8000-0000000000f1', 'dono');

insert into public.alunos (id, academia_id, nome, cpf, email) values
  ('f3000000-0000-4000-8000-0000000001a1', 'f3000000-0000-4000-8000-00000000000a', 'Aluno A', '11111111111', 'aluno-a@perm.test'),
  ('f3000000-0000-4000-8000-0000000001e1', 'f3000000-0000-4000-8000-00000000000e', 'Aluno S', '22222222222', 'aluno-s@perm.test');

insert into public.cobrancas (id, academia_id, aluno_id, valor, vencimento) values
  ('f3000000-0000-4000-8000-0000000000c1', 'f3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-0000000001a1', 100, current_date + 10);

-- cobrança já paga na academia suspensa: não impede a anonimização
insert into public.cobrancas (id, academia_id, aluno_id, valor, vencimento, status, pago_em) values
  ('f3000000-0000-4000-8000-0000000000c2', 'f3000000-0000-4000-8000-00000000000e', 'f3000000-0000-4000-8000-0000000001e1', 100, current_date - 40, 'paga', now());

-- ---------------------------------------------------------------------
-- 1. Dono de academia ativa: sem delete, status só por função
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$delete from public.alunos where id = 'f3000000-0000-4000-8000-0000000001a1'$$,
  '42501'::char(5), null::text, 'Delete em alunos: permission denied');
select throws_ok(
  $$delete from public.cobrancas where id = 'f3000000-0000-4000-8000-0000000000c1'$$,
  '42501'::char(5), null::text, 'Delete em cobrancas: permission denied');
select throws_ok(
  $$update public.cobrancas set status = 'paga', pago_em = now() where id = 'f3000000-0000-4000-8000-0000000000c1'$$,
  '42501'::char(5), null::text, 'Marcar paga por update direto: permission denied');
select throws_ok(
  $$insert into public.cobrancas (academia_id, aluno_id, valor, vencimento, status, pago_em)
    values ('f3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-0000000001a1', 10, current_date, 'paga', now())$$,
  '42501'::char(5), null::text, 'Criar cobrança já paga: permission denied');
select lives_ok(
  $$update public.academias set nome = 'Permissões A (editada)' where id = 'f3000000-0000-4000-8000-00000000000a'$$,
  'Dono de academia ativa atualiza a academia');

reset role;
select is((select nome from public.academias where id = 'f3000000-0000-4000-8000-00000000000a'),
  'Permissões A (editada)', 'Academia ativa foi atualizada');

-- ---------------------------------------------------------------------
-- 2. Academia suspensa ou com trial vencido não altera os próprios dados
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000e1';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000e1","role":"authenticated"}';

select lives_ok(
  $$update public.academias set nome = 'Tentativa' where id = 'f3000000-0000-4000-8000-00000000000e'$$,
  'Update da suspensa não dá erro (o RLS só não enxerga a linha)');
select is((select count(*) from public.academias where id = 'f3000000-0000-4000-8000-00000000000e'),
  1::bigint, 'Dono da suspensa continua lendo a academia');

reset role;
select is((select nome from public.academias where id = 'f3000000-0000-4000-8000-00000000000e'),
  'Permissões S', 'Suspensa não atualiza academia');

set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000f1';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000f1","role":"authenticated"}';

select lives_ok(
  $$update public.academias set nome = 'Tentativa' where id = 'f3000000-0000-4000-8000-00000000000f'$$,
  'Update do trial vencido não dá erro');

reset role;
select is((select nome from public.academias where id = 'f3000000-0000-4000-8000-00000000000f'),
  'Permissões T', 'Trial vencido não atualiza academia');

-- ---------------------------------------------------------------------
-- 3. LGPD: única escrita permitida com a assinatura vencida
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000e2';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000e2","role":"authenticated"}';

select throws_like(
  $$select public.anonimizar_aluno('f3000000-0000-4000-8000-0000000001e1')$$,
  '%sem permissão%', 'Recepção não anonimiza');
select throws_like(
  $$select public.baixar_cobranca_manual('f3000000-0000-4000-8000-0000000000c2')$$,
  '%sem permissão%', 'Suspensa não dá baixa em cobrança');

set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select throws_like(
  $$select public.anonimizar_aluno('f3000000-0000-4000-8000-0000000001e1')$$,
  '%sem permissão%', 'Dono de outra academia não anonimiza');

set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000e1';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000e1","role":"authenticated"}';

select lives_ok(
  $$select public.anonimizar_aluno('f3000000-0000-4000-8000-0000000001e1')$$,
  'Dono de academia suspensa anonimiza aluno');

reset role;
select is((select nome from public.alunos where id = 'f3000000-0000-4000-8000-0000000001e1'),
  'Aluno anonimizado', 'Nome anonimizado');
select is((select cpf is null and email is null and anonimizado_em is not null
             from public.alunos where id = 'f3000000-0000-4000-8000-0000000001e1'),
  true, 'CPF e e-mail apagados, anonimizado_em preenchido');
select is((select count(*) from public.cobrancas where aluno_id = 'f3000000-0000-4000-8000-0000000001e1'),
  1::bigint, 'Cobranças do aluno anonimizado são mantidas');
select throws_like(
  $$update public.alunos set nome = 'Volta' where id = 'f3000000-0000-4000-8000-0000000001e1'$$,
  '%anonimizado%', 'Cadastro anonimizado não aceita update nem do dono do banco');

-- ---------------------------------------------------------------------
-- 4. alunos: grants por coluna (user_id, anonimizado_em e academia_id
--    não são graváveis pela API)
-- ---------------------------------------------------------------------
insert into public.alunos (id, academia_id, nome, cpf, email) values
  ('f3000000-0000-4000-8000-0000000001a2', 'f3000000-0000-4000-8000-00000000000a', 'Aluno A2', '33333333333', 'aluno-a2@perm.test');
insert into public.modalidades (id, academia_id, nome) values
  ('f3000000-0000-4000-8000-000000000201', 'f3000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu');
insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('f3000000-0000-4000-8000-000000000301', 'f3000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-000000000201', 'Turma A');

set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$update public.alunos set anonimizado_em = now() where id = 'f3000000-0000-4000-8000-0000000001a2'$$,
  '42501'::char(5), null::text, 'Recepção não grava anonimizado_em');
select throws_ok(
  $$update public.alunos set user_id = 'f3000000-0000-4000-8000-0000000000a2' where id = 'f3000000-0000-4000-8000-0000000001a2'$$,
  '42501'::char(5), null::text, 'Recepção não grava user_id por update');
select throws_ok(
  $$insert into public.alunos (academia_id, nome, user_id)
    values ('f3000000-0000-4000-8000-00000000000a', 'Aluno com login', 'f3000000-0000-4000-8000-0000000000a2')$$,
  '42501'::char(5), null::text, 'Recepção não grava user_id por insert');
select throws_ok(
  $$update public.alunos set academia_id = 'f3000000-0000-4000-8000-00000000000e' where id = 'f3000000-0000-4000-8000-0000000001a2'$$,
  '42501'::char(5), null::text, 'Recepção não grava academia_id em aluno');
select lives_ok(
  $$update public.alunos set telefone = '5585999990000' where id = 'f3000000-0000-4000-8000-0000000001a2'$$,
  'Recepção continua editando os dados cadastrais');

reset role;
select is((select telefone from public.alunos where id = 'f3000000-0000-4000-8000-0000000001a2'),
  '5585999990000', 'Dado cadastral foi gravado');

-- marcador presente, dados pessoais ainda preenchidos: não conta como anonimizado
update public.alunos set anonimizado_em = now() where id = 'f3000000-0000-4000-8000-0000000001a2';

set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f3000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$select public.anonimizar_aluno('f3000000-0000-4000-8000-0000000001a2')$$,
  'anonimizar_aluno roda mesmo com o marcador já presente');

reset role;
select is((select nome = 'Aluno anonimizado' and cpf is null and telefone is null and email is null
             from public.alunos where id = 'f3000000-0000-4000-8000-0000000001a2'),
  true, 'Marcador presente com dados preenchidos: os dados são limpos');

-- ---------------------------------------------------------------------
-- 5. Nenhum registro muda de academia (trigger, vale até para o dono do banco)
-- ---------------------------------------------------------------------
select throws_like(
  $$update public.alunos set academia_id = 'f3000000-0000-4000-8000-00000000000e' where id = 'f3000000-0000-4000-8000-0000000001a1'$$,
  '%não pode mudar de academia%', 'Aluno não muda de academia');
select throws_like(
  $$update public.turmas set academia_id = 'f3000000-0000-4000-8000-00000000000e' where id = 'f3000000-0000-4000-8000-000000000301'$$,
  '%não pode mudar de academia%', 'Turma não muda de academia');
select is((select count(*)
             from information_schema.columns c
             join information_schema.tables t
               on t.table_schema = c.table_schema and t.table_name = c.table_name
            where c.table_schema = 'public' and c.column_name = 'academia_id' and t.table_type = 'BASE TABLE'
              and not exists (
                select 1 from pg_catalog.pg_trigger g
                where g.tgrelid = format('public.%I', c.table_name)::regclass
                  and g.tgname = c.table_name || '_academia_imutavel')),
  0::bigint, 'Toda tabela com academia_id tem o trigger de academia imutável');

select * from finish();
rollback;
