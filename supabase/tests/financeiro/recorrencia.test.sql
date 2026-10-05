-- gerar_cobrancas: sem duplicata, competência cancelada não volta, primeira
-- mensalidade de matrícula retroativa e aluno importado sem cobrança vencida.
-- "Hoje" é sempre hoje_academia(), então o teste vale em qualquer dia do mês.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ---------------------------------------------------------------------
-- Fixtures: academia A com plano mensal de 150 e três matrículas
--   m1: começa hoje
--   m2: começou no dia 1 deste mês, cadastrada hoje (retroativa no mesmo mês)
--   m3: começou há 200 dias, cadastrada hoje (aluno importado), vencimento dia 1
-- ---------------------------------------------------------------------
insert into public.academias (id, nome, slug, status, dias_antecedencia_cobranca) values
  ('f2000000-0000-4000-8000-00000000000a', 'Recorrência A', 'fin-recorrencia-a', 'ativa', 10);

insert into public.alunos (id, academia_id, nome) values
  ('f2000000-0000-4000-8000-0000000001a1', 'f2000000-0000-4000-8000-00000000000a', 'Aluno novo'),
  ('f2000000-0000-4000-8000-0000000001a2', 'f2000000-0000-4000-8000-00000000000a', 'Aluno retroativo'),
  ('f2000000-0000-4000-8000-0000000001a3', 'f2000000-0000-4000-8000-00000000000a', 'Aluno importado');

insert into public.planos (id, academia_id, nome, valor) values
  ('f2000000-0000-4000-8000-000000000201', 'f2000000-0000-4000-8000-00000000000a', 'Mensal', 150);

create temp table t_hoje as
select public.hoje_academia('f2000000-0000-4000-8000-00000000000a') as hoje,
       date_trunc('month', public.hoje_academia('f2000000-0000-4000-8000-00000000000a')::timestamp)::date as mes;

insert into public.matriculas (id, academia_id, aluno_id, plano_id, dia_vencimento, data_inicio)
select v.id::uuid, 'f2000000-0000-4000-8000-00000000000a'::uuid, v.aluno_id::uuid,
       'f2000000-0000-4000-8000-000000000201'::uuid, v.dia,
       case v.inicio when 'hoje' then h.hoje when 'mes' then h.mes else h.hoje - 200 end
from (values
  ('f2000000-0000-4000-8000-000000000301', 'f2000000-0000-4000-8000-0000000001a1', 10, 'hoje'),
  ('f2000000-0000-4000-8000-000000000302', 'f2000000-0000-4000-8000-0000000001a2', 10, 'mes'),
  ('f2000000-0000-4000-8000-000000000303', 'f2000000-0000-4000-8000-0000000001a3', 1,  'antiga')
) as v(id, aluno_id, dia, inicio)
cross join t_hoje h;

-- ---------------------------------------------------------------------
-- 1. Gerar duas vezes não duplica
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
-- 2. Matrícula que começa hoje: primeira mensalidade vence hoje
-- ---------------------------------------------------------------------
select is((select vencimento from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje)),
  (select hoje from t_hoje), 'Primeira mensalidade vence em data_inicio');
select is((select valor from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000301' and competencia = (select mes from t_hoje)),
  150.00::numeric, 'Valor vem do plano');

-- ---------------------------------------------------------------------
-- 3. Competência cancelada não volta
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
-- 4. data_inicio retroativa no mesmo mês: primeira mensalidade gerada,
--    vencendo no dia do cadastro (não nasce vencida)
-- ---------------------------------------------------------------------
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000302' and competencia = (select mes from t_hoje)),
  1::bigint, 'Matrícula retroativa no mesmo mês gera a primeira mensalidade');
select is((select vencimento from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000302' and competencia = (select mes from t_hoje)),
  (select hoje from t_hoje), 'Vence no dia do cadastro, não na data_inicio passada');

-- ---------------------------------------------------------------------
-- 5. Aluno importado com data_inicio antiga: nada já vencido
-- ---------------------------------------------------------------------
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000303' and vencimento < (select hoje from t_hoje)),
  0::bigint, 'Aluno importado não recebe cobrança já vencida');
select is((select count(*) from public.cobrancas
            where matricula_id = 'f2000000-0000-4000-8000-000000000303' and competencia < (select mes from t_hoje)),
  0::bigint, 'Aluno importado não recebe competência de meses passados');

select * from finish();
rollback;
