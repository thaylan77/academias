-- Geração diária de cobranças pelo pg_cron (issue #18; plano aprovado pelo
-- dono do projeto na sessão, por mexer no fluxo de dinheiro).
--
-- gerar_cobrancas já calcula o "hoje" de cada academia no fuso dela, pula a
-- academia suspensa, só gera a competência atual e a seguinte (com a
-- antecedência da academia) e não duplica. Faltava alguém chamá-la todo dia.
--
-- 1. cobrancas_geracao_log: uma linha por academia e execução, com quantas
--    cobranças saíram ou o erro. Dono e admin leem a da própria academia;
--    ninguém grava pela API.
-- 2. gerar_cobrancas_agendado(): percorre as academias ativas e gera as de
--    cada uma com o erro isolado (a falha de uma não derruba as outras).
--    Só service_role (e o job, que roda como postgres).
-- 3. Job diário gerar-cobrancas-diario às 06:00 UTC (03:00 em Brasília e
--    Fortaleza, 01:00 no Acre): o dia já virou em todos os fusos do Brasil.
--    Se um dia falhar, o seguinte recupera, dentro da janela da geração.
--
-- A emissão automática no gateway fica para depois da #17.

-- ---------------------------------------------------------------------
-- 1. Registro das execuções
-- ---------------------------------------------------------------------
create table public.cobrancas_geracao_log (
  id           uuid primary key default gen_random_uuid(),
  academia_id  uuid not null references public.academias (id) on delete cascade,
  executado_em timestamptz not null default now(),
  geradas      integer not null default 0 check (geradas >= 0),
  erro         text,
  unique (academia_id, id)
);
create index cobrancas_geracao_log_academia_idx on public.cobrancas_geracao_log (academia_id, executado_em desc);

alter table public.cobrancas_geracao_log enable row level security;
revoke all on public.cobrancas_geracao_log from anon, authenticated;
grant select on public.cobrancas_geracao_log to authenticated;

create policy cobrancas_geracao_log_select on public.cobrancas_geracao_log
  for select to authenticated
  using (public.tem_papel(academia_id, array['dono', 'admin']));

create trigger cobrancas_geracao_log_academia_imutavel
  before update of academia_id on public.cobrancas_geracao_log
  for each row execute function public.bloqueia_troca_academia();

-- ---------------------------------------------------------------------
-- 2. O que o job chama
-- ---------------------------------------------------------------------
create or replace function public.gerar_cobrancas_agendado()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_qtd      integer;
  v_total    integer := 0;
  v_erro     text;
begin
  for v_academia in
    select a.id from public.academias a where public.academia_ativa(a.id) order by a.id
  loop
    -- Cada academia numa subtransação: o erro desfaz só o que ela gravou.
    begin
      v_qtd := public.gerar_cobrancas(v_academia, null);
      v_total := v_total + v_qtd;
      insert into public.cobrancas_geracao_log (academia_id, geradas) values (v_academia, v_qtd);
    exception when others then
      get stacked diagnostics v_erro = message_text;
      insert into public.cobrancas_geracao_log (academia_id, geradas, erro) values (v_academia, 0, left(v_erro, 500));
    end;
  end loop;
  return v_total;
end
$$;

revoke execute on function public.gerar_cobrancas_agendado() from public, anon, authenticated;
grant execute on function public.gerar_cobrancas_agendado() to service_role;

-- ---------------------------------------------------------------------
-- 3. Agendamento
-- ---------------------------------------------------------------------
-- O Supabase (hospedado e o local do CI) tem o pg_cron. Fora dele (o Postgres
-- temporário de desenvolvimento) a migration segue sem o job, com aviso; o
-- teste agendamento_cron.test.sql exige a extensão e o job, então o CI falha
-- se faltarem.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Com o mesmo nome, cron.schedule atualiza o job em vez de duplicar.
    perform cron.schedule('gerar-cobrancas-diario', '0 6 * * *', 'select public.gerar_cobrancas_agendado()');
  else
    raise notice 'pg_cron indisponível neste banco: o job gerar-cobrancas-diario não foi agendado';
  end if;
end
$$;
