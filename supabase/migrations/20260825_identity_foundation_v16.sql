-- Band Manager v16 — Identity Foundation
-- Objetivo: introduzir identidade real via Supabase Auth sem quebrar o fluxo interno atual.
-- Estratégia:
--   - cada navegador/aparelho pode usar um usuário Auth anônimo;
--   - esse auth.uid() é ligado ao membro selecionado em membro_dispositivos;
--   - localStorage continua como fallback enquanto a migração acontece;
--   - nenhuma policy aberta antiga é removida nesta etapa.

begin;

-- =========================================================
-- 1) FKs opcionais para as colunas user_id já existentes
-- =========================================================

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'membros_user_id_auth_fkey'
       and conrelid = 'public.membros'::regclass
  ) then
    alter table public.membros
      add constraint membros_user_id_auth_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'organizacoes_user_id_auth_fkey'
       and conrelid = 'public.organizacoes'::regclass
  ) then
    alter table public.organizacoes
      add constraint organizacoes_user_id_auth_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists membros_user_id_idx
  on public.membros (user_id)
  where user_id is not null;

create index if not exists organizacoes_user_id_idx
  on public.organizacoes (user_id)
  where user_id is not null;

-- =========================================================
-- 2) Ligação Auth por aparelho
-- =========================================================
-- Não usamos membros.user_id como único vínculo nesta fase porque o mesmo
-- integrante pode abrir o Live em mais de um aparelho. Cada sessão Auth pode
-- apontar para o mesmo membro, enquanto um auth.uid() só representa um perfil
-- ativo por vez.

create table if not exists public.membro_dispositivos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  membro_id uuid not null references public.membros(id) on delete cascade,
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.membro_dispositivos is
  'Vínculo entre uma sessão Supabase Auth do navegador/aparelho e o membro ativo da banda.';

create index if not exists membro_dispositivos_org_membro_idx
  on public.membro_dispositivos (org_id, membro_id);

create or replace function public.validate_membro_dispositivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select m.org_id
    into v_org_id
    from public.membros m
   where m.id = new.membro_id
     and m.ativo = true;

  if v_org_id is null then
    raise exception 'Membro % inexistente, inativo ou sem organização.', new.membro_id;
  end if;

  new.org_id := v_org_id;
  new.updated_at := now();
  new.last_seen_at := coalesce(new.last_seen_at, now());
  return new;
end;
$$;

drop trigger if exists trg_validate_membro_dispositivo on public.membro_dispositivos;
create trigger trg_validate_membro_dispositivo
before insert or update of membro_id, org_id, last_seen_at
on public.membro_dispositivos
for each row
execute function public.validate_membro_dispositivo();

-- =========================================================
-- 3) RLS da tabela de vínculo — já nasce fechada corretamente
-- =========================================================

grant select, insert, update, delete on public.membro_dispositivos to authenticated;

alter table public.membro_dispositivos enable row level security;

drop policy if exists membro_dispositivos_select_own on public.membro_dispositivos;
create policy membro_dispositivos_select_own
on public.membro_dispositivos
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists membro_dispositivos_insert_own on public.membro_dispositivos;
create policy membro_dispositivos_insert_own
on public.membro_dispositivos
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
      from public.membros m
     where m.id = membro_dispositivos.membro_id
       and m.org_id = membro_dispositivos.org_id
       and m.ativo = true
  )
);

drop policy if exists membro_dispositivos_update_own on public.membro_dispositivos;
create policy membro_dispositivos_update_own
on public.membro_dispositivos
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
      from public.membros m
     where m.id = membro_dispositivos.membro_id
       and m.org_id = membro_dispositivos.org_id
       and m.ativo = true
  )
);

drop policy if exists membro_dispositivos_delete_own on public.membro_dispositivos;
create policy membro_dispositivos_delete_own
on public.membro_dispositivos
for delete
to authenticated
using (user_id = auth.uid());

-- =========================================================
-- 4) Helpers de identidade para a próxima fase de RLS
-- =========================================================

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select md.membro_id
        from public.membro_dispositivos md
       where md.user_id = auth.uid()
       limit 1
    ),
    (
      select m.id
        from public.membros m
       where m.user_id = auth.uid()
       limit 1
    )
  );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select md.org_id
        from public.membro_dispositivos md
       where md.user_id = auth.uid()
       limit 1
    ),
    (
      select m.org_id
        from public.membros m
       where m.user_id = auth.uid()
       limit 1
    ),
    (
      select o.id
        from public.organizacoes o
       where o.user_id = auth.uid()
       limit 1
    )
  );
$$;

create or replace function public.current_identity()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'auth_user_id', auth.uid(),
    'org_id', public.current_org_id(),
    'membro_id', public.current_member_id(),
    'linked', public.current_org_id() is not null
  );
$$;

grant execute on function public.current_member_id() to authenticated;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_identity() to authenticated;

commit;
