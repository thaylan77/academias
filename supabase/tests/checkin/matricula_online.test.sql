-- matricula_online: códigos de erro estáveis no hint.
-- Slug inexistente, matrícula fechada e academia suspensa respondem o mesmo
-- código público (matricula_fechada).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

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
  ('f6000000-0000-4000-8000-000000000201', 'f6000000-0000-4000-8000-00000000000b', 'Plano de outra academia', 100),
  ('f6000000-0000-4000-8000-000000000202', 'f6000000-0000-4000-8000-00000000000a', 'Plano da academia aberta', 100);

insert into public.modalidades (id, academia_id, nome) values
  ('f6000000-0000-4000-8000-000000000301', 'f6000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu');
insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('f6000000-0000-4000-8000-000000000401', 'f6000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-000000000301', 'Turma da aberta');

-- SQLSTATE do erro: entrada malformada tem de sair como P0001 (raise da
-- própria função), nunca como erro de conversão do Postgres (22xxx).
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
grant execute on function public.__sqlstate_de(text) to anon, authenticated;

set local role authenticated;

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

-- entradas malformadas: dados_invalidos, e não erro técnico de conversão
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"plano_id":"invalido"}')$$),
  'dados_invalidos', 'plano_id que não é uuid: dados_invalidos');
select is(public.__sqlstate_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"plano_id":"invalido"}')$$),
  'P0001', 'plano_id que não é uuid não vaza erro de conversão (22P02)');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"data_nascimento":"2026-02-30"}')$$),
  'dados_invalidos', 'Data que não existe (30 de fevereiro): dados_invalidos');
select is(public.__sqlstate_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"data_nascimento":"2026-02-30"}')$$),
  'P0001', 'Data que não existe não vaza erro de conversão (22008)');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"data_nascimento":"30/02/2000"}')$$),
  'dados_invalidos', 'Data fora do formato AAAA-MM-DD: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"data_nascimento":"2999-01-01"}')$$),
  'dados_invalidos', 'Data de nascimento no futuro: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":"invalido"}')$$),
  'dados_invalidos', 'aceite_termo que não é booleano: dados_invalidos');
select is(public.__sqlstate_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":"invalido"}')$$),
  'P0001', 'aceite_termo que não é booleano não vaza erro de conversão (22P02)');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":"true"}')$$),
  'dados_invalidos', 'aceite_termo como texto "true" não vale como aceite');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"turma_ids":123}')$$),
  'dados_invalidos', 'turma_ids que não é lista: dados_invalidos');
select is(public.__sqlstate_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"turma_ids":123}')$$),
  'P0001', 'turma_ids que não é lista não vaza erro técnico (22023)');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '{"nome":"Fulano de Tal","aceite_termo":true,"turma_ids":["nao-e-uuid"]}')$$),
  'dados_invalidos', 'turma_ids com item que não é uuid: dados_invalidos');
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta', '"texto solto"')$$),
  'dados_invalidos', 'p_dados que não é objeto: dados_invalidos');

-- o caminho feliz com plano, turmas e data válidos continua funcionando
select is(public.__hint_de($$select public.matricula_online('mat-teste-aberta',
    '{"nome":"Beltrano Completo","aceite_termo":true,"cpf":"33333333333","data_nascimento":"1990-05-20",
      "plano_id":"f6000000-0000-4000-8000-000000000202","turma_ids":["f6000000-0000-4000-8000-000000000401"]}')$$),
  'sem erro', 'Matrícula com plano, turma e data válidos é aceita');

reset role;
select is((select count(*) from public.alunos where academia_id = 'f6000000-0000-4000-8000-00000000000a'),
  3::bigint, 'Só as três matrículas válidas criaram aluno; nenhuma entrada malformada gravou nada');
select is((select count(*) from public.matriculas
            where academia_id = 'f6000000-0000-4000-8000-00000000000a' and status = 'pendente' and origem = 'online'),
  3::bigint, 'E as três nasceram pendentes, de origem online');
select is((select count(*) from public.matricula_turmas mt
            join public.matriculas ma on ma.id = mt.matricula_id
            join public.alunos al on al.id = ma.aluno_id
           where al.cpf = '33333333333' and mt.turma_id = 'f6000000-0000-4000-8000-000000000401'),
  1::bigint, 'A turma informada foi ligada à matrícula');

select * from finish();
rollback;
