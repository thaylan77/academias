-- Convite de membros da equipe (docs/specs/convite-membros.md): criação pela
-- Edge Function (criar_convite_interna, só service_role), leitura, cancelar,
-- aceitar, recusar, equipe_da_academia e o gatilho do último dono.
-- Academias A e B (ativas) e S (suspensa).
begin;
create extension if not exists pgtap with schema extensions;
select plan(120);

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
create function public.__como(p_user text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated',
    'iat', floor(extract(epoch from clock_timestamp()))::bigint + 1, 'session_id', p_user,
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', 0)))::text, true);
end
$$;

-- Sessão aberta por link, com iat e session_id escolhidos.
create function public.__como_token(p_user text, p_iat bigint, p_sessao text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'iat', p_iat,
    'session_id', p_sessao,
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', 0)))::text, true);
end
$$;

-- Sessão aberta só com senha (sem link enviado ao e-mail).
create function public.__como_senha(p_user text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_user,
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', 0)))::text, true);
end
$$;

create function public.__como_servico()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

-- Simula o Auth (GoTrue): requisição que não é service_role nem sessão
-- administrativa sem JWT. No Supabase de verdade é o session_user
-- supabase_auth_admin; aqui, o papel da requisição.
create function public.__como_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'supabase_auth_admin', true);
  perform set_config('request.jwt.claims', '{"role":"supabase_auth_admin"}', true);
end
$$;

create function public.__sem_jwt()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end
$$;

create function public.__hint_de(p_sql text)
returns text
language plpgsql
as $$
declare v text;
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return coalesce(nullif(v, ''), 'sem hint: ' || sqlerrm);
end
$$;

-- Roda o comando e desfaz: devolve 'passou' ou o hint do erro.
create function public.__passa_e_desfaz(p_sql text)
returns text
language plpgsql
as $$
declare v text;
begin
  begin
    execute p_sql;
    raise exception 'desfazer' using hint = '__desfazer';
  exception when others then
    get stacked diagnostics v = pg_exception_hint;
  end;
  return case when v = '__desfazer' then 'passou' else coalesce(nullif(v, ''), 'sem hint') end;
end
$$;

-- Convite pela Edge Function: criar_convite_interna como service_role.
create function public.__cc(p_user text, p_acad text, p_email text, p_papel text)
returns jsonb
language sql
as $$
  select public.criar_convite_interna(p_user::uuid, p_acad::uuid, p_email, p_papel)
$$;

grant execute on function public.__como(text), public.__como_senha(text), public.__como_token(text, bigint, text), public.__como_servico(), public.__sem_jwt(),
  public.__hint_de(text), public.__passa_e_desfaz(text) to authenticated, service_role;
grant execute on function public.__cc(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('e7c00000-0000-4000-8000-0000000000a1', 'dono-a@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a2', 'admin-a@conv.test',    now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a3', 'prof-a@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a4', 'recep-a@conv.test',    now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a5', 'inativo-a@conv.test',  now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a6', 'exdono-a@conv.test',   now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a7', 'admin2-a@conv.test',   now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000a8', 'inativo2-a@conv.test', now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000b1', 'dono-b@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000b2', 'admin-b@conv.test',    now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000c1', 'dono-s@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d1', 'conf@conv.test',       now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d2', 'naoconf@conv.test',    null,  '{}'),
  ('e7c00000-0000-4000-8000-0000000000d3', 'senha@conv.test',      now(), '{"definir_senha": true}'),
  ('e7c00000-0000-4000-8000-0000000000d4', 'aluno@conv.test',      now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d5', 'outro@conv.test',      now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d6', 'vencido@conv.test',    now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d7', 'semquem@conv.test',    now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d8', 'saiu@conv.test',       now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000d9', 'recusa@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000da', 'quemapagou@conv.test', now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000f1', 'dono-x@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000f2', 'dono-y@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000dc', 'aluno2@conv.test',     now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000dd', 'semsenha@conv.test',   now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000de', 'outrasessao@conv.test', now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000df', 'semsessao@conv.test',  now(), '{}'),
  ('e7c00000-0000-4000-8000-0000000000e1', 'totem-a@conv.test',    now(), '{}');

-- Senha nova já definida pela Edge Function concluir-senha (o aceite exige),
-- menos para semsenha.
update auth.users set raw_app_meta_data = raw_app_meta_data
       || jsonb_build_object('senha_redefinida_em', 1, 'senha_redefinida_sessao', id::text)
 where email like '%@conv.test' and email <> 'semsenha@conv.test';
-- A troca de senha de outrasessao foi feita em outra sessão.
update auth.users set raw_app_meta_data = raw_app_meta_data
       || '{"senha_redefinida_sessao": "e7c00000-0000-4000-8000-0000000005ff"}'
 where email = 'outrasessao@conv.test';
-- Uma sessão por usuário (id = o próprio id do usuário, como o session_id que
-- __como põe no JWT); semsessao teve a sessão revogada.
insert into auth.sessions (id, user_id) select id, id from auth.users where email like '%@conv.test';
delete from auth.sessions where user_id = 'e7c00000-0000-4000-8000-0000000000df';

insert into public.academias (id, nome, slug, status) values
  ('e7c00000-0000-4000-8000-00000000000a', 'Convite A', 'convite-a', 'ativa'),
  ('e7c00000-0000-4000-8000-00000000000b', 'Convite B', 'convite-b', 'ativa'),
  ('e7c00000-0000-4000-8000-00000000000c', 'Convite S', 'convite-s', 'ativa'),
  ('e7c00000-0000-4000-8000-00000000000d', 'Convite D', 'convite-d', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel, ativo) values
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a1', 'dono',      true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a2', 'admin',     true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a3', 'professor', true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a4', 'recepcao',  true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a5', 'professor', false),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a6', 'dono',      false),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a7', 'admin',     true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a8', 'professor', false),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d4', 'aluno',     true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000e1', 'totem',     true),
  ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000dc', 'aluno',     true),
  ('e7c00000-0000-4000-8000-00000000000b', 'e7c00000-0000-4000-8000-0000000000b1', 'dono',      true),
  ('e7c00000-0000-4000-8000-00000000000b', 'e7c00000-0000-4000-8000-0000000000b2', 'admin',     true),
  ('e7c00000-0000-4000-8000-00000000000c', 'e7c00000-0000-4000-8000-0000000000c1', 'dono',      true),
  ('e7c00000-0000-4000-8000-00000000000d', 'e7c00000-0000-4000-8000-0000000000f1', 'dono',      true),
  ('e7c00000-0000-4000-8000-00000000000d', 'e7c00000-0000-4000-8000-0000000000f2', 'dono',      true);

insert into public.alunos (id, academia_id, nome, email, status, user_id) values
  ('e7c00000-0000-4000-8000-0000000001a1', 'e7c00000-0000-4000-8000-00000000000a', 'Aluna Promovida',
   'aluno@conv.test', 'ativo', 'e7c00000-0000-4000-8000-0000000000d4'),
  ('e7c00000-0000-4000-8000-0000000001d1', 'e7c00000-0000-4000-8000-00000000000d', 'Dono Y Aluno',
   'dono-y@conv.test', 'ativo', 'e7c00000-0000-4000-8000-0000000000f2');

-- Convite em S criado antes da suspensão (gravado direto).
insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em) values
  ('e7c00000-0000-4000-8000-0000000002c1', 'e7c00000-0000-4000-8000-00000000000c', 'outro@conv.test',
   'professor', 'e7c00000-0000-4000-8000-0000000000c1', now() + interval '7 days');
