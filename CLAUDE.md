@AGENTS.md

## Específico do Claude Code

- Plano de schema precisa da aprovação do dono do projeto **antes** de
  escrever a migration só quando houver:
  1. perda ou alteração irreversível de dados existentes (drop, migração que
     reescreve dados);
  2. mudança em RLS, papéis ou vínculo de login;
  3. fluxo de dinheiro (cobrança, baixa, gateway).
  Nos demais casos, o plano vai na descrição do PR e a revisão do Codex
  basta. Na dúvida sobre em qual caso cai, pergunte.
- Para entregar uma issue, use `/entregar <número>`. Antes de abrir o PR,
  confira o checklist do AGENTS.md.
