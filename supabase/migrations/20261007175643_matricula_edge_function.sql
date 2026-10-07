-- Revogar acesso à função de matrícula online para anônimos
-- A página de matrícula agora chamará uma Edge Function para validação de Captcha, que usará service_role

revoke execute on function public.matricula_online(text, jsonb) from anon;
