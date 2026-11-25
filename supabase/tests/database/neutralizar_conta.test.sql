-- neutralizar_conta_nao_confirmada_interna (docs/specs/convite-membros.md,
-- 4.4): só age em conta com o e-mail não confirmado, com a conta travada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

-- Idempotente: um link emitido depois da primeira neutralização (por esta ou
-- por outra academia) continua valendo numa segunda chamada; se alguém trocar
-- a senha no meio, a próxima chamada neutraliza de novo.
update auth.users set recovery_token = 'link-depois-da-neutralizacao'
 where id = 'e7e00000-0000-4000-8000-0000000000a1';
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values
  (gen_random_uuid(), 'e7e00000-0000-4000-8000-0000000000a1', 'recovery_token', 'link-depois', 'intruso@neutraliza.test');
set local role service_role;
select is(public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a1'), true,
  'segunda chamada numa conta já neutralizada devolve true');
reset role;
select is((select recovery_token || '/' || (select count(*) from auth.one_time_tokens o where o.user_id = u.id)::text
             from auth.users u where id = 'e7e00000-0000-4000-8000-0000000000a1'),
  'link-depois-da-neutralizacao/1', 'a segunda chamada não invalida o link emitido depois da primeira');
-- O Auth limpa a senha ao emitir o link de confirmação: continua neutralizada.
update auth.users set encrypted_password = '' where id = 'e7e00000-0000-4000-8000-0000000000a1';
set local role service_role;
select public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a1');
reset role;
select is((select recovery_token || '/' || encrypted_password from auth.users where id = 'e7e00000-0000-4000-8000-0000000000a1'),
  'link-depois-da-neutralizacao/', 'senha limpa pelo Auth ao emitir o link: a chamada seguinte não invalida o link');
update auth.users set encrypted_password = extensions.crypt('trocada-no-meio', extensions.gen_salt('bf', 4))
 where id = 'e7e00000-0000-4000-8000-0000000000a1';
set local role service_role;
select public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a1');
reset role;
select is((select (encrypted_password = extensions.crypt('trocada-no-meio', encrypted_password))::text || '/' || recovery_token
             from auth.users where id = 'e7e00000-0000-4000-8000-0000000000a1'),
  'false/', 'senha trocada depois da neutralização: a próxima chamada neutraliza de novo');

-- marcar_definir_senha_interna: marca a conta nova, mas não depois de a
-- senha nova já ter sido gravada pela concluir-senha.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('e7e00000-0000-4000-8000-0000000000a3', 'nova@neutraliza.test', null, '{}'),
  ('e7e00000-0000-4000-8000-0000000000a4', 'jadefiniu@neutraliza.test', now(), '{"senha_comprovada": "h"}');
set local role service_role;
select is(public.marcar_definir_senha_interna('e7e00000-0000-4000-8000-0000000000a3')::text || '/'
          || public.marcar_definir_senha_interna('e7e00000-0000-4000-8000-0000000000a4')::text, 'true/false',
  'marca a conta nova; a que já gravou a senha nova não é marcada');
reset role;
select is((select string_agg(coalesce(raw_app_meta_data ->> 'definir_senha', '-'), ',' order by email)
             from auth.users where id in ('e7e00000-0000-4000-8000-0000000000a3', 'e7e00000-0000-4000-8000-0000000000a4')),
  '-,true', 'a marca só fica na conta que ainda não gravou a senha nova');
select ok(not has_function_privilege('authenticated', 'public.marcar_definir_senha_interna(uuid)', 'EXECUTE'),
  'marcar_definir_senha_interna só para service_role');

select * from finish();
rollback;
