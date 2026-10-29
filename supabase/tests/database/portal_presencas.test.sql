-- Portal do aluno: presenças (issue #77). As mesmas leituras que a tela faz,
-- com um responsável que tem um filho na academia A e outro na B e que também
-- é da recepção em A. Em B ele é só aluno: lê as presenças do filho e o nome
-- das turmas, nada da outra aluna de B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function public.__como(p_user text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end
$$;
grant execute on function public.__como(text) to authenticated;

insert into auth.users (id, email, email_confirmed_at) values
  ('fea00000-0000-4000-8000-0000000000e1', 'pai@portal-pres.test',   now()),
  ('fea00000-0000-4000-8000-0000000000e2', 'outra@portal-pres.test', now());

insert into public.academias (id, nome, slug, status) values
  ('fea00000-0000-4000-8000-00000000000a', 'Portal Pres A', 'portal-pres-a', 'ativa'),
  ('fea00000-0000-4000-8000-00000000000b', 'Portal Pres B', 'portal-pres-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fea00000-0000-4000-8000-00000000000a', 'fea00000-0000-4000-8000-0000000000e1', 'recepcao'),
  ('fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-0000000000e1', 'aluno'),
  ('fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-0000000000e2', 'aluno');

insert into public.modalidades (id, academia_id, nome) values
  ('fea00000-0000-4000-8000-000000000201', 'fea00000-0000-4000-8000-00000000000a', 'Jiu-Jitsu A'),
  ('fea00000-0000-4000-8000-000000000202', 'fea00000-0000-4000-8000-00000000000b', 'Judô B');

insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('fea00000-0000-4000-8000-000000000301', 'fea00000-0000-4000-8000-00000000000a', 'fea00000-0000-4000-8000-000000000201', 'Turma A'),
  ('fea00000-0000-4000-8000-000000000302', 'fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-000000000202', 'Turma B');

-- a1: filho do pai em A; a2: outro aluno de A; b1: filho do pai em B; b2:
-- aluna de outro login em B.
insert into public.alunos (id, academia_id, nome, status, user_id) values
  ('fea00000-0000-4000-8000-0000000001a1', 'fea00000-0000-4000-8000-00000000000a', 'Filho A', 'ativo', 'fea00000-0000-4000-8000-0000000000e1'),
  ('fea00000-0000-4000-8000-0000000001a2', 'fea00000-0000-4000-8000-00000000000a', 'Outro A', 'ativo', null),
  ('fea00000-0000-4000-8000-0000000001b1', 'fea00000-0000-4000-8000-00000000000b', 'Filho B', 'ativo', 'fea00000-0000-4000-8000-0000000000e1'),
  ('fea00000-0000-4000-8000-0000000001b2', 'fea00000-0000-4000-8000-00000000000b', 'Outra B', 'ativo', 'fea00000-0000-4000-8000-0000000000e2');

insert into public.presencas (academia_id, aluno_id, turma_id, data, origem) values
  ('fea00000-0000-4000-8000-00000000000a', 'fea00000-0000-4000-8000-0000000001a1', 'fea00000-0000-4000-8000-000000000301', '2026-10-20', 'qrcode'),
  ('fea00000-0000-4000-8000-00000000000a', 'fea00000-0000-4000-8000-0000000001a2', 'fea00000-0000-4000-8000-000000000301', '2026-10-20', 'recepcao'),
  ('fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-0000000001b1', 'fea00000-0000-4000-8000-000000000302', '2026-10-21', 'professor'),
  ('fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-0000000001b1', 'fea00000-0000-4000-8000-000000000302', '2026-10-28', 'qrcode'),
  ('fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-0000000001b2', 'fea00000-0000-4000-8000-000000000302', '2026-10-28', 'qrcode');

set local role authenticated;
select public.__como('fea00000-0000-4000-8000-0000000000e1');

-- Leitura da tela para o filho em B: mais recente primeiro.
select results_eq(
  $$select data, origem from public.presencas
     where academia_id = 'fea00000-0000-4000-8000-00000000000b' and aluno_id = 'fea00000-0000-4000-8000-0000000001b1'
     order by data desc$$,
  $$values ('2026-10-28'::date, 'qrcode'::text), ('2026-10-21', 'professor')$$,
  'pai lê as presenças do filho em B, da mais recente para a mais antiga');
select is((select nome from public.turmas where academia_id = 'fea00000-0000-4000-8000-00000000000b'), 'Turma B',
  'pai lê o nome da turma em B (catálogo)');
select results_eq(
  $$select distinct aluno_id from public.presencas where academia_id = 'fea00000-0000-4000-8000-00000000000b'$$,
  $$values ('fea00000-0000-4000-8000-0000000001b1'::uuid)$$,
  'em B, onde é só aluno, o pai não lê as presenças da outra aluna');
select is((select count(*) from public.presencas
            where academia_id = 'fea00000-0000-4000-8000-00000000000a' and aluno_id = 'fea00000-0000-4000-8000-0000000001a1'),
  1::bigint, 'pai lê a presença do filho em A');
select is((select count(*) from public.presencas where academia_id = 'fea00000-0000-4000-8000-00000000000a'), 2::bigint,
  'como recepção de A, o RLS deixa ler todas as presenças de A (o filtro por aluno da tela é que separa)');

-- Outra aluna de B: só as próprias presenças, nada de A.
select public.__como('fea00000-0000-4000-8000-0000000000e2');
select results_eq($$select aluno_id from public.presencas$$,
  $$values ('fea00000-0000-4000-8000-0000000001b2'::uuid)$$, 'aluna de B lê só a própria presença');
select is((select count(*) from public.turmas where academia_id = 'fea00000-0000-4000-8000-00000000000a'), 0::bigint,
  'e não lê turmas de A');
select throws_ok($$insert into public.presencas (academia_id, aluno_id, turma_id, data)
                   values ('fea00000-0000-4000-8000-00000000000b', 'fea00000-0000-4000-8000-0000000001b2',
                           'fea00000-0000-4000-8000-000000000302', '2026-10-29')$$,
  '42501', null, 'aluno não grava presença direto (só pela RPC de check-in)');
reset role;

select * from finish();
rollback;
