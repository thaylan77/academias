-- Check-in por QR: token rotativo, janela de horário, códigos de erro no
-- hint e papel totem.
-- A janela "aberta" usa um horário que cobre o dia inteiro de hoje; a
-- "fechada" usa um dia da semana que não é hoje nem amanhã. Assim o teste
-- não depende da hora em que roda.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- Devolve o hint do erro que o comando levanta. Fica em public (e some no
-- rollback) porque é chamada com os papéis authenticated e anon.
create function public.__hint_de(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'sem hint: ' || sqlerrm);
end
$$;
grant execute on function public.__hint_de(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Fixtures
--   Academia A: dono, professor, totem; logins de aluno:
--     aluno1 (a1), responsável (a2 e a3), devedor (a4), sem matrícula (a5)
--   Turmas de A: t1 (aberta agora), t2 (outro dia da semana), t3 (sem horário)
--   Academia B: professor; turma tb (aberta agora)
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f4000000-0000-4000-8000-0000000000a1', 'dono-a@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000a2', 'professor-a@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000a3', 'totem-a@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000c1', 'aluno1@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000c2', 'responsavel@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000c4', 'devedor@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000c5', 'sem-matricula@checkin.test'),
  ('f4000000-0000-4000-8000-0000000000b2', 'professor-b@checkin.test');

insert into public.academias (id, nome, slug, status) values
  ('f4000000-0000-4000-8000-00000000000a', 'Check-in A', 'checkin-teste-a', 'ativa'),
  ('f4000000-0000-4000-8000-00000000000b', 'Check-in B', 'checkin-teste-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000a1', 'dono'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000a2', 'professor'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000a3', 'totem'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000c1', 'aluno'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000c2', 'aluno'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000c4', 'aluno'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000000c5', 'aluno'),
  ('f4000000-0000-4000-8000-00000000000b', 'f4000000-0000-4000-8000-0000000000b2', 'professor');

insert into public.modalidades (id, academia_id, nome) values
  ('f4000000-0000-4000-8000-000000000201', 'f4000000-0000-4000-8000-00000000000a', 'Jiu-Jitsu'),
  ('f4000000-0000-4000-8000-000000000202', 'f4000000-0000-4000-8000-00000000000b', 'Jiu-Jitsu');

insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('f4000000-0000-4000-8000-0000000003a1', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-000000000201', 'Turma aberta'),
  ('f4000000-0000-4000-8000-0000000003a2', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-000000000201', 'Turma de outro dia'),
  ('f4000000-0000-4000-8000-0000000003a3', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-000000000201', 'Turma sem horário'),
  ('f4000000-0000-4000-8000-0000000003b1', 'f4000000-0000-4000-8000-00000000000b', 'f4000000-0000-4000-8000-000000000202', 'Turma de B');

insert into public.turma_horarios (academia_id, turma_id, dia_semana, hora_inicio, hora_fim)
select v.academia::uuid, v.turma::uuid,
       (extract(dow from public.hoje_academia(v.academia::uuid))::int + v.dias) % 7,
       v.inicio::time, v.fim::time
from (values
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000003a1', 0, '00:00', '23:59:59'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000003a2', 3, '10:00', '11:00'),
  ('f4000000-0000-4000-8000-00000000000b', 'f4000000-0000-4000-8000-0000000003b1', 0, '00:00', '23:59:59')
) as v (academia, turma, dias, inicio, fim);

insert into public.alunos (id, academia_id, nome, user_id) values
  ('f4000000-0000-4000-8000-0000000001a1', 'f4000000-0000-4000-8000-00000000000a', 'Aluno 1',          'f4000000-0000-4000-8000-0000000000c1'),
  ('f4000000-0000-4000-8000-0000000001a2', 'f4000000-0000-4000-8000-00000000000a', 'Filho 1',          'f4000000-0000-4000-8000-0000000000c2'),
  ('f4000000-0000-4000-8000-0000000001a3', 'f4000000-0000-4000-8000-00000000000a', 'Filho 2',          'f4000000-0000-4000-8000-0000000000c2'),
  ('f4000000-0000-4000-8000-0000000001a4', 'f4000000-0000-4000-8000-00000000000a', 'Aluno devedor',    'f4000000-0000-4000-8000-0000000000c4'),
  ('f4000000-0000-4000-8000-0000000001a5', 'f4000000-0000-4000-8000-00000000000a', 'Aluno sem turma',  'f4000000-0000-4000-8000-0000000000c5');

insert into public.matriculas (id, academia_id, aluno_id) values
  ('f4000000-0000-4000-8000-0000000004a1', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000001a1'),
  ('f4000000-0000-4000-8000-0000000004a2', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000001a2'),
  ('f4000000-0000-4000-8000-0000000004a3', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000001a3'),
  ('f4000000-0000-4000-8000-0000000004a4', 'f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000001a4');

insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000004a1', 'f4000000-0000-4000-8000-0000000003a1'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000004a1', 'f4000000-0000-4000-8000-0000000003a2'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000004a1', 'f4000000-0000-4000-8000-0000000003a3'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000004a2', 'f4000000-0000-4000-8000-0000000003a1'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000004a3', 'f4000000-0000-4000-8000-0000000003a1'),
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000004a4', 'f4000000-0000-4000-8000-0000000003a1');

insert into public.cobrancas (academia_id, aluno_id, valor, vencimento) values
  ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000001a4', 100, current_date - 60);

-- Segredos e tokens de referência, calculados pela função interna
insert into public.checkin_segredos (academia_id) values
  ('f4000000-0000-4000-8000-00000000000a'), ('f4000000-0000-4000-8000-00000000000b');

create temp table t_tok as
select v.nome,
       public.checkin_token_da_janela(v.turma::uuid,
         public.checkin_janela_atual(v.academia::uuid) - v.atraso) as tok
from (values
  ('t1',          'f4000000-0000-4000-8000-0000000003a1', 'f4000000-0000-4000-8000-00000000000a', 0),
  ('t1-anterior', 'f4000000-0000-4000-8000-0000000003a1', 'f4000000-0000-4000-8000-00000000000a', 1),
  ('t1-antigo',   'f4000000-0000-4000-8000-0000000003a1', 'f4000000-0000-4000-8000-00000000000a', 2),
  ('t2',          'f4000000-0000-4000-8000-0000000003a2', 'f4000000-0000-4000-8000-00000000000a', 0),
  ('t3',          'f4000000-0000-4000-8000-0000000003a3', 'f4000000-0000-4000-8000-00000000000a', 0),
  ('tb',          'f4000000-0000-4000-8000-0000000003b1', 'f4000000-0000-4000-8000-00000000000b', 0)
) as v (nome, turma, academia, atraso);
grant select on t_tok to authenticated;

select is((select count(distinct tok) from t_tok), 6::bigint, 'Token muda por turma, por academia e por janela');
select is((select length(tok) from t_tok where nome = 't1'), 32, 'Token tem 128 bits (32 hex)');
select hasnt_function('public', 'fazer_checkin', array['uuid', 'uuid'], 'A fazer_checkin sem token não existe mais');

-- ---------------------------------------------------------------------
-- 1. Emissão do token
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

select is(public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1') ->> 'token',
  (select tok from t_tok where nome = 't1'), 'Professor emite o token da janela atual');
select is((public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1') ->> 'periodo_segundos')::int,
  30, 'Emissão informa o período');
select cmp_ok((public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1') ->> 'expira_em')::timestamptz,
  '>', now() - interval '1 second', 'expira_em é o fim da janela atual');
select is(public.__hint_de($$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a2')$$),
  'checkin_fora_do_horario', 'Emissão fora da janela: checkin_fora_do_horario');
select is(public.__hint_de($$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a3')$$),
  'checkin_fora_do_horario', 'Emissão de turma sem horário: checkin_fora_do_horario');
select is(public.__hint_de($$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003b1')$$),
  'sem_permissao', 'Professor de A não emite token de turma de B');
select is(public.__hint_de($$select public.totem_turmas_agora('f4000000-0000-4000-8000-00000000000b')$$),
  'sem_permissao', 'Professor de A não lista turmas abertas de B');

-- ---------------------------------------------------------------------
-- 2. fazer_checkin: token
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000c1';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000c1","role":"authenticated"}';

select is(public.__hint_de($$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1')$$),
  'sem_permissao', 'Aluno não emite token');
select is(public.__hint_de($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', 'token-errado')$$),
  'checkin_token_invalido', 'Token errado: checkin_token_invalido');
select is(public.__hint_de($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', null)$$),
  'checkin_token_invalido', 'Sem token: checkin_token_invalido');
select is(public.__hint_de($$select public.fazer_checkin('f4000000-0000-4000-8000-00000000ffff', 'qualquer')$$),
  'checkin_token_invalido', 'Turma inexistente: checkin_token_invalido');
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't1-antigo'))),
  'checkin_token_invalido', 'Token de duas janelas atrás: checkin_token_invalido');
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't2'))),
  'checkin_token_invalido', 'Token de outra turma: checkin_token_invalido');
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 'tb'))),
  'checkin_token_invalido', 'Token de outra academia: checkin_token_invalido');

-- ---------------------------------------------------------------------
-- 3. fazer_checkin: janela de horário
-- ---------------------------------------------------------------------
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a2', %L)$$,
    (select tok from t_tok where nome = 't2'))),
  'checkin_fora_do_horario', 'Token válido fora da janela: checkin_fora_do_horario');
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a3', %L)$$,
    (select tok from t_tok where nome = 't3'))),
  'checkin_fora_do_horario', 'Turma sem horário: checkin_fora_do_horario');

