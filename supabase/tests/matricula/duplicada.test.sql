-- Matrícula duplicada na mesma turma (issue #13).
-- Regra: o mesmo aluno não pode ter duas matrículas não canceladas com
-- períodos sobrepostos que compartilhem uma turma. Erro com hint
-- matricula_duplicada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Devolve hint, detail e mensagem do erro de um comando (ou 'sem erro').
create function public.__erro_de(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
  v_detail text;
begin
  execute p_sql;
  return jsonb_build_object('hint', 'sem erro');
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return jsonb_build_object('hint', coalesce(nullif(v_hint, ''), 'sem hint'),
                            'detail', v_detail, 'mensagem', sqlerrm);
end
$$;
grant execute on function public.__erro_de(text) to authenticated;

create function public.__hint_de(p_sql text)
returns text
language sql
as $$ select public.__erro_de(p_sql) ->> 'hint' $$;
grant execute on function public.__hint_de(text) to authenticated;

-- ---------------------------------------------------------------------
-- Fixtures: academias A e B, cada uma com suas turmas e alunos.
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f7000000-0000-4000-8000-0000000000a1', 'recepcao-a@matricula.test');

insert into public.academias (id, nome, slug, status) values
  ('f7000000-0000-4000-8000-00000000000a', 'Duplicada A', 'mat-duplicada-a', 'ativa'),
  ('f7000000-0000-4000-8000-00000000000b', 'Duplicada B', 'mat-duplicada-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('f7000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-0000000000a1', 'recepcao');

insert into public.modalidades (id, academia_id, nome) values
  ('f7000000-0000-4000-8000-000000000201', 'f7000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
  ('f7000000-0000-4000-8000-000000000202', 'f7000000-0000-4000-8000-00000000000b', 'Jiu-Jitsu');

insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('f7000000-0000-4000-8000-0000000003a1', 'f7000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-000000000201', 'Turma 1'),
  ('f7000000-0000-4000-8000-0000000003a2', 'f7000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-000000000201', 'Turma 2'),
  ('f7000000-0000-4000-8000-0000000003a3', 'f7000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-000000000201', 'Turma 3'),
  ('f7000000-0000-4000-8000-0000000003b1', 'f7000000-0000-4000-8000-00000000000b', 'f7000000-0000-4000-8000-000000000202', 'Turma de B');

insert into public.alunos (id, academia_id, nome) values
  ('f7000000-0000-4000-8000-0000000001a1', 'f7000000-0000-4000-8000-00000000000a', 'Aluno 1'),
  ('f7000000-0000-4000-8000-0000000001a2', 'f7000000-0000-4000-8000-00000000000a', 'Aluno 2 (trancada)'),
  ('f7000000-0000-4000-8000-0000000001a3', 'f7000000-0000-4000-8000-00000000000a', 'Aluno 3 (cancelada)'),
  ('f7000000-0000-4000-8000-0000000001a4', 'f7000000-0000-4000-8000-00000000000a', 'Aluno 4 (troca de plano)'),
  ('f7000000-0000-4000-8000-0000000001a5', 'f7000000-0000-4000-8000-00000000000a', 'Aluno 5 (mesmo comando)'),
  ('f7000000-0000-4000-8000-0000000001a6', 'f7000000-0000-4000-8000-00000000000a', 'Aluno 6 (troca de aluno)'),
  ('f7000000-0000-4000-8000-0000000001b1', 'f7000000-0000-4000-8000-00000000000b', 'Aluno de B');

-- Atalhos para os ids, só para os testes ficarem legíveis.
create function pg_temp.a() returns uuid language sql as $$ select 'f7000000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'f7000000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.aluno(n text) returns uuid language sql as $$ select ('f7000000-0000-4000-8000-0000000001' || n)::uuid $$;
create function pg_temp.turma(n text) returns uuid language sql as $$ select ('f7000000-0000-4000-8000-0000000003' || n)::uuid $$;
create function pg_temp.mat(n text) returns uuid language sql as $$ select ('f7000000-0000-4000-8000-0000000004' || n)::uuid $$;

-- ---------------------------------------------------------------------
-- 1. Caso base: segunda matrícula ativa, mesmo período, mesma turma
-- ---------------------------------------------------------------------
insert into public.matriculas (id, academia_id, aluno_id) values
  (pg_temp.mat('01'), pg_temp.a(), pg_temp.aluno('a1')),
  (pg_temp.mat('02'), pg_temp.a(), pg_temp.aluno('a1'));

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
    (pg_temp.a(), pg_temp.mat('01'), pg_temp.turma('a1')),
    (pg_temp.a(), pg_temp.mat('01'), pg_temp.turma('a2'))
$$, 'Primeira matrícula entra em duas turmas');

select ok(
  (select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) > 0,
  'A gravação segura uma trava por aluno até o fim da transação');

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('02'), pg_temp.turma('a1'))
$$), 'matricula_duplicada', 'Segunda matrícula ativa na mesma turma e período: matricula_duplicada');

