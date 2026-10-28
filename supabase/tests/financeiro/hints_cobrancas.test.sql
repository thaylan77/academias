-- Códigos no hint das RPCs de cobrança (issue #61): cada recusa de baixa,
-- cancelamento e geração manual leva um código estável, e a mensagem continua
-- a mesma. Academias A e B; a suspensa C.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Hint da recusa (ou 'sem erro'), para comparar com o código.
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

insert into auth.users (id, email) values
  ('fe600000-0000-4000-8000-0000000000a1', 'recepcao-a@hints.test'),
  ('fe600000-0000-4000-8000-0000000000a2', 'professor-a@hints.test'),
  ('fe600000-0000-4000-8000-0000000000b1', 'dono-b@hints.test'),
  ('fe600000-0000-4000-8000-0000000000c1', 'dono-c@hints.test');

insert into public.academias (id, nome, slug, status, fuso) values
  ('fe600000-0000-4000-8000-00000000000a', 'Hints A', 'hints-a', 'ativa', 'America/Fortaleza'),
  ('fe600000-0000-4000-8000-00000000000b', 'Hints B', 'hints-b', 'ativa', 'America/Fortaleza'),
  ('fe600000-0000-4000-8000-00000000000c', 'Hints C (suspensa)', 'hints-c', 'suspensa', 'America/Fortaleza');

insert into public.membros_academia (academia_id, user_id, papel) values
  ('fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000000a1', 'recepcao'),
  ('fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000000a2', 'professor'),
  ('fe600000-0000-4000-8000-00000000000b', 'fe600000-0000-4000-8000-0000000000b1', 'dono'),
  ('fe600000-0000-4000-8000-00000000000c', 'fe600000-0000-4000-8000-0000000000c1', 'dono');

insert into public.alunos (id, academia_id, nome) values
  ('fe600000-0000-4000-8000-0000000001a1', 'fe600000-0000-4000-8000-00000000000a', 'Aluno A'),
  ('fe600000-0000-4000-8000-0000000001c1', 'fe600000-0000-4000-8000-00000000000c', 'Aluno C');

insert into public.matriculas (id, academia_id, aluno_id, status, data_inicio) values
  ('fe600000-0000-4000-8000-0000000005a1', 'fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000001a1', 'ativa', current_date),
  ('fe600000-0000-4000-8000-0000000005c1', 'fe600000-0000-4000-8000-00000000000c', 'fe600000-0000-4000-8000-0000000001c1', 'ativa', current_date);

insert into public.gateway_contas (id, academia_id, gateway, ambiente, conta_externa_id, api_key_secret_id, webhook_token_hash) values
  ('fe600000-0000-4000-8000-0000000007a1', 'fe600000-0000-4000-8000-00000000000a', 'asaas', 'sandbox', 'conta-hints',
   gen_random_uuid(), 'hash-hints-cobrancas');

-- a1 pendente; a2 emitida no gateway; a3 paga pelo gateway (sem baixa manual);
-- a4 cancelada; a5 com a emissão reservada (ainda sem gateway_id); c1 pendente
-- na suspensa.
insert into public.cobrancas (id, academia_id, aluno_id, valor, vencimento, status, gateway_id, gateway_conta_id, pago_em) values
  ('fe600000-0000-4000-8000-0000000006a1', 'fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000001a1', 150, current_date + 5, 'pendente', null, null, null),
  ('fe600000-0000-4000-8000-0000000006a2', 'fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000001a1', 150, current_date + 5, 'pendente', 'pay_hints', 'fe600000-0000-4000-8000-0000000007a1', null),
  ('fe600000-0000-4000-8000-0000000006a3', 'fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000001a1', 150, current_date - 30, 'paga', null, null, now() - interval '25 days'),
  ('fe600000-0000-4000-8000-0000000006a4', 'fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000001a1', 150, current_date - 60, 'cancelada', null, null, null),
  ('fe600000-0000-4000-8000-0000000006a5', 'fe600000-0000-4000-8000-00000000000a', 'fe600000-0000-4000-8000-0000000001a1', 150, current_date + 5, 'pendente', null, null, null),
  ('fe600000-0000-4000-8000-0000000006c1', 'fe600000-0000-4000-8000-00000000000c', 'fe600000-0000-4000-8000-0000000001c1', 120, current_date + 5, 'pendente', null, null, null);
update public.cobrancas
   set emissao_iniciada_em = now(), emissao_gateway_conta_id = 'fe600000-0000-4000-8000-0000000007a1', emissao_tentativa = gen_random_uuid()
 where id = 'fe600000-0000-4000-8000-0000000006a5';

-- ---------------------------------------------------------------------
-- sem_permissao: outra academia, papel sem acesso, suspensa, inexistente
-- ---------------------------------------------------------------------
set local role authenticated;
select public.__como('fe600000-0000-4000-8000-0000000000b1');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a1', 'pix')$$),
          'sem_permissao', 'dono de B dando baixa em cobrança de A: sem_permissao');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-0000000006a1')$$),
          'sem_permissao', 'dono de B cancelando cobrança de A: sem_permissao');
