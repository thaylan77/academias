-- Emissão no gateway e webhook: isolamento entre academias, reserva,
-- adoção por externalReference e divergência.
-- As funções *_interna e aplicar_pagamento_gateway rodam aqui como o dono do
-- banco, no lugar do service_role das Edge Functions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- ---------------------------------------------------------------------
-- Fixtures
--   Academia A: dono a1, recepção a2. Cobranças c1, c2, c3.
--   Academia B: dono b1. Cobranças cb1 (emitida) e cb2 (só reservada).
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

insert into t_contas
select 'A1', public.gateway_salvar_conta(
  'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1',
  'asaas', 'sandbox', 'acc-a1', 'chave-a1', 'hash-token-a1');

insert into t_contas
select 'B', public.gateway_salvar_conta(
  'f1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-0000000000b1',
  'asaas', 'sandbox', 'acc-b', 'chave-b', 'hash-token-b');

-- B emite cb1 e deixa cb2 só com a reserva
do $$
declare
  v_b uuid := (select id from t_contas where nome = 'B');
begin
  perform public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000b1', v_b);
  perform public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000d1', v_b, 'pay_b1', 'https://gateway.test/b1');
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
select is(
  public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000a2',
    (select id from t_contas where nome = 'A1')) ->> 'estado',
  'reservada', 'Recepção reserva a emissão');
select is(
  public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000a2',
    (select id from t_contas where nome = 'A1')) ->> 'estado',
  'em_andamento', 'Segunda reserva em seguida: em andamento');

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
-- 3. Timeout na emissão: reserva mantida; webhook adota por externalReference
-- ---------------------------------------------------------------------
select throws_like(
  $$select public.liberar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', '  ')$$,
  '%recusa do gateway%', 'Sem recusa explícita do gateway a reserva não é liberada');
select isnt((select emissao_iniciada_em from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  null, 'Reserva mantida depois do timeout');

-- a reserva envelhece: a próxima tentativa precisa reconciliar antes de reemitir
update public.cobrancas set emissao_iniciada_em = now() - interval '10 minutes'
 where id = 'f1000000-0000-4000-8000-0000000000c1';

create temp table t_orfa as
select public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000a2',
         (select id from t_contas where nome = 'A1')) as r;

select is((select r ->> 'estado' from t_orfa), 'orfa', 'Reserva antiga volta como órfã');
select is((select (r ->> 'gateway_conta_id')::uuid from t_orfa), (select id from t_contas where nome = 'A1'),
  'Órfã devolve a conta da reserva, para consultar por externalReference');

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-3', 'pay_c1',
    'f1000000-0000-4000-8000-0000000000c1', 'paga', now(), 100, 'pix'),
  'aplicado', 'Webhook com externalReference adota a cobrança reservada');
select is((select gateway_id from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'pay_c1', 'Cobrança adotada ficou com o gateway_id');
select is((select status from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c1'),
  'paga', 'Cobrança adotada ficou paga');
select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-3', 'pay_c1',
    'f1000000-0000-4000-8000-0000000000c1', 'paga', now(), 100, 'pix'),
  'sem_mudanca', 'Mesmo evento de novo: sem mudança');
select is((select count(*) from public.gateway_eventos
            where gateway_conta_id = (select id from t_contas where nome = 'A1') and evento_id = 'ev-3'),
  1::bigint, 'Evento repetido não duplica linha');

-- A troca de conta: A1 fica inativa, A2 passa a emitir
insert into t_contas
select 'A2', public.gateway_salvar_conta(
  'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1',
  'asaas', 'sandbox', 'acc-a2', 'chave-a2', 'hash-token-a2');

select throws_like(
  format($$select public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-0000000000a2', %L)$$,
         (select id from t_contas where nome = 'A1')),
  '%Conecte uma conta de gateway%', 'Conta inativa não recebe reserva nova');

do $$
begin
  perform public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-0000000000a2',
            (select id from t_contas where nome = 'A2'));
end
$$;

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A1'), 'ev-4', 'pay_c2',
    'f1000000-0000-4000-8000-0000000000c2', 'paga', now(), 100, 'pix'),
  'ignorado', 'Reserva para outra conta da mesma academia não é adotada');
select is((select gateway_id from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c2'),
  null, 'Cobrança reservada em A2 não ganhou gateway_id pelo token de A1');

-- recusa explícita do gateway libera e guarda o motivo
select lives_ok(
  $$select public.liberar_emissao_interna('f1000000-0000-4000-8000-0000000000c2', 'CPF do pagador inválido')$$,
  'Recusa explícita libera a reserva');
select is((select emissao_iniciada_em from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c2'),
  null, 'Reserva liberada');
select is((select emissao_recusa from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c2'),
  'CPF do pagador inválido', 'Motivo da recusa fica na cobrança');

-- ---------------------------------------------------------------------
-- 4. Baixa manual de cobrança emitida + pagamento em duplicidade
-- ---------------------------------------------------------------------
do $$
declare
  v_a2 uuid := (select id from t_contas where nome = 'A2');
begin
  perform public.reservar_emissao_interna('f1000000-0000-4000-8000-0000000000c3', 'f1000000-0000-4000-8000-0000000000a2', v_a2);
  perform public.registrar_emissao_interna('f1000000-0000-4000-8000-0000000000c3', v_a2, 'pay_c3', 'https://gateway.test/c3');
  perform public.baixar_cobranca_interna('f1000000-0000-4000-8000-0000000000c3', 'f1000000-0000-4000-8000-0000000000a2', 'dinheiro');
end
$$;

select is(
  public.aplicar_pagamento_gateway((select id from t_contas where nome = 'A2'), 'ev-5', 'pay_c3', null, 'paga', now(), 100, 'pix'),
  'divergente', 'Pagamento no gateway depois da baixa manual: divergente');
select is((select divergencia from public.cobrancas where id = 'f1000000-0000-4000-8000-0000000000c3'),
  'pagamento_duplicado', 'Divergência gravada como código');

select * from finish();
rollback;
