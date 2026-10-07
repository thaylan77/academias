-- =====================================================================
-- Matrícula duplicada na mesma turma (issue #13)
--
-- Regra: o mesmo aluno não pode ter duas matrículas não canceladas
-- (pendente, ativa ou trancada) com períodos sobrepostos que compartilhem
-- uma turma. O período é [data_inicio, data_fim], ou sem fim quando
-- data_fim é nulo.
--
-- Por quê: duas matrículas na mesma turma geram duas mensalidades
-- (gerar_cobrancas trabalha por matrícula) e confundiam o check-in.
--
-- Troca de plano: encerrar a matrícula antiga (data_fim = véspera) e abrir
-- a nova. Períodos que só se encostam não se sobrepõem.
--
-- Spec: docs/specs/matricula-duplicada.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A regra. Uma função só, para os gatilhos das duas tabelas.
--
--    AFTER, por linha: enxerga o estado final do comando, inclusive as
--    outras linhas inseridas no mesmo insert.
--
--    security definer: a conferência precisa ver todas as matrículas do
--    aluno, qualquer que seja o RLS de quem está gravando.
--
--    Concorrência: trava de transação por aluno. Duas gravações
--    simultâneas para o mesmo aluno entram uma de cada vez, e a segunda já
--    enxerga o que a primeira gravou.
-- ---------------------------------------------------------------------
create or replace function public.matriculas_sem_duplicata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matricula public.matriculas;
  v_turma_id  uuid;      -- nulo: confere todas as turmas da matrícula
  v_conflito  record;
begin
  if tg_table_name = 'matricula_turmas' then
    select m.* into v_matricula
    from public.matriculas m
    where m.id = new.matricula_id;
    v_turma_id := new.turma_id;
  else
    v_matricula := new;
  end if;

  -- Matrícula cancelada não disputa turma com ninguém.
  if v_matricula.id is null or v_matricula.status = 'cancelada' then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('matricula_duplicada:' || v_matricula.aluno_id::text, 0));

  select o.id as matricula_id, mt.turma_id, t.nome as turma_nome
  into v_conflito
  from public.matricula_turmas mt
  join public.matricula_turmas ot
    on ot.turma_id = mt.turma_id
   and ot.matricula_id <> mt.matricula_id
  join public.matriculas o
    on o.id = ot.matricula_id
  join public.turmas t
    on t.id = mt.turma_id
  where mt.matricula_id = v_matricula.id
    and (v_turma_id is null or mt.turma_id = v_turma_id)
    and o.academia_id = v_matricula.academia_id
    and o.aluno_id = v_matricula.aluno_id
    and o.status <> 'cancelada'
    and v_matricula.data_inicio <= coalesce(o.data_fim, 'infinity'::date)
    and o.data_inicio <= coalesce(v_matricula.data_fim, 'infinity'::date)
  order by t.nome, o.id
  limit 1;

  if found then
    raise exception 'O aluno já tem matrícula na turma "%" neste período', v_conflito.turma_nome
      using hint = 'matricula_duplicada',
            detail = jsonb_build_object(
              'matricula_id', v_conflito.matricula_id,
              'turma_id', v_conflito.turma_id)::text;
  end if;

  return null;
end
$$;

-- Entrada de turma na matrícula. (Hoje não há política de update em
-- matricula_turmas; o gatilho cobre o update mesmo assim, para o caso de
-- service_role ou de uma política futura.)
drop trigger if exists matricula_turmas_sem_duplicata on public.matricula_turmas;
create trigger matricula_turmas_sem_duplicata
  after insert or update of matricula_id, turma_id on public.matricula_turmas
  for each row execute function public.matriculas_sem_duplicata();

-- Mudança que pode criar sobreposição numa matrícula que já tem turmas:
-- reativar uma cancelada, mexer nas datas ou trocar o aluno.
drop trigger if exists matriculas_sem_duplicata on public.matriculas;
create trigger matriculas_sem_duplicata
  after update of status, data_inicio, data_fim, aluno_id on public.matriculas
  for each row
  when (new.status <> 'cancelada'
        and (new.status is distinct from old.status
             or new.data_inicio is distinct from old.data_inicio
             or new.data_fim is distinct from old.data_fim
             or new.aluno_id is distinct from old.aluno_id))
  execute function public.matriculas_sem_duplicata();

revoke execute on function public.matriculas_sem_duplicata() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Confere o que já existe.
--
--    Vem depois dos gatilhos de propósito. A partir da criação deles
--    nenhuma duplicata nova entra: se a migration roda numa transação só,
--    o CREATE TRIGGER segura a tabela até o fim; se cada comando é
--    confirmado sozinho, os gatilhos já estão valendo. Em qualquer dos
--    casos, o que esta conferência não achar não existe.
--
--    Se achar, a migration falha e lista os pares. Nada é corrigido
--    sozinho. Rodar de novo depois de resolver é seguro: a função e os
--    gatilhos são recriados.
-- ---------------------------------------------------------------------

do $$
declare
  v_total integer;
  v_lista text;
begin
  with pares as (
    select a.academia_id, a.aluno_id, ta.turma_id, a.id as matricula_a, b.id as matricula_b
    from public.matriculas a
    join public.matriculas b
      on b.academia_id = a.academia_id
     and b.aluno_id = a.aluno_id
     and b.id > a.id
     and b.status <> 'cancelada'
     and a.data_inicio <= coalesce(b.data_fim, 'infinity'::date)
     and b.data_inicio <= coalesce(a.data_fim, 'infinity'::date)
    join public.matricula_turmas ta on ta.matricula_id = a.id
    join public.matricula_turmas tb on tb.matricula_id = b.id and tb.turma_id = ta.turma_id
    where a.status <> 'cancelada'
  ),
  numerados as (
    select p.*, row_number() over (order by academia_id, aluno_id, turma_id, matricula_a, matricula_b) as n
    from pares p
  )
  select count(*),
         string_agg(
           format('academia %s, aluno %s, turma %s: matrículas %s e %s',
                  academia_id, aluno_id, turma_id, matricula_a, matricula_b),
           E'\n' order by n) filter (where n <= 50)
  into v_total, v_lista
  from numerados;

  if v_total > 0 then
    raise exception
      'Há % caso(s) de matrícula duplicada na mesma turma. Cancele ou encerre uma de cada par antes de aplicar esta migration (lista limitada a 50):%',
      v_total, E'\n' || v_lista
      using hint = 'matricula_duplicada';
  end if;
end
$$;
