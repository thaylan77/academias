-- Dados exclusivamente locais. Não executar em produção.
-- IDs estáveis e ON CONFLICT permitem reaplicar sem duplicar o catálogo.
-- Não cria usuários, senhas ou vínculos de acesso.
begin;

insert into public.academias (id, nome, slug, status)
values
  ('de000000-0000-4000-8000-000000000001', 'Honor Team — demonstração A', 'honor-demo-a', 'ativa'),
  ('de000000-0000-4000-8000-000000000002', 'Honor Team — demonstração B', 'honor-demo-b', 'ativa')
on conflict do nothing;

insert into public.modalidades (id, academia_id, nome)
select
  ('de100000-0000-4000-8000-' || lpad((a.numero * 10 + m.numero)::text, 12, '0'))::uuid,
  ('de000000-0000-4000-8000-' || lpad(a.numero::text, 12, '0'))::uuid,
  m.nome
from (values (1), (2)) as a(numero)
-- Se o slug já pertence a outro ID, pula essa demonstração inteira.
join public.academias existente
  on existente.id = ('de000000-0000-4000-8000-' || lpad(a.numero::text, 12, '0'))::uuid
cross join (values (1, 'Jiu-Jitsu'), (2, 'Muay Thai')) as m(numero, nome)
on conflict (academia_id, nome) do nothing;

-- Catálogo adulto inicial de Jiu-Jitsu, da branca à preta.
-- Muay Thai: exemplo de graduação por prajied; a sequência varia por escola.
-- Graus e carências abaixo são exemplos configuráveis, não regras federativas.
-- min_meses/min_aulas são exigências por passo, conforme o schema.
insert into public.faixas (
  academia_id, modalidade_id, nome, cor, ordem, max_graus, min_meses, min_aulas
)
select m.academia_id, m.id, f.nome, f.cor, f.ordem, f.max_graus, f.min_meses, f.min_aulas
from public.modalidades m
join (values
  ('Jiu-Jitsu', 'Branca',  '#FFFFFF', 1, 4, 3, 30),
  ('Jiu-Jitsu', 'Azul',    '#2563EB', 2, 4, 3, 30),
  ('Jiu-Jitsu', 'Roxa',    '#9333EA', 3, 4, 3, 30),
  ('Jiu-Jitsu', 'Marrom',  '#92400E', 4, 4, 3, 30),
  ('Jiu-Jitsu', 'Preta',   '#171717', 5, 6, 12, 120),
  ('Muay Thai', 'Branca',           '#FFFFFF', 1, 0, 3, 30),
  ('Muay Thai', 'Branca e vermelha','#FCA5A5', 2, 0, 3, 30),
  ('Muay Thai', 'Vermelha',         '#DC2626', 3, 0, 3, 30),
  ('Muay Thai', 'Vermelha e azul',  '#7C3AED', 4, 0, 3, 30),
  ('Muay Thai', 'Azul',             '#2563EB', 5, 0, 3, 30),
  ('Muay Thai', 'Azul e preta',     '#1E3A8A', 6, 0, 3, 30),
  ('Muay Thai', 'Preta',            '#171717', 7, 0, 12, 120)
) as f(modalidade, nome, cor, ordem, max_graus, min_meses, min_aulas)
  on f.modalidade = m.nome
where m.academia_id in (
  'de000000-0000-4000-8000-000000000001',
  'de000000-0000-4000-8000-000000000002'
)
on conflict (modalidade_id, ordem) do nothing;

commit;
