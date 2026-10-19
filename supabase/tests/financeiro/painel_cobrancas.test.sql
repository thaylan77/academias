-- Painel: cobranças (issue #29). O que a tela promete, conferido no banco:
-- professor não lê nem mexe no financeiro (rota direta incluída); outra
-- academia não alcança; academia suspensa lê, mas não baixa, cancela nem
-- gera; cobrança emitida no gateway não tem baixa nem cancelamento manual.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function public.__erro_de(p_sql text)
returns jsonb
language plpgsql
as $$
begin
  execute p_sql;
  return jsonb_build_object('sqlstate', 'sem erro');
exception when others then
  return jsonb_build_object('sqlstate', sqlstate, 'mensagem', sqlerrm);
end
$$;
grant execute on function public.__erro_de(text) to authenticated;

create function public.__falha(p_sql text)
returns boolean
language sql
as $$ select public.__erro_de(p_sql) ->> 'sqlstate' <> 'sem erro' $$;
grant execute on function public.__falha(text) to authenticated;

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

insert into auth.users (id, email) values
  ('fe000000-0000-4000-8000-0000000000a1', 'professor-a@cob.test'),
  ('fe000000-0000-4000-8000-0000000000a2', 'recepcao-a@cob.test'),
  ('fe000000-0000-4000-8000-0000000000b1', 'dono-b@cob.test'),
  ('fe000000-0000-4000-8000-0000000000c1', 'recepcao-c@cob.test');

insert into public.academias (id, nome, slug, status, fuso) values
  ('fe000000-0000-4000-8000-00000000000a', 'Cob A', 'cob-painel-a', 'ativa', 'America/Fortaleza'),
  ('fe000000-0000-4000-8000-00000000000b', 'Cob B', 'cob-painel-b', 'ativa', 'America/Fortaleza'),
  ('fe000000-0000-4000-8000-00000000000c', 'Cob C (suspensa)', 'cob-painel-c', 'suspensa', 'America/Fortaleza');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe000000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-0000000000a1', 'professor'),
  ('fe000000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-0000000000a2', 'recepcao'),
  ('fe000000-0000-4000-8000-00000000000b', 'fe000000-0000-4000-8000-0000000000b1', 'dono'),
  ('fe000000-0000-4000-8000-00000000000c', 'fe000000-0000-4000-8000-0000000000c1', 'recepcao');

insert into public.planos (id, academia_id, nome, valor) values
  ('fe000000-0000-4000-8000-0000000004a1', 'fe000000-0000-4000-8000-00000000000a', 'Mensal', 150);

insert into public.alunos (id, academia_id, nome) values
  ('fe000000-0000-4000-8000-0000000001a1', 'fe000000-0000-4000-8000-00000000000a', 'Aluno A'),
  ('fe000000-0000-4000-8000-0000000001c1', 'fe000000-0000-4000-8000-00000000000c', 'Aluno C');

insert into public.matriculas (id, academia_id, aluno_id, plano_id, status, data_inicio, dia_vencimento) values
  ('fe000000-0000-4000-8000-0000000005a1', 'fe000000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-0000000001a1',
   'fe000000-0000-4000-8000-0000000004a1', 'ativa', current_date, 10);

-- Conta do gateway só para a cobrança emitida (o par gateway_id e
-- gateway_conta_id é obrigatório).
insert into public.gateway_contas (id, academia_id, gateway, ambiente, conta_externa_id, api_key_secret_id, webhook_token_hash) values
  ('fe000000-0000-4000-8000-0000000007a1', 'fe000000-0000-4000-8000-00000000000a', 'asaas', 'sandbox', 'conta-teste',
   gen_random_uuid(), 'hash-painel-cobrancas');

-- c1: pendente vencida, nunca emitida; c2: pendente emitida no gateway; c3: paga.
insert into public.cobrancas (id, academia_id, aluno_id, valor, vencimento, status, gateway_id, gateway_conta_id, pago_em) values
  ('fe000000-0000-4000-8000-0000000006a1', 'fe000000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-0000000001a1', 150, current_date - 5, 'pendente', null, null, null),
  ('fe000000-0000-4000-8000-0000000006a2', 'fe000000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-0000000001a1', 150, current_date + 5, 'pendente', 'pay_123', 'fe000000-0000-4000-8000-0000000007a1', null),
  ('fe000000-0000-4000-8000-0000000006a3', 'fe000000-0000-4000-8000-00000000000a', 'fe000000-0000-4000-8000-0000000001a1', 150, current_date - 40, 'paga', null, null, now() - interval '35 days'),
  ('fe000000-0000-4000-8000-0000000006c1', 'fe000000-0000-4000-8000-00000000000c', 'fe000000-0000-4000-8000-0000000001c1', 120, current_date - 3, 'pendente', null, null, null);

-- ---------------------------------------------------------------------
-- Professor de A: nada do financeiro
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe000000-0000-4000-8000-0000000000a1');
select is((select count(*)::int from public.cobrancas), 0, 'professor não lê cobranças');
select is((select count(*)::int from public.vw_inadimplentes), 0, 'professor não lê inadimplentes');
select ok(public.__falha($$select public.baixar_cobranca_manual('fe000000-0000-4000-8000-0000000006a1', 'pix')$$),
          'professor não dá baixa');
select ok(public.__falha($$select public.cancelar_cobranca('fe000000-0000-4000-8000-0000000006a1')$$),
          'professor não cancela');
select ok(public.__falha($$select public.gerar_cobrancas_matricula('fe000000-0000-4000-8000-0000000005a1')$$),
          'professor não gera cobrança');
reset role;

-- ---------------------------------------------------------------------
-- Dono de B: não alcança A
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe000000-0000-4000-8000-0000000000b1');
select is((select count(*)::int from public.cobrancas where academia_id = 'fe000000-0000-4000-8000-00000000000a'), 0,
          'dono de B não lê cobranças de A');
select ok(public.__falha($$select public.baixar_cobranca_manual('fe000000-0000-4000-8000-0000000006a1', 'pix')$$),
          'dono de B não dá baixa em cobrança de A');
select ok(public.__falha($$select public.cancelar_cobranca('fe000000-0000-4000-8000-0000000006a1')$$),
          'dono de B não cancela cobrança de A');
reset role;

-- ---------------------------------------------------------------------
-- Recepção de A
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe000000-0000-4000-8000-0000000000a2');
select is((select count(*)::int from public.cobrancas), 3, 'recepção lê as cobranças da academia');
select is((select cobrancas_atrasadas::int from public.vw_inadimplentes where aluno_id = 'fe000000-0000-4000-8000-0000000001a1'), 1,
          'e vê o aluno como inadimplente (uma cobrança vencida)');
select ok(public.__falha($$select public.baixar_cobranca_manual('fe000000-0000-4000-8000-0000000006a2', 'pix')$$),
          'cobrança emitida no gateway não tem baixa manual');
select ok(public.__falha($$select public.cancelar_cobranca('fe000000-0000-4000-8000-0000000006a2')$$),
          'nem cancelamento manual');
select ok(public.__falha($$select public.cancelar_cobranca('fe000000-0000-4000-8000-0000000006a3')$$),
          'cobrança paga não se cancela');
-- Baixa com o meio-dia do dia da academia, como o front manda.
select is(public.__erro_de(format($$select public.baixar_cobranca_manual('fe000000-0000-4000-8000-0000000006a1', 'pix', %L::timestamptz, 140)$$,
            to_char(public.hoje_academia('fe000000-0000-4000-8000-00000000000a'), 'YYYY-MM-DD') || 'T12:00:00-03:00')) ->> 'sqlstate',
          'sem erro', 'recepção dá baixa na cobrança pendente nunca emitida');
reset role;
select is((select status || '|' || forma_pagamento || '|' || valor_pago || '|' || baixa_por::text from public.cobrancas
            where id = 'fe000000-0000-4000-8000-0000000006a1'),
          'paga|pix|140.00|fe000000-0000-4000-8000-0000000000a2', 'baixa grava forma, valor pago e quem deu a baixa');
select is((select (pago_em at time zone 'America/Fortaleza')::date from public.cobrancas where id = 'fe000000-0000-4000-8000-0000000006a1'),
          public.hoje_academia('fe000000-0000-4000-8000-00000000000a'), 'pago_em cai no dia da academia');
select isnt((select baixa_em from public.cobrancas where id = 'fe000000-0000-4000-8000-0000000006a1'), null, 'baixa_em registrado');

-- ---------------------------------------------------------------------
-- Academia suspensa: lê, mas não altera
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe000000-0000-4000-8000-0000000000c1');
select is((select count(*)::int from public.cobrancas), 1, 'academia suspensa lê as cobranças');
select ok(public.__falha($$select public.baixar_cobranca_manual('fe000000-0000-4000-8000-0000000006c1', 'pix')$$),
          'academia suspensa não dá baixa');
select ok(public.__falha($$select public.cancelar_cobranca('fe000000-0000-4000-8000-0000000006c1')$$),
          'academia suspensa não cancela');
reset role;

select * from finish();
rollback;
