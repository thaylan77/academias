-- Portal do aluno, parte do banco (issue #20): o login de e-mail confirmado se
-- liga aos alunos ativos pelo email do aluno ou pelo responsavel_email; nunca
-- a aluno pendente ou inativo, nunca troca um vínculo existente; e-mail não
-- confirmado é recusado. A matrícula online grava o responsavel_email e a
-- anonimização o apaga. Academias A e B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

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

create function public.__hint_de(p_sql text)
returns text
language plpgsql
as $$
declare v text;
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return coalesce(nullif(v, ''), 'sem hint: ' || sqlerrm);
end
$$;
grant execute on function public.__hint_de(text) to authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('fe800000-0000-4000-8000-0000000000e1', 'ana@vinculo.test',     now()),
  ('fe800000-0000-4000-8000-0000000000e2', 'pai@vinculo.test',     now()),
  ('fe800000-0000-4000-8000-0000000000e3', 'naoconf@vinculo.test', null),
  ('fe800000-0000-4000-8000-0000000000e4', 'outro@vinculo.test',   now()),
  ('fe800000-0000-4000-8000-0000000000a1', 'dono-a@vinculo.test',  now());

insert into public.academias (id, nome, slug, status, matricula_online_aberta) values
  ('fe800000-0000-4000-8000-00000000000a', 'Vinculo A', 'vinculo-a', 'ativa', true),
  ('fe800000-0000-4000-8000-00000000000b', 'Vinculo B', 'vinculo-b', 'ativa', false);

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe800000-0000-4000-8000-00000000000a', 'fe800000-0000-4000-8000-0000000000a1', 'dono');

-- a1: adulta com e-mail próprio (maiúsculas de propósito); a2 e a3: filhos do
-- pai; a4: filho pendente; a5: inativo; a6: já ligado a outro login; a7: do
-- login sem e-mail confirmado; b1: filho do pai na academia B.
insert into public.alunos (id, academia_id, nome, email, responsavel_email, status, user_id) values
  ('fe800000-0000-4000-8000-0000000001a1', 'fe800000-0000-4000-8000-00000000000a', 'Ana Adulta',  'Ana@Vinculo.test', null,                'ativo',    null),
  ('fe800000-0000-4000-8000-0000000001a2', 'fe800000-0000-4000-8000-00000000000a', 'Filho Um',    null,               'PAI@vinculo.test',  'ativo',    null),
  ('fe800000-0000-4000-8000-0000000001a3', 'fe800000-0000-4000-8000-00000000000a', 'Filha Dois',  'filha@vinculo.test','pai@vinculo.test', 'ativo',    null),
  ('fe800000-0000-4000-8000-0000000001a4', 'fe800000-0000-4000-8000-00000000000a', 'Filho Novo',  null,               'pai@vinculo.test',  'pendente', null),
  ('fe800000-0000-4000-8000-0000000001a5', 'fe800000-0000-4000-8000-00000000000a', 'Filho Antigo',null,               'pai@vinculo.test',  'inativo',  null),
  ('fe800000-0000-4000-8000-0000000001a6', 'fe800000-0000-4000-8000-00000000000a', 'Ja Ligado',   null,               'pai@vinculo.test',  'ativo',    'fe800000-0000-4000-8000-0000000000e4'),
  ('fe800000-0000-4000-8000-0000000001a7', 'fe800000-0000-4000-8000-00000000000a', 'Sem Confirma',null,               'naoconf@vinculo.test','ativo',  null),
  ('fe800000-0000-4000-8000-0000000001b1', 'fe800000-0000-4000-8000-00000000000b', 'Filho em B',  null,               'pai@vinculo.test',  'ativo',    null);

create function pg_temp.dono_do_login(p_aluno text) returns text language sql as $$
  select coalesce(user_id::text, '-') from public.alunos where id = p_aluno::uuid
$$;

-- ---------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------
select ok(has_column_privilege('authenticated', 'public.alunos', 'responsavel_email', 'INSERT')
          and has_column_privilege('authenticated', 'public.alunos', 'responsavel_email', 'UPDATE'),
          'a equipe grava responsavel_email (grant por coluna)');
select ok(not has_column_privilege('authenticated', 'public.alunos', 'user_id', 'UPDATE'),
          'user_id continua fora do alcance da API');

-- ---------------------------------------------------------------------
-- Vínculo
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe800000-0000-4000-8000-0000000000e1');
select is(public.vincular_meu_cadastro_aluno(), 1, 'Ana: liga o próprio cadastro (e-mail sem diferença de maiúsculas)');

select public.__como('fe800000-0000-4000-8000-0000000000e2');
select is(public.vincular_meu_cadastro_aluno(), 3, 'pai: liga os filhos ativos pelo responsavel_email, nas duas academias');
select is(public.sou_o_aluno('fe800000-0000-4000-8000-0000000001a2'), true, 'pai é o login do filho um');
select is(public.sou_o_aluno('fe800000-0000-4000-8000-0000000001a1'), false, 'pai não alcança a Ana');
select is((select responsavel_email from public.alunos where id = 'fe800000-0000-4000-8000-0000000001a2'), 'PAI@vinculo.test',
          'pai lê o cadastro do filho pelo RLS');
select is(public.vincular_meu_cadastro_aluno(), 0, 'rodar de novo não liga nada a mais');

select public.__como('fe800000-0000-4000-8000-0000000000e3');
select is(public.__hint_de($$select public.vincular_meu_cadastro_aluno()$$), 'email_nao_confirmado',
          'e-mail não confirmado é recusado, com o código no hint');
reset role;

select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a1'), 'fe800000-0000-4000-8000-0000000000e1', 'a1 ficou com a Ana');
select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a3'), 'fe800000-0000-4000-8000-0000000000e2',
          'a3, que tem e-mail próprio e o do pai, ficou com quem vinculou primeiro');