update public.academias set status = 'suspensa' where id = 'e7c00000-0000-4000-8000-00000000000c';

-- 30 convites recentes em B, para o limite diário.
insert into public.convites_equipe (academia_id, email, papel, convidado_por, expira_em, ultimo_envio_em, envios_recentes)
select 'e7c00000-0000-4000-8000-00000000000b', 'lote' || g || '@conv.test', 'professor',
       'e7c00000-0000-4000-8000-0000000000b1', now() + interval '7 days', now() - interval '1 hour', array[now() - interval '1 hour']
from generate_series(1, 30) g;

-- Leitura de apoio, sem RLS: o convidado não lê convites_equipe nem a linha
-- de membro dos outros.
create function public.__conv(p_acad text, p_email text) returns public.convites_equipe
language sql security definer set search_path = '' as $$
  select * from public.convites_equipe
  where academia_id = p_acad::uuid and email = p_email
  order by created_at desc limit 1
$$;
create function public.__membro(p_acad text, p_user text) returns text
language sql security definer set search_path = '' as $$
  select coalesce((select papel || case when ativo then '' else ' (inativo)' end
                   from public.membros_academia where academia_id = p_acad::uuid and user_id = p_user::uuid), '-')
$$;
grant execute on function public.__conv(text, text), public.__membro(text, text) to authenticated, service_role;
create function public.__sessoes(p_user uuid) returns text
language sql security definer set search_path = '' as $$
  select string_agg(s.id::text, ',' order by s.id) from auth.sessions s where s.user_id = p_user
$$;
grant execute on function public.__sessoes(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Estrutura e permissões
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.convites_equipe'::regclass),
  'convites_equipe com RLS ligado');
select ok(not has_table_privilege('authenticated', 'public.convites_equipe', 'INSERT')
          and not has_table_privilege('authenticated', 'public.convites_equipe', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.convites_equipe', 'DELETE'),
  'authenticated não escreve direto em convites_equipe');
select ok(not has_function_privilege('authenticated', 'public.criar_convite_interna(uuid,uuid,text,text,bigint,uuid)', 'EXECUTE'),
  'authenticated não cria convite (só a Edge Function, com service_role)');
select ok(not has_table_privilege('authenticated', 'public.membros_academia', 'INSERT')
          and not has_column_privilege('authenticated', 'public.membros_academia', 'user_id', 'UPDATE')
          and has_column_privilege('authenticated', 'public.membros_academia', 'papel', 'UPDATE'),
  'entrada na equipe só pelo convite: sem insert direto nem troca de titular pela API');
select ok(not has_table_privilege('authenticated', 'public.convites_envios', 'SELECT')
          and not has_table_privilege('anon', 'public.convites_envios', 'SELECT'),
  'ninguém lê os envios reais pela API (convites_envios)');
select ok(not has_function_privilege('anon', 'public.cancelar_convite(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.meus_convites()', 'EXECUTE')
          and not has_function_privilege('anon', 'public.aceitar_convite(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.recusar_convite(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.equipe_da_academia(uuid)', 'EXECUTE'),
  'anon não executa nenhuma RPC de convite');
select is(public.__hint_de($$update public.convites_equipe set academia_id = 'e7c00000-0000-4000-8000-00000000000a'
                             where id = 'e7c00000-0000-4000-8000-0000000002c1'$$),
  'sem hint: Um registro não pode mudar de academia', 'convite não muda de academia');

-- ---------------------------------------------------------------------
-- Criar (Edge Function)
-- ---------------------------------------------------------------------
set local role service_role;
select public.__como_servico();

select is(public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', '  Novo@Conv.TEST ', 'professor') - 'convite_id' - 'user_id' - 'envio_id',
  '{"email": "novo@conv.test", "conta": "nenhuma", "enviar": true}'::jsonb, 'admin convida professor: e-mail normalizado, conta inexistente, envio liberado');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', 'x@conv.test', 'dono')$$),
  'sem_permissao', 'admin não convida dono');
