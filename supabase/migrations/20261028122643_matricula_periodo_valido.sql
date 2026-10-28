-- Matrícula com período invertido (issue #47; achado do Gemini no PR #45).
--
-- Uma matrícula com data_fim antes de data_inicio nunca vale (não gera
-- cobrança nem permite check-in), mas é dado inconsistente e escapa da regra
-- de matrícula duplicada (o teste de sobreposição de períodos não a vê). As
-- RPCs (criar_matricula, encerrar_matricula) já recusam; o check fecha também
-- a gravação direta na tabela.
--
-- Antes de criar o check, procura matrículas que o violariam. Se achar,
-- falha com a lista (até 50) e não corrige nada sozinha: quem aplica decide,
-- caso a caso, as datas certas (cancelar não basta: o check vale para todas)
-- e roda de novo. Mesmo padrão da migration de matrícula duplicada (#13).

do $$
declare
  v_total integer;
  v_lista text;
begin
  with invertidas as (
    select academia_id, aluno_id, id, data_inicio, data_fim,
           row_number() over (order by academia_id, aluno_id, id) as n
    from public.matriculas
    where data_fim is not null and data_fim < data_inicio
  )
  select count(*),
         string_agg(
           format('academia %s, aluno %s: matrícula %s de %s a %s', academia_id, aluno_id, id, data_inicio, data_fim),
           E'\n' order by n) filter (where n <= 50)
  into v_total, v_lista
  from invertidas;

  if v_total > 0 then
    raise exception
      'Há % matrícula(s) com a data de fim antes do início. Corrija as datas de cada uma (o check vale também para a cancelada) antes de aplicar esta migration (lista limitada a 50):%',
      v_total, E'\n' || v_lista
      using hint = 'periodo_invertido';
  end if;
end
$$;

-- Os dois caminhos que mexem nas datas sem conferir o fim (revisão do Codex no
-- PR #65), recriados com a mesma regra de antes e o período sempre válido.
-- Permissões continuam as mesmas (create or replace as preserva).

-- anonimizar_aluno: ao cancelar, o fim é hoje, ou o início se ela ainda não
-- começou (sem isso, a anonimização de quem tem matrícula futura falharia).
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
         -- Matrícula que ainda nem começou termina no próprio início: o fim nunca
         -- fica antes dele (check matriculas_periodo_valido).
         data_fim = greatest(data_inicio, public.hoje_academia(v_aluno.academia_id))
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

-- aprovar_matricula: o pedido cujo fim já passou é recusado com
-- hint = matricula_vencida.
create or replace function public.aprovar_matricula(p_matricula_id uuid, p_dia_vencimento smallint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_aluno    uuid;
  v_mat      public.matriculas;
  v_hoje     date;
begin
  -- Permissão antes da trava: quem não gere a academia não espera nem trava
  -- a linha. Inexistente ou de outra academia: a mesma resposta.
  select academia_id, aluno_id into v_academia, v_aluno from public.matriculas where id = p_matricula_id;
  if v_academia is null
     or not public.pode_gerir(v_academia, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão'
      using hint = 'sem_permissao';
  end if;

  if p_dia_vencimento is not null and p_dia_vencimento not between 1 and 28 then
    raise exception 'O dia de vencimento vai de 1 a 28' using hint = 'dados_invalidos';
  end if;

  -- Trava o aluno antes da matrícula, na mesma ordem de anonimizar_aluno
  -- (aluno, depois as matrículas dele): sem isso as duas podiam se travar
  -- mutuamente. Se a anonimização chegou antes, a matrícula já está
  -- cancelada e a aprovação é recusada logo abaixo.
  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for update;

  select * into v_mat from public.matriculas where id = p_matricula_id for update;
  if v_mat.status <> 'pendente' then
    raise exception 'Só matrícula pendente pode ser aprovada'
      using hint = 'matricula_nao_pendente';
  end if;

  -- Com plano, aprovar sem dia de vencimento deixaria a matrícula ativa sem
  -- nunca ser cobrada (gerar_cobrancas pula). A tela pede o dia.
  if v_mat.plano_id is not null and coalesce(p_dia_vencimento, v_mat.dia_vencimento) is null then
    raise exception 'Informe o dia de vencimento para aprovar a matrícula com plano'
      using hint = 'dia_vencimento_obrigatorio';
  end if;

  v_hoje := public.hoje_academia(v_academia);
  -- O início vai a no mínimo hoje: um pedido cujo fim já passou ficaria com o
  -- período invertido. Recusa com código próprio, em vez do erro do check.
  if v_mat.data_fim is not null and v_mat.data_fim < greatest(v_mat.data_inicio, v_hoje) then
    raise exception 'O período desta matrícula já terminou: corrija as datas ou cancele o pedido'
      using hint = 'matricula_vencida';
  end if;
  update public.matriculas
     set status          = 'ativa',
         data_inicio     = greatest(data_inicio, v_hoje),
         cobrar_a_partir = greatest(cobrar_a_partir, date_trunc('month', v_hoje::timestamp)::date),
         dia_vencimento  = coalesce(p_dia_vencimento, dia_vencimento)
   where id = v_mat.id;

  update public.alunos
     set status = 'ativo'
   where academia_id = v_academia and id = v_mat.aluno_id and status in ('pendente', 'inativo')
     and anonimizado_em is null;
end
$$;

alter table public.matriculas
  add constraint matriculas_periodo_valido check (data_fim is null or data_fim >= data_inicio);
