-- encerrar_matricula, trancar_matricula e destrancar_matricula (issue #28):
-- dono, admin e recepção com a assinatura em dia; professor, totem, outra
-- academia e academia suspensa não alcançam. Nenhuma cobrança é cancelada;
-- encerrar e trancar devolvem quantas pendentes ficaram depois.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

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
grant execute on function public.__hint_de(text) to authenticated;

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

-- ---------------------------------------------------------------------
-- Fixtures
--   Academia A: recepção, professor, totem, login do aluno 1; turma T1 com
--     horário o dia inteiro hoje; plano Mensal.
--     M1 ativa do aluno 1 em T1 (check-in); M2 ativa do aluno 2 com três
--     cobranças; M3 pendente; M4 cancelada; M6 trancada do aluno 4 (inativo).
--   Academia B: dono. Academia C (suspensa): recepção e M5.
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('fe100000-0000-4000-8000-0000000000a1', 'recepcao-a@encerrar.test'),
  ('fe100000-0000-4000-8000-0000000000a2', 'professor-a@encerrar.test'),
  ('fe100000-0000-4000-8000-0000000000a3', 'totem-a@encerrar.test'),
  ('fe100000-0000-4000-8000-0000000000c1', 'aluno1@encerrar.test'),
  ('fe100000-0000-4000-8000-0000000000b1', 'dono-b@encerrar.test'),
  ('fe100000-0000-4000-8000-0000000000d1', 'recepcao-c@encerrar.test');

insert into public.academias (id, nome, slug, status) values
  ('fe100000-0000-4000-8000-00000000000a', 'Encerrar A', 'encerrar-a', 'ativa'),
  ('fe100000-0000-4000-8000-00000000000b', 'Encerrar B', 'encerrar-b', 'ativa'),
  ('fe100000-0000-4000-8000-00000000000c', 'Encerrar C', 'encerrar-c', 'suspensa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000000a1', 'recepcao'),
  ('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000000a2', 'professor'),
  ('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000000a3', 'totem'),
  ('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000000c1', 'aluno'),
  ('fe100000-0000-4000-8000-00000000000b', 'fe100000-0000-4000-8000-0000000000b1', 'dono'),
  ('fe100000-0000-4000-8000-00000000000c', 'fe100000-0000-4000-8000-0000000000d1', 'recepcao');

insert into public.modalidades (id, academia_id, nome) values
  ('fe100000-0000-4000-8000-000000000201', 'fe100000-0000-4000-8000-00000000000a', 'Jiu-Jitsu');
insert into public.turmas (id, academia_id, modalidade_id, nome) values
  ('fe100000-0000-4000-8000-0000000003a1', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-000000000201', 'T1');
insert into public.turma_horarios (academia_id, turma_id, dia_semana, hora_inicio, hora_fim) values
  ('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000003a1',
   extract(dow from public.hoje_academia('fe100000-0000-4000-8000-00000000000a'))::int, '00:00', '23:59:59');

insert into public.planos (id, academia_id, nome, valor, ativo) values
  ('fe100000-0000-4000-8000-0000000004a1', 'fe100000-0000-4000-8000-00000000000a', 'Mensal', 150, true);

insert into public.alunos (id, academia_id, nome, status, user_id) values
  ('fe100000-0000-4000-8000-0000000001a1', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 1', 'ativo', 'fe100000-0000-4000-8000-0000000000c1'),
  ('fe100000-0000-4000-8000-0000000001a2', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 2', 'ativo', null),
  ('fe100000-0000-4000-8000-0000000001a3', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 3', 'pendente', null),
  ('fe100000-0000-4000-8000-0000000001a4', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 4', 'inativo', null),
  ('fe100000-0000-4000-8000-0000000001b1', 'fe100000-0000-4000-8000-00000000000b', 'Aluno B', 'ativo', null),
  ('fe100000-0000-4000-8000-0000000001c1', 'fe100000-0000-4000-8000-00000000000c', 'Aluno C', 'ativo', null);

create temp table t_d as select public.hoje_academia('fe100000-0000-4000-8000-00000000000a') as hoje;
grant select on t_d to authenticated;

insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, origem, data_inicio, dia_vencimento)
select v.id::uuid, v.acad::uuid, v.aluno::uuid, v.plano::uuid, v.status, 'recepcao', (select hoje from t_d) - 60, v.dia
from (values
  ('fe100000-0000-4000-8000-000000000501', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a1', null, 'ativa', null::smallint),
  ('fe100000-0000-4000-8000-000000000502', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a2', 'fe100000-0000-4000-8000-0000000004a1', 'ativa', 10::smallint),
  ('fe100000-0000-4000-8000-000000000503', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a3', null, 'pendente', null),
  ('fe100000-0000-4000-8000-000000000504', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a3', null, 'cancelada', null),
  ('fe100000-0000-4000-8000-000000000506', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a4', null, 'trancada', null),
  ('fe100000-0000-4000-8000-0000000005b1', 'fe100000-0000-4000-8000-00000000000b', 'fe100000-0000-4000-8000-0000000001b1', null, 'ativa', null),
  ('fe100000-0000-4000-8000-000000000505', 'fe100000-0000-4000-8000-00000000000c', 'fe100000-0000-4000-8000-0000000001c1', null, 'ativa', null)
) as v (id, acad, aluno, plano, status, dia);

insert into public.matricula_turmas (academia_id, matricula_id, turma_id) values
  ('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-000000000501', 'fe100000-0000-4000-8000-0000000003a1');

-- Cobranças avulsas (sem competência) de M2: pendente daqui a 20 dias,
-- pendente vencida há 5 dias e paga daqui a 25 dias.
insert into public.cobrancas (academia_id, aluno_id, matricula_id, valor, vencimento, status, pago_em, forma_pagamento)
select 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a2', 'fe100000-0000-4000-8000-000000000502',
       150, (select hoje from t_d) + v.dias, v.status, v.pago, v.forma
from (values (20, 'pendente', null::timestamptz, null::text), (-5, 'pendente', null, null), (25, 'paga', now(), 'pix')) as v (dias, status, pago, forma);

-- Token do QR de T1, emitido pelo totem logo antes do check-in.
create temp table t_tok (tok text);
grant select, insert, delete on t_tok to authenticated;

-- ---------------------------------------------------------------------
-- 1. Privilégios
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.encerrar_matricula(uuid, date)', 'execute'), 'anon não executa encerrar_matricula');
select ok(not has_function_privilege('anon', 'public.trancar_matricula(uuid)', 'execute'), 'anon não executa trancar_matricula');
select ok(not has_function_privilege('anon', 'public.destrancar_matricula(uuid)', 'execute'), 'anon não executa destrancar_matricula');

-- ---------------------------------------------------------------------
-- 2. Quem não gere a matrícula
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a2');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000501', (select hoje from t_d))$$),
          'sem_permissao', 'professor não encerra');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000501')$$),
          'sem_permissao', 'professor não tranca');
select public.__como('fe100000-0000-4000-8000-0000000000a3');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000501', (select hoje from t_d))$$),
          'sem_permissao', 'totem não encerra');
select public.__como('fe100000-0000-4000-8000-0000000000b1');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000501', (select hoje from t_d))$$),
          'sem_permissao', 'dono de B não encerra matrícula de A');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000501')$$),
          'sem_permissao', 'dono de B não tranca matrícula de A');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000506')$$),
          'sem_permissao', 'dono de B não destranca matrícula de A');
select public.__como('fe100000-0000-4000-8000-0000000000d1');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000505', (select hoje from t_d))$$),
          'sem_permissao', 'academia suspensa: recepção não encerra');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000505')$$),
          'sem_permissao', 'academia suspensa: recepção não tranca');
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-00000000ffff', (select hoje from t_d))$$),
          'sem_permissao', 'matrícula inexistente: sem_permissao');