select is(public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test', 'dono') ->> 'conta',
  'confirmada', 'dono convida dono; a conta existe e está confirmada');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test', 'recepcao')$$),
  'sem_permissao', 'C9: admin não sobrescreve o pendente de dono');
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).papel, 'dono', 'C9: o pendente de dono ficou intacto');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test', 'dono')$$),
  'convite_reenvio_cedo', 'C10: reenvio antes de um minuto');

reset role;
update public.convites_equipe set ultimo_envio_em = now() - interval '2 minutes', expira_em = now() + interval '1 day'
 where email = 'conf@conv.test';
set local role service_role;
select public.__como_servico();

select is((public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test', 'dono') ->> 'convite_id')::uuid,
  (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id, 'C9: reconvidar atualiza o mesmo pendente');
select ok((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).expira_em > now() + interval '6 days',
  'C9: a validade foi renovada para 7 dias');
select is((select count(*) from public.convites_equipe where email = 'conf@conv.test' and status = 'pendente'),
  1::bigint, 'C9: um pendente só');
select is(public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'naoconf@conv.test', 'recepcao') ->> 'conta',
  'nao_confirmada', 'conta não confirmada é avisada à Edge Function');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', 'PROF-A@conv.test', 'recepcao')$$),
  'ja_membro', 'C7: membro ativo da equipe não é convidado');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', 'exdono-a@conv.test', 'professor')$$),
  'sem_permissao', 'admin não traz de volta um dono inativo com outro papel');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'y@conv.test', 'aluno')$$)
          || '/' || public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'y@conv.test', 'totem')$$)
          || '/' || public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'y @conv.test', 'professor')$$),
  'dados_invalidos/dados_invalidos/dados_invalidos', 'papel aluno, papel totem e e-mail malformado: dados_invalidos');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a3', 'e7c00000-0000-4000-8000-00000000000a', 'y@conv.test', 'professor')$$),
  'sem_permissao', 'professor não convida');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000b', 'y@conv.test', 'professor')$$),
  'sem_permissao', 'admin de A não convida em B');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000c1', 'e7c00000-0000-4000-8000-00000000000c', 'y@conv.test', 'professor')$$),
  'academia_suspensa', 'C6: academia suspensa não convida');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000b1', 'e7c00000-0000-4000-8000-00000000000b', 'y@conv.test', 'professor')$$),
  'limite_convites', 'C10: o 31º convite em 24 horas é recusado');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'totem-a@conv.test', 'professor')$$),
  'ja_membro', 'o login do totem não é convidado para a equipe');

-- Cancelar e recriar não fura os 60 segundos nem o teto por endereço.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'ciclo@conv.test', 'professor');
reset role;
update public.convites_equipe set status = 'cancelado', encerrado_em = now() where email = 'ciclo@conv.test';
set local role service_role;
select public.__como_servico();
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'ciclo@conv.test', 'professor')$$),
  'convite_reenvio_cedo', 'C10: cancelar e recriar logo em seguida esbarra nos 60 segundos');
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'ciclo@conv.test', 'professor') ->> 'enviar',
  'false', 'C10: os 60 segundos valem entre academias, sem erro que revele a outra (grava sem envio)');
reset role;
-- O primeiro envio está quase saindo da janela e os outros quatro são de
-- agora: a janela é móvel, e o sexto continua recusado.
update public.convites_equipe
   set ultimo_envio_em = now() - interval '7 minutes',
       envios_recentes = array[now() - interval '23 hours 50 minutes', now() - interval '10 minutes',
                               now() - interval '9 minutes', now() - interval '8 minutes', now() - interval '7 minutes']
 where email = 'ciclo@conv.test' and academia_id = 'e7c00000-0000-4000-8000-00000000000a';
delete from public.convites_envios where email = 'ciclo@conv.test';
insert into public.convites_envios (email, reservado_em, enviado_em)
select 'ciclo@conv.test', t, t
from unnest(array[now() - interval '23 hours 50 minutes', now() - interval '10 minutes',
                  now() - interval '9 minutes', now() - interval '8 minutes', now() - interval '7 minutes']) t;
set local role service_role;
select public.__como_servico();
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'ciclo@conv.test', 'professor')$$),
  'limite_convites', 'C10: o 6º e-mail para o mesmo endereço em 24 horas é recusado');
reset role;
update public.convites_equipe set ultimo_envio_em = null where academia_id = 'e7c00000-0000-4000-8000-00000000000d';
set local role service_role;
select public.__como_servico();
select is((public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'ciclo@conv.test', 'professor') ->> 'enviar')
          || '/' || (select count(*) from public.convites_envios
                     where convite_id = (public.__conv('e7c00000-0000-4000-8000-00000000000d', 'ciclo@conv.test')).id),
  'false/0', 'C10: o teto de 5 por endereço vale entre academias, gravando sem envio real');
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'ciclo@conv.test', 'professor')$$),
  'convite_reenvio_cedo', 'C10: depois de um envio suprimido, a academia vê os 60 segundos como num envio de verdade');
