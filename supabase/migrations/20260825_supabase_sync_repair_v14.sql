-- Band Manager — Supabase Sync Repair v14
-- Objetivo: alinhar o schema remoto com as features v8-v13 e corrigir
-- recorrência/timezone, org_id e notificações duplicadas.
--
-- IMPORTANTE:
-- As policies abaixo são deliberadamente funcionais para o estágio interno atual.
-- O app ainda usa identidade operacional via localStorage e não possui org_id
-- confiável em auth.jwt(). Antes de publicação pública, substituir por RLS real
-- baseado em usuário autenticado + organização.

begin;

-- =========================================================
-- 1) BACKFILL + PROTEÇÃO DE org_id
-- =========================================================

update public.evento_repertorio er
set org_id = e.org_id
from public.eventos e
where er.evento_id = e.id
  and er.org_id is null
  and e.org_id is not null;

update public.musica_estrutura me
set org_id = r.org_id
from public.repertorio r
where me.repertorio_id = r.id
  and me.org_id is null
  and r.org_id is not null;

create or replace function public.sync_evento_repertorio_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select e.org_id
    into v_org_id
    from public.eventos e
   where e.id = new.evento_id;

  if v_org_id is null then
    raise exception 'evento_repertorio: evento % sem organização válida', new.evento_id;
  end if;

  new.org_id := v_org_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_evento_repertorio_org_id on public.evento_repertorio;
create trigger trg_sync_evento_repertorio_org_id
before insert or update of evento_id, org_id
on public.evento_repertorio
for each row
execute function public.sync_evento_repertorio_org_id();

create or replace function public.sync_musica_estrutura_org_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select r.org_id
    into v_org_id
    from public.repertorio r
   where r.id = new.repertorio_id;

  if v_org_id is null then
    raise exception 'musica_estrutura: repertório % sem organização válida', new.repertorio_id;
  end if;

  new.org_id := v_org_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_musica_estrutura_org_id on public.musica_estrutura;
create trigger trg_sync_musica_estrutura_org_id
before insert or update of repertorio_id, org_id
on public.musica_estrutura
for each row
execute function public.sync_musica_estrutura_org_id();


-- =========================================================
-- 2) RLS FUNCIONAL PARA v8 / v10 / v13
-- =========================================================
-- Default-deny estava impedindo o browser de persistir as features novas.
-- Estas policies mantêm o modelo interno atual. Hardening de produção virá
-- depois que membros.user_id/auth estiverem efetivamente vinculados.

grant select, insert, update, delete on public.repertorio_execucoes to anon, authenticated;
grant select, insert, update, delete on public.repertorio_live_favoritos to anon, authenticated;
grant select, insert, update, delete on public.repertorio_notas_membro to anon, authenticated;
grant select, insert, update, delete on public.repertorio_versoes to anon, authenticated;
grant select, insert, update, delete on public.evento_operacao to anon, authenticated;
grant select, insert, update, delete on public.evento_checklist to anon, authenticated;

grant usage, select on sequence public.repertorio_execucoes_id_seq to anon, authenticated;
grant usage, select on sequence public.repertorio_versoes_id_seq to anon, authenticated;
grant usage, select on sequence public.evento_checklist_id_seq to anon, authenticated;

alter table public.repertorio_execucoes enable row level security;
alter table public.repertorio_live_favoritos enable row level security;
alter table public.repertorio_notas_membro enable row level security;
alter table public.repertorio_versoes enable row level security;
alter table public.evento_operacao enable row level security;
alter table public.evento_checklist enable row level security;

drop policy if exists v14_internal_access on public.repertorio_execucoes;
create policy v14_internal_access
on public.repertorio_execucoes
for all
to anon, authenticated
using (org_id is not null and btrim(org_id) <> '')
with check (org_id is not null and btrim(org_id) <> '');

drop policy if exists v14_internal_access on public.repertorio_live_favoritos;
create policy v14_internal_access
on public.repertorio_live_favoritos
for all
to anon, authenticated
using (org_id is not null and btrim(org_id) <> '')
with check (org_id is not null and btrim(org_id) <> '');

drop policy if exists v14_internal_access on public.repertorio_notas_membro;
create policy v14_internal_access
on public.repertorio_notas_membro
for all
to anon, authenticated
using (org_id is not null and btrim(org_id) <> '')
with check (org_id is not null and btrim(org_id) <> '');

drop policy if exists v14_internal_access on public.repertorio_versoes;
create policy v14_internal_access
on public.repertorio_versoes
for all
to anon, authenticated
using (org_id is not null and btrim(org_id) <> '')
with check (org_id is not null and btrim(org_id) <> '');

drop policy if exists v14_internal_access on public.evento_operacao;
create policy v14_internal_access
on public.evento_operacao
for all
to anon, authenticated
using (org_id is not null and btrim(org_id) <> '')
with check (org_id is not null and btrim(org_id) <> '');

drop policy if exists v14_internal_access on public.evento_checklist;
create policy v14_internal_access
on public.evento_checklist
for all
to anon, authenticated
using (org_id is not null and btrim(org_id) <> '')
with check (org_id is not null and btrim(org_id) <> '');