-- ---------------------------------------------------------------------
-- 4. fazer_checkin: caminho feliz
-- ---------------------------------------------------------------------
select isnt(public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', (select tok from t_tok where nome = 't1-anterior')),
  null, 'Token da janela anterior é aceito');
select is(public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', (select tok from t_tok where nome = 't1')),
  (select id from public.presencas where aluno_id = 'f4000000-0000-4000-8000-0000000001a1'),
  'Token da janela atual é aceito e o check-in repetido devolve a mesma presença');

reset role;
select is((select count(*) from public.presencas where aluno_id = 'f4000000-0000-4000-8000-0000000001a1'),
  1::bigint, 'Uma presença só');
select is((select data from public.presencas where aluno_id = 'f4000000-0000-4000-8000-0000000001a1'),
  public.hoje_academia('f4000000-0000-4000-8000-00000000000a'), 'Presença no dia da aula, no fuso da academia');
select is((select origem from public.presencas where aluno_id = 'f4000000-0000-4000-8000-0000000001a1'),
  'qrcode', 'Origem qrcode');

-- ---------------------------------------------------------------------
-- 5. fazer_checkin: matrícula e inadimplência
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000c2';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000c2","role":"authenticated"}';

select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't1'))),
  'checkin_multiplos_alunos', 'Responsável com dois alunos e sem escolher: checkin_multiplos_alunos');