reset role;
update public.convites_equipe
   set ultimo_envio_em = now() - interval '3 minutes',
       envios_recentes = array[now() - interval '25 hours', now() - interval '25 hours', now() - interval '25 hours',
                               now() - interval '25 hours', now() - interval '3 minutes']
 where email = 'ciclo@conv.test' and academia_id = 'e7c00000-0000-4000-8000-00000000000a';
delete from public.convites_envios where email = 'ciclo@conv.test';
insert into public.convites_envios (email, reservado_em, enviado_em)
select 'ciclo@conv.test', t, t
from unnest(array[now() - interval '25 hours', now() - interval '25 hours', now() - interval '25 hours',
                  now() - interval '25 hours', now() - interval '3 minutes']) t;
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'ciclo@conv.test', 'professor') ->> 'conta',
  'nenhuma', 'C10: envios com mais de 24 horas saem da conta');

-- Falha do provedor: liberar o envio devolve a cota do endereço no projeto
-- todo, e outra academia volta a conseguir enviar.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'falha@conv.test', 'professor');
select public.liberar_envio_convite_interna((select id from public.convites_envios where email = 'falha@conv.test'));
select is((select count(*) from public.convites_envios where email = 'falha@conv.test' and liberado_em is null)::text,
  '0', 'liberar o envio que falhou tira ele da cota do projeto todo');
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'falha@conv.test', 'professor') ->> 'enviar',
  'true', 'depois da falha liberada, outra academia volta a enviar para o endereço');
select is(public.__hint_de(format('select public.liberar_envio_convite_interna(%L)', gen_random_uuid())),
  'sem erro', 'liberar de novo, ou um envio que não existe, não faz nada');

-- Envio confirmado: a reserva em andamento bloqueia o endereço mesmo depois
-- de 60 s, e o intervalo conta da confirmação.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'atraso@conv.test', 'professor');
reset role;
update public.convites_equipe set ultimo_envio_em = now() - interval '70 seconds', envios_recentes = array[now() - interval '70 seconds']
 where email = 'atraso@conv.test' and academia_id = 'e7c00000-0000-4000-8000-00000000000a';
update public.convites_envios set reservado_em = now() - interval '70 seconds' where email = 'atraso@conv.test';
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'atraso@conv.test', 'professor') ->> 'enviar',
  'false', 'reserva ainda não confirmada bloqueia o endereço mesmo depois de 60 segundos');
select public.confirmar_envio_convite_interna((select id from public.convites_envios where email = 'atraso@conv.test'));
select ok((select enviado_em > now() from public.convites_envios where email = 'atraso@conv.test'),
  'confirmar grava o horário da confirmação, não o da reserva');
reset role;
update public.convites_equipe set ultimo_envio_em = null, envios_recentes = '{}'
 where email = 'atraso@conv.test' and academia_id = 'e7c00000-0000-4000-8000-00000000000d';
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'atraso@conv.test', 'professor') ->> 'enviar',
  'false', 'o intervalo de 60 segundos conta da confirmação');
select is(public.__hint_de(format('select public.confirmar_envio_convite_interna(%L)',
            (select id from public.convites_envios where email = 'atraso@conv.test'))),
  'sem erro', 'confirmar de novo não faz nada');

-- Uma reserva sem resultado bloqueia o endereço (o provedor pode aceitar a
-- qualquer momento).
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'seis@conv.test', 'professor');
reset role;
update public.convites_equipe
   set ultimo_envio_em = now() - interval '5 minutes 30 seconds', envios_recentes = array[now() - interval '5 minutes 30 seconds']
 where email = 'seis@conv.test';
update public.convites_envios set reservado_em = now() - interval '5 minutes 30 seconds' where email = 'seis@conv.test';
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'seis@conv.test', 'professor') ->> 'enviar',
  'false', 'reserva sem resultado de 5 min 30 s ainda bloqueia o endereço (resultado incerto bloqueia por 24 horas)');

-- Reserva sem resultado conta no teto por 48 horas: com quatro
-- envios confirmados e uma reserva de 24 h 2 min, o endereço já tem cinco.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'janela@conv.test', 'professor');
reset role;
update public.convites_equipe set ultimo_envio_em = now() - interval '1 hour', envios_recentes = array[now() - interval '1 hour']
 where email = 'janela@conv.test';
delete from public.convites_envios where email = 'janela@conv.test';
insert into public.convites_envios (email, reservado_em, enviado_em) values
  ('janela@conv.test', now() - interval '24 hours 2 minutes', null),
  ('janela@conv.test', now() - interval '4 hours', now() - interval '4 hours'),
  ('janela@conv.test', now() - interval '3 hours', now() - interval '3 hours'),
  ('janela@conv.test', now() - interval '2 hours', now() - interval '2 hours'),
  ('janela@conv.test', now() - interval '1 hour',  now() - interval '1 hour');
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'janela@conv.test', 'professor') ->> 'enviar',
  'false', 'reserva sem resultado de 24 h 2 min ainda conta no teto de 5');

-- Resultado tardio de uma reserva antiga, depois de um reenvio do mesmo
-- convite: cada reserva é confirmada ou liberada pela própria identidade.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'tardio@conv.test', 'professor');
reset role;
update public.convites_equipe set ultimo_envio_em = now() - interval '25 hours', envios_recentes = array[now() - interval '25 hours']
 where email = 'tardio@conv.test';
update public.convites_envios set reservado_em = now() - interval '25 hours' where email = 'tardio@conv.test';
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'tardio@conv.test', 'professor') ->> 'enviar',
  'false', 'reserva sem resultado de 25 h ainda bloqueia o endereço (até ser resolvida)');
