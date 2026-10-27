-- registrar_graduacao (issue #30): dono, admin e professor com a assinatura
-- em dia; data no dia da academia; grau dentro da faixa; progresso zera.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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

-- p_dados padrão: aluno A1, faixa Branca, grau 1.
create function public.__grad(p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'aluno_id', 'fd000000-0000-4000-8000-0000000001a1',
    'faixa_id', 'fd000000-0000-4000-8000-0000000006a1',
    'grau', 1,
    'professor_id', 'fd000000-0000-4000-8000-0000000003a1'
  ) || p_extra
$$;
grant execute on function public.__grad(jsonb) to authenticated;

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

create function public.__dia(p_dias int)
returns text
language sql
as $$ select to_char(public.hoje_academia('fd000000-0000-4000-8000-00000000000a') + p_dias, 'YYYY-MM-DD') $$;
grant execute on function public.__dia(int) to authenticated;

insert into auth.users (id, email) values
  ('fd000000-0000-4000-8000-0000000000a1', 'professor-a@grad.test'),
  ('fd000000-0000-4000-8000-0000000000a2', 'admin-a@grad.test'),
  ('fd000000-0000-4000-8000-0000000000a3', 'recepcao-a@grad.test'),
  ('fd000000-0000-4000-8000-0000000000b1', 'dono-b@grad.test'),
  ('fd000000-0000-4000-8000-0000000000c1', 'professor-c@grad.test');

insert into public.academias (id, nome, slug, status) values
  ('fd000000-0000-4000-8000-00000000000a', 'Grad A', 'grad-a', 'ativa'),
  ('fd000000-0000-4000-8000-00000000000b', 'Grad B', 'grad-b', 'ativa'),
  ('fd000000-0000-4000-8000-00000000000c', 'Grad C (suspensa)', 'grad-c', 'suspensa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000000a1', 'professor'),
  ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000000a2', 'admin'),
  ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000000a3', 'recepcao'),
  ('fd000000-0000-4000-8000-00000000000b', 'fd000000-0000-4000-8000-0000000000b1', 'dono'),
  ('fd000000-0000-4000-8000-00000000000c', 'fd000000-0000-4000-8000-0000000000c1', 'professor');

insert into public.modalidades (id, academia_id, nome) values
  ('fd000000-0000-4000-8000-0000000002a1', 'fd000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
  ('fd000000-0000-4000-8000-0000000002b1', 'fd000000-0000-4000-8000-00000000000b', 'Jiu-Jitsu'),
  ('fd000000-0000-4000-8000-0000000002c1', 'fd000000-0000-4000-8000-00000000000c', 'Jiu-Jitsu');

insert into public.faixas (id, academia_id, modalidade_id, nome, ordem, max_graus, min_meses, min_aulas) values
  ('fd000000-0000-4000-8000-0000000006a1', 'fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000002a1', 'Branca', 1, 4, 0, 2),
  ('fd000000-0000-4000-8000-0000000006a2', 'fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000002a1', 'Azul', 2, 4, 24, 200),
  ('fd000000-0000-4000-8000-0000000006b1', 'fd000000-0000-4000-8000-00000000000b', 'fd000000-0000-4000-8000-0000000002b1', 'Branca', 1, 4, 0, 0),
  ('fd000000-0000-4000-8000-0000000006c1', 'fd000000-0000-4000-8000-00000000000c', 'fd000000-0000-4000-8000-0000000002c1', 'Branca', 1, 4, 0, 0);

insert into public.professores (id, academia_id, nome) values
  ('fd000000-0000-4000-8000-0000000003a1', 'fd000000-0000-4000-8000-00000000000a', 'Mestre A'),
  ('fd000000-0000-4000-8000-0000000003b1', 'fd000000-0000-4000-8000-00000000000b', 'Mestre B');

insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('fd000000-0000-4000-8000-0000000004a1', 'fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000002a1', 'Adulto');

insert into public.alunos (id, academia_id, nome, status, anonimizado_em) values
  ('fd000000-0000-4000-8000-0000000001a1', 'fd000000-0000-4000-8000-00000000000a', 'Aluno A1', 'ativo', null),
  ('fd000000-0000-4000-8000-0000000001a2', 'fd000000-0000-4000-8000-00000000000a', 'Aluno A2 inativo', 'inativo', null),
  ('fd000000-0000-4000-8000-0000000001a3', 'fd000000-0000-4000-8000-00000000000a', 'Aluno anonimizado', 'inativo', now()),
  ('fd000000-0000-4000-8000-0000000001b1', 'fd000000-0000-4000-8000-00000000000b', 'Aluno B', 'ativo', null),
  ('fd000000-0000-4000-8000-0000000001c1', 'fd000000-0000-4000-8000-00000000000c', 'Aluno C', 'ativo', null);

select ok(not has_function_privilege('anon', 'public.registrar_graduacao(uuid, jsonb)', 'execute'),
          'anon não executa registrar_graduacao');

-- ---------------------------------------------------------------------
-- Professor de A
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fd000000-0000-4000-8000-0000000000a1');

-- Primeira graduação há 60 dias.
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a',
            public.__grad(jsonb_build_object('grau', 0, 'data', public.__dia(-60))))$$),
          'sem erro', 'professor registra a primeira graduação (data no passado)');