reset role;
select is((select count(*)::int from public.matriculas
            where id in ('fe100000-0000-4000-8000-000000000501', 'fe100000-0000-4000-8000-000000000505')
              and (status <> 'ativa' or data_fim is not null)), 0,
          'nenhuma recusa alterou matrícula');

-- ---------------------------------------------------------------------
-- 3. encerrar_matricula
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000502', (select hoje from t_d) - 61)$$),
          'dados_invalidos', 'fim antes do início: dados_invalidos');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000502', null)$$),
          'dados_invalidos', 'sem data de fim: dados_invalidos');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000503', (select hoje from t_d))$$),
          'matricula_nao_encerravel', 'pendente não encerra');
select is(public.__hint_de($$select public.encerrar_matricula('fe100000-0000-4000-8000-000000000504', (select hoje from t_d))$$),
          'matricula_nao_encerravel', 'cancelada não encerra');
select is(public.encerrar_matricula('fe100000-0000-4000-8000-000000000502', (select hoje from t_d) + 10), 1,
          'encerrar devolve as pendentes depois do fim (a vencida antes e a paga não contam)');
reset role;
select is((select data_fim from public.matriculas where id = 'fe100000-0000-4000-8000-000000000502'),
          (select hoje from t_d) + 10, 'data de fim gravada');