select public.liberar_envio_convite_interna((select id from public.convites_envios
                                             where email = 'tardio@conv.test' and reservado_em = now() - interval '25 hours'));
reset role;
update public.convites_equipe set ultimo_envio_em = now() - interval '25 hours', envios_recentes = array[now() - interval '25 hours']
 where email = 'tardio@conv.test';
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'tardio@conv.test', 'professor') ->> 'enviar',
  'true', 'depois da recusa tardia da reserva antiga, o endereço volta a receber');
select public.confirmar_envio_convite_interna((select id from public.convites_envios
                                               where email = 'tardio@conv.test' and liberado_em is null));
select ok((select count(*) = 1 from public.convites_envios where email = 'tardio@conv.test' and enviado_em is not null),
  'a reserva nova é confirmada pela própria identidade');

-- Reserva antiga (3 dias) confirmada agora: um novo convite para o endereço
-- não apaga o registro, que ainda conta na cota global.
reset role;
insert into public.convites_envios (email, reservado_em) values ('antiga@conv.test', now() - interval '3 days');
set local role service_role;
select public.__como_servico();
select public.confirmar_envio_convite_interna((select id from public.convites_envios where email = 'antiga@conv.test'));
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'antiga@conv.test', 'professor');
select is((select count(*) from public.convites_envios
           where email = 'antiga@conv.test' and reservado_em = now() - interval '3 days' and enviado_em > now()),
  1::bigint, 'criar um convite não apaga a confirmação recente de uma reserva antiga');

-- O reenvio do mesmo pendente registra cada envio na janela.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'reenvio@conv.test', 'professor');
reset role;
update public.convites_equipe
   set ultimo_envio_em = now() - interval '2 minutes',
       envios_recentes = array[now() - interval '5 hours', now() - interval '4 hours',
                               now() - interval '3 hours', now() - interval '2 minutes']
 where email = 'reenvio@conv.test';
set local role service_role;
select public.__como_servico();
select is((public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'reenvio@conv.test', 'admin') ->> 'convite_id')::uuid,
  (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'reenvio@conv.test')).id, 'C10: o quinto envio é o reenvio do mesmo pendente');
select is(cardinality((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'reenvio@conv.test')).envios_recentes),
  5, 'C10: o reenvio registrou o envio (cinco na janela)');
reset role;
update public.convites_equipe set ultimo_envio_em = now() - interval '2 minutes' where email = 'reenvio@conv.test';
set local role service_role;
select public.__como_servico();
select is(public.__hint_de($$select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'reenvio@conv.test', 'admin')$$),
  'limite_convites', 'C10: o sexto envio do mesmo pendente é recusado');

-- Convites usados mais adiante.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'senha@conv.test',    'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'aluno@conv.test',    'recepcao');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'aluno2@conv.test',   'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'semsenha@conv.test', 'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'outrasessao@conv.test', 'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'semsessao@conv.test', 'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', 'inativo-a@conv.test','professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', 'inativo2-a@conv.test','recepcao');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'vencido@conv.test',  'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'semquem@conv.test',  'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a7', 'e7c00000-0000-4000-8000-00000000000a', 'saiu@conv.test',     'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'recusa@conv.test',   'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test',    'dono');

reset role;
update public.convites_equipe set expira_em = now() - interval '1 minute' where email = 'vencido@conv.test';
update public.convites_equipe set convidado_por = null where email = 'semquem@conv.test';

-- ---------------------------------------------------------------------
-- Leitura
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('e7c00000-0000-4000-8000-0000000000a2');
select is((select count(*) from public.convites_equipe where academia_id <> 'e7c00000-0000-4000-8000-00000000000a'),
  0::bigint, 'admin de A não lê convites de B nem de S');
select ok((select count(*) from public.convites_equipe) >= 10, 'admin de A lê os convites de A');
select throws_ok($$update public.convites_equipe set papel = 'admin'$$, '42501', null,
  'update direto em convites_equipe: permissão negada');
select is((select string_agg(email || ':' || papel || case when ativo then '' else '-' end, ',' order by email collate "C")
           from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000a')),
  'admin-a@conv.test:admin,admin2-a@conv.test:admin,dono-a@conv.test:dono,exdono-a@conv.test:dono-,inativo-a@conv.test:professor-,inativo2-a@conv.test:professor-,prof-a@conv.test:professor,recep-a@conv.test:recepcao,totem-a@conv.test:totem',
  'equipe_da_academia: membros, inativos e o totem, sem o papel aluno');
select is(public.__hint_de($$select * from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000b')$$),
  'sem_permissao', 'admin de A não lista a equipe de B');
select is(public.__hint_de($$update public.membros_academia set papel = 'professor'
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000dc'$$),
  'sem_permissao', 'admin não promove um aluno direto para a equipe');
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$update public.membros_academia set papel = 'admin'
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000e1'$$),
  'sem_permissao', 'dono não leva o totem direto para a equipe');
select public.__como('e7c00000-0000-4000-8000-0000000000a2');
select throws_ok($$insert into public.membros_academia (academia_id, user_id, papel)
                   values ('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000b2', 'professor')$$,
  '42501', null, 'admin de A não vincula direto uma conta de B (e não chega ao e-mail dela)');

select public.__como('e7c00000-0000-4000-8000-0000000000a3');
select is((select count(*) from public.convites_equipe), 0::bigint, 'professor não lê convites');
select is(public.__hint_de($$select * from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000a')$$),
  'sem_permissao', 'professor não lista a equipe');

select public.__como('e7c00000-0000-4000-8000-0000000000d1');
select is((select string_agg(academia_nome || ':' || papel, ',') from public.meus_convites()),
  'Convite A:dono', 'meus_convites: o convite do e-mail confirmado');
select is((select count(*) from public.convites_equipe), 0::bigint, 'o convidado não lê a tabela');
select public.__como('e7c00000-0000-4000-8000-0000000000d2');
select is((select count(*) from public.meus_convites()), 0::bigint, 'meus_convites: e-mail não confirmado vê lista vazia');
select public.__como('e7c00000-0000-4000-8000-0000000000d6');
select is((select count(*) from public.meus_convites()), 0::bigint, 'meus_convites: vencido não aparece');
select public.__como('e7c00000-0000-4000-8000-0000000000d7');
select is((select count(*) from public.meus_convites()), 0::bigint, 'meus_convites: convite de quem perdeu o acesso não aparece');
reset role;
insert into public.convites_equipe (academia_id, email, papel, convidado_por, expira_em) values
  ('e7c00000-0000-4000-8000-00000000000a', 'prof-a@conv.test', 'admin', 'e7c00000-0000-4000-8000-0000000000a1', now() + interval '7 days');
set local role authenticated;
select public.__como('e7c00000-0000-4000-8000-0000000000a3');
select is((select count(*) from public.meus_convites()), 0::bigint, 'meus_convites: academia em que o login já é equipe não aparece');

-- ---------------------------------------------------------------------
-- Aceitar e recusar
-- ---------------------------------------------------------------------
select public.__como('e7c00000-0000-4000-8000-0000000000d2');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'naoconf@conv.test')).id)),
  'email_nao_confirmado', 'aceite com e-mail não confirmado');
