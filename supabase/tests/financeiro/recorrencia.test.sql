-- gerar_cobrancas e matriculas.cobrar_a_partir: sem duplicata, competência
-- cancelada não volta, primeira mensalidade e aluno importado.
-- "Hoje" é sempre hoje_academia(), então o teste vale em qualquer dia do mês.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ---------------------------------------------------------------------
-- Fixtures: academia A com plano mensal de 150. Todas cadastradas hoje.
--   m1: começa hoje
--   m2: data_inicio no mês anterior ao cadastro
--   m3: aluno importado (começou há 200 dias), cobrar_a_partir no mês seguinte
--   m4: trancada, sem cobrança (para testar a edição de cobrar_a_partir)
-- ---------------------------------------------------------------------
insert into public.academias (id, nome, slug, status, dias_antecedencia_cobranca) values
  ('f2000000-0000-4000-8000-00000000000a', 'Recorrência A', 'fin-recorrencia-a', 'ativa', 10);

insert into public.alunos (id, academia_id, nome) values
  ('f2000000-0000-4000-8000-0000000001a1', 'f2000000-0000-4000-8000-00000000000a', 'Aluno novo'),
  ('f2000000-0000-4000-8000-0000000001a2', 'f2000000-0000-4000-8000-00000000000a', 'Aluno do mês anterior'),
  ('f2000000-0000-4000-8000-0000000001a3', 'f2000000-0000-4000-8000-00000000000a', 'Aluno importado'),
  ('f2000000-0000-4000-8000-0000000001a4', 'f2000000-0000-4000-8000-00000000000a', 'Aluno trancado');

insert into public.planos (id, academia_id, nome, valor) values
  ('f2000000-0000-4000-8000-000000000201', 'f2000000-0000-4000-8000-00000000000a', 'Mensal', 150);

create temp table t_hoje as
select h.hoje,
       date_trunc('month', h.hoje::timestamp)::date as mes,
       (date_trunc('month', h.hoje::timestamp) + interval '1 month')::date as prox,
       (date_trunc('month', h.hoje::timestamp) - interval '1 month')::date as anterior
from (select public.hoje_academia('f2000000-0000-4000-8000-00000000000a') as hoje) h;

insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, dia_vencimento, data_inicio, cobrar_a_partir)
select v.id::uuid, 'f2000000-0000-4000-8000-00000000000a'::uuid, v.aluno_id::uuid,
       'f2000000-0000-4000-8000-000000000201'::uuid, v.status, v.dia,
       case v.inicio when 'hoje' then h.hoje when 'mes_anterior' then h.mes - 3 else h.hoje - 200 end,
       case when v.adiada then h.prox end
from (values
  ('f2000000-0000-4000-8000-000000000301', 'f2000000-0000-4000-8000-0000000001a1', 'ativa',    10, 'hoje',         false),
  ('f2000000-0000-4000-8000-000000000302', 'f2000000-0000-4000-8000-0000000001a2', 'ativa',    10, 'mes_anterior', false),
  ('f2000000-0000-4000-8000-000000000303', 'f2000000-0000-4000-8000-0000000001a3', 'ativa',    28, 'antiga',       true),
  ('f2000000-0000-4000-8000-000000000304', 'f2000000-0000-4000-8000-0000000001a4', 'trancada', 10, 'hoje',         false)
) as v(id, aluno_id, status, dia, inicio, adiada)
cross join t_hoje h;

-- ---------------------------------------------------------------------
-- 1. Padrão de cobrar_a_partir
-- ---------------------------------------------------------------------
select is((select cobrar_a_partir from public.matriculas where id = 'f2000000-0000-4000-8000-000000000301'),
  (select mes from t_hoje), 'Padrão de cobrar_a_partir é o mês do cadastro');
select is((select cobrar_a_partir from public.matriculas where id = 'f2000000-0000-4000-8000-000000000302'),
  (select mes from t_hoje), 'data_inicio no mês anterior: cobrar_a_partir continua sendo o mês do cadastro');

-- ---------------------------------------------------------------------
-- 2. Gerar duas vezes não duplica
-- ---------------------------------------------------------------------
select cmp_ok(public.gerar_cobrancas('f2000000-0000-4000-8000-00000000000a'), '>=', 2,
  'Primeira rodada cria cobranças');

