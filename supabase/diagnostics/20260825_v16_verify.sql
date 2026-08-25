\pset pager off

-- Band Manager v16 — verificação da fundação de identidade

select
  to_regclass('public.membro_dispositivos') as membro_dispositivos_table;

select
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename = 'membro_dispositivos'
order by policyname;

select
  count(*) as membros_total,
  count(user_id) as membros_com_user_id
from public.membros;

select
  count(*) as organizacoes_total,
  count(user_id) as organizacoes_com_user_id
from public.organizacoes;

select
  count(*) as dispositivos_vinculados,
  count(distinct membro_id) as membros_com_dispositivo,
  count(distinct org_id) as organizacoes_com_dispositivo
from public.membro_dispositivos;

select
  count(*) as vinculos_invalidos
from public.membro_dispositivos md
left join public.membros m on m.id = md.membro_id
where m.id is null
   or m.org_id is distinct from md.org_id;

select
  p.proname as helper,
  pg_get_function_result(p.oid) as retorno
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_member_id', 'current_org_id', 'current_identity')
order by p.proname;
