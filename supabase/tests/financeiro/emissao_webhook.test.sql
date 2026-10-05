-- Emissão no gateway e webhook: isolamento entre academias, reserva com
-- tentativa, retomada concorrente, adoção por externalReference e divergência.
-- As funções *_interna e aplicar_pagamento_gateway rodam aqui como o dono do
-- banco, no lugar do service_role das Edge Functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Devolve o hint do erro que o comando levanta (código estável para a Edge Function).
create function pg_temp.hint_de(p_sql text)
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

-- ---------------------------------------------------------------------
-- Fixtures
--   Academia A: dono a1, recepção a2. Cobranças c1, c2, c3.
--   Academia B: dono b1. Cobranças d1 (emitida) e d2 (só reservada).
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-0000000000a1', 'dono-a@fin.test'),
  ('f1000000-0000-4000-8000-0000000000a2', 'recepcao-a@fin.test'),
  ('f1000000-0000-4000-8000-0000000000b1', 'dono-b@fin.test');

insert into public.academias (id, nome, slug, status) values
  ('f1000000-0000-4000-8000-00000000000a', 'Financeiro A', 'fin-teste-a', 'ativa'),
  ('f1000000-0000-4000-8000-00000000000b', 'Financeiro B', 'fin-teste-b', 'ativa');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1', 'dono'),
  ('f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a2', 'recepcao'),
  ('f1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000000b1', 'dono');

insert into public.alunos (id, academia_id, nome) values
  ('f1000000-0000-4000-8000-0000000001a1', 'f1000000-0000-4000-8000-00000000000a', 'Aluno A'),
  ('f1000000-0000-4000-8000-0000000001b1', 'f1000000-0000-4000-8000-00000000000b', 'Aluno B');

insert into public.cobrancas (id, academia_id, aluno_id, valor, vencimento) values
  ('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000001a1', 100, current_date + 10),
  ('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000001a1', 100, current_date + 10),
  ('f1000000-0000-4000-8000-0000000000c3', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000001a1', 100, current_date + 10),
  ('f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000001b1', 100, current_date + 10),
  ('f1000000-0000-4000-8000-0000000000d2', 'f1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000001b1', 100, current_date + 10);

create temp table t_contas (nome text primary key, id uuid not null);
create temp table t_res (nome text primary key, r jsonb not null);   -- respostas de reservar_emissao_interna

insert into t_contas
select 'A1', public.gateway_salvar_conta(
  'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1',
  'asaas', 'sandbox', 'acc-a1', 'chave-a1', 'hash-token-a1');

insert into t_contas
select 'B', public.gateway_salvar_conta(
  'f1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000000b1',
  'asaas', 'sandbox', 'acc-b', 'chave-b', 'hash-token-b');

-- B emite d1 e deixa d2 só com a reserva
do $$
declare
  v_b uuid := (select id from t_contas where nome = 'B');
  v_r jsonb;
begin
  v_r := public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000b1', v_b);
  perform public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000d1', (v_r ->> 'tentativa')::uuid, v_b, 'pay_b1', 'https://gateway.test/b1');
  perform public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000d2', 'f1000000-0000-4000-8000-0000000000b1', v_b);
end
$$;

-- ---------------------------------------------------------------------
-- 1. Token da academia A com id / externalReference de cobrança da B
-- ---------------------------------------------------------------------
select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-1', 'pay_b1',
    'f1000000-0000-4000-8000-0000000000d1', 'paga', now(), 100, 'pix'),
  'ignorado', 'Token de A com gateway_id e referência de cobrança emitida de B: ignorado');

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-2', 'pay_qualquer',
    'f1000000-0000-4000-8000-0000000000d2', 'paga', now(), 100, 'pix'),
  'ignorado', 'Token de A com externalReference de cobrança reservada de B: ignorado');

