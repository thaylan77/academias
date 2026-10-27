-- Encerrar, trancar e destrancar matrícula (issue #28; plano aprovado pelo
-- dono do projeto na sessão, por mexer no fluxo de cobrança).
--
-- encerrar_matricula: define (ou corrige) a data de fim. gerar_cobrancas não
--   cobra vencimento depois dela, e o check-in não vale depois dela.
-- trancar_matricula: status 'trancada'. gerar_cobrancas só cobra matrícula
--   ativa e o check-in também só aceita ativa; a trancada continua ocupando
--   a turma (docs/specs/matricula-duplicada.md).
-- destrancar_matricula: volta a 'ativa'. Os meses trancados não são cobrados
--   depois: a geração só olha a competência atual e a seguinte.
--
-- Nenhuma cobrança é cancelada aqui. encerrar e trancar devolvem quantas
-- pendentes da matrícula ficaram depois do fim (ou de hoje em diante, no
-- trancamento), e a tela avisa para a recepção decidir em Cobranças.
--
-- Mesma permissão das políticas de matrículas: dono, admin e recepção, com a
-- assinatura em dia (pode_gerir). Nenhuma política muda. As três travam o
-- aluno antes da matrícula, na ordem de anonimizar_aluno e aprovar_matricula.

create or replace function public.encerrar_matricula(p_matricula_id uuid, p_data_fim date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_aluno    uuid;
  v_mat      public.matriculas;
  v_qtd      integer;
begin
  -- Permissão antes da trava. Inexistente ou de outra academia: a mesma resposta.
  select academia_id, aluno_id into v_academia, v_aluno from public.matriculas where id = p_matricula_id;
  if v_academia is null
     or not public.pode_gerir(v_academia, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão'
      using hint = 'sem_permissao';
  end if;

  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for update;
  select * into v_mat from public.matriculas where id = p_matricula_id for update;

  if v_mat.status not in ('ativa', 'trancada') then
    raise exception 'Só matrícula ativa ou trancada pode ser encerrada'
      using hint = 'matricula_nao_encerravel';
  end if;

  if p_data_fim is null or p_data_fim < v_mat.data_inicio then
    raise exception 'A data de fim não pode ser antes do início da matrícula'
      using hint = 'dados_invalidos';
  end if;

  -- Estender o período passa pelo gatilho de duplicidade (matricula_duplicada).
  update public.matriculas set data_fim = p_data_fim where id = v_mat.id;

  select count(*)::int into v_qtd
    from public.cobrancas
   where academia_id = v_academia and matricula_id = v_mat.id
     and status = 'pendente' and vencimento > p_data_fim;
  return v_qtd;
end
$$;

create or replace function public.trancar_matricula(p_matricula_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_aluno    uuid;
  v_mat      public.matriculas;
  v_hoje     date;
  v_qtd      integer;
begin
  select academia_id, aluno_id into v_academia, v_aluno from public.matriculas where id = p_matricula_id;
  if v_academia is null
     or not public.pode_gerir(v_academia, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão'
      using hint = 'sem_permissao';
  end if;

  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for update;
  select * into v_mat from public.matriculas where id = p_matricula_id for update;
  v_hoje := public.hoje_academia(v_academia);

  -- Encerrada (fim antes de hoje) não tranca: já não gera cobrança nem check-in.
  if v_mat.status <> 'ativa' or (v_mat.data_fim is not null and v_mat.data_fim < v_hoje) then
    raise exception 'Só matrícula ativa e em andamento pode ser trancada'
      using hint = 'matricula_nao_ativa';
  end if;

  update public.matriculas set status = 'trancada' where id = v_mat.id;

  select count(*)::int into v_qtd
    from public.cobrancas
   where academia_id = v_academia and matricula_id = v_mat.id
     and status = 'pendente' and vencimento >= v_hoje;
  return v_qtd;
end
$$;

create or replace function public.destrancar_matricula(p_matricula_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_academia uuid;
  v_aluno    uuid;
  v_mat      public.matriculas;
begin
  select academia_id, aluno_id into v_academia, v_aluno from public.matriculas where id = p_matricula_id;
  if v_academia is null
     or not public.pode_gerir(v_academia, array['dono', 'admin', 'recepcao']) then
    raise exception 'Matrícula não encontrada ou sem permissão'
      using hint = 'sem_permissao';
  end if;

  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for update;
  select * into v_mat from public.matriculas where id = p_matricula_id for update;

  if v_mat.status <> 'trancada' then
    raise exception 'Só matrícula trancada pode ser destrancada'
      using hint = 'matricula_nao_trancada';
  end if;

  update public.matriculas set status = 'ativa' where id = v_mat.id;

  -- Matrícula ativa é aluno ativo (sem isso, gerar_cobrancas pula o aluno).
  update public.alunos
     set status = 'ativo'
   where academia_id = v_academia and id = v_aluno and status in ('pendente', 'inativo')
     and anonimizado_em is null;
end
$$;

revoke execute on function public.encerrar_matricula(uuid, date), public.trancar_matricula(uuid),
  public.destrancar_matricula(uuid) from public, anon;
grant execute on function public.encerrar_matricula(uuid, date), public.trancar_matricula(uuid),
  public.destrancar_matricula(uuid) to authenticated;
