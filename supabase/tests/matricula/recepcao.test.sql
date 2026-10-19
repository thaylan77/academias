-- criar_matricula e aprovar_matricula (issue #14): dono, admin e recepção com
-- a assinatura em dia; professor, aluno e outra academia não alcançam.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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

-- p_dados padrão: aluno A2 na turma T1, sem plano.
create function public.__mat(p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'aluno_id', 'fc000000-0000-4000-8000-0000000001a2',
    'plano_id', null,
    'turma_ids', jsonb_build_array('fc000000-0000-4000-8000-0000000003a1')
  ) || p_extra
$$;
grant execute on function public.__mat(jsonb) to authenticated;

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
  ('fc000000-0000-4000-8000-0000000000a1', 'recepcao-a@mat.test'),
  ('fc000000-0000-4000-8000-0000000000a2', 'admin-a@mat.test'),
  ('fc000000-0000-4000-8000-0000000000a3', 'professor-a@mat.test'),
  ('fc000000-0000-4000-8000-0000000000a4', 'aluno-a@mat.test'),
  ('fc000000-0000-4000-8000-0000000000b1', 'dono-b@mat.test'),
  ('fc000000-0000-4000-8000-0000000000c1', 'recepcao-c@mat.test');

insert into public.academias (id, nome, slug, status) values
  ('fc000000-0000-4000-8000-00000000000a', 'Mat A', 'mat-recepcao-a', 'ativa'),
  ('fc000000-0000-4000-8000-00000000000b', 'Mat B', 'mat-recepcao-b', 'ativa'),
  ('fc000000-0000-4000-8000-00000000000c', 'Mat C (suspensa)', 'mat-recepcao-c', 'suspensa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000a1', 'recepcao'),
  ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000a2', 'admin'),
  ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000a3', 'professor'),
  ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000000a4', 'aluno'),
  ('fc000000-0000-4000-8000-00000000000b', 'fc000000-0000-4000-8000-0000000000b1', 'dono'),
  ('fc000000-0000-4000-8000-00000000000c', 'fc000000-0000-4000-8000-0000000000c1', 'recepcao');

insert into public.modalidades (id, academia_id, nome) values
  ('fc000000-0000-4000-8000-0000000002a1', 'fc000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
  ('fc000000-0000-4000-8000-0000000002b1', 'fc000000-0000-4000-8000-00000000000b', 'Jiu-Jitsu'),
  ('fc000000-0000-4000-8000-0000000002c1', 'fc000000-0000-4000-8000-00000000000c', 'Jiu-Jitsu');

insert into public.turmas (id, academia_id, modalidade_id, nome, ativa) values
  ('fc000000-0000-4000-8000-0000000003a1', 'fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000002a1', 'T1', true),
  ('fc000000-0000-4000-8000-0000000003a2', 'fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000002a1', 'T2', true),
  ('fc000000-0000-4000-8000-0000000003a3', 'fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000002a1', 'T3 inativa', false),
  ('fc000000-0000-4000-8000-0000000003b1', 'fc000000-0000-4000-8000-00000000000b', 'fc000000-0000-4000-8000-0000000002b1', 'TB', true),
  ('fc000000-0000-4000-8000-0000000003c1', 'fc000000-0000-4000-8000-00000000000c', 'fc000000-0000-4000-8000-0000000002c1', 'TC', true);

insert into public.planos (id, academia_id, nome, valor, ativo) values
  ('fc000000-0000-4000-8000-0000000004a1', 'fc000000-0000-4000-8000-00000000000a', 'Mensal', 150, true),
  ('fc000000-0000-4000-8000-0000000004a2', 'fc000000-0000-4000-8000-00000000000a', 'Antigo', 100, false);

insert into public.alunos (id, academia_id, nome, status, user_id) values
  ('fc000000-0000-4000-8000-0000000001a2', 'fc000000-0000-4000-8000-00000000000a', 'Aluno A2', 'ativo', null),
  ('fc000000-0000-4000-8000-0000000001a4', 'fc000000-0000-4000-8000-00000000000a', 'Aluno A4', 'ativo', 'fc000000-0000-4000-8000-0000000000a4'),
  ('fc000000-0000-4000-8000-0000000001af', 'fc000000-0000-4000-8000-00000000000a', 'Aluno Online', 'pendente', null),
  ('fc000000-0000-4000-8000-0000000001b1', 'fc000000-0000-4000-8000-00000000000b', 'Aluno B', 'ativo', null),
  ('fc000000-0000-4000-8000-0000000001c1', 'fc000000-0000-4000-8000-00000000000c', 'Aluno C', 'ativo', null);

insert into public.alunos (id, academia_id, nome, status, anonimizado_em) values
  ('fc000000-0000-4000-8000-0000000001a3', 'fc000000-0000-4000-8000-00000000000a', 'Aluno anonimizado', 'inativo', now());

-- Matrícula online pendente (como matricula_online grava).
insert into public.matriculas (id, academia_id, aluno_id, status, origem, data_inicio) values
  ('fc000000-0000-4000-8000-0000000005a1', 'fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000001af', 'pendente', 'online', current_date);
insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
  ('fc000000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-0000000005a1', 'fc000000-0000-4000-8000-0000000003a2');

select ok(not has_function_privilege('anon', 'public.criar_matricula(uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.aprovar_matricula(uuid)', 'execute'),
          'anon não executa criar_matricula nem aprovar_matricula');

create temp table t_ids (nome text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- ---------------------------------------------------------------------
-- Recepção de A cria
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fc000000-0000-4000-8000-0000000000a1');

insert into t_ids values ('m1', public.criar_matricula('fc000000-0000-4000-8000-00000000000a',
  public.__mat('{"turma_ids":["fc000000-0000-4000-8000-0000000003a1","fc000000-0000-4000-8000-0000000003a2"],"plano_id":"fc000000-0000-4000-8000-0000000004a1","dia_vencimento":10}')));

reset role;
select is((select status || '|' || origem || '|' || dia_vencimento from public.matriculas where id = (select id from t_ids where nome = 'm1')),
          'ativa|recepcao|10', 'recepção cria matrícula ativa, origem recepção');
select is((select count(*)::int from public.matricula_turmas where matricula_id = (select id from t_ids where nome = 'm1')), 2,
          'com as duas turmas na mesma transação');
select is((select data_inicio from public.matriculas where id = (select id from t_ids where nome = 'm1')),
          public.hoje_academia('fc000000-0000-4000-8000-00000000000a'), 'início padrão: hoje na academia');
select is((select cobrar_a_partir from public.matriculas where id = (select id from t_ids where nome = 'm1')),
          date_trunc('month', public.hoje_academia('fc000000-0000-4000-8000-00000000000a')::timestamp)::date,
          'sem cobrar_a_partir, o gatilho põe o mês do cadastro');
select is((select count(*)::int from public.cobrancas where matricula_id = (select id from t_ids where nome = 'm1')), 0,
          'criar_matricula não gera cobrança');

set local role authenticated;
select public.__como('fc000000-0000-4000-8000-0000000000a1');

-- Duplicata (mesmo aluno, mesma turma, período sobreposto): nada fica gravado.
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat())$$),
          'matricula_duplicada', 'mesma turma e período: matricula_duplicada');