reset role;

-- Duas aulas depois dela.
insert into public.presencas (academia_id, aluno_id, turma_id, data) values
  ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000001a1', 'fd000000-0000-4000-8000-0000000004a1',
   public.hoje_academia('fd000000-0000-4000-8000-00000000000a') - 30),
  ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000001a1', 'fd000000-0000-4000-8000-0000000004a1',
   public.hoje_academia('fd000000-0000-4000-8000-00000000000a') - 20);

select is((select aulas_desde || '|' || apto from public.vw_progresso_graduacao where aluno_id = 'fd000000-0000-4000-8000-0000000001a1'),
          '2|true', 'duas aulas desde a graduação: apto (mínimo de 2 aulas)');

set local role authenticated;
select public.__como('fd000000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad())$$),
          'sem erro', 'professor registra o grau 1 hoje (data padrão)');
reset role;

select is((select faixa || '|' || grau || '|' || graduado_em from public.vw_graduacao_atual where aluno_id = 'fd000000-0000-4000-8000-0000000001a1'),
          'Branca|1|' || public.hoje_academia('fd000000-0000-4000-8000-00000000000a'),
          'a graduação nova vira a atual, com a data de hoje na academia');
select is((select aulas_desde || '|' || apto || '|' || proximo_passo from public.vw_progresso_graduacao where aluno_id = 'fd000000-0000-4000-8000-0000000001a1'),
          '0|false|grau 2', 'o progresso zerou e o próximo passo é o grau 2');

set local role authenticated;
select public.__como('fd000000-0000-4000-8000-0000000000a1');

select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"grau":5}'))$$),
          'grau_invalido', 'grau acima do máximo da faixa: grau_invalido');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad(jsonb_build_object('data', public.__dia(1))))$$),
          'dados_invalidos', 'data no futuro: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"data":"2026-02-31"}'))$$),
          'dados_invalidos', 'data que não existe: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"aluno_id":"fd000000-0000-4000-8000-0000000001a2"}'))$$),
          'dados_invalidos', 'aluno inativo: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"aluno_id":"fd000000-0000-4000-8000-0000000001a3"}'))$$),
          'dados_invalidos', 'aluno anonimizado: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"aluno_id":"fd000000-0000-4000-8000-0000000001b1"}'))$$),
          'dados_invalidos', 'aluno de outra academia: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"faixa_id":"fd000000-0000-4000-8000-0000000006b1"}'))$$),
          'dados_invalidos', 'faixa de outra academia: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"professor_id":"fd000000-0000-4000-8000-0000000003b1"}'))$$),
          'dados_invalidos', 'professor de outra academia: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad('{"grau":"1"}'))$$),
          'dados_invalidos', 'grau que não é número: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a',
            public.__grad(jsonb_build_object('observacao', repeat('x', 501))))$$),
          'dados_invalidos', 'observação acima de 500 caracteres: dados_invalidos');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a',
            public.__grad('{"faixa_id":"fd000000-0000-4000-8000-0000000006a2","grau":0,"professor_id":null,"observacao":"  Troca de faixa  "}'))$$),
          'sem erro', 'troca de faixa sem professor, com observação');
reset role;
select is((select observacao from public.graduacoes where faixa_id = 'fd000000-0000-4000-8000-0000000006a2'), 'Troca de faixa',
          'observação gravada sem espaços nas pontas');
select is((select faixa from public.vw_graduacao_atual where aluno_id = 'fd000000-0000-4000-8000-0000000001a1'), 'Azul',
          'a faixa nova vira a atual');

-- Clique duplo: a mesma faixa, grau e data não se repetem.
set local role authenticated;
select public.__como('fd000000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad())$$),
          'graduacao_repetida', 'mesma faixa, grau e data de novo: graduacao_repetida');