select public.__como('e7c00000-0000-4000-8000-0000000000d3');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'senha@conv.test')).id)),
  'senha_pendente', 'conta marcada para definir senha não aceita antes');
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d3'), '-', 'senha_pendente não grava membro');

select public.__como('e7c00000-0000-4000-8000-0000000000d5');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id)),
  'convite_invalido', 'outro e-mail não aceita o convite');
select is(public.__hint_de($$select public.aceitar_convite('e7c00000-0000-4000-8000-00000000ffff')$$),
  'convite_invalido', 'convite inexistente: mesmo código');

select public.__como('e7c00000-0000-4000-8000-0000000000dd');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'semsenha@conv.test')).id)),
  'senha_pendente', 'sem senha nova definida depois do link, o aceite é recusado');
select public.__como('e7c00000-0000-4000-8000-0000000000de');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'outrasessao@conv.test')).id)),
  'senha_pendente', 'senha trocada em outra sessão não serve de prova');
select public.__como('e7c00000-0000-4000-8000-0000000000df');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'semsessao@conv.test')).id)),
  'convite_exige_link', 'token de sessão revogada não aceita');
select is((select count(*) from public.meus_convites()), 0::bigint, 'token de sessão revogada não lista convites');
select is(public.__hint_de(format('select public.recusar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'semsessao@conv.test')).id)),
  'convite_exige_link', 'token de sessão revogada não recusa');
reset role;
insert into auth.sessions (id, user_id) values
  ('e7c00000-0000-4000-8000-0000000005a1', 'e7c00000-0000-4000-8000-0000000000d1'),
  ('e7c00000-0000-4000-8000-0000000005a2', 'e7c00000-0000-4000-8000-0000000000d1');
set local role authenticated;
select public.__como_senha('e7c00000-0000-4000-8000-0000000000d1');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id)),
  'convite_exige_link', 'sessão aberta só com senha não aceita: precisa do link enviado ao e-mail');
select public.__como('e7c00000-0000-4000-8000-0000000000d1');
select is(public.aceitar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id),
  'e7c00000-0000-4000-8000-00000000000a'::uuid, 'aceite devolve a academia');
select is(public.__sessoes('e7c00000-0000-4000-8000-0000000000d1'),
  'e7c00000-0000-4000-8000-0000000000d1', 'o aceite apaga as outras sessões da conta e mantém a atual');
select public.__como_token('e7c00000-0000-4000-8000-0000000000d1', 0, 'e7c00000-0000-4000-8000-0000000000d1');
select is(public.__hint_de($$select * from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000a')$$),
  'sem_permissao', 'token emitido antes do aceite não usa o vínculo novo');
select public.__como_token('e7c00000-0000-4000-8000-0000000000d1', floor(extract(epoch from clock_timestamp()))::bigint + 10,
                            'e7c00000-0000-4000-8000-0000000005a2');
select is(public.__hint_de($$select * from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000a')$$),
  'sem_permissao', 'token novo de uma sessão revogada não usa o vínculo');
select public.__como('e7c00000-0000-4000-8000-0000000000d1');
select ok((select count(*) from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000a')) > 0,
  'token novo, depois do aceite, usa o vínculo');
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d1'), 'dono', 'o convidado virou dono');
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).status, 'aceito', 'convite marcado como aceito');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id)),
  'convite_invalido', 'aceitar de novo: convite_invalido');

select public.__como('e7c00000-0000-4000-8000-0000000000d4');
select public.aceitar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'aluno@conv.test')).id);
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d4'), 'recepcao',
  'C7: quem era só aluno passa para o papel da equipe');
select ok(public.sou_o_aluno('e7c00000-0000-4000-8000-0000000001a1'), 'C7: e continua sendo o login do próprio cadastro de aluno');
select public.__como('e7c00000-0000-4000-8000-0000000000dc');
select public.aceitar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'aluno2@conv.test')).id);
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000dc'), 'professor',
  'o aluno que a gestão não podia promover direto entra pelo aceite do convite');