select is((select count(*)::int from public.cobrancas
            where matricula_id = 'fe100000-0000-4000-8000-000000000502' and status = 'cancelada'), 0,
          'nenhuma cobrança foi cancelada');

-- ---------------------------------------------------------------------
-- 4. trancar e destrancar
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.trancar_matricula('fe100000-0000-4000-8000-000000000502'), 1,
          'trancar devolve as pendentes de hoje em diante');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000502')$$),
          'matricula_nao_ativa', 'trancada não tranca de novo');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000503')$$),
          'matricula_nao_ativa', 'pendente não tranca');
reset role;
select is(public.gerar_cobrancas('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-000000000502'), 0,
          'matrícula trancada não gera cobrança');
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000502')$$),
          'sem erro', 'recepção destranca');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000502')$$),
          'matricula_nao_trancada', 'ativa não destranca');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000506')$$),
          'sem erro', 'destranca a matrícula do aluno inativo');
reset role;
select is((select status from public.matriculas where id = 'fe100000-0000-4000-8000-000000000502'), 'ativa',
          'destrancada volta a ativa');
select is((select status from public.alunos where id = 'fe100000-0000-4000-8000-0000000001a4'), 'ativo',
          'e o aluno inativo volta a ativo');

-- Encerrada no passado: não tranca, e a geração não cobra depois do fim.
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.encerrar_matricula('fe100000-0000-4000-8000-000000000502', (select hoje from t_d) - 1), 1,
          'encerrar no passado é aceito (registro atrasado da saída)');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000502')$$),
          'matricula_nao_ativa', 'encerrada antes de hoje não tranca');
reset role;
select public.gerar_cobrancas('fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-000000000502');
select is((select count(*)::int from public.cobrancas
            where matricula_id = 'fe100000-0000-4000-8000-000000000502' and vencimento > (select hoje from t_d) - 1), 2,
          'nenhuma cobrança nova depois do fim (só as duas que já existiam)');

-- ---------------------------------------------------------------------
-- 5. Check-in: trancada não entra; destrancada entra
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.trancar_matricula('fe100000-0000-4000-8000-000000000501'), 0, 'tranca M1 (sem cobranças)');
select public.__como('fe100000-0000-4000-8000-0000000000a3');
insert into t_tok select public.emitir_token_checkin('fe100000-0000-4000-8000-0000000003a1') ->> 'token';
select public.__como('fe100000-0000-4000-8000-0000000000c1');
select is(public.__hint_de($$select public.fazer_checkin('fe100000-0000-4000-8000-0000000003a1', (select tok from t_tok))$$),
          'checkin_sem_matricula', 'com a matrícula trancada, o check-in é recusado');
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select public.destrancar_matricula('fe100000-0000-4000-8000-000000000501');
select public.__como('fe100000-0000-4000-8000-0000000000c1');
select isnt(public.fazer_checkin('fe100000-0000-4000-8000-0000000003a1', (select tok from t_tok)), null,
            'destrancada, o check-in volta a valer');
reset role;