-- Gravação direta na tabela (a política permite) também respeita as regras.
select is(public.__hint_de($$insert into public.graduacoes (academia_id, aluno_id, faixa_id, grau, data)
            values ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000001a1', 'fd000000-0000-4000-8000-0000000006a1', 9, public.__dia(-1)::date)$$),
          'grau_invalido', 'insert direto com grau acima da faixa: grau_invalido');
select is(public.__hint_de($$insert into public.graduacoes (academia_id, aluno_id, faixa_id, grau, data)
            values ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000001a1', 'fd000000-0000-4000-8000-0000000006a1', 1, public.__dia(2)::date)$$),
          'dados_invalidos', 'insert direto com data no futuro: dados_invalidos');
select is(public.__hint_de($$update public.graduacoes set grau = 9 where aluno_id = 'fd000000-0000-4000-8000-0000000001a1'$$),
          'grau_invalido', 'update direto com grau acima da faixa: grau_invalido');
select is(public.__hint_de($$insert into public.graduacoes (academia_id, aluno_id, faixa_id, grau, data)
            values ('fd000000-0000-4000-8000-00000000000a', 'fd000000-0000-4000-8000-0000000001a1', 'fd000000-0000-4000-8000-0000000006a1', 3, public.__dia(-2)::date)$$),
          'sem erro', 'insert direto válido continua passando');
reset role;

-- ---------------------------------------------------------------------
-- Quem não registra
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fd000000-0000-4000-8000-0000000000a3');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad())$$),
          'sem_permissao', 'recepção: sem_permissao');
select public.__como('fd000000-0000-4000-8000-0000000000b1');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a', public.__grad())$$),
          'sem_permissao', 'dono de B registrando em A: sem_permissao');
select public.__como('fd000000-0000-4000-8000-0000000000c1');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000c',
            '{"aluno_id":"fd000000-0000-4000-8000-0000000001c1","faixa_id":"fd000000-0000-4000-8000-0000000006c1","grau":0}'::jsonb)$$),
          'sem_permissao', 'academia suspensa: sem_permissao');
select public.__como('fd000000-0000-4000-8000-0000000000a2');
select is(public.__hint_de($$select public.registrar_graduacao('fd000000-0000-4000-8000-00000000000a',
            public.__grad('{"faixa_id":"fd000000-0000-4000-8000-0000000006a2","grau":1}'))$$),
          'sem erro', 'admin registra');
reset role;

select is((select count(*)::int from public.graduacoes where academia_id = 'fd000000-0000-4000-8000-00000000000c'), 0,
          'nada foi gravado na academia suspensa');

-- Gravação sem data fica com o dia da academia, não com o dia em UTC. Nos
-- dois extremos de fuso, a qualquer hora pelo menos um deles está num dia
-- diferente do UTC.
insert into public.academias (id, nome, slug, status, fuso) values
  ('fd000000-0000-4000-8000-00000000000d', 'Grad oeste', 'grad-d', 'ativa', 'Etc/GMT+12'),
  ('fd000000-0000-4000-8000-00000000000e', 'Grad leste', 'grad-e', 'ativa', 'Pacific/Kiritimati');
insert into public.modalidades (id, academia_id, nome) values
  ('fd000000-0000-4000-8000-0000000002d1', 'fd000000-0000-4000-8000-00000000000d', 'Judô'),
  ('fd000000-0000-4000-8000-0000000002e1', 'fd000000-0000-4000-8000-00000000000e', 'Judô');
insert into public.faixas (id, academia_id, modalidade_id, nome, ordem) values
  ('fd000000-0000-4000-8000-0000000006d1', 'fd000000-0000-4000-8000-00000000000d', 'fd000000-0000-4000-8000-0000000002d1', 'Branca', 1),
  ('fd000000-0000-4000-8000-0000000006e1', 'fd000000-0000-4000-8000-00000000000e', 'fd000000-0000-4000-8000-0000000002e1', 'Branca', 1);
insert into public.alunos (id, academia_id, nome) values
  ('fd000000-0000-4000-8000-0000000001d1', 'fd000000-0000-4000-8000-00000000000d', 'Aluno oeste'),
  ('fd000000-0000-4000-8000-0000000001e1', 'fd000000-0000-4000-8000-00000000000e', 'Aluno leste');
insert into public.graduacoes (academia_id, aluno_id, faixa_id) values
  ('fd000000-0000-4000-8000-00000000000d', 'fd000000-0000-4000-8000-0000000001d1', 'fd000000-0000-4000-8000-0000000006d1'),
  ('fd000000-0000-4000-8000-00000000000e', 'fd000000-0000-4000-8000-0000000001e1', 'fd000000-0000-4000-8000-0000000006e1');
select is((select data from public.graduacoes where aluno_id = 'fd000000-0000-4000-8000-0000000001d1'),
          public.hoje_academia('fd000000-0000-4000-8000-00000000000d'), 'sem data, fica o dia da academia (UTC-12)');
select is((select data from public.graduacoes where aluno_id = 'fd000000-0000-4000-8000-0000000001e1'),
          public.hoje_academia('fd000000-0000-4000-8000-00000000000e'), 'sem data, fica o dia da academia (UTC+14)');

select * from finish();
rollback;
