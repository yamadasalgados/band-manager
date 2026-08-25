-- Band Manager v15 — Event Profiles + Foundation Step 1
-- Cria dois níveis de preparação de evento sem duplicar entidades:
--   simples  = culto/evento corriqueiro
--   completo = produção que exige logística/checklist
-- Também endurece duas relações que a v14 já saneou e adiciona índices do fluxo principal.

begin;

-- =========================================================
-- 1) PERFIL DE PREPARAÇÃO
-- =========================================================

alter table public.eventos
  add column if not exists modo_preparacao text not null default 'simples';

alter table public.eventos_recorrentes
  add column if not exists modo_preparacao text not null default 'simples';

update public.eventos
set modo_preparacao = 'simples'
where modo_preparacao is null or modo_preparacao not in ('simples', 'completo');

update public.eventos_recorrentes
set modo_preparacao = 'simples'
where modo_preparacao is null or modo_preparacao not in ('simples', 'completo');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'eventos_modo_preparacao_check'
      and conrelid = 'public.eventos'::regclass
  ) then
    alter table public.eventos
      add constraint eventos_modo_preparacao_check
      check (modo_preparacao in ('simples', 'completo'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'eventos_recorrentes_modo_preparacao_check'
      and conrelid = 'public.eventos_recorrentes'::regclass
  ) then
    alter table public.eventos_recorrentes
      add constraint eventos_recorrentes_modo_preparacao_check
      check (modo_preparacao in ('simples', 'completo'));
  end if;
end $$;

comment on column public.eventos.modo_preparacao is
  'simples = preparação essencial; completo = logística/checklist/produção avançada';
comment on column public.eventos_recorrentes.modo_preparacao is
  'Modo herdado pelas ocorrências geradas pela recorrência';

-- =========================================================
-- 2) RECORRÊNCIA HERDA O PERFIL
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

      v_evento_id := null;

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
           set recorrencia_id = coalesce(recorrencia_id, regra.id),
               modo_preparacao = coalesce(regra.modo_preparacao, 'simples')
         where id = v_evento_id;
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
         set recorrencia_id = regra.id,
             modo_preparacao = coalesce(regra.modo_preparacao, 'simples')
       where id = v_evento_id;
    end loop;
  end loop;
end;
$$;

-- Ocorrências futuras já vinculadas passam a refletir o perfil da regra.
update public.eventos e
set modo_preparacao = r.modo_preparacao
from public.eventos_recorrentes r
where e.recorrencia_id = r.id
  and e.finalizado = false
  and e.data >= now();

-- =========================================================
-- 3) FOUNDATION: ORG_ID OBRIGATÓRIO NAS RELAÇÕES JÁ SANEADAS
-- =========================================================
-- A v14 zerou os NULLs e adicionou triggers que preenchem org_id automaticamente.

alter table public.evento_repertorio
  alter column org_id set not null;

alter table public.musica_estrutura
  alter column org_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'evento_repertorio_org_id_fkey'
      and conrelid = 'public.evento_repertorio'::regclass
  ) then
    alter table public.evento_repertorio
      add constraint evento_repertorio_org_id_fkey
      foreign key (org_id) references public.organizacoes(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'musica_estrutura_org_id_fkey'
      and conrelid = 'public.musica_estrutura'::regclass
  ) then
    alter table public.musica_estrutura
      add constraint musica_estrutura_org_id_fkey
      foreign key (org_id) references public.organizacoes(id) on delete cascade;
  end if;
end $$;

-- =========================================================
-- 4) FOUNDATION: ÍNDICES DOS FLUXOS MAIS USADOS
-- =========================================================

create index if not exists eventos_org_finalizado_data_idx
  on public.eventos (org_id, finalizado, data);

create index if not exists evento_repertorio_evento_ordem_idx
  on public.evento_repertorio (evento_id, ordem);

create index if not exists evento_repertorio_org_evento_idx
  on public.evento_repertorio (org_id, evento_id);

create index if not exists musica_estrutura_repertorio_posicao_idx
  on public.musica_estrutura (repertorio_id, posicao);

create index if not exists musica_estrutura_org_repertorio_idx
  on public.musica_estrutura (org_id, repertorio_id);

create index if not exists escalas_evento_status_idx
  on public.escalas (evento_id, status);

commit;
