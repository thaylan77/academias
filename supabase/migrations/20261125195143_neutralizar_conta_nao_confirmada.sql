-- Convite de membros (docs/specs/convite-membros.md, 4.4): conta com o
-- e-mail do convidado que nunca foi confirmada. Quem a criou pode não ser o
-- dono do e-mail; a senha dela cai, as sessões e os tokens de uso único
-- dela também, e a conta fica marcada para definir senha.
--
-- Feito no banco, com a conta travada e só se o e-mail continuar não
-- confirmado: o dono legítimo que confirmou o cadastro entre a criação do
-- convite e este passo não perde a senha. A Edge Function convidar-membro
-- chama logo depois de criar_convite_interna devolver conta = nao_confirmada.

create or replace function public.neutralizar_conta_nao_confirmada_interna(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmada timestamptz;
begin
  select u.email_confirmed_at into v_confirmada
    from auth.users u where u.id = p_user_id for update;
  if not found or v_confirmada is not null then
    return false;
  end if;

  update auth.users u
     set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'),
                                               extensions.gen_salt('bf', 10)),
         recovery_token = '',
         recovery_sent_at = null,
         reauthentication_token = '',
         email_change_token_new = '',
         email_change_token_current = '',
         raw_app_meta_data = (coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('definir_senha', true))
           - 'senha_comprovada' - 'senha_redefinida_em' - 'senha_redefinida_sessao'
   where u.id = p_user_id;
  delete from auth.sessions s where s.user_id = p_user_id;
  delete from auth.one_time_tokens o where o.user_id = p_user_id;
  return true;
end
$$;

revoke execute on function public.neutralizar_conta_nao_confirmada_interna(uuid) from public, anon, authenticated;
grant execute on function public.neutralizar_conta_nao_confirmada_interna(uuid) to service_role;
