-- Limite de tentativas da concluir-senha (registrar_tentativa_senha_interna).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, email_confirmed_at) values
  ('e7f10000-0000-4000-8000-0000000000a1', 'tenta@senha.test', now()),
  ('e7f10000-0000-4000-8000-0000000000a2', 'outra@senha.test', now()),
  ('e7f10000-0000-4000-8000-0000000000a3', 'mfa@senha.test', now());
insert into auth.sessions (id, user_id, created_at, aal) values
  ('e7f10000-0000-4000-8000-0000000006a1', 'e7f10000-0000-4000-8000-0000000000a1', now(), 'aal1'),
  ('e7f10000-0000-4000-8000-0000000006a2', 'e7f10000-0000-4000-8000-0000000000a2', now(), 'aal1'),
  ('e7f10000-0000-4000-8000-0000000006a3', 'e7f10000-0000-4000-8000-0000000000a3', now(), 'aal2');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), 'e7f10000-0000-4000-8000-0000000000a3', 'app', 'totp', 'verified', now(), now());

select ok(not has_function_privilege('authenticated', 'public.registrar_tentativa_senha_interna(uuid, uuid, text)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.registrar_tentativa_senha_interna(uuid, uuid, text)', 'EXECUTE'),
  'só service_role registra tentativas');
set local role service_role;
select is((select string_agg(public.registrar_tentativa_senha_interna(
                    'e7f10000-0000-4000-8000-0000000000a1', 'e7f10000-0000-4000-8000-0000000006a1', 'aal1'), ',')
             from generate_series(1, 7)),
  'ok,ok,ok,ok,ok,limite,limite', 'cinco tentativas em 15 minutos; a sexta em diante é recusada');
select is(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a2',
            'e7f10000-0000-4000-8000-0000000006a2', 'aal1'), 'ok', 'o limite é por conta');
select is(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a2',
            'e7f10000-0000-4000-8000-0000000006a1', 'aal1'), 'convite_exige_link',
  'sessão de outra conta: recusa sem debitar');
select is((select string_agg(public.registrar_tentativa_senha_interna(
                    'e7f10000-0000-4000-8000-0000000000a3', 'e7f10000-0000-4000-8000-0000000006a3', 'aal1'), ',')
             from generate_series(1, 6)),
  'mfa_necessario,mfa_necessario,mfa_necessario,mfa_necessario,mfa_necessario,mfa_necessario',
  'com MFA, o token aal1 é recusado antes de debitar');
select is(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a3',
            'e7f10000-0000-4000-8000-0000000006a3', 'aal2'), 'ok',
  'as recusas do token aal1 não gastaram a cota do token aal2');
reset role;
update public.convites_senha_tentativas set tentado_em = now() - interval '20 minutes'
 where user_id = 'e7f10000-0000-4000-8000-0000000000a1';
set local role service_role;
select is(public.registrar_tentativa_senha_interna('e7f10000-0000-4000-8000-0000000000a1',
            'e7f10000-0000-4000-8000-0000000006a1', 'aal1'), 'ok', 'passados 15 minutos, volta a permitir');
reset role;
select is((select count(*)::int from public.convites_senha_tentativas), 8,
  'só as tentativas aceitas são gravadas (6 da primeira conta, 1 da segunda, 1 da com MFA)');

select * from finish();
rollback;
