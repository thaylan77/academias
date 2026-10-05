-- Executar com supabase test db. Todos os dados são revertidos ao final.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- UUIDs exclusivos da suíte, independentes do seed e de usuários reais.
create function pg_temp.id(chave text) returns uuid
language sql immutable as $$ select md5('honor-rls:' || chave)::uuid $$;

insert into auth.users (id, email)
select pg_temp.id('usuario-' || n), 'rls-' || n || '@example.test'
from generate_series(1, 9) n;

insert into public.academias (id, nome, slug, status)
values (pg_temp.id('A'), 'Academia RLS A', 'teste-rls-a', 'ativa'),
       (pg_temp.id('B'), 'Academia RLS B', 'teste-rls-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel, ativo)
select pg_temp.id('A'), pg_temp.id('usuario-' || n), papel, n <> 7
from (values (1, 'dono'), (2, 'admin'), (3, 'professor'), (4, 'recepcao'),
             (5, 'aluno'), (6, 'aluno'), (7, 'admin')) p(n, papel);
insert into public.membros_academia (academia_id, user_id, papel)
values (pg_temp.id('B'), pg_temp.id('usuario-8'), 'dono');

insert into public.modalidades (id, academia_id, nome)
select pg_temp.id('modalidade-' || a), pg_temp.id(a), 'Jiu-Jitsu' from unnest(array['A','B']) a;
insert into public.faixas (id, academia_id, modalidade_id, nome, ordem)
select pg_temp.id('faixa-' || a), pg_temp.id(a), pg_temp.id('modalidade-' || a), 'Branca', 1
from unnest(array['A','B']) a;
insert into public.professores (id, academia_id, nome)
select pg_temp.id('professor-' || a), pg_temp.id(a), 'Professor de teste' from unnest(array['A','B']) a;
insert into public.turmas (id, academia_id, modalidade_id, professor_id, nome)
select pg_temp.id('turma-' || a), pg_temp.id(a), pg_temp.id('modalidade-' || a),
       pg_temp.id('professor-' || a), 'Turma de teste' from unnest(array['A','B']) a;
insert into public.turma_horarios (id, academia_id, turma_id, dia_semana, hora_inicio, hora_fim)
select pg_temp.id('horario-' || a), pg_temp.id(a), pg_temp.id('turma-' || a), 1, '18:00', '19:00'
from unnest(array['A','B']) a;
insert into public.turmas (id, academia_id, modalidade_id, nome)
values (pg_temp.id('turma-vazia-A'), pg_temp.id('A'), pg_temp.id('modalidade-A'), 'Turma sem matrículas');
insert into public.planos (id, academia_id, nome, valor)
select pg_temp.id('plano-' || a), pg_temp.id(a), 'Mensal', 100 from unnest(array['A','B']) a;

-- Dois filhos do mesmo responsável em A, outro aluno em A e um em B.
insert into public.alunos (id, academia_id, user_id, nome)
select pg_temp.id('aluno-' || chave), pg_temp.id(academia), pg_temp.id('usuario-' || usuario), 'Aluno ' || chave
from (values ('A1', 'A', 5), ('A2', 'A', 5), ('A3', 'A', 6), ('B1', 'B', 8)) a(chave, academia, usuario);
insert into public.matriculas (id, academia_id, aluno_id, plano_id)
select pg_temp.id('matricula-' || a.id), a.academia_id, a.id, pg_temp.id('plano-' || t.chave)
from public.alunos a join (values ('A'), ('B')) t(chave) on a.academia_id = pg_temp.id(t.chave);
insert into public.matricula_turmas (academia_id, matricula_id, turma_id)
select m.academia_id, m.id, t.id from public.matriculas m join public.turmas t using (academia_id)
where m.academia_id in (pg_temp.id('A'), pg_temp.id('B')) and t.id <> pg_temp.id('turma-vazia-A');
insert into public.presencas (id, academia_id, aluno_id, turma_id, data)
select pg_temp.id('presenca-' || a.id), a.academia_id, a.id, t.id, current_date - 1
from public.alunos a join public.turmas t using (academia_id)
where a.academia_id in (pg_temp.id('A'), pg_temp.id('B')) and t.id <> pg_temp.id('turma-vazia-A');
insert into public.graduacoes (id, academia_id, aluno_id, faixa_id, data)
select pg_temp.id('graduacao-' || a.id), a.academia_id, a.id, f.id, current_date - 30
from public.alunos a join public.faixas f using (academia_id)
where a.academia_id in (pg_temp.id('A'), pg_temp.id('B'));
insert into public.cobrancas (id, academia_id, aluno_id, matricula_id, valor, vencimento)
select pg_temp.id('cobranca-' || m.aluno_id), m.academia_id, m.aluno_id, m.id, 100, current_date - 1
from public.matriculas m where m.academia_id in (pg_temp.id('A'), pg_temp.id('B'));

-- Cada tentativa de escrita usa uma subtransação e desfaz até os sucessos.
-- A função é SECURITY INVOKER: a instrução usa o papel/JWT do caso em teste.
create function pg_temp.escrita(comando text, permitido boolean, descricao text)
returns text language plpgsql as $$
declare resultado text; quantidade bigint;
begin
  begin
    execute comando;
    get diagnostics quantidade = row_count;
    resultado := case when quantidade > 0 then 'permitido' else 'bloqueado' end;
    raise sqlstate 'ZX001';
  exception
    when sqlstate 'ZX001' then null;
    when insufficient_privilege then resultado := 'bloqueado';
    when others then resultado := sqlstate || ': ' || sqlerrm;
  end;
  return is(resultado, case when permitido then 'permitido' else 'bloqueado' end, descricao);
end $$;

create temporary table casos_insert (tabela text, comando text, papeis text[]);
insert into casos_insert values
('modalidades', $$insert into public.modalidades (academia_id, nome) values (pg_temp.id('A'), 'Nova')$$, array['dono','admin']),
('faixas', $$insert into public.faixas (academia_id, modalidade_id, nome, ordem) values (pg_temp.id('A'), pg_temp.id('modalidade-A'), 'Azul', 2)$$, array['dono','admin']),
('professores', $$insert into public.professores (academia_id, nome) values (pg_temp.id('A'), 'Novo professor')$$, array['dono','admin']),
('turmas', $$insert into public.turmas (academia_id, modalidade_id, nome) values (pg_temp.id('A'), pg_temp.id('modalidade-A'), 'Nova turma')$$, array['dono','admin']),
('turma_horarios', $$insert into public.turma_horarios (academia_id, turma_id, dia_semana, hora_inicio, hora_fim) values (pg_temp.id('A'), pg_temp.id('turma-A'), 2, '18:00', '19:00')$$, array['dono','admin']),
('planos', $$insert into public.planos (academia_id, nome, valor) values (pg_temp.id('A'), 'Novo plano', 100)$$, array['dono','admin']),
('alunos', $$insert into public.alunos (academia_id, nome) values (pg_temp.id('A'), 'Novo aluno')$$, array['dono','admin','recepcao']),
('matriculas', $$insert into public.matriculas (academia_id, aluno_id) values (pg_temp.id('A'), pg_temp.id('aluno-A1'))$$, array['dono','admin','recepcao']),
('matricula_turmas', $$insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values (pg_temp.id('A'), pg_temp.id('matricula-' || pg_temp.id('aluno-A1')), pg_temp.id('turma-vazia-A'))$$, array['dono','admin','recepcao']),
('presencas', $$insert into public.presencas (academia_id, aluno_id, turma_id, data) values (pg_temp.id('A'), pg_temp.id('aluno-A1'), pg_temp.id('turma-A'), current_date)$$, array['dono','admin','professor','recepcao']),
('graduacoes', $$insert into public.graduacoes (academia_id, aluno_id, faixa_id) values (pg_temp.id('A'), pg_temp.id('aluno-A1'), pg_temp.id('faixa-A'))$$, array['dono','admin','professor']),
('cobrancas', $$insert into public.cobrancas (academia_id, aluno_id, valor, vencimento) values (pg_temp.id('A'), pg_temp.id('aluno-A1'), 100, current_date)$$, array['dono','admin','recepcao']),
('membros_academia', $$insert into public.membros_academia (academia_id, user_id, papel) values (pg_temp.id('A'), pg_temp.id('usuario-9'), 'professor')$$, array['dono','admin']);
grant select on casos_insert to authenticated;

-- RLS deve estar habilitado em todas as tabelas de negócio.
select ok(c.relrowsecurity, c.relname || ': RLS habilitado')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('academias','membros_academia','modalidades','faixas','professores',
    'turmas','turma_horarios','planos','alunos','matriculas','matricula_turmas','presencas','graduacoes','cobrancas')
order by c.relname;

set local role authenticated;
select ok(not rolsuper and not rolbypassrls, 'authenticated não ignora RLS')
from pg_roles where rolname = current_user;
select set_config('request.jwt.claim.sub', pg_temp.id('usuario-1')::text, true);

-- Consultas SEM filtro de tenant: o próprio banco precisa isolar A de B.
select results_eq(format('select distinct academia_id from public.%I order by 1', tabela),
  array[pg_temp.id('A')], 'Dono A lê somente A: ' || tabela)
from unnest(array['membros_academia','modalidades','faixas','professores','turmas',
  'turma_horarios','planos','alunos','matriculas','matricula_turmas','presencas',
  'graduacoes','cobrancas','vw_graduacao_atual','vw_progresso_graduacao','vw_inadimplentes']) tabela;
select results_eq('select id from public.academias', array[pg_temp.id('A')], 'Dono A só lê sua academia');

-- UUID conhecido não permite escrever no tenant B; testa USING e WITH CHECK.
select pg_temp.escrita(replace(comando, $$pg_temp.id('A')$$, $$pg_temp.id('B')$$), false,
  'Dono A não insere em B: ' || tabela) from casos_insert;
select pg_temp.escrita(format('update public.%I set academia_id = academia_id where academia_id = pg_temp.id(''B'')', tabela), false,
  'Dono A não atualiza B: ' || tabela) from casos_insert;
select pg_temp.escrita(format('delete from public.%I where academia_id = pg_temp.id(''B'')', tabela), false,
  'Dono A não remove B: ' || tabela) from casos_insert;
select pg_temp.escrita($$update public.alunos set academia_id = pg_temp.id('B') where id = pg_temp.id('aluno-A1')$$,
  false, 'Não pode transferir aluno para tenant sem acesso');

-- Cada papel recebe controles positivos e negativos de INSERT.
reset role;
create function pg_temp.matriz_insert() returns setof text language plpgsql as $$
declare papel record; caso record;
begin
  for papel in select * from (values (1,'dono'),(2,'admin'),(3,'professor'),(4,'recepcao'),(5,'aluno')) p(n,nome) loop
    perform set_config('request.jwt.claim.sub', pg_temp.id('usuario-' || papel.n)::text, true);
    for caso in select * from casos_insert order by tabela loop
      return next pg_temp.escrita(caso.comando, papel.nome = any(caso.papeis), papel.nome || ' insere ' || caso.tabela);
    end loop;
  end loop;
end $$;
set local role authenticated;
select * from pg_temp.matriz_insert();

-- Responsável vê os dois filhos e somente os registros deles.
select set_config('request.jwt.claim.sub', pg_temp.id('usuario-5')::text, true);
select results_eq('select id from public.alunos order by id',
  'select id from (values (pg_temp.id(''aluno-A1'')), (pg_temp.id(''aluno-A2''))) a(id) order by id',
  'Responsável só vê seus dois filhos');
select results_eq(format('select distinct aluno_id from public.%I order by aluno_id', tabela),
  'select id from (values (pg_temp.id(''aluno-A1'')), (pg_temp.id(''aluno-A2''))) a(id) order by id',
  'Responsável só vê registros dos filhos: ' || tabela)
from unnest(array['matriculas','presencas','graduacoes','cobrancas','vw_graduacao_atual','vw_progresso_graduacao','vw_inadimplentes']) tabela;
select is((select count(*) from public.matricula_turmas), 2::bigint, 'Responsável só vê turmas das matrículas dos filhos');
select is((select count(*) from public.faixas), 1::bigint, 'Aluno lê catálogo da sua academia');
select pg_temp.escrita($$update public.alunos set nome = 'Alterado' where id = pg_temp.id('aluno-A1')$$, false, 'Aluno não altera cadastro diretamente');
select pg_temp.escrita($$delete from public.presencas where aluno_id = pg_temp.id('aluno-A1')$$, false, 'Aluno não remove presença');
select lives_ok($$select public.fazer_checkin(pg_temp.id('turma-A'), pg_temp.id('aluno-A1'))$$, 'Aluno faz check-in autorizado via RPC');
select is((select count(*) from public.presencas where aluno_id = pg_temp.id('aluno-A1') and data = current_date),
  1::bigint, 'RPC registra presença do próprio aluno');
select throws_ok($$select public.fazer_checkin(pg_temp.id('turma-A'), pg_temp.id('aluno-A3'))$$,
  'P0001', 'Nenhuma matrícula ativa nesta turma para este login', 'RPC rejeita check-in de outro aluno');
select throws_ok($$select public.fazer_checkin(pg_temp.id('turma-B'), pg_temp.id('aluno-B1'))$$,
  'P0001', 'Nenhuma matrícula ativa nesta turma para este login', 'RPC rejeita check-in em outro tenant');

select set_config('request.jwt.claim.sub', pg_temp.id('usuario-3')::text, true);
select is((select count(*) from public.alunos), 3::bigint, 'Professor lê alunos de A');
select is((select count(*) from public.cobrancas), 0::bigint, 'Professor não lê cobranças');
select is((select count(*) from public.vw_inadimplentes), 0::bigint, 'View não expõe financeiro ao professor');
select pg_temp.escrita($$update public.graduacoes set grau = 1 where aluno_id = pg_temp.id('aluno-A1')$$, true, 'Professor atualiza graduação');
select pg_temp.escrita($$delete from public.graduacoes where aluno_id = pg_temp.id('aluno-A1')$$, false, 'Professor não remove graduação');
select pg_temp.escrita($$update public.cobrancas set valor = 200 where aluno_id = pg_temp.id('aluno-A1')$$, false, 'Professor não altera cobrança');

select set_config('request.jwt.claim.sub', pg_temp.id('usuario-4')::text, true);
select is((select count(*) from public.cobrancas), 3::bigint, 'Recepção lê cobranças de A');
select pg_temp.escrita($$update public.cobrancas set valor = 200 where aluno_id = pg_temp.id('aluno-A1')$$, true, 'Recepção atualiza cobrança');
select pg_temp.escrita($$delete from public.cobrancas where aluno_id = pg_temp.id('aluno-A1')$$, false, 'Recepção não remove cobrança');

select set_config('request.jwt.claim.sub', pg_temp.id('usuario-2')::text, true);
select pg_temp.escrita($$insert into public.membros_academia (academia_id, user_id, papel) values (pg_temp.id('A'), pg_temp.id('usuario-9'), 'dono')$$, false, 'Admin não cria dono');
select pg_temp.escrita($$update public.membros_academia set papel = 'dono' where user_id = pg_temp.id('usuario-2')$$, false, 'Admin não promove a si mesmo');
select pg_temp.escrita($$update public.membros_academia set papel = 'professor' where user_id = pg_temp.id('usuario-1')$$, false, 'Admin não rebaixa dono');
select pg_temp.escrita($$delete from public.membros_academia where user_id = pg_temp.id('usuario-1')$$, false, 'Admin não remove dono');
select pg_temp.escrita($$update public.membros_academia set papel = 'recepcao' where user_id = pg_temp.id('usuario-3')$$, true, 'Admin gerencia equipe sem papel dono');

select set_config('request.jwt.claim.sub', pg_temp.id('usuario-1')::text, true);
select pg_temp.escrita($$update public.membros_academia set papel = 'dono' where user_id = pg_temp.id('usuario-3')$$, true, 'Dono pode promover outro dono');
select pg_temp.escrita($$update public.academias set nome = 'Novo nome' where id = pg_temp.id('A')$$, true, 'Dono ativo atualiza nome');
select pg_temp.escrita(format('update public.academias set %I = %L where id = pg_temp.id(''A'')', coluna, valor), false,
  'Dono não altera coluna de billing: ' || coluna)
from (values ('slug','slug-alterado'),('status','suspensa'),('plano_saas','premium'),('trial_ate','2099-01-01')) c(coluna,valor);

-- FK composta deve rejeitar vínculos cruzados mesmo para um dono de ambos tenants.
reset role;
insert into public.membros_academia (academia_id, user_id, papel)
values (pg_temp.id('B'), pg_temp.id('usuario-1'), 'dono');
set local role authenticated;
select results_eq('select id from public.academias order by id',
  'select id from (values (pg_temp.id(''A'')), (pg_temp.id(''B''))) a(id) order by id', 'Membro de duas academias lê ambas');
select throws_ok($$insert into public.faixas (academia_id, modalidade_id, nome, ordem) values (pg_temp.id('A'), pg_temp.id('modalidade-B'), 'Inválida', 9)$$,
  '23503', null, 'FK composta impede faixa ligada à modalidade de B');
select throws_ok($$insert into public.matriculas (academia_id, aluno_id) values (pg_temp.id('A'), pg_temp.id('aluno-B1'))$$,
  '23503', null, 'FK composta impede matrícula ligada ao aluno de B');
select throws_ok($$insert into public.presencas (academia_id, aluno_id, turma_id, data) values (pg_temp.id('A'), pg_temp.id('aluno-A1'), pg_temp.id('turma-B'), current_date)$$,
  '23503', null, 'FK composta impede presença na turma de B');

-- Membro inativo e usuário sem vínculo não ganham acesso ao catálogo/alunos.
select set_config('request.jwt.claim.sub', pg_temp.id('usuario-7')::text, true);
select is((select count(*) from public.alunos), 0::bigint, 'Admin inativo não lê alunos');
select is((select count(*) from public.modalidades), 0::bigint, 'Admin inativo não lê catálogo');
select pg_temp.escrita(comando, false, 'Admin inativo não insere ' || tabela) from casos_insert;
select set_config('request.jwt.claim.sub', pg_temp.id('usuario-9')::text, true);
select is((select count(*) from public.academias), 0::bigint, 'Sem vínculo não lê academias');
select is((select count(*) from public.alunos), 0::bigint, 'Sem vínculo não lê alunos');

-- Suspensão/trial vencido preservam leitura, mas devem bloquear escrita.
reset role;
update public.academias set status = 'suspensa' where id = pg_temp.id('A');
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.id('usuario-1')::text, true);
select is((select count(*) from public.alunos where academia_id = pg_temp.id('A')), 3::bigint, 'Suspensa mantém leitura');
select pg_temp.escrita(comando, false, 'Suspensa não insere ' || tabela) from casos_insert;
select pg_temp.escrita($$update public.alunos set nome = 'Alterado' where id = pg_temp.id('aluno-A1')$$, false, 'Suspensa não atualiza aluno');
select pg_temp.escrita($$delete from public.alunos where id = pg_temp.id('aluno-A1')$$, false, 'Suspensa não remove aluno');
select pg_temp.escrita($$update public.academias set nome = 'Alterado' where id = pg_temp.id('A')$$, false, 'Suspensa não atualiza academia');
reset role;
update public.academias set status = 'trial', trial_ate = current_date - 1 where id = pg_temp.id('A');
set local role authenticated;
select is((select count(*) from public.alunos where academia_id = pg_temp.id('A')), 3::bigint, 'Trial vencido mantém leitura');
select pg_temp.escrita(comando, false, 'Trial vencido não insere ' || tabela) from casos_insert;
select pg_temp.escrita($$update public.academias set nome = 'Alterado' where id = pg_temp.id('A')$$, false, 'Trial vencido não atualiza academia');
reset role;
update public.academias set trial_ate = current_date where id = pg_temp.id('A');
set local role authenticated;
select pg_temp.escrita(comando, 'dono' = any(papeis), 'Trial válido permite inserir ' || tabela) from casos_insert;

-- Anônimo não acessa tabelas; consultas públicas passam somente pelas RPCs.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*) from public.alunos), 0::bigint, 'Anônimo não lê alunos');
select is((select count(*) from public.cobrancas), 0::bigint, 'Anônimo não lê cobranças');
select throws_ok('select * from public.vw_inadimplentes', '42501', null, 'Anônimo não acessa view financeira');
select throws_ok($$select public.fazer_checkin(pg_temp.id('turma-A'), pg_temp.id('aluno-A1'))$$,
  '42501', null, 'Anônimo não executa check-in');
select is(public.academia_publica('teste-rls-a')->>'nome', 'Academia RLS A', 'RPC pública permanece acessível');
reset role;
select * from finish();
rollback;
