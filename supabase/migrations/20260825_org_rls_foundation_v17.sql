-- Band Manager v17 — RLS por organização + convites protegidos
-- Pré-requisitos lógicos: v14/v15/v16. O script é defensivo e recria os helpers necessários.
-- Objetivos:
--   1) fechar o acesso direto cross-org;
--   2) manter o onboarding via Auth anônimo;
--   3) substituir links ?org=<uuid> por convite com token;
--   4) permitir login de uma organização sem expor email_admin/pin_acesso ao browser;
--   5) preparar a remoção definitiva do modo legado.

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1) Token de convite e acesso de organização por sessão Auth
-- =========================================================

alter table public.organizacoes
  add column if not exists invite_token uuid;

update public.organizacoes
   set invite_token = gen_random_uuid()
 where invite_token is null;

alter table public.organizacoes
  alter column invite_token set default gen_random_uuid();

alter table public.organizacoes
  alter column invite_token set not null;

create unique index if not exists organizacoes_invite_token_key
  on public.organizacoes(invite_token);

create table if not exists public.organizacao_acessos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists organizacao_acessos_org_idx
  on public.organizacao_acessos(org_id);

-- v17 é cumulativa: se a v16 ainda não tiver sido aplicada, cria a base de identidade aqui.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'membros_user_id_auth_fkey'
       and conrelid = 'public.membros'::regclass
  ) then
    alter table public.membros
      add constraint membros_user_id_auth_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'organizacoes_user_id_auth_fkey'
       and conrelid = 'public.organizacoes'::regclass
  ) then
    alter table public.organizacoes
      add constraint organizacoes_user_id_auth_fkey
      foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create table if not exists public.membro_dispositivos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  membro_id uuid not null references public.membros(id) on delete cascade,
  org_id uuid not null references public.organizacoes(id) on delete cascade,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists membro_dispositivos_org_membro_idx
  on public.membro_dispositivos(org_id, membro_id);

create or replace function public.validate_membro_dispositivo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select m.org_id into v_org_id
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
for each row execute function public.validate_membro_dispositivo();

-- Organizações que já possuíam user_id viram owner no novo mapa de acesso.
insert into public.organizacao_acessos(user_id, org_id, role)
select o.user_id, o.id, 'owner'
  from public.organizacoes o
 where o.user_id is not null
on conflict (user_id) do update
  set org_id = excluded.org_id,
      role = case when public.organizacao_acessos.role = 'owner' then 'owner' else excluded.role end,
      updated_at = now(),
      last_seen_at = now();

create or replace function public.bootstrap_org_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    insert into public.organizacao_acessos(user_id, org_id, role)
    values (new.user_id, new.id, 'owner')
    on conflict (user_id) do update
      set org_id = excluded.org_id,
          role = 'owner',
          updated_at = now(),
          last_seen_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bootstrap_org_access on public.organizacoes;
create trigger trg_bootstrap_org_access
after insert or update of user_id
on public.organizacoes
for each row execute function public.bootstrap_org_access();

-- =========================================================
-- 2) Helpers definitivos de identidade
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
      select oa.org_id
        from public.organizacao_acessos oa
       where oa.user_id = auth.uid()
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

create or replace function public.current_org_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select oa.role
        from public.organizacao_acessos oa
       where oa.user_id = auth.uid()
       limit 1
    ),
    (
      select 'owner'::text
        from public.organizacoes o
       where o.user_id = auth.uid()
       limit 1
    ),
    case when public.current_member_id() is not null then 'member'::text else null end
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
    'role', public.current_org_role(),
    'linked', public.current_org_id() is not null
  );
$$;

create or replace function public.belongs_to_current_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and p_org_id is not null
     and p_org_id = public.current_org_id();
$$;

