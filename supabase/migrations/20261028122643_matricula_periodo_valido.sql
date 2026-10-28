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

alter table public.matriculas
  add constraint matriculas_periodo_valido check (data_fim is null or data_fim >= data_inicio);
