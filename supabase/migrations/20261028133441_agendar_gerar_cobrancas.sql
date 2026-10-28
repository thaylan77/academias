-- Geração diária de cobranças pelo pg_cron (issue #18; plano aprovado pelo
-- dono do projeto na sessão, por mexer no fluxo de dinheiro).
--
-- gerar_cobrancas já calcula o "hoje" de cada academia no fuso dela, pula a
-- academia suspensa, só gera a competência atual e a seguinte (com a
-- antecedência da academia) e não duplica. Faltava alguém chamá-la todo dia.
--
-- 1. cobrancas_geracao_log: uma linha por academia e execução, com quantas
--    cobranças saíram ou o erro. Dono e admin leem a da própria academia;
--    ninguém grava pela API. Guarda 180 dias.
-- 2. gerar_cobrancas_da_academia(academia): gera as de uma academia com o erro
--    isolado e registra. Só service_role.
-- 3. gerar_cobrancas_agendado(): procedure que o job chama; percorre as
--    academias ativas com commit depois de cada uma (não segura travas nem
--    perde o que já fez se cair no meio) e limpa o registro antigo.
-- 4. Job diário gerar-cobrancas-diario às 06:00 UTC (03:00 em Brasília e
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
  -- Instante real de cada academia (now() seria o início da transação).
  executado_em timestamptz not null default clock_timestamp(),
  geradas      integer not null default 0 check (geradas >= 0),
  erro         text
);
create index cobrancas_geracao_log_academia_idx on public.cobrancas_geracao_log (academia_id, executado_em desc);
create index cobrancas_geracao_log_executado_idx on public.cobrancas_geracao_log (executado_em);

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
-- 2. Uma academia
-- ---------------------------------------------------------------------
create or replace function public.gerar_cobrancas_da_academia(p_academia_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd  integer;
  v_erro text;
begin
  -- Subtransação: o erro desfaz só o que esta academia gravou.
  begin
    v_qtd := public.gerar_cobrancas(p_academia_id, null);
    insert into public.cobrancas_geracao_log (academia_id, geradas) values (p_academia_id, v_qtd);
    return v_qtd;
  exception when others then
    get stacked diagnostics v_erro = message_text;
    insert into public.cobrancas_geracao_log (academia_id, geradas, erro) values (p_academia_id, 0, left(v_erro, 500));
    return 0;
  end;
end
$$;

revoke execute on function public.gerar_cobrancas_da_academia(uuid) from public, anon, authenticated;
grant execute on function public.gerar_cobrancas_da_academia(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. O lote que o job chama
-- ---------------------------------------------------------------------
-- Procedure com commit depois de cada academia. O Postgres não aceita commit
-- em procedure security definer nem com "set search_path", então ela roda com
-- os privilégios de quem chama (o job, como postgres, ou service_role; ninguém
-- mais executa) e usa só nomes qualificados. O trabalho de cada academia é da
-- gerar_cobrancas_da_academia, que é security definer com search_path vazio.
create or replace procedure public.gerar_cobrancas_agendado()
language plpgsql
as $$
declare
  v_academia uuid;
begin
  for v_academia in
    select a.id from public.academias a where public.academia_ativa(a.id) order by a.id
  loop
    perform public.gerar_cobrancas_da_academia(v_academia);
    commit;
  end loop;

  delete from public.cobrancas_geracao_log where executado_em < now() - interval '180 days';
  commit;
end
$$;

revoke execute on procedure public.gerar_cobrancas_agendado() from public, anon, authenticated;
grant execute on procedure public.gerar_cobrancas_agendado() to service_role;

-- ---------------------------------------------------------------------
-- 4. Agendamento
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
    perform cron.schedule('gerar-cobrancas-diario', '0 6 * * *', 'call public.gerar_cobrancas_agendado()');
  else
    raise notice 'pg_cron indisponível neste banco: o job gerar-cobrancas-diario não foi agendado';
  end if;
end
$$;
