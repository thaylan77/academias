-- Apagar turma não apaga mais o histórico (issue #54; opção 2 da issue,
-- aprovada pelo dono do projeto na sessão).
--
-- presencas e matricula_turmas referenciavam turmas com "on delete cascade":
-- um delete direto pela API (política turmas_delete: dono e admin) levava
-- junto todas as presenças e os vínculos de matrícula da turma. Agora a FK é
-- "no action": apagar turma com presença ou matrícula falha (23503), e turma
-- criada por engano, sem nada ligado, ainda pode ser apagada. Para sair de uso,
-- a turma é desativada (ativa = false), como a tela já faz.
--
-- Apagar a academia inteira já falhava antes (turmas -> modalidades não tem
-- cascade); o encerramento de academia é a issue #19, que vai apagar em ordem.
--
-- turma_horarios continua em cascade: horário é parte da turma, não histórico.
-- Nenhuma política RLS muda e nenhum dado é alterado.

alter table public.presencas
  drop constraint presencas_academia_id_turma_id_fkey,
  add constraint presencas_academia_id_turma_id_fkey
    foreign key (academia_id, turma_id) references public.turmas (academia_id, id);

alter table public.matricula_turmas
  drop constraint matricula_turmas_academia_id_turma_id_fkey,
  add constraint matricula_turmas_academia_id_turma_id_fkey
    foreign key (academia_id, turma_id) references public.turmas (academia_id, id);
