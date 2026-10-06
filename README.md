# Honor Team SaaS

Gestão para academias de artes marciais: alunos, matrícula online, turmas,
frequência por check-in, graduações (faixas e graus) e financeiro. Cada
academia é um tenant isolado no mesmo banco.

## Estado atual

O que já existe em `main`:

- **Banco** (Supabase, Postgres): schema multi-tenant com RLS em todas as
  tabelas, papéis da equipe (dono, admin, professor, recepção, totem),
  matrícula online, check-in por QR com token rotativo, graduações e
  financeiro (cobranças, recorrência, baixa manual, inadimplência).
- **Testes pgTAP** de RLS, check-in, matrícula online e financeiro, sempre
  com duas academias.
- **Front** (React + Vite + TypeScript + Tailwind) com três telas:
  matrícula pública, check-in do aluno e totem com o QR da turma.

O que ainda não existe: painel da equipe, portal do aluno, integração com
gateway de pagamento, lembretes por WhatsApp e convite de membros. O
backlog está no fim do [AGENTS.md](AGENTS.md) e nas issues.

## Rodando o front

Requer Node 22.12.0 (a mesma versão do CI).

```bash
npm ci
npm run dev
```

O servidor de desenvolvimento sobe em HTTPS com certificado autoassinado
(a câmera do check-in exige HTTPS). Sem `.env.local`, o front roda com dados
simulados e a academia de demonstração `honor-demo-a`.

Para apontar para um projeto Supabase, crie `.env.local`:

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<chave anon/publishable>
```

Só a chave `anon` entra aqui. A `service_role` nunca vai para o front nem
para o repositório.

Rotas:

| Endereço              | Tela                                   |
|-----------------------|----------------------------------------|
| `/{slug}/matricula`   | matrícula online (visitante anônimo)   |
| `/{slug}/checkin`     | check-in do aluno pelo QR da turma     |
| `/{slug}/totem`       | totem da academia (login da equipe)    |

## Comandos

```bash
npm run dev      # servidor de desenvolvimento
npm run lint     # checagem de tipos (tsc --noEmit)
npm test         # testes do front (Vitest)
npm run build    # build de produção

npx supabase@2.119.0 migration new <nome>   # nova migration
```

A CLI do Supabase é fixa na versão `2.119.0`, a mesma do CI.

## Banco e testes

- As migrations ficam em `supabase/migrations/`. Migration já aplicada não
  se edita: cria-se outra.
- O workflow [Banco](.github/workflows/banco.yml) é o verde oficial. A cada
  push e pull request ele aplica as migrations do zero, roda os testes
  pgTAP, confere se `src/types/database.ts` bate com o banco e roda lint,
  testes e build do front.
- `src/types/database.ts` é gerado pelo CI (artifact `database-types`). Não
  edite à mão.
- O projeto Supabase de desenvolvimento compartilhado só recebe `main`, por
  `supabase db push`, depois do merge. Testes nunca rodam contra ele.

Detalhes do seed e das suítes: [supabase/tests/README.md](supabase/tests/README.md).

## Estrutura

```
supabase/migrations/   SQL versionado
supabase/tests/        testes pgTAP
supabase/seed.sql      dados de exemplo (duas academias de demonstração)
src/                   front-end
src/types/database.ts  tipos gerados do banco
docs/specs/            specs de módulo
```

## Documentação

- [AGENTS.md](AGENTS.md): regras multi-tenant, papéis e permissões, RPCs e
  views, convenções, fluxo de revisão e merge. Leia antes de contribuir.
- [docs/specs/checkin-seguranca.md](docs/specs/checkin-seguranca.md):
  check-in com token rotativo, papel totem e códigos de erro.
- [docs/specs/financeiro-gateway-webhook.md](docs/specs/financeiro-gateway-webhook.md):
  gateway de pagamento e webhook (ainda não implementado).

## Como contribuir

Nada entra em `main` por commit direto: tudo por pull request, com o CI
`Banco` verde e revisão aprovada. As regras completas estão no
[AGENTS.md](AGENTS.md), seções "Revisão e merge" e "Checklist antes de
abrir PR".