reset role;
select is((select count(*)::int from public.matriculas where aluno_id = 'fc000000-0000-4000-8000-0000000001a2'), 1,
          'a matrícula duplicada não ficou gravada (tudo numa transação)');
set local role authenticated;
select public.__como('fc000000-0000-4000-8000-0000000000a1');

-- cobrar_a_partir explícito.
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a',
            public.__mat(jsonb_build_object('turma_ids', '[]'::jsonb, 'cobrar_a_partir',
              to_char(date_trunc('month', public.hoje_academia('fc000000-0000-4000-8000-00000000000a')::timestamp) + interval '1 month', 'YYYY-MM-DD'))))$$),
          'sem erro', 'cobrar_a_partir no mês seguinte (aluno importado) é aceito');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a',
            public.__mat(jsonb_build_object('turma_ids', '[]'::jsonb, 'cobrar_a_partir',
              to_char(date_trunc('month', public.hoje_academia('fc000000-0000-4000-8000-00000000000a')::timestamp) + interval '14 days', 'YYYY-MM-DD'))))$$),
          'cobrar_a_partir_invalido', 'cobrar_a_partir fora do dia 1: cobrar_a_partir_invalido');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a',
            public.__mat(jsonb_build_object('turma_ids', '[]'::jsonb, 'cobrar_a_partir',
              to_char(date_trunc('month', public.hoje_academia('fc000000-0000-4000-8000-00000000000a')::timestamp) - interval '1 month', 'YYYY-MM-DD'))))$$),
          'cobrar_a_partir_invalido', 'cobrar_a_partir antes do mês atual: cobrar_a_partir_invalido');

