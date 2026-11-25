-- Convite de membros (docs/specs/convite-membros.md, 4.4): conta com o
-- e-mail do convidado que nunca foi confirmada. Quem a criou pode não ser o
-- dono do e-mail; a senha dela cai, as sessões e os tokens de uso único
-- dela também, e a conta fica marcada para definir senha.
--
-- Feito no banco, com a conta travada e só se o e-mail continuar não
-- confirmado: o dono legítimo que confirmou o cadastro entre a criação do
-- convite e este passo não perde a senha. A Edge Function convidar-membro
-- chama logo depois de criar_convite_interna devolver conta = nao_confirmada.
--
-- Idempotente: a primeira neutralização guarda em app_metadata o hash da
-- senha que ela gravou. Enquanto a senha continuar essa (ninguém trocou), uma
-- nova chamada não mexe em nada, e o link enviado depois da primeira (por
-- esta ou por outra academia) continua valendo.

create or replace function public.neutralizar_conta_nao_confirmada_interna(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmada timestamptz;
  v_hash       text;
  v_meta       jsonb;
  v_nova       text;
begin
  select u.email_confirmed_at, u.encrypted_password, u.raw_app_meta_data
    into v_confirmada, v_hash, v_meta
    from auth.users u where u.id = p_user_id for update;
  if not found or v_confirmada is not null then
    return false;
  end if;

  -- Já neutralizada e intacta: nada a fazer. "Intacta" inclui a senha
  -- vazia: o Auth limpa a senha de uma conta não confirmada ao emitir o link
  -- de confirmação, e esse link (de uma academia) não pode cair por causa do
  -- convite de outra. Uma senha diferente (alguém definiu outra) neutraliza
  -- de novo.
  if v_meta ? 'neutralizada'
     and (coalesce(v_hash, '') = '' or v_meta ->> 'neutralizada' = md5(v_hash)) then
    return true;
  end if;

  v_nova := extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 10));
  update auth.users u
     set encrypted_password = v_nova,
         recovery_token = '',
         recovery_sent_at = null,
         reauthentication_token = '',
         email_change_token_new = '',
         email_change_token_current = '',
         raw_app_meta_data = (coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('definir_senha', true, 'neutralizada', md5(v_nova)))
           - 'senha_comprovada' - 'senha_redefinida_em' - 'senha_redefinida_sessao'
   where u.id = p_user_id;
  delete from auth.sessions s where s.user_id = p_user_id;
  delete from auth.one_time_tokens o where o.user_id = p_user_id;
  return true;
end
$$;

revoke execute on function public.neutralizar_conta_nao_confirmada_interna(uuid) from public, anon, authenticated;
grant execute on function public.neutralizar_conta_nao_confirmada_interna(uuid) to service_role;

-- Conta criada agora pelo convite do Auth: marca definir_senha, com a conta
-- travada e só se a pessoa ainda não tiver gravado a senha nova pela
-- concluir-senha (senha_comprovada). O link sai antes desta marca; se a
-- pessoa já concluiu a senha nesse meio-tempo, a marca não volta.
create or replace function public.marcar_definir_senha_interna(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from auth.users u where u.id = p_user_id for update;
  update auth.users u
     set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('definir_senha', true)
   where u.id = p_user_id
     and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'senha_comprovada');
  return found;
end
$$;

revoke execute on function public.marcar_definir_senha_interna(uuid) from public, anon, authenticated;
grant execute on function public.marcar_definir_senha_interna(uuid) to service_role;