select isnt(public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', (select tok from t_tok where nome = 't1'),
    'f4000000-0000-4000-8000-0000000001a2'),
  null, 'Responsável escolhe o aluno e faz o check-in');
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L, 'f4000000-0000-4000-8000-0000000001a1')$$,
    (select tok from t_tok where nome = 't1'))),
  'checkin_sem_matricula', 'Responsável não faz check-in de aluno de outro login');

set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000c5';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000c5","role":"authenticated"}';
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't1'))),
  'checkin_sem_matricula', 'Login sem matrícula na turma: checkin_sem_matricula');

set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000c4';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000c4","role":"authenticated"}';
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't1'))),
  'checkin_inadimplente', 'Mensalidade vencida além da tolerância: checkin_inadimplente');

-- ---------------------------------------------------------------------
-- 6. Totem: emite token e não lê mais nada
-- ---------------------------------------------------------------------
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000a3';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000a3","role":"authenticated"}';

select is(public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1') ->> 'token',
  (select tok from t_tok where nome = 't1'), 'Totem emite o token');
select is(jsonb_array_length(public.totem_turmas_agora('f4000000-0000-4000-8000-00000000000a')),
  1, 'Totem vê só a turma com check-in aberto');
select is(public.totem_turmas_agora('f4000000-0000-4000-8000-00000000000a') -> 0 ->> 'id',
  'f4000000-0000-4000-8000-0000000003a1', 'E é a turma aberta');