select is((select status from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000d1'),
  'pendente', 'Cobrança emitida de B continua pendente');
select is((select pago_em from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000d1'),
  null, 'Cobrança emitida de B sem pago_em');
select is((select gateway_id from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000d2'),
  null, 'Cobrança reservada de B não foi adotada pela conta de A');
select is((select count(*) from public.gateway_eventos
            where gateway_conta_id = (select id from t_contas where nome = 'A1') and cobranca_id is not null),
  0::bigint, 'Nenhum evento da conta de A ficou ligado a cobrança');

-- ---------------------------------------------------------------------
-- 2. Baixa manual, cancelamento e ajuste de valor durante a reserva
-- ---------------------------------------------------------------------
insert into t_res
select 'c1-worker1', public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1',
  'f1000000-0000-4000-8000-0000000000a2', (select id from t_contas where nome = 'A1'));
insert into t_res
select 'c1-concorrente', public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1',
  'f1000000-0000-4000-8000-0000000000a2', (select id from t_contas where nome = 'A1'));

select is((select r ->> 'estado' from t_res where nome = 'c1-worker1'), 'reservada', 'Recepção reserva a emissão');
select isnt((select r ->> 'tentativa' from t_res where nome = 'c1-worker1'), null, 'A reserva devolve a tentativa');
select is((select r ->> 'estado' from t_res where nome = 'c1-concorrente'), 'em_andamento', 'Segunda reserva em seguida: em andamento');
select is((select r ->> 'tentativa' from t_res where nome = 'c1-concorrente'), null, 'Quem não reservou não recebe a tentativa');

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-0000000000a2';
set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

select throws_like(
  $$select public.baixar_cobranca_manual('f1000000-0000-4000-8000-0000000000c1')$$,
  '%emitida no gateway%', 'Baixa manual durante a reserva é recusada');
select throws_like(
  $$select public.cancelar_cobranca('f1000000-0000-4000-8000-0000000000c1')$$,
  '%emitida no gateway%', 'Cancelamento durante a reserva é recusado');
select throws_like(
  $$update public.cobrancas set valor = 50 where id = 'f1000000-0000-4000-8000-0000000000c1'$$,
  '%não podem mudar%', 'Valor não muda durante a reserva');
select throws_ok(
  $$select public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-0000000000a2', gen_random_uuid())$$,
  '42501'::char(5), null::text, 'authenticated não executa função *_interna');
select throws_ok(
  $$select public.aplicar_pagamento_gateway(gen_random_uuid(), 'x', 'y', null, 'paga')$$,
  '42501'::char(5), null::text, 'authenticated não executa aplicar_pagamento_gateway');

reset role;

select is((select status from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'pendente', 'Cobrança reservada segue pendente');

-- ---------------------------------------------------------------------
-- 3. Timeout na emissão: a reserva fica
-- ---------------------------------------------------------------------
select throws_like(
  format($$select public.liberar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', %L, '  ')$$,
         (select r ->> 'tentativa' from t_res where nome = 'c1-worker1')),
  '%recusa do gateway%', 'Sem recusa explícita do gateway a reserva não é liberada');
select isnt((select emissao_iniciada_em from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  null, 'Reserva mantida depois do timeout');

-- ---------------------------------------------------------------------
-- 4. Retomada concorrente: o worker 1 trava; a reserva envelhece e o
--    worker 2 assume. O worker 1 volta atrasado com a tentativa antiga.
-- ---------------------------------------------------------------------
update public.cobrancas set emissao_iniciada_em = now() - interval '10 minutes'
 where id = 'f1000000-0000-4000-8000-0000000000c1';

insert into t_res
select 'c1-worker2', public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1',
  'f1000000-0000-4000-8000-0000000000a2', (select id from t_contas where nome = 'A1'));

select is((select r ->> 'estado' from t_res where nome = 'c1-worker2'), 'orfa', 'Reserva antiga volta como órfã');
select is((select (r ->> 'gateway_conta_id')::uuid from t_res where nome = 'c1-worker2'),
  (select id from t_contas where nome = 'A1'), 'Órfã devolve a conta da reserva, para consultar por externalReference');
select isnt((select r ->> 'tentativa' from t_res where nome = 'c1-worker2'),
  (select r ->> 'tentativa' from t_res where nome = 'c1-worker1'), 'Quem assume a órfã recebe uma tentativa nova');

select is(pg_temp.hint_de(format(
    $$select public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', %L, %L, 'pay_worker1', 'https://gateway.test/w1')$$,
    (select r ->> 'tentativa' from t_res where nome = 'c1-worker1'), (select id from t_contas where nome = 'A1'))),
  'reserva_substituida', 'Registro com tentativa antiga é recusado');
select is(pg_temp.hint_de(format(
    $$select public.liberar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', %L, 'CPF inválido')$$,
    (select r ->> 'tentativa' from t_res where nome = 'c1-worker1'))),
  'reserva_substituida', 'Liberação com tentativa antiga é recusada');
select is(pg_temp.hint_de(format(
    $$select public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000a2', %L, %L)$$,
    (select id from t_contas where nome = 'A1'), (select r ->> 'tentativa' from t_res where nome = 'c1-worker1'))),
  'reserva_substituida', 'Retomada atrasada depois de outro worker renovar é recusada');
select is((select gateway_id from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  null, 'Nada do worker atrasado foi gravado');

-- o worker 2 conferiu o gateway, não achou nada e renova com a tentativa vigente
insert into t_res
select 'c1-worker2-renovada', public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1',
  'f1000000-0000-4000-8000-0000000000a2', (select id from t_contas where nome = 'A1'),
  (select (r ->> 'tentativa')::uuid from t_res where nome = 'c1-worker2'));

select is((select r ->> 'estado' from t_res where nome = 'c1-worker2-renovada'), 'reservada',
  'Renovação com a tentativa vigente é aceita');
select is(pg_temp.hint_de(format(
    $$select public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', %L, %L, 'pay_velho', 'https://gateway.test/velho')$$,
    (select r ->> 'tentativa' from t_res where nome = 'c1-worker2'), (select id from t_contas where nome = 'A1'))),
  'reserva_substituida', 'A tentativa anterior à renovação deixa de valer');

-- ---------------------------------------------------------------------
-- 5. Webhook chega antes do registro: adota por externalReference e o
--    registro seguinte só completa o link
-- ---------------------------------------------------------------------
select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-3', 'pay_c1',
    'f1000000-0000-4000-8000-0000000000c1', 'pendente'),
  'sem_mudanca', 'Webhook de cobrança pendente com externalReference: sem mudança de status');