-- =========================================================
-- 3) EVENTOS / RECORRÊNCIAS: UPDATE E DELETE
-- =========================================================

grant update, delete on public.eventos to anon, authenticated;
grant update, delete on public.eventos_recorrentes to anon, authenticated;

drop policy if exists v14_update_eventos on public.eventos;
create policy v14_update_eventos
on public.eventos
for update
to anon, authenticated
using (org_id is not null)
with check (org_id is not null);

drop policy if exists v14_delete_eventos on public.eventos;
create policy v14_delete_eventos
on public.eventos
for delete
to anon, authenticated
using (org_id is not null);

-- A policy antiga dependia de membros.user_id, que hoje está NULL na base.
drop policy if exists delete_eventos_recorrentes on public.eventos_recorrentes;
drop policy if exists v14_delete_eventos_recorrentes on public.eventos_recorrentes;

create policy v14_delete_eventos_recorrentes
on public.eventos_recorrentes
for delete
to anon, authenticated
using (org_id is not null);


-- =========================================================
-- 4) RECORRÊNCIA COM TIMEZONE CORRETO + recorrencia_id
-- =========================================================

create or replace function public.gerar_eventos_recorrentes_proxima_semana()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  regra record;
  dia_semana_alvo int;
  data_calculada timestamptz;
  data_local date;
  v_evento_id uuid;
begin
  for regra in
    select *
      from public.eventos_recorrentes
     where ativo = true
  loop
    foreach dia_semana_alvo in array regra.dias_semana
    loop
      data_calculada := public.calcular_proximo_timestamp(
        dia_semana_alvo,
        regra.hora,
        regra.tz
      );

      data_local := (data_calculada at time zone regra.tz)::date;

      if data_local < regra.data_inicio then
        continue;
      end if;

      if regra.data_fim is not null and data_local > regra.data_fim then
        continue;
      end if;

      -- Primeiro tenta reaproveitar uma ocorrência já existente no horário correto.
      select e.id
        into v_evento_id
        from public.eventos e
       where e.org_id = regra.org_id
         and e.local = regra.local
         and e.data = data_calculada
       order by e.created_at asc
       limit 1;

      if v_evento_id is not null then
        update public.eventos
           set recorrencia_id = regra.id
         where id = v_evento_id
           and recorrencia_id is null;
        continue;
      end if;

      v_evento_id := public.criar_evento_e_escalar(
        p_org_id := regra.org_id,
        p_local := regra.local,
        p_data := data_calculada,
        p_paleta := regra.paleta_cores,
        p_auto_escalar := regra.auto_escalar
      );

      update public.eventos
         set recorrencia_id = regra.id
       where id = v_evento_id;
    end loop;
  end loop;
end;
$$;

-- Corrige somente ocorrências FUTURAS que carregam a assinatura do bug antigo:
-- recorrencia_id NULL + mesmo local/org + timestamp UTC com o mesmo dia/hora
-- cadastrados na regra. Histórico finalizado não é alterado.
with candidatos as (
  select
    e.id as evento_id,
    r.id as recorrencia_id,
    (
      ((e.data at time zone 'UTC')::date + r.hora)
      at time zone r.tz
    ) as data_corrigida
  from public.eventos e
  join public.eventos_recorrentes r
    on r.org_id = e.org_id
   and r.local = e.local
   and r.ativo = true
  where e.recorrencia_id is null
    and e.finalizado = false
    and e.data >= now()
    and extract(dow from (e.data at time zone 'UTC'))::int = any(r.dias_semana)
    and (e.data at time zone 'UTC')::time = r.hora
),
seguros as (
  select c.*
  from candidatos c
  where not exists (
    select 1
    from public.eventos outro
    where outro.id <> c.evento_id
      and outro.recorrencia_id = c.recorrencia_id
      and outro.data = c.data_corrigida
  )
)
update public.eventos e
set data = s.data_corrigida,
    recorrencia_id = s.recorrencia_id
from seguros s
where e.id = s.evento_id;


-- =========================================================
-- 5) NOTIFICAÇÕES: UMA ÚNICA ARQUITETURA, SEM SEGREDO NO SCHEMA
-- =========================================================
-- O app já envia push através de /api/onesignal/send.
-- Removemos webhooks do banco que duplicavam mensagens e continham um JWT
-- privilegiado literal dentro da definição do trigger.

drop trigger if exists setlist_changed on public.evento_repertorio;
drop trigger if exists trg_setlist_changed_del on public.evento_repertorio;
drop trigger if exists trg_setlist_changed_ins on public.evento_repertorio;
drop trigger if exists trg_setlist_changed_upd on public.evento_repertorio;
drop trigger if exists alerta_falta_integrante on public.escalas;

drop function if exists public.notify_setlist_change();
drop function if exists public.notify_setlist_changed();
drop function if exists public.notify_setlist_changed_stmt();
drop function if exists public.queue_setlist_push();

commit;
