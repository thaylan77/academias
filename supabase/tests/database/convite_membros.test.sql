-- Convite de membros da equipe (docs/specs/convite-membros.md): criação pela
-- Edge Function (criar_convite_interna, só service_role), leitura, cancelar,
-- aceitar, recusar, equipe_da_academia e o gatilho do último dono.
-- Academias A e B (ativas) e S (suspensa).
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

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
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

grant execute on function public.__como(text), public.__como_servico(), public.__sem_jwt(),
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
  ('e7c00000-0000-4000-8000-0000000000d9', 'recusa@conv.test',     now(), '{}');

insert into public.academias (id, nome, slug, status) values
  ('e7c00000-0000-4000-8000-00000000000a', 'Convite A', 'convite-a', 'ativa'),
  ('e7c00000-0000-4000-8000-00000000000b', 'Convite B', 'convite-b', 'ativa'),
  ('e7c00000-0000-4000-8000-00000000000c', 'Convite S', 'convite-s', 'ativa');

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
  ('e7c00000-0000-4000-8000-00000000000b', 'e7c00000-0000-4000-8000-0000000000b1', 'dono',      true),
  ('e7c00000-0000-4000-8000-00000000000b', 'e7c00000-0000-4000-8000-0000000000b2', 'admin',     true),
  ('e7c00000-0000-4000-8000-00000000000c', 'e7c00000-0000-4000-8000-0000000000c1', 'dono',      true);

insert into public.alunos (id, academia_id, nome, email, status, user_id) values
  ('e7c00000-0000-4000-8000-0000000001a1', 'e7c00000-0000-4000-8000-00000000000a', 'Aluna Promovida',
   'aluno@conv.test', 'ativo', 'e7c00000-0000-4000-8000-0000000000d4');

-- Convite em S criado antes da suspensão (gravado direto).
insert into public.convites_equipe (id, academia_id, email, papel, convidado_por, expira_em) values
  ('e7c00000-0000-4000-8000-0000000002c1', 'e7c00000-0000-4000-8000-00000000000c', 'outro@conv.test',
   'professor', 'e7c00000-0000-4000-8000-0000000000c1', now() + interval '7 days');
update public.academias set status = 'suspensa' where id = 'e7c00000-0000-4000-8000-00000000000c';

-- 30 convites recentes em B, para o limite diário.
insert into public.convites_equipe (academia_id, email, papel, convidado_por, expira_em)
select 'e7c00000-0000-4000-8000-00000000000b', 'lote' || g || '@conv.test', 'professor',
       'e7c00000-0000-4000-8000-0000000000b1', now() + interval '7 days'
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

-- ---------------------------------------------------------------------
-- Estrutura e permissões
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.convites_equipe'::regclass),
  'convites_equipe com RLS ligado');
select ok(not has_table_privilege('authenticated', 'public.convites_equipe', 'INSERT')
          and not has_table_privilege('authenticated', 'public.convites_equipe', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.convites_equipe', 'DELETE'),
  'authenticated não escreve direto em convites_equipe');
select ok(not has_function_privilege('authenticated', 'public.criar_convite_interna(uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated não cria convite (só a Edge Function, com service_role)');
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

select is(public.__cc('e7c00000-0000-4000-8000-0000000000a2', 'e7c00000-0000-4000-8000-00000000000a', '  Novo@Conv.TEST ', 'professor') - 'convite_id' - 'user_id',
  '{"email": "novo@conv.test", "conta": "nenhuma"}'::jsonb, 'admin convida professor: e-mail normalizado, conta inexistente');
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

-- Convites usados mais adiante.
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'senha@conv.test',    'professor');
select public.__cc('e7c00000-0000-4000-8000-0000000000a1', 'e7c00000-0000-4000-8000-00000000000a', 'aluno@conv.test',    'recepcao');
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
  'admin-a@conv.test:admin,admin2-a@conv.test:admin,dono-a@conv.test:dono,exdono-a@conv.test:dono-,inativo-a@conv.test:professor-,inativo2-a@conv.test:professor-,prof-a@conv.test:professor,recep-a@conv.test:recepcao',
  'equipe_da_academia: membros e inativos, sem o papel aluno');
select is(public.__hint_de($$select * from public.equipe_da_academia('e7c00000-0000-4000-8000-00000000000b')$$),
  'sem_permissao', 'admin de A não lista a equipe de B');

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

select public.__como('e7c00000-0000-4000-8000-0000000000d1');
select is(public.aceitar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id),
  'e7c00000-0000-4000-8000-00000000000a'::uuid, 'aceite devolve a academia');
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d1'), 'dono', 'o convidado virou dono');
select is((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).status, 'aceito', 'convite marcado como aceito');
select is(public.__hint_de(format('select public.aceitar_convite(%L)', (public.__conv('e7c00000-0000-4000-8000-00000000000a', 'conf@conv.test')).id)),
  'convite_invalido', 'aceitar de novo: convite_invalido');

select public.__como('e7c00000-0000-4000-8000-0000000000d4');
select public.aceitar_convite((public.__conv('e7c00000-0000-4000-8000-00000000000a', 'aluno@conv.test')).id);
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d4'), 'recepcao',
  'C7: quem era só aluno passa para o papel da equipe');
select ok(public.sou_o_aluno('e7c00000-0000-4000-8000-0000000001a1'), 'C7: e continua sendo o login do próprio cadastro de aluno');

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
create function public.__apaga_membro_definer(p_acad uuid, p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.membros_academia where academia_id = p_acad and user_id = p_user
$$;
grant execute on function public.__apaga_membro_definer(uuid, uuid) to authenticated;

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

-- A tem dois donos ativos (dono-a e conf): um pode sair; o outro, não.
select public.__como('e7c00000-0000-4000-8000-0000000000d1');
delete from public.membros_academia
 where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000d1';
select is(public.__membro('e7c00000-0000-4000-8000-00000000000a', 'e7c00000-0000-4000-8000-0000000000d1'), '-',
  'com dois donos, um pode sair');
select public.__como('e7c00000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$update public.membros_academia set papel = 'admin'
                             where academia_id = 'e7c00000-0000-4000-8000-00000000000a' and user_id = 'e7c00000-0000-4000-8000-0000000000a1'$$),
  'ultimo_dono', 'o dono que sobrou não se rebaixa');

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

-- Apagar a academia apaga os membros, inclusive o único dono. Com o papel de
-- requisição authenticated, para passar pelo caminho da academia apagada.
select public.__como('e7c00000-0000-4000-8000-0000000000b1');
delete from public.academias where id = 'e7c00000-0000-4000-8000-00000000000b';
select is((select count(*) from public.membros_academia where academia_id = 'e7c00000-0000-4000-8000-00000000000b'),
  0::bigint, 'apagar a academia leva o último dono junto (cascata)');

select * from finish();
rollback;
