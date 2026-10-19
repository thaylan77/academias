-- Slugs reservados (issue #50).
--
-- O primeiro segmento da URL é o slug da academia (/{slug}/matricula), menos
-- os caminhos do próprio app: /painel hoje, e os que vêm (portal do aluno,
-- api, admin, entrar) ou que o servidor de arquivos usa (assets). Academia
-- com um desses slugs teria a página pública engolida pela rota do app.
--
-- A lista fica num check nomeado em academias: vale para criar_academia e
-- para a troca de slug pelo billing (service_role). criar_academia traduz o
-- erro para um código estável no hint, junto com os outros erros de slug que
-- o onboarding precisa tratar.

-- 1. Nenhuma academia existente pode estar usando um slug reservado. Se
--    houver, a migration para com a lista: o slug só muda pelo billing.
do $$
declare
  v_lista text;
begin
  select string_agg(format('%s (%s)', slug, id), ', ' order by slug)
    into v_lista
    from public.academias
   where slug in ('painel', 'portal', 'api', 'admin', 'entrar', 'assets');
  if v_lista is not null then
    raise exception 'Há academias com slug reservado: %', v_lista
      using hint = 'slug_reservado',
            detail = 'Troque o slug dessas academias pelo billing (service_role) e rode a migration de novo.';
  end if;
end
$$;

-- 2. A regra no banco. O add constraint confere todas as linhas sob trava
--    exclusiva da tabela: uma academia criada depois do passo 1 também é
--    conferida aqui.
alter table public.academias
  add constraint academias_slug_nao_reservado
  check (slug not in ('painel', 'portal', 'api', 'admin', 'entrar', 'assets'));

-- 3. criar_academia com códigos estáveis no hint para os erros de slug.
create or replace function public.criar_academia(p_nome text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_restricao text;
begin
  if auth.uid() is null then
    raise exception 'Faça login para criar uma academia';
  end if;

  insert into public.academias (nome, slug)
  values (trim(p_nome), lower(trim(p_slug)))
  returning id into v_id;

  insert into public.membros_academia (academia_id, user_id, papel)
  values (v_id, auth.uid(), 'dono');

  return v_id;
exception
  when unique_violation then
    raise exception 'Esse endereço (slug) já está em uso'
      using hint = 'slug_em_uso';
  when check_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'academias_slug_nao_reservado' then
      raise exception 'Esse endereço (slug) é reservado pelo sistema. Escolha outro.'
        using hint = 'slug_reservado';
    elsif v_restricao = 'academias_slug_check' then
      raise exception 'O endereço (slug) deve ter de 3 a 40 caracteres, só letras minúsculas, números e hífen, sem hífen no começo nem no fim.'
        using hint = 'slug_invalido';
    end if;
    raise;
end
$$;

-- create or replace mantém os grants; repetidos aqui para deixar explícito.
revoke execute on function public.criar_academia(text, text) from public, anon;
grant execute on function public.criar_academia(text, text) to authenticated;