select is(
  public.__erro_de($$
    insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
    values (pg_temp.a(), pg_temp.mat('02'), pg_temp.turma('a1'))
  $$) ->> 'mensagem',
  'O aluno já tem matrícula na turma "Turma 1" neste período',
  'Mensagem em português, com o nome da turma');

select is(
  (public.__erro_de($$
    insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
    values (pg_temp.a(), pg_temp.mat('02'), pg_temp.turma('a1'))
  $$) ->> 'detail')::jsonb,
  jsonb_build_object('matricula_id', pg_temp.mat('01'), 'turma_id', pg_temp.turma('a1')),
  'O detail aponta a matrícula e a turma em conflito');

select is(
  (select count(*) from public.matricula_turmas where matricula_id = pg_temp.mat('02')),
  0::bigint, 'A turma recusada não ficou gravada');

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('02'), pg_temp.turma('a3'))
$$, 'A mesma segunda matrícula entra numa turma que o aluno ainda não tem');

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('01'), pg_temp.turma('a3'))
$$), 'matricula_duplicada', 'O conflito vale nos dois sentidos');

-- ---------------------------------------------------------------------
-- 2. Situações: pendente e trancada disputam; cancelada não
-- ---------------------------------------------------------------------
insert into public.matriculas (id, academia_id, aluno_id, status) values
  (pg_temp.mat('03'), pg_temp.a(), pg_temp.aluno('a1'), 'pendente'),
  (pg_temp.mat('04'), pg_temp.a(), pg_temp.aluno('a2'), 'trancada'),
  (pg_temp.mat('05'), pg_temp.a(), pg_temp.aluno('a2'), 'ativa'),
  (pg_temp.mat('06'), pg_temp.a(), pg_temp.aluno('a3'), 'cancelada'),
  (pg_temp.mat('07'), pg_temp.a(), pg_temp.aluno('a3'), 'ativa');

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('03'), pg_temp.turma('a2'))
$$), 'matricula_duplicada', 'Matrícula pendente também não pode repetir a turma');

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('04'), pg_temp.turma('a1'))
$$, 'Outro aluno entra na mesma turma sem conflito');

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('05'), pg_temp.turma('a1'))
$$), 'matricula_duplicada', 'Matrícula trancada continua ocupando a turma');

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
    (pg_temp.a(), pg_temp.mat('06'), pg_temp.turma('a1')),
    (pg_temp.a(), pg_temp.mat('07'), pg_temp.turma('a1'))
$$, 'Matrícula cancelada não disputa a turma com a nova');

select is(public.__hint_de($$
  update public.matriculas set status = 'ativa' where id = pg_temp.mat('06')
$$), 'matricula_duplicada', 'Reativar a cancelada quando já há outra na turma: matricula_duplicada');

select is((select status from public.matriculas where id = pg_temp.mat('06')),
  'cancelada', 'A reativação recusada não ficou gravada');

select lives_ok($$
  update public.matriculas set status = 'cancelada' where id = pg_temp.mat('07');
  update public.matriculas set status = 'ativa' where id = pg_temp.mat('06')
$$, 'Depois de cancelar a outra, a reativação passa');

-- ---------------------------------------------------------------------
-- 3. Períodos e troca de plano
-- ---------------------------------------------------------------------
insert into public.matriculas (id, academia_id, aluno_id, data_inicio, data_fim) values
  (pg_temp.mat('08'), pg_temp.a(), pg_temp.aluno('a4'), current_date - 60, current_date - 1),
  (pg_temp.mat('09'), pg_temp.a(), pg_temp.aluno('a4'), current_date, null);

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
    (pg_temp.a(), pg_temp.mat('08'), pg_temp.turma('a1')),
    (pg_temp.a(), pg_temp.mat('09'), pg_temp.turma('a1'))
$$, 'Troca de plano: antiga encerrada na véspera e nova a partir de hoje, na mesma turma');

select is(public.__hint_de($$
  update public.matriculas set data_fim = current_date where id = pg_temp.mat('08')
$$), 'matricula_duplicada', 'Estender a antiga até o dia em que a nova começa: matricula_duplicada (o período é fechado)');

