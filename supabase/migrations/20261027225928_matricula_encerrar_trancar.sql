-- Encerrar, trancar e destrancar matrícula (issue #28; plano aprovado pelo
-- dono do projeto na sessão, por mexer no fluxo de cobrança).
--
-- encerrar_matricula: define (ou corrige) a data de fim. gerar_cobrancas não
--   cobra vencimento depois dela, e o check-in não vale depois dela.
-- trancar_matricula: status 'trancada'. gerar_cobrancas só cobra matrícula
--   ativa e o check-in também só aceita ativa; a trancada continua ocupando
--   a turma (docs/specs/matricula-duplicada.md).
-- destrancar_matricula: volta a 'ativa' (só a trancada que ainda não terminou). Os meses trancados não são cobrados
--   depois: a geração só olha a competência atual e a seguinte.
--
-- Nenhuma cobrança é cancelada aqui. encerrar e trancar devolvem quantas
-- pendentes da matrícula ficaram depois do fim (ou de hoje em diante, no
-- trancamento), e a tela avisa para a recepção decidir em Cobranças.
--
-- Mesma permissão das políticas de matrículas: dono, admin e recepção, com a
-- assinatura em dia (pode_gerir). Nenhuma política muda. As três travam o
-- aluno antes da matrícula, na ordem de anonimizar_aluno e aprovar_matricula.
-- A trava do aluno é "for no key update": conflita com a de anonimizar_aluno
-- (for update), mas não com a conferência da chave estrangeira de cobrancas
-- -> alunos que gerar_cobrancas faz ao gravar (ver o fim do arquivo).

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

  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for no key update;
  select * into v_mat from public.matriculas where id = p_matricula_id for update;
  -- Apagada entre a primeira leitura e a trava: a mesma resposta de inexistente.
  if not found then
    raise exception 'Matrícula não encontrada ou sem permissão' using hint = 'sem_permissao';
  end if;

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

  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for no key update;
  select * into v_mat from public.matriculas where id = p_matricula_id for update;
  -- Apagada entre a primeira leitura e a trava: a mesma resposta de inexistente.
  if not found then
    raise exception 'Matrícula não encontrada ou sem permissão' using hint = 'sem_permissao';
  end if;
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

  perform 1 from public.alunos where academia_id = v_academia and id = v_aluno for no key update;
  select * into v_mat from public.matriculas where id = p_matricula_id for update;
  -- Apagada entre a primeira leitura e a trava: a mesma resposta de inexistente.
  if not found then
    raise exception 'Matrícula não encontrada ou sem permissão' using hint = 'sem_permissao';
  end if;

  -- Trancada já encerrada (fim antes de hoje) não destranca: viraria ativa sem
  -- período pela frente e reativaria o aluno sem matrícula vigente.
  if v_mat.status <> 'trancada'
     or (v_mat.data_fim is not null and v_mat.data_fim < public.hoje_academia(v_academia)) then
    raise exception 'Só matrícula trancada e em andamento pode ser destrancada'
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

-- gerar_cobrancas (revisão do Codex no PR #64; aprovado pelo dono do projeto
-- na sessão): a mesma regra de 20261005120000_correcoes_e_financeiro.sql,
-- agora com a matrícula travada (for share). Sem a trava, uma geração
-- concorrente com trancar_matricula ou encerrar_matricula lia a matrícula
-- ainda ativa, esperava o commit na chave estrangeira e gravava a cobrança
-- que não devia existir, sem a tela saber. Permissões continuam as mesmas
-- (create or replace as preserva).
create or replace function public.gerar_cobrancas(
  p_academia_id  uuid default null,
  p_matricula_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd integer;
begin
  insert into public.cobrancas
    (academia_id, aluno_id, matricula_id, competencia, descricao, valor, vencimento)
  select
    m.academia_id, m.aluno_id, m.id, g.competencia,
    p.nome || ' — ' || to_char(g.competencia, 'MM/YYYY'),
    coalesce(m.valor, p.valor),
    x.vencimento
  from public.matriculas m
  join public.academias a on a.id = m.academia_id
  join public.planos p on p.academia_id = m.academia_id and p.id = m.plano_id
  join public.alunos al on al.academia_id = m.academia_id and al.id = m.aluno_id
  cross join lateral (
    select
      (now() at time zone a.fuso)::date as hoje,
      case p.periodicidade
        when 'mensal' then 1 when 'trimestral' then 3 when 'semestral' then 6 else 12
      end as intervalo,
      greatest(m.data_inicio, (m.created_at at time zone a.fuso)::date) as base
  ) b
  cross join lateral (
    select s::date as competencia
    from generate_series(
      date_trunc('month', b.hoje::timestamp),
      date_trunc('month', b.hoje::timestamp) + interval '1 month',
      interval '1 month') s
  ) g
  cross join lateral (
    select case
             when g.competencia <> m.cobrar_a_partir
               then g.competencia + (m.dia_vencimento - 1)
             when m.cobrar_a_partir = date_trunc('month', b.base::timestamp)::date
               then b.base
             else greatest(g.competencia + (m.dia_vencimento - 1), b.base)
           end as vencimento
  ) x
  where m.status = 'ativa'
    and al.status = 'ativo'
    and m.dia_vencimento is not null
    and coalesce(m.valor, p.valor) > 0
    and public.academia_ativa(a.id)
    and (p_academia_id is null or m.academia_id = p_academia_id)
    and (p_matricula_id is null or m.id = p_matricula_id)
    and g.competencia >= m.cobrar_a_partir
    and ((extract(year from g.competencia) - extract(year from m.cobrar_a_partir)) * 12
         + extract(month from g.competencia) - extract(month from m.cobrar_a_partir))::int % b.intervalo = 0
    and b.hoje >= x.vencimento - a.dias_antecedencia_cobranca
    and (m.data_fim is null or x.vencimento <= m.data_fim)
  -- Trava o aluno e depois a matrícula, na mesma ordem das RPCs de matrícula
  -- e de anonimizar_aluno (aluno, depois as matrículas dele): um trancamento,
  -- encerramento ou anonimização em andamento faz a geração esperar e
  -- reavaliar a linha já atualizada (status, data_fim) antes de gravar, em vez
  -- de cobrar pela versão antiga, e sem ciclo de espera entre elas. A do aluno
  -- é "key share": basta para esperar anonimizar_aluno (for update) e não
  -- conflita com a "for no key update" de trancar e encerrar.
  for key share of al
  for share of m
  on conflict (matricula_id, competencia) do nothing;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end
$$;
