-- Painel: alunos (issue #26). Códigos estáveis no hint para os erros que a
-- tela de alunos trata. Nenhuma regra muda: só os erros ganham código.

-- 1. CPF repetido na academia. O índice único alunos_cpf_por_academia
--    continua sendo a garantia; este gatilho só dá o código cpf_duplicado
--    (gravação direta na tabela devolveria só o 23505 do índice, sem hint).
--    Em duas gravações simultâneas do mesmo CPF, a segunda ainda pode cair
--    no índice sem hint: o front trata como erro genérico.
--
--    security invoker de propósito: o gatilho roda antes da política de
--    insert, e a busca precisa respeitar o RLS de quem grava. Como definer,
--    a recepção de outra academia descobriria que um CPF existe aqui ao
--    tentar gravar (recebendo cpf_duplicado em vez da recusa do RLS).
--    matricula_online, que é definer, continua enxergando a academia toda.
create or replace function public.alunos_cpf_unico()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.cpf is not null and exists (
    select 1
      from public.alunos a
     where a.academia_id = new.academia_id
       and a.cpf = new.cpf
       and a.id <> new.id
  ) then
    raise exception 'Já existe um aluno com esse CPF nesta academia'
      using hint = 'cpf_duplicado';
  end if;
  return new;
end
$$;

create trigger alunos_cpf_unico
  before insert or update of cpf on public.alunos
  for each row execute function public.alunos_cpf_unico();

revoke execute on function public.alunos_cpf_unico() from public, anon, authenticated;

-- 2. Cadastro anonimizado: mesmo gatilho, com o código aluno_anonimizado, e
--    agora security definer. Corrige um defeito de 20261005120000: o gatilho
--    rodava com o papel de quem grava e chama aluno_sem_dados_pessoais, cuja
--    execução é revogada de authenticated. O Postgres confere essa permissão
--    ao preparar a expressão, mesmo quando o "and" nem chegaria a chamá-la,
--    então todo update de aluno pela equipe falhava com "permission denied
--    for function aluno_sem_dados_pessoais". Como definer, a função roda com
--    o dono; o gatilho só lê OLD e NEW, sem nada vindo de quem chama.
create or replace function public.alunos_bloqueia_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonimizado_em is not null
     and not (new.anonimizado_em is not null and public.aluno_sem_dados_pessoais(new)) then
    raise exception 'Cadastro anonimizado não pode ser alterado'
      using hint = 'aluno_anonimizado';
  end if;
  return new;
end
$$;

-- Já revogada de public, anon e authenticated em 20261005120000 (o create or
-- replace mantém); repetido aqui porque agora a função é definer.
revoke execute on function public.alunos_bloqueia_anonimizado() from public, anon, authenticated;

-- 3. anonimizar_aluno: corpo idêntico ao de 20261005120000, com os códigos
--    sem_permissao e anonimizar_cobranca_pendente. Continua usando tem_papel
--    (dono, admin) sem checar a assinatura: é a única exceção do AGENTS.md.
--    create or replace mantém os grants.
create or replace function public.anonimizar_aluno(p_aluno_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aluno public.alunos;
begin
  select * into v_aluno from public.alunos where id = p_aluno_id for update;
  if not found
     or not public.tem_papel(v_aluno.academia_id, array['dono', 'admin']) then
    raise exception 'Aluno não encontrado ou sem permissão para anonimizar'
      using hint = 'sem_permissao';
  end if;

  -- só está pronto se o marcador existe E os dados pessoais já saíram
  if v_aluno.anonimizado_em is not null and public.aluno_sem_dados_pessoais(v_aluno) then
    return;
  end if;

  if exists (
    select 1 from public.cobrancas
    where academia_id = v_aluno.academia_id and aluno_id = p_aluno_id and status = 'pendente'
  ) then
    raise exception 'Cancele ou dê baixa nas cobranças pendentes antes de anonimizar'
      using hint = 'anonimizar_cobranca_pendente';
  end if;

  update public.matriculas
     set status = 'cancelada',
         data_fim = public.hoje_academia(v_aluno.academia_id)
   where academia_id = v_aluno.academia_id
     and aluno_id = p_aluno_id
     and status <> 'cancelada';

  delete from public.gateway_clientes
   where academia_id = v_aluno.academia_id and aluno_id = p_aluno_id;

  update public.gateway_eventos e
     set payload = '{}'::jsonb
    from public.cobrancas c
   where c.academia_id = v_aluno.academia_id
     and c.aluno_id = p_aluno_id
     and e.academia_id = c.academia_id
     and e.cobranca_id = c.id;

  update public.alunos
     set nome                 = 'Aluno anonimizado',
         cpf                  = null,
         data_nascimento      = null,
         telefone             = null,
         email                = null,
         foto_url             = null,
         responsavel_nome     = null,
         responsavel_cpf      = null,
         responsavel_telefone = null,
         contato_emergencia   = null,
         observacoes_medicas  = null,
         user_id              = null,
         status               = 'inativo',
         anonimizado_em       = coalesce(anonimizado_em, now())
   where id = p_aluno_id;

  -- o login perde o papel de aluno se não tiver outro aluno na academia
  if v_aluno.user_id is not null then
    delete from public.membros_academia m
     where m.academia_id = v_aluno.academia_id
       and m.user_id = v_aluno.user_id
       and m.papel = 'aluno'
       and not exists (
         select 1 from public.alunos a
         where a.academia_id = v_aluno.academia_id and a.user_id = v_aluno.user_id
       );
  end if;
end
$$;