select is(public.__hint_de($$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003b1')$$),
  'sem_permissao', 'Totem de A não emite token de turma de B');
select is(public.__hint_de($$select public.totem_turmas_agora('f4000000-0000-4000-8000-00000000000b')$$),
  'sem_permissao', 'Totem de A não lista turmas de B');

select is((select count(*) from public.membros_academia), 1::bigint, 'Totem lê só o próprio vínculo');
select is((select count(*) from public.academias),      0::bigint, 'Totem não lê academias');
select is((select count(*) from public.modalidades),    0::bigint, 'Totem não lê modalidades');
select is((select count(*) from public.faixas),         0::bigint, 'Totem não lê faixas');
select is((select count(*) from public.professores),    0::bigint, 'Totem não lê professores');
select is((select count(*) from public.turmas),         0::bigint, 'Totem não lê turmas');
select is((select count(*) from public.turma_horarios), 0::bigint, 'Totem não lê horários');
select is((select count(*) from public.planos),         0::bigint, 'Totem não lê planos');
select is((select count(*) from public.alunos),         0::bigint, 'Totem não lê alunos');
select is((select count(*) from public.matriculas),     0::bigint, 'Totem não lê matrículas');
select is((select count(*) from public.presencas),      0::bigint, 'Totem não lê presenças');
select is((select count(*) from public.graduacoes),     0::bigint, 'Totem não lê graduações');
select is((select count(*) from public.cobrancas),      0::bigint, 'Totem não lê cobranças');
select is((select count(*) from public.vw_graduacao_atual),     0::bigint, 'Totem não lê vw_graduacao_atual');
select is((select count(*) from public.vw_progresso_graduacao), 0::bigint, 'Totem não lê vw_progresso_graduacao');
select is((select count(*) from public.vw_inadimplentes),       0::bigint, 'Totem não lê vw_inadimplentes');
select throws_ok(
  $$select count(*) from public.checkin_segredos$$,
  '42501'::char(5), null::text, 'Totem não lê o segredo do token');
select throws_ok(
  $$insert into public.presencas (academia_id, aluno_id, turma_id, data)
    values ('f4000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-0000000001a5',
            'f4000000-0000-4000-8000-0000000003a1', current_date)$$,
  '42501'::char(5), null::text, 'Totem não lança presença');
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't1'))),
  'checkin_sem_matricula', 'Totem não faz check-in por ninguém');
select is(public.__hint_de($$select public.rotacionar_segredo_checkin('f4000000-0000-4000-8000-00000000000a')$$),
  'sem_permissao', 'Totem não troca o segredo');

-- o papel aluno continua lendo o catálogo (a mudança em tem_papel só tira o totem)
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000c1';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select is((select count(*) from public.turmas), 3::bigint, 'Aluno continua lendo as turmas da academia');
select is((select count(*) from public.academias), 1::bigint, 'Aluno continua lendo a própria academia');

-- anônimo não chama nada do check-in
set local role anon;
select throws_ok(
  $$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1')$$,
  '42501'::char(5), null::text, 'Anônimo não emite token');
select throws_ok(
  $$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', 'x')$$,
  '42501'::char(5), null::text, 'Anônimo não faz check-in');

-- ---------------------------------------------------------------------
-- 7. Rotação do segredo e academia suspensa
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000a1';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.rotacionar_segredo_checkin('f4000000-0000-4000-8000-00000000000a')$$,
  'Dono troca o segredo do check-in');

set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000c1';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_tok where nome = 't1'))),
  'checkin_token_invalido', 'Depois da rotação, o token antigo não vale');

reset role;
update public.academias set status = 'suspensa' where id = 'f4000000-0000-4000-8000-00000000000a';
create temp table t_novo as
select public.checkin_token_da_janela('f4000000-0000-4000-8000-0000000003a1',
         public.checkin_janela_atual('f4000000-0000-4000-8000-00000000000a')) as tok;
grant select on t_novo to authenticated;

set local role authenticated;
select is(public.__hint_de(format($$select public.fazer_checkin('f4000000-0000-4000-8000-0000000003a1', %L)$$,
    (select tok from t_novo))),
  'academia_suspensa', 'Token válido em academia suspensa: academia_suspensa');

set local request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is(public.__hint_de($$select public.emitir_token_checkin('f4000000-0000-4000-8000-0000000003a1')$$),
  'academia_suspensa', 'Emissão em academia suspensa: academia_suspensa');
select is(public.__hint_de($$select public.totem_turmas_agora('f4000000-0000-4000-8000-00000000000a')$$),
  'academia_suspensa', 'Turmas abertas em academia suspensa: academia_suspensa');

select * from finish();
rollback;