-- ---------------------------------------------------------------------
-- 6. Fronteiras, trancada encerrada e as recusas que faltavam
--   M7 trancada do aluno 5 (pendente); M8 ativa do aluno 6 com fim hoje e
--   quatro pendentes (ontem, hoje, hoje + 5, hoje + 6); M9 trancada do
--   aluno 7 (inativo) com fim ontem; M10 trancada na academia suspensa.
-- ---------------------------------------------------------------------
insert into public.alunos (id, academia_id, nome, status) values
  ('fe100000-0000-4000-8000-0000000001a5', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 5', 'pendente'),
  ('fe100000-0000-4000-8000-0000000001a6', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 6', 'ativo'),
  ('fe100000-0000-4000-8000-0000000001a7', 'fe100000-0000-4000-8000-00000000000a', 'Aluno 7', 'inativo'),
  ('fe100000-0000-4000-8000-0000000001c2', 'fe100000-0000-4000-8000-00000000000c', 'Aluno C2', 'ativo');
insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, origem, data_inicio, data_fim, dia_vencimento) values
  ('fe100000-0000-4000-8000-000000000507', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a5', null,
   'trancada', 'recepcao', (select hoje from t_d) - 60, null, null),
  ('fe100000-0000-4000-8000-000000000508', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a6', 'fe100000-0000-4000-8000-0000000004a1',
   'ativa', 'recepcao', (select hoje from t_d) - 60, (select hoje from t_d), 10),
  ('fe100000-0000-4000-8000-000000000509', 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a7', null,
   'trancada', 'recepcao', (select hoje from t_d) - 60, (select hoje from t_d) - 1, null),
  ('fe100000-0000-4000-8000-000000000510', 'fe100000-0000-4000-8000-00000000000c', 'fe100000-0000-4000-8000-0000000001c2', null,
   'trancada', 'recepcao', (select hoje from t_d) - 60, null, null);
insert into public.cobrancas (academia_id, aluno_id, matricula_id, valor, vencimento)
select 'fe100000-0000-4000-8000-00000000000a', 'fe100000-0000-4000-8000-0000000001a6', 'fe100000-0000-4000-8000-000000000508',
       150, (select hoje from t_d) + d
from unnest(array[-1, 0, 5, 6]) d;

set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a2');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000507')$$),
          'sem_permissao', 'professor não destranca');
select public.__como('fe100000-0000-4000-8000-0000000000a3');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000507')$$),
          'sem_permissao', 'totem não destranca');
select public.__como('fe100000-0000-4000-8000-0000000000d1');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000510')$$),
          'sem_permissao', 'academia suspensa: recepção não destranca');
reset role;
select is((select string_agg(status, ',' order by id) from public.matriculas
            where id in ('fe100000-0000-4000-8000-000000000507', 'fe100000-0000-4000-8000-000000000510')),
          'trancada,trancada', 'as recusas não destrancaram nada');
select is((select status from public.alunos where id = 'fe100000-0000-4000-8000-0000000001a5'), 'pendente',
          'nem reativaram o aluno');

set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
-- Fim hoje ainda está em andamento; conta a pendente de hoje, não a de ontem.
select is(public.trancar_matricula('fe100000-0000-4000-8000-000000000508'), 3,
          'trancar com fim hoje é aceito e conta as pendentes de hoje em diante (hoje inclusive)');
reset role;
select is((select status || '|' || data_fim from public.matriculas where id = 'fe100000-0000-4000-8000-000000000508'),
          'trancada|' || (select hoje from t_d), 'trancada, com o fim preservado');
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.encerrar_matricula('fe100000-0000-4000-8000-000000000508', (select hoje from t_d) + 5), 1,
          'trancada também encerra; a pendente no dia do fim não conta, a do dia seguinte sim');
reset role;
select is((select status || '|' || data_fim from public.matriculas where id = 'fe100000-0000-4000-8000-000000000508'),
          'trancada|' || ((select hoje from t_d) + 5), 'encerrar a trancada muda o fim e mantém trancada');
set local role authenticated;
select public.__como('fe100000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000509')$$),
          'matricula_nao_trancada', 'trancada que já terminou não destranca');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000503')$$),
          'matricula_nao_trancada', 'pendente não destranca');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000504')$$),
          'matricula_nao_trancada', 'cancelada não destranca');
select is(public.__hint_de($$select public.trancar_matricula('fe100000-0000-4000-8000-000000000504')$$),
          'matricula_nao_ativa', 'cancelada não tranca');
select is(public.__hint_de($$select public.destrancar_matricula('fe100000-0000-4000-8000-000000000507')$$),
          'sem erro', 'recepção destranca a do aluno pendente');
reset role;
select is((select status from public.alunos where id = 'fe100000-0000-4000-8000-0000000001a5'), 'ativo',
          'e o aluno pendente fica ativo');
select is((select m.status || '|' || a.status from public.matriculas m join public.alunos a on a.id = m.aluno_id
            where m.id = 'fe100000-0000-4000-8000-000000000509'), 'trancada|inativo',
          'a trancada encerrada continua como estava, e o aluno dela também');

select * from finish();
rollback;
