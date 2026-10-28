-- Códigos estáveis no hint das RPCs de cobrança (issue #61; plano aprovado
-- pelo dono do projeto na sessão, por mexer no fluxo de dinheiro).
--
-- As funções são recriadas com o corpo idêntico: nenhuma regra muda e as
-- mensagens ficam as mesmas. Só ganham "using hint", para o front decidir por
-- error.hint e dizer exatamente o que houve:
--   sem_permissao          não encontrada ou sem permissão (todas);
--   cobranca_emitida       emitida no gateway (baixa e cancelamento manuais);
--   cobranca_nao_pendente  não está pendente;
--   cobranca_paga_gateway  já paga pelo gateway (baixa);
--   dados_invalidos        forma, data ou valor da baixa inválidos.
-- create or replace mantém os grants e revokes de cada função.

create or replace function public.baixar_cobranca_interna(
  p_cobranca_id uuid,
  p_user_id     uuid,
  p_forma       text default 'dinheiro',
  p_pago_em     timestamptz default now(),
  p_valor_pago  numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.membro_pode_gerir(p_user_id, v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para dar baixa' using hint = 'sem_permissao';
  end if;

  if v_cob.status = 'paga' and v_cob.baixa_em is not null then
    return;  -- repetição da mesma baixa
  end if;

  if v_cob.status = 'paga' then
    raise exception 'Esta cobrança já foi paga pelo gateway' using hint = 'cobranca_paga_gateway';
  end if;

  if not (v_cob.status = 'pendente'
          or (v_cob.status = 'cancelada' and v_cob.gateway_id is not null)) then
    raise exception 'Só é possível dar baixa em cobrança pendente' using hint = 'cobranca_nao_pendente';
  end if;

  if p_forma is null or p_forma not in ('pix', 'boleto', 'cartao', 'dinheiro', 'outro') then
    raise exception 'Forma de pagamento inválida' using hint = 'dados_invalidos';
  end if;

  if p_pago_em is null or p_pago_em > now() + interval '1 day' then
    raise exception 'Data de pagamento inválida' using hint = 'dados_invalidos';
  end if;

  if coalesce(p_valor_pago, v_cob.valor) <= 0 then
    raise exception 'Valor pago inválido' using hint = 'dados_invalidos';
  end if;

  update public.cobrancas
     set status          = 'paga',
         pago_em         = p_pago_em,
         valor_pago      = coalesce(p_valor_pago, v_cob.valor),
         forma_pagamento = p_forma,
         baixa_por       = p_user_id,
         baixa_em        = now()
   where id = p_cobranca_id;
end
$$;

create or replace function public.baixar_cobranca_manual(
  p_cobranca_id uuid,
  p_forma       text default 'dinheiro',
  p_pago_em     timestamptz default now(),
  p_valor_pago  numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.pode_gerir(v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para dar baixa' using hint = 'sem_permissao';
  end if;

  if v_cob.gateway_id is not null or v_cob.emissao_iniciada_em is not null then
    raise exception 'Cobrança emitida no gateway: a baixa precisa cancelar a cobrança lá primeiro' using hint = 'cobranca_emitida';
  end if;

  if v_cob.status <> 'pendente' then
    raise exception 'Só é possível dar baixa em cobrança pendente' using hint = 'cobranca_nao_pendente';
  end if;

  perform public.baixar_cobranca_interna(p_cobranca_id, auth.uid(), p_forma, p_pago_em, p_valor_pago);
end
$$;

create or replace function public.cancelar_cobranca_interna(p_cobranca_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.membro_pode_gerir(p_user_id, v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para cancelar' using hint = 'sem_permissao';
  end if;

  if v_cob.status = 'cancelada' then
    return;
  end if;

  if v_cob.status <> 'pendente' then
    raise exception 'Só é possível cancelar cobrança pendente' using hint = 'cobranca_nao_pendente';
  end if;

  update public.cobrancas set status = 'cancelada' where id = p_cobranca_id;
end
$$;

create or replace function public.cancelar_cobranca(p_cobranca_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cob public.cobrancas;
begin
  select * into v_cob from public.cobrancas where id = p_cobranca_id for update;
  if not found
     or not public.pode_gerir(v_cob.academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Cobrança não encontrada ou sem permissão para cancelar' using hint = 'sem_permissao';
  end if;

  if v_cob.gateway_id is not null or v_cob.emissao_iniciada_em is not null then
    raise exception 'Cobrança emitida no gateway: o cancelamento precisa acontecer lá primeiro' using hint = 'cobranca_emitida';
  end if;

  perform public.cancelar_cobranca_interna(p_cobranca_id, auth.uid());
end
$$;

create or replace function public.gerar_cobrancas_matricula(p_matricula_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia_id uuid;
begin
  select academia_id into v_academia_id from public.matriculas where id = p_matricula_id;
  if not found
     or not public.pode_gerir(v_academia_id, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão' using hint = 'sem_permissao';
  end if;

  return public.gerar_cobrancas(v_academia_id, p_matricula_id);
end
$$;
