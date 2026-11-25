-- Limite de tentativas da concluir-senha (registrar_tentativa_senha_interna).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, email_confirmed_at) values
  ('e7f10000-0000-4000-8000-0000000000a1', 'tenta@senha.test', now()),
  ('e7f10000-0000-4000-8000-0000000000a2', 'outra@senha.test', now());

select ok(not has_function_privilege('authenticated', 'public.registrar_tentativa_senha_interna(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.registrar_tentativa_senha_interna(uuid)', 'EXECUTE'),
  'só service_role registra tentativas');
set local role service_role;
select is((select string_agg(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a1')::text, ',')
             from generate_series(1, 7)),
  'true,true,true,true,true,false,false', 'cinco tentativas em 15 minutos; a sexta em diante é recusada');
select is(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a2'), true,
  'o limite é por conta');
reset role;
update public.convites_senha_tentativas set tentado_em = now() - interval '20 minutes'
 where user_id = 'e7f10000-0000-4000-8000-0000000000a1';
set local role service_role;
select is(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a1'), true,
  'passados 15 minutos, volta a permitir');
reset role;
select is((select count(*)::int from public.convites_senha_tentativas), 7,
  'a recusa não grava tentativa (5 antigas + 1 nova da conta, 1 da outra)');

select * from finish();
rollback;
