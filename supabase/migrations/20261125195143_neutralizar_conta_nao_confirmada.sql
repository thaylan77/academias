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

  -- Sem senha, não há credencial de quem criou a conta para derrubar: é a
  -- conta criada agora pelo convite do Auth (o link do convite está nos
  -- tokens dela) ou uma cuja senha o Auth limpou ao emitir o link de
  -- confirmação. Os tokens são o link já entregue por alguma academia e não
  -- podem cair pelo convite de outra: só marca definir_senha (se a senha
  -- nova ainda não foi gravada).
  if coalesce(v_hash, '') = '' then
    update auth.users u
       set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('definir_senha', true)
     where u.id = p_user_id
       and not (coalesce(u.raw_app_meta_data, '{}'::jsonb) ? 'senha_comprovada');
    -- Sessões não fazem parte do link; uma conta não confirmada não deveria
    -- ter nenhuma, e se tiver, cai.
    delete from auth.sessions s where s.user_id = p_user_id;
    return true;
  end if;

  -- Já neutralizada e intacta (ninguém trocou a senha aleatória): nada a
  -- fazer, e o link emitido depois continua valendo. Uma senha diferente
  -- neutraliza de novo.
  if v_meta ->> 'neutralizada' = md5(v_hash) then
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

-- Conta não confirmada com o e-mail do convite, para a convidar-membro: quando
-- ela tenta criar a conta de um endereço que não tinha conta e o Auth recusa
-- porque alguém se cadastrou nesse meio-tempo, usa esta conta (e a
-- neutraliza antes do link). Null se a conta já foi confirmada ou não existe.
create or replace function public.conta_nao_confirmada_por_email_interna(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where lower(btrim(u.email)) = lower(btrim(p_email))
     and u.email_confirmed_at is null
     and u.deleted_at is null
   order by u.created_at
   limit 1
$$;

revoke execute on function public.conta_nao_confirmada_por_email_interna(text) from public, anon, authenticated;
grant execute on function public.conta_nao_confirmada_por_email_interna(text) to service_role;

-- definir_senha_comprovada_interna (do convite) passa a exigir o fluxo do
-- convite: convite pendente e válido para o e-mail confirmado, ou vínculo já
-- aceito por convite. Antes, qualquer conta com sessão aberta por link podia
-- trocar a senha por aqui, sem as regras do Auth (revisão do Codex, PR 84).
--
-- Recebe também o aal do JWT que a Edge Function conferiu: com MFA, o token
-- apresentado e a sessão viva precisam estar em aal2. A versão de 3
-- parâmetros sai (não pode sobrar um caminho sem o aal do token).
drop function public.definir_senha_comprovada_interna(uuid, uuid, text);

create or replace function public.definir_senha_comprovada_interna(p_user_id uuid, p_sessao uuid, p_senha text,
                                                                   p_aal text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash  text;
  v_atual text;
  v_aal   text;
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
  select s.aal::text into v_aal from auth.sessions s where s.id = p_sessao and s.user_id = p_user_id for share;
  if not found then
    raise exception 'Abra o link enviado ao seu e-mail para definir a senha.'
      using hint = 'convite_exige_link';
  end if;

  -- Como a troca de senha do Auth: conta com fator MFA verificado só troca a
  -- senha com um token aal2, de uma sessão que continua em aal2. Um token aal1
  -- anterior da mesma sessão, ainda válido, não serve.
  if exists (select 1 from auth.mfa_factors f where f.user_id = p_user_id and f.status = 'verified')
     and (coalesce(v_aal, 'aal1') <> 'aal2' or coalesce(p_aal, 'aal1') <> 'aal2') then
    raise exception 'Confirme o segundo fator de autenticação para definir a senha.'
      using hint = 'mfa_necessario';
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

revoke execute on function public.definir_senha_comprovada_interna(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.definir_senha_comprovada_interna(uuid, uuid, text, text) to service_role;

-- Reserva de envio abandonada (revisão do Codex, PR 84): a convidar-membro
-- responde antes de enviar (EdgeRuntime.waitUntil). Se o worker cair entre a
-- reserva e a chamada ao Auth, nenhum e-mail saiu, mas a reserva sem
-- resultado seguraria o endereço em todas as academias até o expurgo.
-- tentativa_em marca, de forma durável, o momento em que o worker vai chamar
-- o Auth: antes dele, uma reserva com mais de 2 minutos é abandonada e o job
-- a libera; depois dele, o e-mail pode ter saído e a reserva fica (lado
-- seguro contra spam), como antes.
alter table public.convites_envios add column tentativa_em timestamptz;

-- O worker assume a reserva logo antes de chamar o Auth. Devolve false se
-- ela já foi resolvida ou liberada como abandonada: aí o worker não envia.
create or replace function public.assumir_envio_convite_interna(p_envio_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select v.email into v_email from public.convites_envios v where v.id = p_envio_id;
  if v_email is null then
    return false;
  end if;
  -- Mesma trava do endereço de criar_convite_interna.
  perform pg_advisory_xact_lock(hashtextextended('convite_email:' || v_email, 0));
  update public.convites_envios v
     set tentativa_em = clock_timestamp()
   where v.id = p_envio_id
     and v.enviado_em is null
     and v.liberado_em is null
     and v.tentativa_em is null;
  return found;
end
$$;

revoke execute on function public.assumir_envio_convite_interna(uuid) from public, anon, authenticated;
grant execute on function public.assumir_envio_convite_interna(uuid) to service_role;

-- Libera as reservas que nenhum worker assumiu em 2 minutos (o worker caiu
-- antes de chamar o Auth). Roda a cada minuto pelo pg_cron.
create or replace function public.liberar_reservas_abandonadas_interna(p_idade interval default interval '2 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_idade is null or p_idade < interval '1 minute' then
    raise exception 'Idade mínima de 1 minuto.' using hint = 'dados_invalidos';
  end if;
  update public.convites_envios v
     set liberado_em = clock_timestamp()
   where v.enviado_em is null
     and v.liberado_em is null
     and v.tentativa_em is null
     and v.reservado_em < clock_timestamp() - p_idade;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke execute on function public.liberar_reservas_abandonadas_interna(interval) from public, anon, authenticated;
grant execute on function public.liberar_reservas_abandonadas_interna(interval) to service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('liberar-reservas-convite-abandonadas', '* * * * *',
                          'select public.liberar_reservas_abandonadas_interna()');
  else
    raise notice 'pg_cron indisponível neste banco: o job liberar-reservas-convite-abandonadas não foi agendado';
  end if;
end
$$;
