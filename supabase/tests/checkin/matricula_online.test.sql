-- matricula_online: códigos de erro estáveis no hint.
-- Slug inexistente, matrícula fechada e academia suspensa respondem o mesmo
-- código público (matricula_fechada).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function public.__hint_de(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'sem hint: ' || sqlerrm);
end
$$;
grant execute on function public.__hint_de(text) to anon, authenticated;

insert into public.academias (id, nome, slug, status, matricula_online_aberta) values
  ('f6000000-0000-4000-8000-00000000000a', 'Matrícula aberta',   'mat-teste-aberta',   'ativa',    true),
  ('f6000000-0000-4000-8000-00000000000b', 'Matrícula fechada',  'mat-teste-fechada',  'ativa',    false),
  ('f6000000-0000-4000-8000-00000000000c', 'Matrícula suspensa', 'mat-teste-suspensa', 'suspensa', true);

insert into public.planos (id, academia_id, nome, valor) values
  ('f6000000-0000-4000-8000-000000000201', 'f6000000-0000-4000-8000-00000000000b', 'Plano de outra academia', 100);

set local role anon;

select is(public.__hint_de($$select public.matricula_online('mat-teste-nao-existe', '{"nome":"Fulano de Tal","aceite_termo":true}')$$),
  'matricula_fechada', 'Slug inexistente: matricula_fechada');
select is(public.__hint_de($$select public.matricula_online('mat-teste-fechada', '{"nome":"Fulano de Tal","aceite_termo":true}')$$),
  'matricula_fechada', 'Matrícula online fechada: matricula_fechada');
select is(public.__hint_de($$select public.matricula_online('mat-teste-suspensa', '{"nome":"Fulano de Tal","aceite_termo":true}')$$),
  'matricula_fechada', 'Academia suspensa responde o mesmo código público: matricula_fechada');

select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"  ","aceite_termo":true}')$$),
  'dados_invalidos', 'Nome vazio: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal"}')$$),
  'dados_invalidos', 'Termo não aceito: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta',
    '{"nome":"Fulano de Tal","aceite_termo":true,"plano_id":"f6000000-0000-4000-8000-000000000201"}')$$),
  'dados_invalidos', 'Plano de outra academia: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"cpf":"123"}')$$),
  'dados_invalidos', 'CPF com menos de 11 dígitos: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta',
    '{"nome":"Criança de Tal","aceite_termo":true,"data_nascimento":"2020-01-01"}')$$),
  'menor_sem_responsavel', 'Menor sem responsável: menor_sem_responsavel');

select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta',
    '{"nome":"Criança de Tal","aceite_termo":true,"data_nascimento":"2020-01-01","responsavel_nome":"Mãe de Tal","responsavel_cpf":"111.111.111-11"}')$$),
  'sem erro', 'Menor com responsável é aceito');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"cpf":"222.222.222-22"}')$$),
  'sem erro', 'Matrícula válida é aceita');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Outro Fulano","aceite_termo":true,"cpf":"22222222222"}')$$),
  'cpf_duplicado', 'CPF já cadastrado na academia: cpf_duplicado');

reset role;
select is((select count(*) from public.alunos where academia_id = 'f6000000-0000-4000-8000-00000000000a'),
  2::bigint, 'Só as duas matrículas válidas criaram aluno');
select is((select count(*) from public.matriculas
            where academia_id = 'f6000000-0000-4000-8000-00000000000a' and status = 'pendente' and origem = 'online'),
  2::bigint, 'E as duas nasceram pendentes, de origem online');

select * from finish();
rollback;