select public.__como('e7c00000-0000-4000-8000-0000000000a5');
select public.aceitar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'inativo-a@conv.test')).id);
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000a5'), 'professor',
  'C7: membro inativo é reativado pelo aceite');

select public.__como('e7c00000-0000-4000-8000-0000000000d6');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'vencido@conv.test')).id)),
  'convite_invalido', 'convite vencido não é aceito');
select public.__como('e7c00000-0000-4000-8000-0000000000d7');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'semquem@conv.test')).id)),
  'convite_invalido', 'convite de conta apagada (convidado_por nulo) não é aceito');

-- O admin que convidou é desativado pelo dono; e o inativo2 é reativado pela
-- tela antes de aceitar.
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
update public.membros_academia set ativo = false
 where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000a7';
update public.membros_academia set ativo = true
 where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000a8';
select public.__como('e7c00000-0000-4000-8000-0000000000d8');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'saiu@conv.test')).id)),
  'convite_invalido', 'quem convidou perdeu o acesso: o convite morre');
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'saiu@conv.test')).status, 'cancelado',
  'a revogação de quem convidou cancela o convite pendente');
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
update public.membros_academia set ativo = true
 where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000a7';
select public.__como('e7c00000-0000-4000-8000-0000000000d8');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'saiu@conv.test')).id)),
  'convite_invalido', 'quem convidou voltou a ser admin: o convite antigo continua morto');
select public.__como('e7c00000-0000-4000-8000-0000000000a8');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'inativo2-a@conv.test')).id)),
  'ja_membro', 'C7: reativado pela tela depois do convite: ja_membro no aceite');

select public.__como('e7c00000-0000-4000-8000-0000000000d9');
select public.recusar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'recusa@conv.test')).id);
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'recusa@conv.test')).status || '/'
          || ((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'recusa@conv.test')).encerrado_por = 'e7c00000-0000-4000-8000-0000000000d9')::text,
  'recusado/true', 'recusar marca recusado, com quem recusou');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'recusa@conv.test')).id)),
  'convite_invalido', 'recusado não pode mais ser aceito');

select public.__como('e7c00000-0000-4000-8000-0000000000d5');
select is(public.__hint_de($$select public.aceitar_convite('e7c00000-0000-4000-8000-0000000002c1')$$)
          || '/' || public.__hint_de($$select public.recusar_convite('e7c00000-0000-4000-8000-0000000002c1')$$),
  'academia_suspensa/academia_suspensa', 'C6: academia suspensa não aceita nem recusa');

-- ---------------------------------------------------------------------
-- Cancelar
-- ---------------------------------------------------------------------
select public.__como('e7c00000-0000-4000-8000-0000000000b2');
select is(public.__hint_de(format('select public.cancelar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test')).id))
          || '/' || public.__hint_de($$select public.cancelar_convite('e7c00000-0000-4000-8000-00000000ffff')$$),
  'convite_invalido/convite_invalido', 'admin de B: convite de A e convite inexistente dão o mesmo código');
select public.__como('e7c00000-0000-4000-8000-0000000000a2');
select is(public.__hint_de(format('select public.cancelar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test')).id)),
  'sem_permissao', 'admin não cancela convite de dono');
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
select public.cancelar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test')).id);
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test')).status || '/'
          || ((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test')).encerrado_por = 'e7c00000-0000-4000-8000-0000000000a1')::text,
  'cancelado/true', 'dono cancela, com quem cancelou');
select is(public.__hint_de(format('select public.cancelar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'dono2@conv.test')).id)),
  'convite_invalido', 'cancelar de novo: convite_invalido');
select public.cancelar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'vencido@conv.test')).id);
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'vencido@conv.test')).status, 'cancelado', 'convite vencido pode ser cancelado');
select public.__como('e7c00000-0000-4000-8000-0000000000c1');
select is(public.__hint_de($$select public.cancelar_convite('e7c00000-0000-4000-8000-0000000002c1')$$),
  'academia_suspensa', 'C6: academia suspensa não cancela');

-- ---------------------------------------------------------------------
-- Último dono
-- ---------------------------------------------------------------------
reset role;
create function public.__apaga_membro_definer(p_acad uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.membros_academia where academia_id = p_acad and user_id = p_user
$$;
grant execute on function public.__apaga_membro_definer(uuid, uuid) to authenticated;
set local role authenticated;

-- B tem um dono só.
select public.__como('e7c00000-0000-4000-8000-0000000000b1');
select is(public.__hint_de($$update public.membros_academia set papel = 'admin'
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000b' and user_id = 'e7c00000-0000-4000-8000-0000000000b1'$$),
  'ultimo_dono', 'o único dono não se rebaixa');
select is(public.__hint_de($$update public.membros_academia set ativo = false
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000b' and user_id = 'e7c00000-0000-4000-8000-0000000000b1'$$),
  'ultimo_dono', 'o único dono não se desativa');
select is(public.__hint_de($$delete from public.membros_academia
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000b' and user_id = 'e7c00000-0000-4000-8000-0000000000b1'$$),
  'ultimo_dono', 'o único dono não se apaga');
select is(public.__hint_de($$select public.__apaga_membro_definer('e7c00000-0000-4000-8000-00000000000b', 'e7c00000-0000-4000-8000-0000000000b1')$$),
  'ultimo_dono', 'função security definer chamada pela API também não fura a trava');

-- conf (dono) convida um dono; rebaixado a admin pelo outro dono, o convite
-- de dono dele morre.
reset role;
insert into public.convites_equipe (academia_id, email, papel, convidado_por, expira_em) values
  ('e7c00000-0000-4000-8000-00000000000a', 'demov@conv.test', 'dono', 'e7c00000-0000-4000-8000-0000000000d1', now() + interval '7 days');
set local role authenticated;
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
update public.membros_academia set papel = 'admin'
 where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000d1';
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'demov@conv.test')).status, 'cancelado',
  'dono rebaixado a admin: o convite de dono que ele fez é cancelado');

-- A tem dono-a e conf (agora admin): conf pode sair; dono-a, não.
select public.__como('e7c00000-0000-4000-8000-0000000000d1');
delete from public.membros_academia
 where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000d1';
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d1'), '-',
  'com dois donos, um pode sair');
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$update public.membros_academia set papel = 'admin'
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000a1'$$),
  'ultimo_dono', 'o dono que sobrou não se rebaixa');

