-- Painel: alunos (issue #26). Códigos no hint para os erros que a tela trata:
-- cpf_duplicado (gravação direta na tabela), aluno_anonimizado, e os de
-- anonimizar_aluno (sem_permissao, anonimizar_cobranca_pendente).
-- Duas academias: nada de uma conta como duplicata na outra.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function public.__erro_de(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return jsonb_build_object('hint', 'sem erro');
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return jsonb_build_object('hint', coalesce(nullif(v_hint, ''), 'sem hint'),
                            'mensagem', sqlerrm, 'sqlstate', sqlstate);
end
$$;
grant execute on function public.__erro_de(text) to authenticated;

create function public.__hint_de(p_sql text)
returns text
language sql
as $$ select public.__erro_de(p_sql) ->> 'hint' $$;
grant execute on function public.__hint_de(text) to authenticated;

insert into auth.users (id, email) values
  ('f9000000-0000-4000-8000-0000000000a1', 'recepcao-a@alunos.test'),
  ('f9000000-0000-4000-8000-0000000000a2', 'professor-a@alunos.test'),
  ('f9000000-0000-4000-8000-0000000000a3', 'dono-a@alunos.test'),
  ('f9000000-0000-4000-8000-0000000000b1', 'recepcao-b@alunos.test');

insert into public.academias (id, nome, slug, status) values
  ('f9000000-0000-4000-8000-00000000000a', 'Alunos A', 'alunos-hints-a', 'ativa'),
  ('f9000000-0000-4000-8000-00000000000b', 'Alunos B', 'alunos-hints-b', 'ativa'),
  ('f9000000-0000-4000-8000-00000000000c', 'Alunos C (suspensa)', 'alunos-hints-c', 'suspensa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('f9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-0000000000a1', 'recepcao'),
  ('f9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-0000000000a2', 'professor'),
  ('f9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-0000000000a3', 'dono'),
  ('f9000000-0000-4000-8000-00000000000b', 'f9000000-0000-4000-8000-0000000000b1', 'recepcao'),
  ('f9000000-0000-4000-8000-00000000000c', 'f9000000-0000-4000-8000-0000000000a3', 'dono');

insert into public.alunos (id, academia_id, nome, cpf) values
  ('f9000000-0000-4000-8000-0000000001a1', 'f9000000-0000-4000-8000-00000000000a', 'Aluno Um', '11111111111'),
  ('f9000000-0000-4000-8000-0000000001a2', 'f9000000-0000-4000-8000-00000000000a', 'Aluno Dois', '22222222222'),
  ('f9000000-0000-4000-8000-0000000001a3', 'f9000000-0000-4000-8000-00000000000a', 'Aluno Com Cobrança', null),
  ('f9000000-0000-4000-8000-0000000001c1', 'f9000000-0000-4000-8000-00000000000c', 'Aluno da Suspensa', null);

insert into public.cobrancas (academia_id, aluno_id, valor, vencimento) values
  ('f9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-0000000001a3', 150, current_date + 10);

-- ---------------------------------------------------------------------
-- Recepção da academia A
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f9000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(
  public.__hint_de($$insert into public.alunos (academia_id, nome, cpf)
                     values ('f9000000-0000-4000-8000-00000000000a', 'Outro', '11111111111')$$),
  'cpf_duplicado', 'novo aluno com CPF já cadastrado na academia: cpf_duplicado');

select is(
  public.__hint_de($$update public.alunos set cpf = '11111111111'
                     where id = 'f9000000-0000-4000-8000-0000000001a2'$$),
  'cpf_duplicado', 'trocar o CPF para o de outro aluno: cpf_duplicado');

select is(
  public.__hint_de($$update public.alunos set nome = 'Aluno Um Silva', cpf = '11111111111'
                     where id = 'f9000000-0000-4000-8000-0000000001a1'$$),
  'sem erro', 'editar o próprio aluno mantendo o CPF dele não é duplicata');

select is(
  public.__hint_de($$insert into public.alunos (academia_id, nome, cpf)
                     values ('f9000000-0000-4000-8000-00000000000a', 'Sem CPF 1', null)$$),
  'sem erro', 'aluno sem CPF passa');

select is(
  public.__hint_de($$insert into public.alunos (academia_id, nome, cpf)
                     values ('f9000000-0000-4000-8000-00000000000a', 'Sem CPF 2', null)$$),
  'sem erro', 'dois alunos sem CPF não são duplicata');

-- Recepção de A não anonimiza (só dono e admin).
select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000001a2')$$),
  'sem_permissao', 'recepção não anonimiza: sem_permissao');

reset role;

-- ---------------------------------------------------------------------
-- Recepção da academia B: o mesmo CPF vale lá (outra academia).
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-0000000000b1';
set local request.jwt.claims = '{"sub":"f9000000-0000-4000-8000-0000000000b1","role":"authenticated"}';

select is(
  public.__hint_de($$insert into public.alunos (academia_id, nome, cpf)
                     values ('f9000000-0000-4000-8000-00000000000b', 'Aluno de B', '11111111111')$$),
  'sem erro', 'o mesmo CPF em outra academia não é duplicata');

-- E o erro de duplicata não revela alunos de A para quem é de B.
select is(
  public.__hint_de($$insert into public.alunos (academia_id, nome, cpf)
                     values ('f9000000-0000-4000-8000-00000000000a', 'Intruso', '22222222222')$$),
  'sem hint', 'recepção de B gravando em A é recusada pelo RLS, sem cpf_duplicado');

select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000001a2')$$),
  'sem_permissao', 'recepção de B não anonimiza aluno de A: sem_permissao');

reset role;

-- ---------------------------------------------------------------------
-- Professor e dono de A
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f9000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000001a2')$$),
  'sem_permissao', 'professor não anonimiza: sem_permissao');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims = '{"sub":"f9000000-0000-4000-8000-0000000000a3","role":"authenticated"}';