create temp table t_antes as
select count(*) as n from public.cobrancas where academia_id = 'f2000000-0000-4000-8000-00000000000a';

select is(public.gerar_cobrancas('f2000000-0000-4000-8000-00000000000a'), 0,
  'Segunda rodada não cria nada');
select is((select count(*) from public.cobrancas where academia_id = 'f2000000-0000-4000-8000-00000000000a'),
  (select n from t_antes), 'Total de cobranças não mudou');
select is((select count(*) from (
             select 1 from public.cobrancas
             where academia_id = 'f2000000-0000-4000-8000-00000000000a'
             group by matricula_id, competencia having count(*) > 1) d),
  0::bigint, 'Nenhuma competência duplicada por matrícula');

-- ---------------------------------------------------------------------
-- 3. Matrícula que começa hoje: primeira mensalidade vence hoje
-- ---------------------------------------------------------------------
select is((select vencimento from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje)),
  (select hoje from t_hoje), 'Primeira mensalidade vence em data_inicio');
select is((select valor from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje)),
  150.00::numeric, 'Valor vem do plano');

-- ---------------------------------------------------------------------
-- 4. Competência cancelada não volta
-- ---------------------------------------------------------------------
update public.cobrancas set status = 'cancelada'
 where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje);

select is(public.gerar_cobrancas('f2000000-0000-4000-8000-00000000000a'), 0,
  'Depois do cancelamento, gerar não recria a competência');
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje)),
  1::bigint, 'Continua uma só cobrança naquela competência');
select is((select status from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje)),
  'cancelada', 'E ela continua cancelada');

-- ---------------------------------------------------------------------
-- 5. data_inicio no mês anterior ao cadastro: gera cobrança no mês do
--    cadastro, vencendo no dia do cadastro
-- ---------------------------------------------------------------------
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000302' and competencia = (select mes from t_hoje)),
  1::bigint, 'data_inicio no mês anterior gera a cobrança do mês do cadastro');
select is((select vencimento from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000302' and competencia = (select mes from t_hoje)),
  (select hoje from t_hoje), 'Vence no dia do cadastro, não na data_inicio passada');

-- ---------------------------------------------------------------------
-- 6. Aluno importado com cobrar_a_partir no mês seguinte: nada no mês corrente
-- ---------------------------------------------------------------------
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000303' and competencia < (select prox from t_hoje)),
  0::bigint, 'Importado não tem cobrança na competência corrente nem em anteriores');
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000303' and vencimento < (select prox from t_hoje)),
  0::bigint, 'Importado não tem cobrança vencendo no mês corrente');
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000303'
              and vencimento <> (select prox + 27 from t_hoje)),
  0::bigint, 'Se a do mês seguinte já foi gerada, vence no dia_vencimento daquele mês');

-- ---------------------------------------------------------------------
-- 7. cobrar_a_partir só muda enquanto a matrícula não tem cobrança
-- ---------------------------------------------------------------------
select throws_like(
  format($$update public.matriculas set cobrar_a_partir = %L where id = 'f2000000-0000-4000-8000-000000000301'$$,
         (select prox from t_hoje)),
  '%já tem cobrança%', 'cobrar_a_partir não muda depois da primeira cobrança');
select lives_ok(
  format($$update public.matriculas set cobrar_a_partir = %L where id = 'f2000000-0000-4000-8000-000000000304'$$,
         (select prox from t_hoje)),
  'Sem cobrança, cobrar_a_partir pode ser adiado');
select is((select cobrar_a_partir from public.matriculas where id = 'f2000000-0000-4000-8000-000000000304'),
  (select prox from t_hoje), 'cobrar_a_partir foi alterado');
select throws_like(
  format($$update public.matriculas set cobrar_a_partir = %L where id = 'f2000000-0000-4000-8000-000000000304'$$,
         (select anterior from t_hoje)),
  '%anterior ao mês do cadastro%', 'cobrar_a_partir não volta para antes do mês do cadastro');
select throws_like(
  format($$insert into public.matriculas (academia_id, aluno_id, cobrar_a_partir)
           values ('f2000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-0000000001a4', %L)$$,
         (select anterior from t_hoje)),
  '%anterior ao mês do cadastro%', 'Matrícula nova não nasce com cobrar_a_partir no passado');

select * from finish();
rollback;
