-- Reservas de envio do convite abandonadas antes da chamada ao Auth
-- (docs/specs/convite-membros.md, 4.4): assumir_envio_convite_interna e
-- liberar_reservas_abandonadas_interna.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.convites_envios (id, email, reservado_em, tentativa_em) values
  ('e7f00000-0000-4000-8000-000000000001', 'velha@reserva.test', now() - interval '5 minutes', null),
  ('e7f00000-0000-4000-8000-000000000002', 'nova@reserva.test', now(), null),
  ('e7f00000-0000-4000-8000-000000000003', 'assumida@reserva.test', now() - interval '5 minutes', now() - interval '4 minutes');

select ok(not has_function_privilege('authenticated', 'public.assumir_envio_convite_interna(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.liberar_reservas_abandonadas_interna(interval)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.assumir_envio_convite_interna(uuid)', 'EXECUTE'),
  'só service_role assume e libera reservas');
select is((select count(*)::int from cron.job where jobname = 'liberar-reservas-convite-abandonadas'), 1,
  'a liberação das reservas abandonadas está agendada no pg_cron');

set local role service_role;
select is(public.liberar_reservas_abandonadas_interna(), 1, 'libera só a reserva velha que nenhum worker assumiu');
reset role;
select is((select string_agg(email || '=' || (liberado_em is not null)::text, ',' order by email)
             from public.convites_envios where email like '%@reserva.test'),
  'assumida@reserva.test=false,nova@reserva.test=false,velha@reserva.test=true',
  'a reserva recente e a assumida (o e-mail pode ter saído) ficam');

set local role service_role;
select is(public.assumir_envio_convite_interna('e7f00000-0000-4000-8000-000000000001'), false,
  'o worker atrasado não assume a reserva já liberada (e não envia)');
select is(public.assumir_envio_convite_interna('e7f00000-0000-4000-8000-000000000002'), true,
  'o worker assume a reserva em aberto antes de chamar o Auth');
select is(public.assumir_envio_convite_interna('e7f00000-0000-4000-8000-000000000002'), false,
  'a mesma reserva não é assumida duas vezes');
reset role;
update public.convites_envios set reservado_em = now() - interval '5 minutes'
 where id = 'e7f00000-0000-4000-8000-000000000002';
set local role service_role;
select is(public.liberar_reservas_abandonadas_interna(), 0,
  'reserva assumida não é liberada, mesmo velha: o e-mail pode ter saído');
select throws_ok($$select public.liberar_reservas_abandonadas_interna(interval '10 seconds')$$, 'P0001', null,
  'idade mínima de 1 minuto');
reset role;

select * from finish();
rollback;
