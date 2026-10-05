# Seed e testes do banco

`supabase/seed.sql` cria duas academias locais (`honor-demo-a` e
`honor-demo-b`). Cada uma recebe Jiu-Jitsu com cinco faixas adultas, da branca
à preta, e Muay Thai com sete graduações por prajied. As cores, graus e
carências são exemplos configuráveis por escola, não normas federativas.
O catálogo não contempla todas as faixas infantis ou de mestria de Jiu-Jitsu.

O seed é transacional e pode ser reaplicado: os conflitos de ID da academia,
nome da modalidade e ordem da faixa são ignorados. Não sobrescreve ajustes
existentes nem cria usuários ou senhas. Execute apenas em desenvolvimento.

## Execução no Supabase

Use a instância local compartilhada do projeto, já configurada e iniciada.
A configuração da CLI/Docker fica a cargo de quem coordena esse ambiente.
Antes de `supabase db reset`, confirme com a coordenação: o comando apaga
os dados locais usados pelos demais worktrees, conforme `AGENTS.md`.
O reset aplica as migrations e o seed desta branch quando executado com
esta configuração integrada ao ambiente compartilhado.

Na raiz deste worktree, com a CLI apontando para essa instância:

```sh
supabase test db supabase/tests/database/rls.test.sql
```

A suíte usa pgTAP, cria suas próprias fixtures e termina com `ROLLBACK`.
Não depende do seed. Não use `--linked` ou uma URL de produção.
As consultas de autorização usam `SET LOCAL ROLE authenticated`/`anon`
e um JWT simulado com `request.jwt.claim.sub`; só a preparação de dados
usa o papel administrativo. Os auxiliares temporários são SECURITY INVOKER.
Cada tentativa de escrita é desfeita em uma subtransação, inclusive quando
permitida, para não contaminar os próximos casos.

## Cobertura

- RLS habilitado nas 14 tabelas e papel autenticado sem bypass.
- Isolamento de leitura, INSERT, UPDATE e DELETE entre duas academias,
  incluindo UUIDs conhecidos, views e tentativa de transferência de tenant.
- Matriz de INSERT nas 13 tabelas subordinadas para dono, admin, professor,
  recepção e aluno; controles positivos e negativos de UPDATE/DELETE.
- Responsável com dois filhos, catálogo do aluno e acesso às suas matrículas,
  presenças, graduações e cobranças.
- Check-in permitido via RPC e rejeição de outro aluno ou academia.
- Professor sem acesso às cobranças/view financeira; restrições da recepção.
- Admin sem poder promover, rebaixar ou remover donos; proteção das colunas
  de billing, inclusive `trial_ate`.
- FKs compostas mesmo quando o usuário é dono das duas academias.
- Membro inativo, usuário sem vínculo, acesso anônimo, suspensão e fronteiras
  do trial (vencido ontem e válido hoje).

## Validação e falhas encontradas

Em 05/10/2026, validação em PostgreSQL 17.4 temporário com pgTAP 1.3.4:
seed aplicado duas vezes sem duplicação (2 academias, 4 modalidades e 24 faixas); 244 testes executados com o schema inicial, dos quais 242 passaram e 2 falharam.
Esse ambiente reproduz os papéis, grants iniciais e `auth.uid()` necessários,
mas usa uma tabela `auth.users` mínima. O pgTAP foi carregado pelo SQL oficial
em `extensions`; somente na cópia temporária foi omitido `CREATE EXTENSION`.
Isso não substitui `supabase test db` na stack completa. Docker não estava
disponível, e o banco Supabase compartilhado não foi reiniciado.

Duas regressões do schema inicial ficam intencionalmente vermelhas, sem
`TODO`/skip: **Suspensa não atualiza academia** e **Trial vencido não atualiza
academia**. A política `academias_update` usa `tem_papel` em `USING` e
`WITH CHECK`, permitindo mudar, por exemplo, `nome` nesses estados.
A regra do produto exige `pode_gerir(id, array['dono', 'admin'])` nos dois
predicados. A correção deve entrar em uma nova migration pelo responsável
pelo schema/RLS; não editar a migration inicial. Esta tarefa não altera
`supabase/migrations/`, para preservar a exclusividade do agente de schema.

Referências: [testes de banco do Supabase](https://supabase.com/docs/guides/database/testing)
e [pgTAP](https://pgtap.org/documentation.html).

A troca dos dois predicados por `pode_gerir` foi verificada somente em uma
transação temporária: os 244 testes passaram. O `ROLLBACK` desfez esse ajuste;
nenhuma migration foi alterada.
