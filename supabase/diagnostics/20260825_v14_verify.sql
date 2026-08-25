-- Band Manager v14 — verificação pós-migration
-- Execute no SQL Editor depois de aplicar 20260825_supabase_sync_repair_v14.sql.

-- 1) As tabelas v8/v10/v13 devem ter a policy v14_internal_access.
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'repertorio_execucoes',
    'repertorio_live_favoritos',
    'repertorio_notas_membro',
    'repertorio_versoes',
    'evento_operacao',
    'evento_checklist'
  )
order by tablename, policyname;

-- 2) org_id antigo deve ter sido preenchido.
select 'evento_repertorio' as tabela, count(*) filter (where org_id is null) as org_id_null
from public.evento_repertorio
union all
select 'musica_estrutura', count(*) filter (where org_id is null)
from public.musica_estrutura;

-- 3) Eventos futuros recorrentes: horário convertido para o fuso da regra.
select
  e.id,
  e.local,
  e.data as utc,
  r.tz,
  e.data at time zone r.tz as horario_local,
  r.hora as horario_regra,
  e.recorrencia_id
from public.eventos e
join public.eventos_recorrentes r on r.id = e.recorrencia_id
where e.finalizado = false
order by e.data;

-- 4) Não devem restar webhooks antigos de setlist/presença com segredo literal.
select
  event_object_table as tabela,
  trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'setlist_changed',
    'trg_setlist_changed_del',
    'trg_setlist_changed_ins',
    'trg_setlist_changed_upd',
    'alerta_falta_integrante'
  );

-- 5) Policies de UPDATE/DELETE de eventos/recorrências.
select
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in ('eventos', 'eventos_recorrentes')
  and policyname like 'v14_%'
order by tablename, cmd, policyname;