-- Exclusão lógica no Auth é recusada para todos: o Auth, o service_role e o
-- SQL do projeto (sem JWT). Conta se apaga de verdade.
reset role;
select public.__como_auth();
select is(public.__hint_de($$update auth.users set deleted_at = now() where id = 'e7c00000-0000-4000-8000-0000000000f2'$$),
  'exclusao_logica_bloqueada', 'o Auth não apaga logicamente uma conta');
select public.__como_servico();
select is(public.__hint_de($$update auth.users set deleted_at = now() where id = 'e7c00000-0000-4000-8000-0000000000f2'$$),
  'exclusao_logica_bloqueada', 'nem uma requisição service_role apaga logicamente uma conta');
select public.__sem_jwt();
select is(public.__hint_de($$update auth.users set deleted_at = now() where id = 'e7c00000-0000-4000-8000-0000000000f2'$$),
  'exclusao_logica_bloqueada', 'nem o SQL do projeto, sem JWT, apaga logicamente uma conta');
set local role authenticated;

-- service_role e sessão administrativa sem JWT passam.
reset role;
set local role service_role;
select public.__como_servico();
select is(public.__passa_e_desfaz($$delete from public.membros_academia
                                    where academia_id = 'e7c00000-0000-4000-8000-00000000000b' and user_id = 'e7c00000-0000-4000-8000-0000000000b1'$$),
  'passou', 'service_role remove o último dono');
reset role;
select public.__sem_jwt();
select is(public.__passa_e_desfaz($$delete from public.membros_academia
                                    where academia_id = 'e7c00000-0000-4000-8000-00000000000b' and user_id = 'e7c00000-0000-4000-8000-0000000000b1'$$),
  'passou', 'sessão administrativa sem JWT (SQL do projeto) remove o último dono');

-- B tem cinco envios recentes para um endereço; apagar B não devolve a cota
-- dele às outras academias (convites_envios não tem cascata).
insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em) values
  ('e7c00000-0000-4000-8000-0000000002b9', 'e7c00000-0000-4000-8000-00000000000b', 'apagada@conv.test', 'professor',
   'e7c00000-0000-4000-8000-0000000000b1', now() + interval '7 days');
insert into public.convites_envios (email, convite_id, reservado_em, enviado_em)
select 'apagada@conv.test', 'e7c00000-0000-4000-8000-0000000002b9', t, t
from unnest(array[now() - interval '5 hours', now() - interval '4 hours', now() - interval '3 hours',
                  now() - interval '2 hours', now() - interval '1 hour']) t;

-- Apagar a academia apaga os membros, inclusive o único dono. Com o papel de
-- requisição authenticated, para passar pelo caminho da academia apagada.
select public.__como('e7c00000-0000-4000-8000-0000000000b1');
delete from public.academias where id = 'e7c00000-0000-4000-8000-00000000000b';
select is((select count(*) from public.membros_academia where academia_id = 'e7c00000-0000-4000-8000-00000000000b'),
  0::bigint, 'apagar a academia leva o último dono junto (cascata)');
select is((select count(*) from public.convites_envios where email = 'apagada@conv.test' and convite_id is null),
  5::bigint, 'os envios da academia apagada continuam no registro global');
set local role service_role;
select public.__como_servico();
select is(public.__cc('e7c00000-0000-4000-8000-0000000000f1', 'e7c00000-0000-4000-8000-00000000000d', 'apagada@conv.test', 'professor') ->> 'enviar',
  'false', 'apagar uma academia não devolve a cota do endereço às outras');
reset role;

-- Expurgo: o registro global de um endereço convidado uma vez só sai depois
-- das janelas da C10 (com margem de 2 dias), mesmo sem novo convite; a cota
-- vigente da academia apagada fica.
select is((select count(*)::int from cron.job where jobname = 'expurgar-convites-envios-diario'), 1,
  'expurgo de convites_envios agendado no pg_cron');
insert into public.convites_envios (email, reservado_em, enviado_em) values
  ('velho@conv.test', now() - interval '4 days', now() - interval '4 days'),
  ('velho@conv.test', now() - interval '3 days 1 hour', null);
select public.expurgar_convites_envios(1);
select is((select count(*) from public.convites_envios where email = 'velho@conv.test'), 0::bigint,
  'expurgo apaga o registro antigo de um endereço sem novo convite (em lotes)');
select is(public.__hint_de('select public.expurgar_convites_envios(0)') || '/'
          || public.__hint_de('select public.expurgar_convites_envios(null)'),
  'dados_invalidos/dados_invalidos', 'expurgo recusa lote zero ou nulo, antes de apagar');
select is((select count(*) from public.convites_envios where email = 'apagada@conv.test'), 5::bigint,
  'expurgo mantém a cota vigente, inclusive da academia apagada');

select * from finish();
rollback;
