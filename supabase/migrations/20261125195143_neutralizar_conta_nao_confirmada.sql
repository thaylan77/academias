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

-- definir_senha_comprovada_interna (do convite) passa a exigir o fluxo do
-- convite: convite pendente e válido para o e-mail confirmado, ou vínculo já
-- aceito por convite. Antes, qualquer conta com sessão aberta por link podia
-- trocar a senha por aqui, sem as regras do Auth (revisão do Codex, PR 84).
create or replace function public.definir_senha_comprovada_interna(p_user_id uuid, p_sessao uuid, p_senha text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash  text;
  v_atual text;
begin
  if p_senha is null or length(p_senha) < 8 or octet_length(p_senha) > 72 then
    raise exception 'A senha precisa ter de 8 a 72 caracteres.'
      using hint = 'dados_invalidos';
  end if;
  -- Os vínculos aceitos por convite antes da conta, na mesma ordem do aceite
  -- (vínculo, academia, conta).
  perform 1 from public.membros_academia m
   where m.user_id = p_user_id and m.vale_a_partir is not null
     for update;
  select u.encrypted_password into v_atual from auth.users u where u.id = p_user_id for update;
  perform 1 from auth.sessions s where s.id = p_sessao and s.user_id = p_user_id for share;
  if not found then
    raise exception 'Abra o link enviado ao seu e-mail para definir a senha.'
      using hint = 'convite_exige_link';
  end if;

  -- Só no fluxo do convite: um convite pendente e válido para o e-mail
  -- confirmado da conta, ou um vínculo já aceito por convite (refazer a prova
  -- depois de uma troca de senha fora do fluxo). Uma conta comum, mesmo
  -- entrando por link, troca a senha pelo Auth, não por aqui.
  if not exists (select 1 from public.membros_academia m
                  where m.user_id = p_user_id and m.vale_a_partir is not null)
     and not exists (select 1
                       from auth.users u
                       join public.convites_equipe c on c.email = lower(btrim(u.email))
                      where u.id = p_user_id
                        and u.email_confirmed_at is not null
                        and c.status = 'pendente'
                        and c.expira_em > clock_timestamp()) then
    raise exception 'Não há convite da equipe para esta conta.'
      using hint = 'convite_invalido';
  end if;

  -- A senha nova não pode ser a atual: quem já a conhecia (a conta pode ter
  -- sido criada com a confirmação de e-mail desligada) entraria de novo.
  -- O Auth grava bcrypt. O pgcrypto só confere o prefixo $2a$; $2b$ e $2y$
  -- calculam o mesmo hash para senhas de até 72 bytes (o limite acima), então
  -- são conferidos trocando o prefixo. Outro formato não dá para conferir e
  -- é recusado.
  if coalesce(v_atual, '') <> '' then
    if v_atual !~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
      raise exception 'Não foi possível conferir a senha atual desta conta. Use "esqueci a senha".'
        using hint = 'senha_nao_verificavel';
    end if;
    v_atual := '$2a' || substr(v_atual, 4);
    if extensions.crypt(p_senha, v_atual) = v_atual then
      raise exception 'Escolha uma senha diferente da atual.'
        using hint = 'senha_repetida';
    end if;
  end if;

  -- Custo 10, o mesmo do Auth (o padrão do gen_salt('bf') é 6).
  v_hash := extensions.crypt(p_senha, extensions.gen_salt('bf', 10));
  -- Como a troca de senha do Auth: tokens de uso único emitidos antes
  -- (recuperação, troca de e-mail, reautenticação) deixam de valer.
  update auth.users u
     set encrypted_password = v_hash,
         recovery_token = '',
         recovery_sent_at = null,
         reauthentication_token = '',
         email_change_token_new = '',
         email_change_token_current = '',
         raw_app_meta_data = (coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('senha_redefinida_em', floor(extract(epoch from clock_timestamp()))::bigint,
                                 'senha_redefinida_sessao', p_sessao::text,
                                 'senha_comprovada', md5(v_hash)))
           - 'definir_senha'
   where u.id = p_user_id;
  delete from auth.one_time_tokens o where o.user_id = p_user_id;
  -- Como a troca de senha do Auth, as outras sessões caem. E os vínculos já
  -- aceitos por convite passam a valer só a partir desta prova: tokens
  -- posteriores desta sessão ou de sessões novas. Uma sessão aberta com uma
  -- senha anterior (por exemplo, durante uma suspensão) não volta a valer.
  delete from auth.sessions s where s.user_id = p_user_id and s.id <> p_sessao;
  update public.membros_academia m
     set vale_a_partir = date_trunc('second', clock_timestamp()) + interval '1 second',
         sessao_do_aceite = p_sessao
   where m.user_id = p_user_id
     and m.vale_a_partir is not null;
end
$$;

revoke execute on function public.definir_senha_comprovada_interna(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.definir_senha_comprovada_interna(uuid, uuid, text) to service_role;