create or replace function public.belongs_to_current_org_text(p_org_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and nullif(trim(p_org_id), '') is not null
     and p_org_id = public.current_org_id()::text;
$$;

create or replace function public.repertorio_is_current_org(p_repertorio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.repertorio r
     where r.id = p_repertorio_id
       and r.org_id = public.current_org_id()
  );
$$;

grant execute on function public.current_member_id() to authenticated;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_org_role() to authenticated;
grant execute on function public.current_identity() to authenticated;
grant execute on function public.belongs_to_current_org(uuid) to authenticated;
grant execute on function public.belongs_to_current_org_text(text) to authenticated;
grant execute on function public.repertorio_is_current_org(uuid) to authenticated;

revoke execute on function public.current_member_id() from public, anon;
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.current_org_role() from public, anon;
revoke execute on function public.current_identity() from public, anon;
revoke execute on function public.belongs_to_current_org(uuid) from public, anon;
revoke execute on function public.belongs_to_current_org_text(text) from public, anon;
revoke execute on function public.repertorio_is_current_org(uuid) from public, anon;

-- RPC administrativa SECURITY DEFINER antiga: somente backend/service role.
revoke execute on function public.criar_evento_e_escalar(uuid, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.criar_evento_e_escalar(uuid, text, timestamptz, text, boolean) to service_role;

-- Cálculo de recorrência também é usado pelo backend, não pelo navegador.
revoke execute on function public.calcular_proximo_timestamp(integer, time, text) from public, anon, authenticated;
grant execute on function public.calcular_proximo_timestamp(integer, time, text) to service_role;

-- Jobs internos não devem virar RPC pública via PostgREST.
revoke execute on function public.arquivar_eventos_passados() from public, anon, authenticated;
revoke execute on function public.gerar_eventos_recorrentes() from public, anon, authenticated;
revoke execute on function public.gerar_eventos_recorrentes_proxima_semana() from public, anon, authenticated;

-- =========================================================
-- 3) RPCs seguras para um dispositivo ainda não vinculado
-- =========================================================

create or replace function public.get_org_join_info(
  p_org_id uuid,
  p_invite_token uuid
)
returns table (
  id uuid,
  nome text,
  slug text,
  status_assinatura text,
  data_expiracao timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select o.id, o.nome, o.slug, o.status_assinatura, o.data_expiracao
    from public.organizacoes o
   where o.id = p_org_id
     and o.invite_token = p_invite_token;
end;
$$;

create or replace function public.list_joinable_members(
  p_org_id uuid,
  p_invite_token uuid
)
returns table (
  id uuid,
  nome text,
  funcao text,
  subfuncao text[],
  org_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.organizacoes o
     where o.id = p_org_id and o.invite_token = p_invite_token
  ) then
    raise exception 'Invalid invite';
  end if;

  return query
  select m.id, m.nome, m.funcao, m.subfuncao, m.org_id
    from public.membros m
   where m.org_id = p_org_id
     and m.ativo = true
   order by m.nome;
end;
$$;

create or replace function public.join_org_as_member(
  p_org_id uuid,
  p_invite_token uuid,
  p_membro_id uuid,
  p_device_label text default null
)
returns table (
  id uuid,
  nome text,
  funcao text,
  subfuncao text[],
  org_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.organizacoes o
     where o.id = p_org_id and o.invite_token = p_invite_token
  ) then
    raise exception 'Invalid invite';
  end if;

  if not exists (
    select 1 from public.membros m
     where m.id = p_membro_id and m.org_id = p_org_id and m.ativo = true
  ) then
    raise exception 'Member unavailable';
  end if;

  insert into public.membro_dispositivos(user_id, membro_id, org_id, device_label, last_seen_at, updated_at)
  values (auth.uid(), p_membro_id, p_org_id, p_device_label, now(), now())
  on conflict (user_id) do update
    set membro_id = excluded.membro_id,
        org_id = excluded.org_id,
        device_label = excluded.device_label,
        last_seen_at = now(),
        updated_at = now();

  return query
  select m.id, m.nome, m.funcao, m.subfuncao, m.org_id
    from public.membros m
   where m.id = p_membro_id;
end;
$$;

create or replace function public.join_org_create_member(
  p_org_id uuid,
  p_invite_token uuid,
  p_nome text,
  p_funcao text,
  p_whatsapp text default null,
  p_subfuncao text[] default '{}'::text[],
  p_device_label text default null
)
returns table (
  id uuid,
  nome text,
  funcao text,
  subfuncao text[],
  org_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membro_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.organizacoes o
     where o.id = p_org_id and o.invite_token = p_invite_token
  ) then
    raise exception 'Invalid invite';
  end if;

  if nullif(trim(p_nome), '') is null or nullif(trim(p_funcao), '') is null then
    raise exception 'Name and function are required';
  end if;

  insert into public.membros as m(nome, funcao, whatsapp, subfuncao, ativo, org_id)
  values (trim(p_nome), trim(p_funcao), nullif(trim(coalesce(p_whatsapp, '')), ''), coalesce(p_subfuncao, '{}'::text[]), true, p_org_id)
  returning m.id into v_membro_id;

  insert into public.membro_dispositivos(user_id, membro_id, org_id, device_label, last_seen_at, updated_at)
  values (auth.uid(), v_membro_id, p_org_id, p_device_label, now(), now())
  on conflict (user_id) do update
    set membro_id = excluded.membro_id,
        org_id = excluded.org_id,
        device_label = excluded.device_label,
        last_seen_at = now(),
        updated_at = now();

  return query
  select m.id, m.nome, m.funcao, m.subfuncao, m.org_id
    from public.membros m
   where m.id = v_membro_id;
end;
$$;

grant execute on function public.get_org_join_info(uuid, uuid) to authenticated;
grant execute on function public.list_joinable_members(uuid, uuid) to authenticated;
grant execute on function public.join_org_as_member(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.join_org_create_member(uuid, uuid, text, text, text, text[], text) to authenticated;

revoke execute on function public.get_org_join_info(uuid, uuid) from public, anon;
revoke execute on function public.list_joinable_members(uuid, uuid) from public, anon;
revoke execute on function public.join_org_as_member(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.join_org_create_member(uuid, uuid, text, text, text, text[], text) from public, anon;

-- =========================================================
-- 4) Integridade org_id — agora obrigatória no núcleo
-- =========================================================

do $$
begin
  if exists (select 1 from public.membros where org_id is null) then
    raise exception 'v17 abortado: membros.org_id ainda possui NULL';
  end if;
  if exists (select 1 from public.eventos where org_id is null) then
    raise exception 'v17 abortado: eventos.org_id ainda possui NULL';
  end if;
  if exists (select 1 from public.escalas where org_id is null) then
    raise exception 'v17 abortado: escalas.org_id ainda possui NULL';
  end if;
  if exists (select 1 from public.repertorio where org_id is null) then
    raise exception 'v17 abortado: repertorio.org_id ainda possui NULL';
  end if;
end $$;

alter table public.membros alter column org_id set not null;
alter table public.eventos alter column org_id set not null;
alter table public.escalas alter column org_id set not null;
alter table public.repertorio alter column org_id set not null;
alter table public.evento_repertorio alter column org_id set not null;
alter table public.musica_estrutura alter column org_id set not null;

-- =========================================================
-- 5) Limpa policies antigas/temporárias e cria RLS por organização
-- =========================================================

do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = any(array[
         'organizacoes','organizacao_acessos','membro_dispositivos','membros',
         'eventos','eventos_recorrentes','escalas','repertorio','musica_blocos',
         'musica_estrutura','evento_repertorio','repertorio_execucoes',
         'repertorio_live_favoritos','repertorio_notas_membro','repertorio_versoes',
         'evento_operacao','evento_checklist','configuracao_eventos_fixos',
         'controle_recorrente','evento_estrutura_custom','presenca_recorrente',
         'setlists','setlist_itens'
       ])
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- RLS ligado em todas as tabelas que fazem parte do domínio.
alter table public.organizacoes enable row level security;
alter table public.organizacao_acessos enable row level security;
alter table public.membro_dispositivos enable row level security;
alter table public.membros enable row level security;
alter table public.eventos enable row level security;
alter table public.eventos_recorrentes enable row level security;
alter table public.escalas enable row level security;
alter table public.repertorio enable row level security;
alter table public.musica_blocos enable row level security;
alter table public.musica_estrutura enable row level security;
alter table public.evento_repertorio enable row level security;
alter table public.repertorio_execucoes enable row level security;
alter table public.repertorio_live_favoritos enable row level security;
alter table public.repertorio_notas_membro enable row level security;
alter table public.repertorio_versoes enable row level security;
alter table public.evento_operacao enable row level security;
alter table public.evento_checklist enable row level security;
alter table public.configuracao_eventos_fixos enable row level security;
alter table public.controle_recorrente enable row level security;
alter table public.evento_estrutura_custom enable row level security;
alter table public.presenca_recorrente enable row level security;
alter table public.setlists enable row level security;
alter table public.setlist_itens enable row level security;

-- Organizacoes: criação por Auth real; depois somente a organização atual.
create policy org_select_current on public.organizacoes
for select to authenticated
using (id = public.current_org_id());

create policy org_insert_own on public.organizacoes
for insert to authenticated
with check (user_id = auth.uid());

create policy org_update_current on public.organizacoes
for update to authenticated
using (id = public.current_org_id())
with check (id = public.current_org_id());

create policy org_delete_current on public.organizacoes
for delete to authenticated
using (id = public.current_org_id());

-- Acesso administrativo: cada sessão só enxerga sua própria linha.
create policy org_access_select_own on public.organizacao_acessos
for select to authenticated
using (user_id = auth.uid());

create policy org_access_delete_own on public.organizacao_acessos
for delete to authenticated
using (user_id = auth.uid());

-- Vínculo de aparelho: somente a própria sessão. Novos convites usam os RPCs acima.
create policy device_select_own on public.membro_dispositivos
for select to authenticated
using (user_id = auth.uid());

create policy device_insert_current_org on public.membro_dispositivos
for insert to authenticated
with check (user_id = auth.uid() and org_id = public.current_org_id());

create policy device_update_own on public.membro_dispositivos
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and org_id = public.current_org_id());

create policy device_delete_own on public.membro_dispositivos
for delete to authenticated
using (user_id = auth.uid());

-- Tabelas UUID com org_id direto.
create policy membros_org_all on public.membros
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy eventos_org_all on public.eventos
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy recorrencias_org_all on public.eventos_recorrentes
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy escalas_org_all on public.escalas
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy repertorio_org_all on public.repertorio
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy musica_estrutura_org_all on public.musica_estrutura
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy evento_repertorio_org_all on public.evento_repertorio
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

-- Blocos não possuem org_id próprio; derivam do repertório.
create policy musica_blocos_org_all on public.musica_blocos
for all to authenticated
using (public.repertorio_is_current_org(repertorio_id))
with check (public.repertorio_is_current_org(repertorio_id));

-- Tabelas v8/v10/v13 usam org_id TEXT por compatibilidade.
create policy execucoes_org_all on public.repertorio_execucoes
for all to authenticated
using (public.belongs_to_current_org_text(org_id))
with check (public.belongs_to_current_org_text(org_id));

create policy favoritos_org_all on public.repertorio_live_favoritos
for all to authenticated
using (public.belongs_to_current_org_text(org_id))
with check (public.belongs_to_current_org_text(org_id));

create policy notas_org_all on public.repertorio_notas_membro
for all to authenticated
using (public.belongs_to_current_org_text(org_id))
with check (public.belongs_to_current_org_text(org_id));

create policy versoes_org_all on public.repertorio_versoes
for all to authenticated
using (public.belongs_to_current_org_text(org_id))
with check (public.belongs_to_current_org_text(org_id));

create policy operacao_org_all on public.evento_operacao
for all to authenticated
using (public.belongs_to_current_org_text(org_id))
with check (public.belongs_to_current_org_text(org_id));

create policy checklist_org_all on public.evento_checklist
for all to authenticated
using (public.belongs_to_current_org_text(org_id))
with check (public.belongs_to_current_org_text(org_id));

-- Legado ainda existente: fechado por org até decidirmos removê-lo.
create policy config_fixos_org_all on public.configuracao_eventos_fixos
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy controle_recorrente_org_all on public.controle_recorrente
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy estrutura_custom_org_all on public.evento_estrutura_custom
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy presenca_recorrente_org_all on public.presenca_recorrente
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy setlists_org_all on public.setlists
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

create policy setlist_itens_org_all on public.setlist_itens
for all to authenticated
using (org_id = public.current_org_id())
with check (org_id = public.current_org_id());

-- =========================================================
-- 6) Privileges: o browser sem sessão Auth não lê mais dados privados
-- =========================================================

