\pset pager off

-- Distribuição dos modos.
select modo_preparacao, count(*)
from public.eventos
group by modo_preparacao
order by modo_preparacao;

-- Regras recorrentes e ocorrências futuras devem herdar o mesmo modo.
select
  r.id as recorrencia_id,
  r.local,
  r.modo_preparacao as modo_regra,
  e.id as evento_id,
  e.modo_preparacao as modo_evento,
  e.data
from public.eventos_recorrentes r
left join public.eventos e
  on e.recorrencia_id = r.id
 and e.finalizado = false
 and e.data >= now()
order by r.local, e.data;

-- Relações endurecidas pela v15.
select 'evento_repertorio' as tabela, count(*) filter (where org_id is null) as org_id_null
from public.evento_repertorio
union all
select 'musica_estrutura', count(*) filter (where org_id is null)
from public.musica_estrutura;

-- Constraints de modo e NOT NULL.
select table_name, column_name, is_nullable, column_default
from information_schema.columns
where table_schema='public'
  and table_name in ('eventos','eventos_recorrentes','evento_repertorio','musica_estrutura')
  and column_name in ('modo_preparacao','org_id')
order by table_name, column_name;