-- Dados inválidos.
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":["fc000000-0000-4000-8000-0000000003b1"]}'))$$),
          'dados_invalidos', 'turma de outra academia: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":["fc000000-0000-4000-8000-0000000003a3"]}'))$$),
          'dados_invalidos', 'turma inativa: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"plano_id":"fc000000-0000-4000-8000-0000000004a2"}'))$$),
          'dados_invalidos', 'plano inativo: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"aluno_id":"fc000000-0000-4000-8000-0000000001a3"}'))$$),
          'dados_invalidos', 'aluno anonimizado: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"aluno_id":"fc000000-0000-4000-8000-0000000001b1"}'))$$),
          'dados_invalidos', 'aluno de outra academia: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"data_inicio":"2026-02-31"}'))$$),
          'dados_invalidos', 'data que não existe: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"data_inicio":"2026-05-10","data_fim":"2026-05-01"}'))$$),
          'dados_invalidos', 'fim antes do início: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"dia_vencimento":29}'))$$),
          'dados_invalidos', 'dia de vencimento 29: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"valor":-1}'))$$),
          'dados_invalidos', 'valor negativo: dados_invalidos');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":"x"}'))$$),
          'dados_invalidos', 'turma_ids que não é lista: dados_invalidos');

-- Aprovação da matrícula online.
select is(public.__hint_de($$select public.aprovar_matricula('fc000000-0000-4000-8000-0000000005a1')$$),
          'sem erro', 'recepção aprova a matrícula online');
reset role;
select is((select status from public.matriculas where id = 'fc000000-0000-4000-8000-0000000005a1'), 'ativa',
          'a matrícula ficou ativa');
select is((select status from public.alunos where id = 'fc000000-0000-4000-8000-0000000001af'), 'ativo',
          'e o aluno pendente ficou ativo');
set local role authenticated;
select public.__como('fc000000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.aprovar_matricula('fc000000-0000-4000-8000-0000000005a1')$$),
          'matricula_nao_pendente', 'aprovar de novo: matricula_nao_pendente');
select is(public.__hint_de($$select public.aprovar_matricula('fc000000-0000-4000-8000-0000000009ff')$$),
          'sem_permissao', 'matrícula inexistente: sem_permissao (não diz se existe)');
reset role;

-- ---------------------------------------------------------------------
-- Admin de A cria; professor e aluno não
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fc000000-0000-4000-8000-0000000000a2');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a',
            public.__mat('{"turma_ids":["fc000000-0000-4000-8000-0000000003a1"],"aluno_id":"fc000000-0000-4000-8000-0000000001a4"}'))$$),
          'sem erro', 'admin cria matrícula');
select public.__como('fc000000-0000-4000-8000-0000000000a3');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[]}'))$$),
          'sem_permissao', 'professor: sem_permissao');
select is(public.__hint_de($$select public.aprovar_matricula((select id from t_ids where nome = 'm1'))$$),
          'sem_permissao', 'professor não aprova: sem_permissao');
select public.__como('fc000000-0000-4000-8000-0000000000a4');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[],"aluno_id":"fc000000-0000-4000-8000-0000000001a4"}'))$$),
          'sem_permissao', 'aluno não se matricula pela RPC da recepção: sem_permissao');
reset role;

-- ---------------------------------------------------------------------
-- Outra academia e academia suspensa
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fc000000-0000-4000-8000-0000000000b1');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000a', public.__mat('{"turma_ids":[]}'))$$),
          'sem_permissao', 'dono de B criando em A: sem_permissao');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000b', public.__mat('{"turma_ids":["fc000000-0000-4000-8000-0000000003b1"]}'))$$),
          'dados_invalidos', 'dono de B com aluno de A na própria academia: dados_invalidos');
select is(public.__hint_de($$select public.aprovar_matricula((select id from t_ids where nome = 'm1'))$$),
          'sem_permissao', 'dono de B aprovando matrícula de A: sem_permissao');
select public.__como('fc000000-0000-4000-8000-0000000000c1');
select is(public.__hint_de($$select public.criar_matricula('fc000000-0000-4000-8000-00000000000c',
            '{"aluno_id":"fc000000-0000-4000-8000-0000000001c1","plano_id":null,"turma_ids":["fc000000-0000-4000-8000-0000000003c1"]}'::jsonb)$$),
          'sem_permissao', 'academia suspensa: sem_permissao');
reset role;

select * from finish();
rollback;