revoke all on table public.organizacoes from anon;
revoke all on table public.organizacao_acessos from anon;
revoke all on table public.membro_dispositivos from anon;
revoke all on table public.membros from anon;
revoke all on table public.eventos from anon;
revoke all on table public.eventos_recorrentes from anon;
revoke all on table public.escalas from anon;
revoke all on table public.repertorio from anon;
revoke all on table public.musica_blocos from anon;
revoke all on table public.musica_estrutura from anon;
revoke all on table public.evento_repertorio from anon;
revoke all on table public.repertorio_execucoes from anon;
revoke all on table public.repertorio_live_favoritos from anon;
revoke all on table public.repertorio_notas_membro from anon;
revoke all on table public.repertorio_versoes from anon;
revoke all on table public.evento_operacao from anon;
revoke all on table public.evento_checklist from anon;
revoke all on table public.configuracao_eventos_fixos from anon;
revoke all on table public.controle_recorrente from anon;
revoke all on table public.evento_estrutura_custom from anon;
revoke all on table public.presenca_recorrente from anon;
revoke all on table public.setlists from anon;
revoke all on table public.setlist_itens from anon;

-- Grants gerais autenticados (RLS continua decidindo quais linhas passam).
grant select, insert, update, delete on table public.organizacao_acessos to authenticated;
grant select, insert, update, delete on table public.membro_dispositivos to authenticated;
grant select, insert, update, delete on table public.membros to authenticated;
grant select, insert, update, delete on table public.eventos to authenticated;
grant select, insert, update, delete on table public.eventos_recorrentes to authenticated;
grant select, insert, update, delete on table public.escalas to authenticated;
grant select, insert, update, delete on table public.repertorio to authenticated;
grant select, insert, update, delete on table public.musica_blocos to authenticated;
grant select, insert, update, delete on table public.musica_estrutura to authenticated;
grant select, insert, update, delete on table public.evento_repertorio to authenticated;
grant select, insert, update, delete on table public.repertorio_execucoes to authenticated;
grant select, insert, update, delete on table public.repertorio_live_favoritos to authenticated;
grant select, insert, update, delete on table public.repertorio_notas_membro to authenticated;
grant select, insert, update, delete on table public.repertorio_versoes to authenticated;
grant select, insert, update, delete on table public.evento_operacao to authenticated;
grant select, insert, update, delete on table public.evento_checklist to authenticated;
grant select, insert, update, delete on table public.configuracao_eventos_fixos to authenticated;
grant select, insert, update, delete on table public.controle_recorrente to authenticated;
grant select, insert, update, delete on table public.evento_estrutura_custom to authenticated;
grant select, insert, update, delete on table public.presenca_recorrente to authenticated;
grant select, insert, update, delete on table public.setlists to authenticated;
grant select, insert, update, delete on table public.setlist_itens to authenticated;

-- Organizacoes recebe grants por coluna para não expor PIN/email/token em SELECT.
revoke all on table public.organizacoes from authenticated;
grant select (id, nome, slug, created_at, status_assinatura, data_expiracao, user_id)
  on public.organizacoes to authenticated;
grant insert (nome, slug, status_assinatura, email_admin, pin_acesso, user_id)
  on public.organizacoes to authenticated;
grant update (nome, slug, pin_acesso)
  on public.organizacoes to authenticated;
grant delete on public.organizacoes to authenticated;

-- Sequences das tabelas bigint usadas pelo browser.
revoke all on all sequences in schema public from anon;
grant usage, select on all sequences in schema public to authenticated;

commit;
