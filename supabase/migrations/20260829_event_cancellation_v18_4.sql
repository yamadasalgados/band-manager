begin;

alter table public.eventos
  add column if not exists cancelado boolean not null default false,
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid,
  add column if not exists motivo_cancelamento text;

-- Mantém a semântica histórica: cancelado sai da agenda ativa e permanece no histórico.
update public.eventos
set finalizado = true
where cancelado = true
  and coalesce(finalizado, false) = false;

create index if not exists eventos_org_cancelado_data_idx
  on public.eventos (org_id, cancelado, finalizado, data);

comment on column public.eventos.cancelado is
  'Indica cancelamento operacional do evento sem apagar seu histórico.';
comment on column public.eventos.cancelado_em is
  'Momento em que o evento foi cancelado.';
comment on column public.eventos.cancelado_por is
  'auth.users.id da sessão que confirmou o cancelamento.';
comment on column public.eventos.motivo_cancelamento is
  'Motivo opcional informado no cancelamento.';

commit;
