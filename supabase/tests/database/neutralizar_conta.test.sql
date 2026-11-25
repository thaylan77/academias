-- neutralizar_conta_nao_confirmada_interna (docs/specs/convite-membros.md,
-- 4.4): só age em conta com o e-mail não confirmado, com a conta travada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_app_meta_data, recovery_token) values
  ('e7e00000-0000-4000-8000-0000000000a1', 'intruso@neutraliza.test', null,
   extensions.crypt('senha-do-intruso', extensions.gen_salt('bf', 4)),
   '{"senha_comprovada": "x", "provider": "email"}', 'token-de-recuperacao'),
  ('e7e00000-0000-4000-8000-0000000000a2', 'confirmado@neutraliza.test', now(),
   extensions.crypt('senha-propria', extensions.gen_salt('bf', 4)), '{"provider": "email"}', '');
insert into auth.sessions (id, user_id, created_at) values
  ('e7e00000-0000-4000-8000-0000000006a1', 'e7e00000-0000-4000-8000-0000000000a1', now()),
  ('e7e00000-0000-4000-8000-0000000006a2', 'e7e00000-0000-4000-8000-0000000000a2', now());

select ok(not has_function_privilege('authenticated', 'public.neutralizar_conta_nao_confirmada_interna(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.neutralizar_conta_nao_confirmada_interna(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.neutralizar_conta_nao_confirmada_interna(uuid)', 'EXECUTE'),
  'só service_role executa');

set local role service_role;
select is(public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a1'), true,
  'conta não confirmada é neutralizada');
select is(public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a2'), false,
  'conta confirmada não é tocada');
select is(public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000ff'), false,
  'conta inexistente devolve false');
reset role;

select is((select encrypted_password = extensions.crypt('senha-do-intruso', encrypted_password)
                  or recovery_token <> ''
                  or not (raw_app_meta_data -> 'definir_senha')::boolean
                  or raw_app_meta_data ? 'senha_comprovada'
             from auth.users where id = 'e7e00000-0000-4000-8000-0000000000a1'),
  false, 'a senha e o token de recuperação de quem criou a conta caem, e ela fica marcada para definir senha');
select is((select count(*) from auth.sessions where user_id = 'e7e00000-0000-4000-8000-0000000000a1'), 0::bigint,
  'as sessões da conta neutralizada caem');
select is((select (encrypted_password = extensions.crypt('senha-propria', encrypted_password))::text
                  || '/' || (select count(*) from auth.sessions where user_id = u.id)::text
             from auth.users u where id = 'e7e00000-0000-4000-8000-0000000000a2'),
  'true/1', 'a conta confirmada mantém a senha e a sessão');

select * from finish();
rollback;
