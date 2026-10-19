-- Slugs reservados (issue #50): caminhos do app não podem virar slug de
-- academia, nem na criação (criar_academia) nem na troca pelo billing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create function public.__erro_de(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return jsonb_build_object('hint', 'sem erro');
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return jsonb_build_object('hint', coalesce(nullif(v_hint, ''), 'sem hint'),
                            'mensagem', sqlerrm, 'sqlstate', sqlstate);
end
$$;
grant execute on function public.__erro_de(text) to authenticated;

insert into auth.users (id, email) values
  ('f8000000-0000-4000-8000-0000000000a1', 'dono@slug.test');

insert into public.academias (id, nome, slug, status) values
  ('f8000000-0000-4000-8000-00000000000a', 'Slug A', 'slug-existente-a', 'ativa');

-- ---------------------------------------------------------------------
-- A regra está no banco (check nomeado).
-- ---------------------------------------------------------------------
select ok(
  exists (select 1 from pg_constraint
           where conname = 'academias_slug_nao_reservado'
             and conrelid = 'public.academias'::regclass),
  'check academias_slug_nao_reservado existe em academias'
);

-- Billing (service_role, sem RLS) também não troca para slug reservado.
select is(
  public.__erro_de($$update public.academias set slug = 'painel'
                     where id = 'f8000000-0000-4000-8000-00000000000a'$$) ->> 'sqlstate',
  '23514',
  'update direto para slug painel é recusado pelo check'
);
select is(
  public.__erro_de($$insert into public.academias (nome, slug) values ('Outra', 'assets')$$) ->> 'sqlstate',
  '23514',
  'insert direto com slug assets é recusado pelo check'
);
select is(
  public.__erro_de($$update public.academias set slug = 'painel-dojo'
                     where id = 'f8000000-0000-4000-8000-00000000000a'$$) ->> 'hint',
  'sem erro',
  'slug que só começa com painel continua valendo'
);

-- ---------------------------------------------------------------------
-- criar_academia, como usuário logado.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f8000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f8000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select is(public.__erro_de($$select public.criar_academia('Dojo', 'painel')$$) ->> 'hint',
          'slug_reservado', 'painel é reservado');
select is(public.__erro_de($$select public.criar_academia('Dojo', 'portal')$$) ->> 'hint',
          'slug_reservado', 'portal é reservado');
select is(public.__erro_de($$select public.criar_academia('Dojo', 'api')$$) ->> 'hint',
          'slug_reservado', 'api é reservado');
select is(public.__erro_de($$select public.criar_academia('Dojo', 'admin')$$) ->> 'hint',
          'slug_reservado', 'admin é reservado');
select is(public.__erro_de($$select public.criar_academia('Dojo', 'entrar')$$) ->> 'hint',
          'slug_reservado', 'entrar é reservado');
select is(public.__erro_de($$select public.criar_academia('Dojo', 'assets')$$) ->> 'hint',
          'slug_reservado', 'assets é reservado');
select is(public.__erro_de($$select public.criar_academia('Dojo', '  PAINEL ')$$) ->> 'hint',
          'slug_reservado', 'maiúsculas e espaços não escapam da reserva (o slug é normalizado antes)');
select is(public.__erro_de($$select public.criar_academia('Dojo', 'painel-dojo')$$) ->> 'hint',
          'slug_em_uso', 'slug de outra academia (painel-dojo, do teste acima): slug_em_uso');
select is(public.__erro_de($$select public.criar_academia('Dojo', '-ruim')$$) ->> 'hint',
          'slug_invalido', 'formato inválido: slug_invalido');

-- Slug normal continua passando, e quem cria vira dono.
select is(public.__erro_de($$select public.criar_academia('Dojo Novo', 'dojo-novo-slug')$$) ->> 'hint',
          'sem erro', 'slug comum é aceito');

reset role;

select is(
  (select m.papel from public.membros_academia m
     join public.academias a on a.id = m.academia_id
    where a.slug = 'dojo-novo-slug' and m.user_id = 'f8000000-0000-4000-8000-0000000000a1'),
  'dono',
  'quem criou é dono da academia nova'
);

-- Nome inválido continua com o erro original (não vira erro de slug).
set local role authenticated;
select is(public.__erro_de($$select public.criar_academia(' ', 'dojo-nome-vazio')$$) ->> 'sqlstate',
          '23514', 'nome vazio segue com o check_violation original');
reset role;

select * from finish();
rollback;