select is((select gateway_id from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'pay_c1', 'Mas a cobrança reservada foi adotada');
select is((select link_pagamento from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  null, 'Adotada pelo webhook ainda sem link');

select lives_ok(format(
    $$select public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', %L, %L, 'pay_c1', 'https://gateway.test/c1')$$,
    (select r ->> 'tentativa' from t_res where nome = 'c1-worker2-renovada'), (select id from t_contas where nome = 'A1')),
  'Registro da mesma cobrança do gateway depois da adoção é aceito');
select is((select link_pagamento from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'https://gateway.test/c1', 'O registro completou o link que faltava');
select is((select status from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'pendente', 'Sem tocar no status');
select is(pg_temp.hint_de(format(
    $$select public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', %L, %L, 'pay_outro', 'https://gateway.test/outro')$$,
    (select r ->> 'tentativa' from t_res where nome = 'c1-worker2-renovada'), (select id from t_contas where nome = 'A1'))),
  'reserva_substituida', 'Outro gateway_id para cobrança já emitida é recusado');

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-4', 'pay_c1',
    null, 'paga', now(), 100, 'pix'),
  'aplicado', 'Pagamento aplicado');
select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-4', 'pay_c1',
    null, 'paga', now(), 100, 'pix'),
  'sem_mudanca', 'Mesmo evento de novo: sem mudança');
select is((select count(*) from public.gateway_eventos
            where gateway_conta_id = (select id from t_contas where nome = 'A1') and evento_id = 'ev-4'),
  1::bigint, 'Evento repetido não duplica linha');

do $$
begin
  perform public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', null,
            (select id from t_contas where nome = 'A1'), 'pay_c1', 'https://gateway.test/c1-de-novo');
end
$$;
select is((select status || ' ' || link_pagamento from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'paga https://gateway.test/c1', 'Registro repetido depois do pagamento não muda status nem link');

-- ---------------------------------------------------------------------
-- 6. Troca de conta: A1 fica inativa, A2 passa a emitir
-- ---------------------------------------------------------------------
insert into t_contas
select 'A2', public.gateway_salvar_conta(
  'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1',
  'asaas', 'sandbox', 'acc-a2', 'chave-a2', 'hash-token-a2');

select throws_like(
  format($$select public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-0000000000a2', %L)$$,
         (select id from t_contas where nome = 'A1')),
  '%Conecte uma conta de gateway%', 'Conta inativa não recebe reserva nova');

insert into t_res
select 'c2', public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c2',
  'f1000000-0000-4000-8000-0000000000a2', (select id from t_contas where nome = 'A2'));

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-5', 'pay_c2',
    'f1000000-0000-4000-8000-0000000000c2', 'paga', now(), 100, 'pix'),
  'ignorado', 'Reserva para outra conta da mesma academia não é adotada');
select is((select gateway_id from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c2'),
  null, 'Cobrança reservada em A2 não ganhou gateway_id pelo token de A1');

-- recusa explícita do gateway libera e guarda o motivo
select lives_ok(format(
    $$select public.liberar_emissao_interna('f1000000-0000-4000-8000-0000000000c2', %L, 'CPF do pagador inválido')$$,
    (select r ->> 'tentativa' from t_res where nome = 'c2')),
  'Recusa explícita, com a tentativa vigente, libera a reserva');
select is((select emissao_iniciada_em is null and emissao_tentativa is null
             from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c2'),
  true, 'Reserva liberada');
select is((select emissao_recusa from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c2'),
  'CPF do pagador inválido', 'Motivo da recusa fica na cobrança');

-- ---------------------------------------------------------------------
-- 7. Baixa manual de cobrança emitida + pagamento em duplicidade
-- ---------------------------------------------------------------------
do $$
declare
  v_a2 uuid := (select id from t_contas where nome = 'A2');
  v_r  jsonb;
begin
  v_r := public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c3', 'f1000000-0000-4000-8000-0000000000a2', v_a2);
  perform public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c3', (v_r ->> 'tentativa')::uuid, v_a2, 'pay_c3', 'https://gateway.test/c3');
  perform public.baixar_cobranca_interna('f1000000-0000-4000-8000-0000000000c3', 'f1000000-0000-4000-8000-0000000000a2', 'dinheiro');
end
$$;

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A2'), 'ev-6', 'pay_c3', null, 'paga', now(), 100, 'pix'),
  'divergente', 'Pagamento no gateway depois da baixa manual: divergente');
select is((select divergencia from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c3'),
  'pagamento_duplicado', 'Divergência gravada como código');

select * from finish();
rollback;