select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a4') || pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a5'), '--',
          'pendente e inativo não são ligados');
select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a6'), 'fe800000-0000-4000-8000-0000000000e4',
          'o vínculo existente não é trocado');
select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a7'), '-', 'sem e-mail confirmado, nada ligado');
select is((select string_agg(academia_id::text || ':' || papel, ',' order by academia_id) from public.membros_academia
            where user_id = 'fe800000-0000-4000-8000-0000000000e2'),
          'fe800000-0000-4000-8000-00000000000a:aluno,fe800000-0000-4000-8000-00000000000b:aluno',
          'pai virou aluno nas duas academias dos filhos');

-- ---------------------------------------------------------------------
-- Matrícula online grava o e-mail do responsável
-- ---------------------------------------------------------------------
set local role anon;
select lives_ok($$select public.matricula_online('vinculo-a', jsonb_build_object(
  'nome', 'Criança Online', 'data_nascimento', '2018-05-01', 'responsavel_nome', 'Mãe Online',
  'responsavel_cpf', '12345678909', 'responsavel_email', '  Mae@Vinculo.TEST ', 'aceite_termo', true))$$,
  'matrícula online aceita responsavel_email');
reset role;
select is((select responsavel_email from public.alunos where nome = 'Criança Online'), 'mae@vinculo.test',
          'gravado sem espaços e em minúsculas');

-- ---------------------------------------------------------------------
-- Anonimização apaga o e-mail do responsável
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe800000-0000-4000-8000-0000000000a1');
select public.anonimizar_aluno('fe800000-0000-4000-8000-0000000001a2');
reset role;
select is((select responsavel_email from public.alunos where id = 'fe800000-0000-4000-8000-0000000001a2'), null,
          'anonimizar apaga o responsavel_email');
set local role authenticated;
select public.__como('fe800000-0000-4000-8000-0000000000a1');
select throws_ok($$update public.alunos set responsavel_email = 'volta@vinculo.test' where id = 'fe800000-0000-4000-8000-0000000001a2'$$,
                 'P0001', null, 'e o cadastro anonimizado não recebe o e-mail de volta');

-- ---------------------------------------------------------------------
-- Trocar o e-mail desfaz o vínculo
-- ---------------------------------------------------------------------
-- Mesmo e-mail com outra caixa e espaço: o vínculo fica.
update public.alunos set email = ' ANA@vinculo.test ' where id = 'fe800000-0000-4000-8000-0000000001a1';
-- O responsável da a3 mudou (o e-mail próprio dela também não é o do pai).
update public.alunos set responsavel_email = 'novo@vinculo.test' where id = 'fe800000-0000-4000-8000-0000000001a3';
reset role;
select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a1'), 'fe800000-0000-4000-8000-0000000000e1',
          'trocar só a caixa ou espaços do e-mail mantém o vínculo');
select is(pg_temp.dono_do_login('fe800000-0000-4000-8000-0000000001a3'), '-',
          'trocar o e-mail do responsável tira o cadastro do login antigo');
select is((select string_agg(academia_id::text, ',' order by academia_id) from public.membros_academia
            where user_id = 'fe800000-0000-4000-8000-0000000000e2' and papel = 'aluno'),
          'fe800000-0000-4000-8000-00000000000b',
          'sem aluno na academia A, o pai perde o papel lá e fica na B');
set local role authenticated;
select public.__como('fe800000-0000-4000-8000-0000000000e2');
select is(public.sou_o_aluno('fe800000-0000-4000-8000-0000000001a3'), false, 'e não alcança mais o cadastro');
reset role;

select * from finish();
rollback;
