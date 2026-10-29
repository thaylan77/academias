-- Portal do aluno: graduação (issue #76). As mesmas leituras que a tela faz,
-- com um responsável que tem um filho na academia A e outro na B e que também
-- é da recepção em A (lá o RLS deixa ler todos os alunos; o filtro por
-- user_id da tela é o que separa). Um aluno qualquer de A fica de fora.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
  ('fe900000-0000-4000-8000-0000000000e1', 'pai@portal-grad.test',   now()),
  ('fe900000-0000-4000-8000-0000000000e2', 'outra@portal-grad.test', now());

insert into public.academias (id, nome, slug, status) values
  ('fe900000-0000-4000-8000-00000000000a', 'Portal Grad A', 'portal-grad-a', 'ativa'),
  ('fe900000-0000-4000-8000-00000000000b', 'Portal Grad B', 'portal-grad-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe900000-0000-4000-8000-00000000000a', 'fe900000-0000-4000-8000-0000000000e1', 'recepcao'),
  ('fe900000-0000-4000-8000-00000000000b', 'fe900000-0000-4000-8000-0000000000e1', 'aluno'),
  ('fe900000-0000-4000-8000-00000000000a', 'fe900000-0000-4000-8000-0000000000e2', 'aluno');

insert into public.modalidades (id, academia_id, nome) values
  ('fe900000-0000-4000-8000-000000000201', 'fe900000-0000-4000-8000-00000000000a', 'Jiu-Jitsu A'),
  ('fe900000-0000-4000-8000-000000000202', 'fe900000-0000-4000-8000-00000000000b', 'Judô B');

insert into public.faixas (id, academia_id, modalidade_id, nome, ordem, max_graus, min_meses, min_aulas) values
  ('fe900000-0000-4000-8000-000000000301', 'fe900000-0000-4000-8000-00000000000a', 'fe900000-0000-4000-8000-000000000201', 'Azul', 2, 4, 0, 0),
  ('fe900000-0000-4000-8000-000000000302', 'fe900000-0000-4000-8000-00000000000b', 'fe900000-0000-4000-8000-000000000202', 'Amarela', 2, 4, 0, 0);

-- a1: filho do pai em A; a2: aluna de outro login em A; b1: filho do pai em B.
insert into public.alunos (id, academia_id, nome, status, user_id) values
  ('fe900000-0000-4000-8000-0000000001a1', 'fe900000-0000-4000-8000-00000000000a', 'Filho A',  'ativo', 'fe900000-0000-4000-8000-0000000000e1'),
  ('fe900000-0000-4000-8000-0000000001a2', 'fe900000-0000-4000-8000-00000000000a', 'Outra A',  'ativo', 'fe900000-0000-4000-8000-0000000000e2'),
  ('fe900000-0000-4000-8000-0000000001b1', 'fe900000-0000-4000-8000-00000000000b', 'Filho B',  'ativo', 'fe900000-0000-4000-8000-0000000000e1');

insert into public.graduacoes (academia_id, aluno_id, faixa_id, grau, data) values
  ('fe900000-0000-4000-8000-00000000000a', 'fe900000-0000-4000-8000-0000000001a1', 'fe900000-0000-4000-8000-000000000301', 1, '2026-01-10'),
  ('fe900000-0000-4000-8000-00000000000a', 'fe900000-0000-4000-8000-0000000001a2', 'fe900000-0000-4000-8000-000000000301', 3, '2026-01-10'),
  ('fe900000-0000-4000-8000-00000000000b', 'fe900000-0000-4000-8000-0000000001b1', 'fe900000-0000-4000-8000-000000000302', 2, '2026-02-10');

set local role authenticated;
select public.__como('fe900000-0000-4000-8000-0000000000e1');

-- Lista de cadastros da tela: alunos com user_id = login, com a academia.
select results_eq(
  $$select a.nome, ac.nome from public.alunos a join public.academias ac on ac.id = a.academia_id
     where a.user_id = 'fe900000-0000-4000-8000-0000000000e1' order by a.nome$$,
  $$values ('Filho A'::text, 'Portal Grad A'::text), ('Filho B', 'Portal Grad B')$$,
  'pai: a lista da tela traz os dois filhos, nas duas academias, com o nome da academia');
select is((select count(*) from public.alunos where academia_id = 'fe900000-0000-4000-8000-00000000000a'), 2::bigint,
  'como recepção de A, o RLS deixa ler os dois alunos de A (o filtro da tela é que separa)');

-- Graduação do filho em B: o pai lê como aluno.
select results_eq(
  $$select faixa, grau from public.vw_graduacao_atual
     where academia_id = 'fe900000-0000-4000-8000-00000000000b' and aluno_id = 'fe900000-0000-4000-8000-0000000001b1'$$,
  $$values ('Amarela'::text, 2::smallint)$$, 'pai lê a faixa atual do filho em B');
select is((select proximo_passo from public.vw_progresso_graduacao
            where academia_id = 'fe900000-0000-4000-8000-00000000000b' and aluno_id = 'fe900000-0000-4000-8000-0000000001b1'),
  'grau 3', 'pai lê o progresso do filho em B');
select is((select nome from public.modalidades where academia_id = 'fe900000-0000-4000-8000-00000000000b'),
  'Judô B', 'pai lê o nome da modalidade em B (catálogo)');
select is((select count(*) from public.vw_graduacao_atual where academia_id = 'fe900000-0000-4000-8000-00000000000b'), 1::bigint,
  'em B, só a graduação do filho');

-- Outra login: só o próprio cadastro, nada do pai nem de B.
select public.__como('fe900000-0000-4000-8000-0000000000e2');
select results_eq($$select nome from public.alunos order by nome$$, $$values ('Outra A'::text)$$,
  'aluna de A lê só o próprio cadastro');
select results_eq($$select aluno_id from public.vw_graduacao_atual$$,
  $$values ('fe900000-0000-4000-8000-0000000001a2'::uuid)$$, 'e só a própria graduação');
select is((select count(*) from public.vw_progresso_graduacao where aluno_id <> 'fe900000-0000-4000-8000-0000000001a2'), 0::bigint,
  'nenhum progresso de outro aluno');
select is((select count(*) from public.academias where id = 'fe900000-0000-4000-8000-00000000000b'), 0::bigint,
  'não lê a academia B');
reset role;

select * from finish();
rollback;
