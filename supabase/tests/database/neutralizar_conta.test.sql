-- neutralizar_conta_nao_confirmada_interna (docs/specs/convite-membros.md,
-- 4.4): só age em conta com o e-mail não confirmado, com a conta travada.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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

-- conta_nao_confirmada_por_email_interna: a conta não confirmada do endereço
-- (o cadastro que surgiu no meio do convite); nada para a confirmada.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('e7e00000-0000-4000-8000-0000000000a3', 'nova@neutraliza.test', null, '{}'),
  ('e7e00000-0000-4000-8000-0000000000a4', 'jadefiniu@neutraliza.test', now(), '{}');
set local role service_role;
select is(public.conta_nao_confirmada_por_email_interna('  NOVA@neutraliza.test '), 'e7e00000-0000-4000-8000-0000000000a3'::uuid,
  'acha a conta não confirmada pelo e-mail normalizado');
select is(public.conta_nao_confirmada_por_email_interna('jadefiniu@neutraliza.test'), null::uuid,
  'conta confirmada não é devolvida');
reset role;
select ok(not has_function_privilege('authenticated', 'public.conta_nao_confirmada_por_email_interna(text)', 'EXECUTE'),
  'conta_nao_confirmada_por_email_interna só para service_role');

-- Conta criada agora pelo convite do Auth (sem senha, com o link nos tokens):
-- o convite de outra academia não apaga o link, só marca definir_senha.
insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_app_meta_data, recovery_token) values
  ('e7e00000-0000-4000-8000-0000000000a5', 'convidada@neutraliza.test', null, '', '{}', '');
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values
  (gen_random_uuid(), 'e7e00000-0000-4000-8000-0000000000a5', 'confirmation_token', 'link-do-convite', 'convidada@neutraliza.test');
set local role service_role;
select is(public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a5'), true,
  'conta sem senha criada pelo convite: devolve true');
reset role;
select is((select (raw_app_meta_data ->> 'definir_senha') || '/' || (select count(*) from auth.one_time_tokens o where o.user_id = u.id)::text
             from auth.users u where id = 'e7e00000-0000-4000-8000-0000000000a5'),
  'true/1', 'o link do convite da conta nova continua valendo, e ela fica marcada para definir senha');

-- Cadastro com senha que surgiu no meio do convite: a neutralização derruba a
-- senha antes do único link.
insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_app_meta_data) values
  ('e7e00000-0000-4000-8000-0000000000a6', 'cadastro-no-meio@neutraliza.test', null,
   extensions.crypt('senha-do-cadastro', extensions.gen_salt('bf', 4)), '{}');
set local role service_role;
select public.neutralizar_conta_nao_confirmada_interna(
  public.conta_nao_confirmada_por_email_interna('cadastro-no-meio@neutraliza.test'));
reset role;
select is((select (encrypted_password = extensions.crypt('senha-do-cadastro', encrypted_password))::text
                  || '/' || (raw_app_meta_data ->> 'definir_senha')
             from auth.users where id = 'e7e00000-0000-4000-8000-0000000000a6'),
  'false/true', 'a senha do cadastro concorrente caiu e a conta ficou marcada');

-- MFA: conta com fator verificado só define a senha numa sessão aal2.
insert into public.academias (id, nome, slug, status) values
  ('e7e00000-0000-4000-8000-00000000000a', 'Neutraliza MFA', 'neutraliza-mfa', 'ativa');
insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_app_meta_data) values
  ('e7e00000-0000-4000-8000-0000000000a7', 'mfa@neutraliza.test', now(), '', '{}');
insert into public.membros_academia (academia_id, user_id, papel, vale_a_partir) values
  ('e7e00000-0000-4000-8000-00000000000a', 'e7e00000-0000-4000-8000-0000000000a7', 'professor', now());
insert into auth.sessions (id, user_id, created_at, aal) values
  ('e7e00000-0000-4000-8000-0000000006a7', 'e7e00000-0000-4000-8000-0000000000a7', now(), 'aal1');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), 'e7e00000-0000-4000-8000-0000000000a7', 'app', 'totp', 'verified', now(), now());
set local role service_role;
select throws_ok($$select public.definir_senha_comprovada_interna('e7e00000-0000-4000-8000-0000000000a7',
    'e7e00000-0000-4000-8000-0000000006a7', 'senha-nova-com-mfa')$$, 'P0001',
  'Confirme o segundo fator de autenticação para definir a senha.',
  'conta com MFA verificado não define a senha numa sessão aal1');
reset role;
update auth.sessions set aal = 'aal2' where id = 'e7e00000-0000-4000-8000-0000000006a7';
set local role service_role;
select throws_ok($$select public.definir_senha_comprovada_interna('e7e00000-0000-4000-8000-0000000000a7',
    'e7e00000-0000-4000-8000-0000000006a7', 'senha-nova-com-mfa', 'aal1')$$, 'P0001',
  'Confirme o segundo fator de autenticação para definir a senha.',
  'sessão elevada a aal2, mas com um token aal1 anterior: recusa');
select lives_ok($$select public.definir_senha_comprovada_interna('e7e00000-0000-4000-8000-0000000000a7',
    'e7e00000-0000-4000-8000-0000000006a7', 'senha-nova-com-mfa', 'aal2')$$,
  'token e sessão em aal2: a senha é definida');
reset role;

-- O link de confirmação do cadastro (foi para o próprio endereço) fica; os
-- demais tokens de uso único e a senha caem.
insert into auth.users (id, email, email_confirmed_at, encrypted_password, raw_app_meta_data) values
  ('e7e00000-0000-4000-8000-0000000000a8', 'recem-cadastro@neutraliza.test', null,
   extensions.crypt('senha-do-cadastro-2', extensions.gen_salt('bf', 4)), '{}');
insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values
  (gen_random_uuid(), 'e7e00000-0000-4000-8000-0000000000a8', 'confirmation_token', 'link-do-cadastro', 'recem-cadastro@neutraliza.test'),
  (gen_random_uuid(), 'e7e00000-0000-4000-8000-0000000000a8', 'recovery_token', 'link-de-recuperacao', 'recem-cadastro@neutraliza.test');
set local role service_role;
select public.neutralizar_conta_nao_confirmada_interna('e7e00000-0000-4000-8000-0000000000a8');
reset role;
select is((select string_agg(o.token_type::text, ',' order by o.token_type::text) from auth.one_time_tokens o
            where o.user_id = 'e7e00000-0000-4000-8000-0000000000a8')
          || '/' || (select (encrypted_password = extensions.crypt('senha-do-cadastro-2', encrypted_password))::text
                       from auth.users where id = 'e7e00000-0000-4000-8000-0000000000a8'),
  'confirmation_token/false', 'o link de confirmação do cadastro fica; a recuperação e a senha caem');

select * from finish();
rollback;
