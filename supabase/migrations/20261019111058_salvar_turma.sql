-- Painel: turmas e horários (issue #27).
--
-- salvar_turma grava a turma e troca os horários dela numa transação só.
-- Pelo cliente seriam três chamadas (turma, apagar horários, inserir
-- horários), e uma falha no meio deixaria a turma sem horário: pela D4 da
-- spec do check-in, ela some do totem e não aceita QR até alguém notar.
--
-- Mesma permissão das políticas do catálogo: dono e admin, com a assinatura
-- em dia (pode_gerir). Nenhuma política muda.
--
-- p_turma_id null (ou omitido) cria; com id, edita aquela turma da academia.
--
-- p_dados:
--   { "nome": text, "modalidade_id": uuid, "professor_id": uuid | null,
--     "publico": "adulto" | "infantil" | "misto" | "feminino",
--     "capacidade": inteiro > 0 | null, "ativa": boolean,
--     "horarios": [ { "dia_semana": 0..6, "hora_inicio": "HH:MM",
--                     "hora_fim": "HH:MM" }, ... ] }
--
-- Horários no fuso da academia: são horas de relógio local, sem fuso; quem
-- as compara com o agora (fazer_checkin, totem_turmas_agora) usa
-- academias.fuso.
create or replace function public.salvar_turma(p_academia_id uuid, p_dados jsonb, p_turma_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_nome        text;
  v_modalidade  uuid;
  v_professor   uuid;
  v_publico     text;
  v_capacidade  smallint;
  v_ativa       boolean;
  v_horarios    jsonb;
  v_h           jsonb;
begin
  if p_academia_id is null or not public.pode_gerir(p_academia_id, array['dono', 'admin']) then
    raise exception 'Sem permissão para alterar turmas desta academia'
      using hint = 'sem_permissao';
  end if;

  -- Formato da entrada. Qualquer coisa fora do esperado é dados_invalidos.
  if p_dados is null or jsonb_typeof(p_dados) <> 'object'
     or jsonb_typeof(p_dados -> 'nome') is distinct from 'string'
     or length(trim(p_dados ->> 'nome')) < 2
     or jsonb_typeof(p_dados -> 'modalidade_id') is distinct from 'string'
     or (p_dados ->> 'modalidade_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(jsonb_typeof(p_dados -> 'professor_id'), 'null') not in ('null', 'string')
     or (jsonb_typeof(p_dados -> 'professor_id') = 'string'
         and (p_dados ->> 'professor_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or coalesce(p_dados ->> 'publico', '') not in ('adulto', 'infantil', 'misto', 'feminino')
     or coalesce(jsonb_typeof(p_dados -> 'capacidade'), 'null') not in ('null', 'number')
     or (jsonb_typeof(p_dados -> 'capacidade') = 'number'
         and ((p_dados ->> 'capacidade') !~ '^[0-9]{1,4}$' or (p_dados ->> 'capacidade')::int < 1))
     or jsonb_typeof(p_dados -> 'ativa') is distinct from 'boolean'
     or jsonb_typeof(p_dados -> 'horarios') is distinct from 'array'
  then
    raise exception 'Dados da turma inválidos' using hint = 'dados_invalidos';
  end if;

  v_nome       := trim(p_dados ->> 'nome');
  v_modalidade := (p_dados ->> 'modalidade_id')::uuid;
  v_professor  := nullif(p_dados ->> 'professor_id', '')::uuid;
  v_publico    := p_dados ->> 'publico';
  v_capacidade := (p_dados ->> 'capacidade')::smallint;
  v_ativa      := (p_dados ->> 'ativa')::boolean;
  v_horarios   := p_dados -> 'horarios';

  -- Cada horário: dia de 0 (domingo) a 6, "HH:MM" e fim depois do início.
  for v_h in select * from jsonb_array_elements(v_horarios) loop
    if jsonb_typeof(v_h) <> 'object'
       or jsonb_typeof(v_h -> 'dia_semana') is distinct from 'number'
       or (v_h ->> 'dia_semana') !~ '^[0-6]$'
       or coalesce(v_h ->> 'hora_inicio', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_h ->> 'hora_fim', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_h ->> 'hora_fim')::time <= (v_h ->> 'hora_inicio')::time
    then
      raise exception 'Horário inválido: dia de domingo a sábado e fim depois do início'
        using hint = 'horario_invalido';
    end if;
  end loop;

  -- Dois horários da mesma turma no mesmo dia não se sobrepõem.
  if exists (
    select 1
      from jsonb_array_elements(v_horarios) with ordinality a(h, i)
      join jsonb_array_elements(v_horarios) with ordinality b(h, j)
        on a.i < b.j
       and (a.h ->> 'dia_semana') = (b.h ->> 'dia_semana')
       and (a.h ->> 'hora_inicio')::time < (b.h ->> 'hora_fim')::time
       and (b.h ->> 'hora_inicio')::time < (a.h ->> 'hora_fim')::time
  ) then
    raise exception 'Há horários da turma que se sobrepõem no mesmo dia'
      using hint = 'horario_sobreposto';
  end if;

  -- Modalidade e professor precisam ser desta academia (a FK composta também
  -- garante; aqui o erro sai com código).
  if not exists (select 1 from public.modalidades
                  where academia_id = p_academia_id and id = v_modalidade)
     or (v_professor is not null and not exists (
           select 1 from public.professores
            where academia_id = p_academia_id and id = v_professor))
  then
    raise exception 'Modalidade ou professor não encontrado nesta academia'
      using hint = 'dados_invalidos';
  end if;

  if p_turma_id is null then
    insert into public.turmas (academia_id, modalidade_id, professor_id, nome, publico, capacidade, ativa)
    values (p_academia_id, v_modalidade, v_professor, v_nome, v_publico, v_capacidade, v_ativa)
    returning id into v_id;
  else
    update public.turmas
       set modalidade_id = v_modalidade,
           professor_id  = v_professor,
           nome          = v_nome,
           publico       = v_publico,
           capacidade    = v_capacidade,
           ativa         = v_ativa
     where academia_id = p_academia_id and id = p_turma_id
     returning id into v_id;
    if v_id is null then
      raise exception 'Turma não encontrada nesta academia'
        using hint = 'turma_nao_encontrada';
    end if;
  end if;

  -- Troca os horários. Nada referencia turma_horarios.id, então apagar e
  -- inserir não perde histórico (presenças guardam turma e data).
  delete from public.turma_horarios
   where academia_id = p_academia_id and turma_id = v_id;

  insert into public.turma_horarios (academia_id, turma_id, dia_semana, hora_inicio, hora_fim)
  select p_academia_id, v_id, (h ->> 'dia_semana')::smallint,
         (h ->> 'hora_inicio')::time, (h ->> 'hora_fim')::time
    from jsonb_array_elements(v_horarios) h;

  return v_id;
end
$$;

revoke execute on function public.salvar_turma(uuid, jsonb, uuid) from public, anon;
grant execute on function public.salvar_turma(uuid, jsonb, uuid) to authenticated;

-- Turma com presença não troca de modalidade. vw_progresso_graduacao conta
-- as presenças pela modalidade atual da turma: trocar Jiu-Jitsu por Judô
-- tiraria aulas já dadas de uma modalidade e as daria à outra, mudando
-- aulas_desde e apto sem nenhum treino novo. Para mudar, cria-se uma turma
-- nova e desativa-se a antiga. Vale para salvar_turma e para update direto.
-- security definer: a conferência olha presenças da própria turma, sem
-- depender do RLS de quem grava.
--
-- Concorrência: a FK de presencas trava a turma em KEY SHARE, que não
-- conflita com o NO KEY UPDATE deste update; sem mais nada, uma primeira
-- presença ainda não confirmada passaria despercebida. O FOR UPDATE na turma
-- conflita com KEY SHARE: a troca espera a presença terminar, e a consulta
-- seguinte (snapshot novo, em read committed) já a enxerga. Na ordem
-- inversa, a presença espera a troca e entra já na modalidade nova.
create or replace function public.turmas_modalidade_com_presencas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.modalidade_id is distinct from old.modalidade_id then
    perform 1 from public.turmas where id = old.id for update;
  end if;
  if new.modalidade_id is distinct from old.modalidade_id and exists (
    select 1 from public.presencas
     where academia_id = old.academia_id and turma_id = old.id
  ) then
    raise exception 'Esta turma já tem presenças: crie uma turma nova na outra modalidade e desative esta'
      using hint = 'turma_com_presencas';
  end if;
  return new;
end
$$;

create trigger turmas_modalidade_com_presencas
  before update of modalidade_id on public.turmas
  for each row execute function public.turmas_modalidade_com_presencas();

revoke execute on function public.turmas_modalidade_com_presencas() from public, anon, authenticated;