select is(public.__hint_de($$select public.gerar_cobrancas_matricula('fe600000-0000-4000-8000-0000000005a1')$$),
          'sem_permissao', 'dono de B gerando para matrícula de A: sem_permissao');

select public.__como('fe600000-0000-4000-8000-0000000000a2');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a1', 'pix')$$),
          'sem_permissao', 'professor não dá baixa: sem_permissao');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-0000000006a1')$$),
          'sem_permissao', 'professor não cancela: sem_permissao');
select is(public.__hint_de($$select public.gerar_cobrancas_matricula('fe600000-0000-4000-8000-0000000005a1')$$),
          'sem_permissao', 'professor não gera: sem_permissao');

select public.__como('fe600000-0000-4000-8000-0000000000c1');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006c1', 'pix')$$),
          'sem_permissao', 'suspensa não dá baixa: sem_permissao');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-0000000006c1')$$),
          'sem_permissao', 'suspensa não cancela: sem_permissao');
select is(public.__hint_de($$select public.gerar_cobrancas_matricula('fe600000-0000-4000-8000-0000000005c1')$$),
          'sem_permissao', 'suspensa não gera: sem_permissao');

-- ---------------------------------------------------------------------
-- Recepção de A
-- ---------------------------------------------------------------------
select public.__como('fe600000-0000-4000-8000-0000000000a1');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-000000000999', 'pix')$$),
          'sem_permissao', 'cobrança inexistente: sem_permissao');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-000000000999')$$),
          'sem_permissao', 'cancelar cobrança inexistente: sem_permissao');
select is(public.__hint_de($$select public.gerar_cobrancas_matricula('fe600000-0000-4000-8000-000000000999')$$),
          'sem_permissao', 'gerar para matrícula inexistente: sem_permissao');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a5', 'pix')$$),
          'cobranca_emitida', 'baixa com a emissão reservada: cobranca_emitida');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-0000000006a5')$$),
          'cobranca_emitida', 'cancelamento com a emissão reservada: cobranca_emitida');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a4', 'pix')$$),
          'cobranca_nao_pendente', 'baixa de cancelada: cobranca_nao_pendente');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a2', 'pix')$$),
          'cobranca_emitida', 'baixa de emitida no gateway: cobranca_emitida');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-0000000006a2')$$),
          'cobranca_emitida', 'cancelamento de emitida no gateway: cobranca_emitida');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a3', 'pix')$$),
          'cobranca_nao_pendente', 'baixa de paga: cobranca_nao_pendente');
select is(public.__hint_de($$select public.cancelar_cobranca('fe600000-0000-4000-8000-0000000006a3')$$),
          'cobranca_nao_pendente', 'cancelamento de paga: cobranca_nao_pendente');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a1', 'cheque')$$),
          'dados_invalidos', 'forma inválida: dados_invalidos');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a1', 'pix', now() + interval '3 days')$$),
          'dados_invalidos', 'data no futuro: dados_invalidos');
select is(public.__hint_de($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a1', 'pix', now(), 0)$$),
          'dados_invalidos', 'valor zero: dados_invalidos');
-- A mensagem continua a mesma (o hint só se soma a ela).
select throws_ok($$select public.baixar_cobranca_manual('fe600000-0000-4000-8000-0000000006a2', 'pix')$$,
                 'P0001', 'Cobrança emitida no gateway: a baixa precisa cancelar a cobrança lá primeiro',
                 'mensagem da recusa sem mudança');
reset role;

-- ---------------------------------------------------------------------
-- Funções internas (só service_role; aqui como postgres)
-- ---------------------------------------------------------------------
select is(public.__hint_de($$select public.baixar_cobranca_interna('fe600000-0000-4000-8000-0000000006a3', 'fe600000-0000-4000-8000-0000000000a1', 'pix')$$),
          'cobranca_paga_gateway', 'baixa interna de cobrança já paga pelo gateway: cobranca_paga_gateway');
select is(public.__hint_de($$select public.baixar_cobranca_interna('fe600000-0000-4000-8000-0000000006a4', 'fe600000-0000-4000-8000-0000000000a1', 'pix')$$),
          'cobranca_nao_pendente', 'baixa interna de cancelada sem gateway: cobranca_nao_pendente');

select * from finish();
rollback;
