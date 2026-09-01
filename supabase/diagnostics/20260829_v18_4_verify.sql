\pset pager off

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'eventos'
  and column_name in ('cancelado', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento')
order by column_name;

select
  count(*) filter (where cancelado = true) as cancelados,
  count(*) filter (where cancelado = false and finalizado = false) as ativos,
  count(*) filter (where finalizado = true) as historico_total
from public.eventos;

select id, local, data, cancelado, cancelado_em, motivo_cancelamento
from public.eventos
where cancelado = true
order by cancelado_em desc nulls last
limit 10;