select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000001a3')$$),
  'anonimizar_cobranca_pendente', 'aluno com cobrança pendente: anonimizar_cobranca_pendente');

select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000001a2')$$),
  'sem erro', 'dono anonimiza aluno sem cobrança pendente');

select is(
  public.__hint_de($$update public.alunos set nome = 'Voltou'
                     where id = 'f9000000-0000-4000-8000-0000000001a2'$$),
  'aluno_anonimizado', 'editar aluno anonimizado: aluno_anonimizado');

select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000009ff')$$),
  'sem_permissao', 'aluno inexistente: sem_permissao (não diz se existe)');

-- Academia suspensa: dono anonimiza mesmo assim (exceção LGPD), mas não edita.
select is(
  public.__hint_de($$update public.alunos set nome = 'Editado na suspensa'
                     where id = 'f9000000-0000-4000-8000-0000000001c1'$$),
  'sem erro', 'update na academia suspensa não dá erro (o RLS só filtra a linha)');
select is(
  (select nome from public.alunos where id = 'f9000000-0000-4000-8000-0000000001c1'),
  'Aluno da Suspensa', 'mas a academia suspensa não altera o aluno');
select is(
  public.__hint_de($$select public.anonimizar_aluno('f9000000-0000-4000-8000-0000000001c1')$$),
  'sem erro', 'academia suspensa: o dono anonimiza (exceção LGPD)');

reset role;

-- Recepção tentando editar o anonimizado: o gatilho avalia aluno_sem_dados_pessoais
-- com o papel dela (o caminho que falhava por permissão antes desta migration).
set local role authenticated;
set local request.jwt.claim.sub = 'f9000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f9000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(
  public.__hint_de($$update public.alunos set nome = 'Voltou'
                     where id = 'f9000000-0000-4000-8000-0000000001a2'$$),
  'aluno_anonimizado', 'recepção editando anonimizado: aluno_anonimizado (não permission denied)');
reset role;

select is(
  (select nome from public.alunos where id = 'f9000000-0000-4000-8000-0000000001a2'),
  'Aluno anonimizado',
  'o cadastro anonimizado continua sem dados pessoais'
);

select * from finish();
rollback;
