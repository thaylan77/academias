-- Agendamento diário da geração de cobranças (issue #18). Só roda onde há
-- pg_cron (o Supabase local do CI e o hospedado): no CI, falha se a extensão
-- ou o job faltarem. A função que o job chama é testada em
-- geracao_agendada.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select has_extension('pg_cron', 'pg_cron instalado');
select is((select count(*)::int from cron.job where jobname = 'gerar-cobrancas-diario'), 1,
          'um único job gerar-cobrancas-diario');
select is((select schedule || ' | ' || command from cron.job where jobname = 'gerar-cobrancas-diario'),
          '0 6 * * * | select public.gerar_cobrancas_agendado()',
          'todo dia às 06:00 UTC, chamando gerar_cobrancas_agendado');

select * from finish();
rollback;