select is(public.__hint_de($$
  update public.matriculas set data_fim = null where id = pg_temp.mat('08')
$$), 'matricula_duplicada', 'Reabrir a antiga sem data de fim: matricula_duplicada');

select is(public.__hint_de($$
  update public.matriculas set data_inicio = current_date - 1 where id = pg_temp.mat('09')
$$), 'matricula_duplicada', 'Antecipar o início da nova para dentro da antiga: matricula_duplicada');

select lives_ok($$
  update public.matriculas set data_fim = current_date - 10 where id = pg_temp.mat('08');
  update public.matriculas set data_inicio = current_date - 9 where id = pg_temp.mat('09')
$$, 'Mudar as datas sem sobrepor é aceito');

select lives_ok($$
  update public.matriculas set valor = 123.45, dia_vencimento = 10 where id = pg_temp.mat('08')
$$, 'Alterar campo que não é situação, data nem aluno não dispara a conferência');

-- ---------------------------------------------------------------------
-- 4. Mesmo comando, troca de aluno e matrícula sem turma
-- ---------------------------------------------------------------------
insert into public.matriculas (id, academia_id, aluno_id) values
  (pg_temp.mat('10'), pg_temp.a(), pg_temp.aluno('a5')),
  (pg_temp.mat('11'), pg_temp.a(), pg_temp.aluno('a5')),
  (pg_temp.mat('12'), pg_temp.a(), pg_temp.aluno('a6'));

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
    (pg_temp.a(), pg_temp.mat('10'), pg_temp.turma('a2')),
    (pg_temp.a(), pg_temp.mat('11'), pg_temp.turma('a2'))
$$), 'matricula_duplicada', 'Duas matrículas do mesmo aluno na mesma turma, no mesmo insert: matricula_duplicada');

select is(
  (select count(*) from public.matricula_turmas where matricula_id in (pg_temp.mat('10'), pg_temp.mat('11'))),
  0::bigint, 'O insert recusado não gravou nenhuma das duas linhas');

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.a(), pg_temp.mat('12'), pg_temp.turma('a1'))
$$, 'Aluno 6 entra na turma 1');

select is(public.__hint_de($$
  update public.matriculas set aluno_id = pg_temp.aluno('a1') where id = pg_temp.mat('12')
$$), 'matricula_duplicada', 'Passar a matrícula para um aluno que já está na turma: matricula_duplicada');

select lives_ok($$
  update public.matriculas set status = 'trancada' where id = pg_temp.mat('11');
  update public.matriculas set status = 'ativa' where id = pg_temp.mat('11')
$$, 'Matrícula sem turma muda de situação livremente, mesmo com outra do mesmo aluno');

-- ---------------------------------------------------------------------
-- 5. Duas academias: a regra vale em cada uma e uma não interfere na outra
-- ---------------------------------------------------------------------
insert into public.matriculas (id, academia_id, aluno_id) values
  (pg_temp.mat('b1'), pg_temp.b(), pg_temp.aluno('b1')),
  (pg_temp.mat('b2'), pg_temp.b(), pg_temp.aluno('b1'));

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.b(), pg_temp.mat('b1'), pg_temp.turma('b1'))
$$, 'Academia B: matrícula entra na turma de B, sem relação com as de A');

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.b(), pg_temp.mat('b2'), pg_temp.turma('b1'))
$$), 'matricula_duplicada', 'Academia B: a mesma regra vale');

select isnt(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values (pg_temp.b(), pg_temp.mat('b2'), pg_temp.turma('a1'))
$$), 'sem erro', 'Matrícula de B não entra em turma de A (FK composta)');

-- ---------------------------------------------------------------------
-- 6. Pela API, como recepção: a regra vale por cima do RLS
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f7000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f7000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(public.__hint_de($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values ('f7000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-000000000402', 'f7000000-0000-4000-8000-0000000003a1')
$$), 'matricula_duplicada', 'Recepção recebe matricula_duplicada ao repetir a turma');

select is(public.__hint_de($$
  update public.matriculas set data_fim = null where id = 'f7000000-0000-4000-8000-000000000408'
$$), 'matricula_duplicada', 'Recepção recebe matricula_duplicada ao reabrir a matrícula antiga');

select lives_ok($$
  insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
  values ('f7000000-0000-4000-8000-00000000000a', 'f7000000-0000-4000-8000-000000000410', 'f7000000-0000-4000-8000-0000000003a2')
$$, 'Recepção matricula normalmente quando não há conflito');

reset role;

select * from finish();
rollback;
