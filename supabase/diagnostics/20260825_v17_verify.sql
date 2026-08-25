\pset pager off
\echo '=== v17 / identidade atual ==='
select public.current_identity();

\echo '=== policies abertas restantes no domínio (deve retornar 0) ==='
select schemaname, tablename, policyname, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename = any(array[
     'organizacoes','organizacao_acessos','membro_dispositivos','membros',
     'eventos','eventos_recorrentes','escalas','repertorio','musica_blocos',
     'musica_estrutura','evento_repertorio','repertorio_execucoes',
     'repertorio_live_favoritos','repertorio_notas_membro','repertorio_versoes',
     'evento_operacao','evento_checklist'
   ])
   and (
     coalesce(qual, '') in ('true', '(true)')
     or coalesce(with_check, '') in ('true', '(true)')
   );

\echo '=== policies v17 ==='
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and policyname like '%org%'
 order by tablename, policyname;

\echo '=== integridade org_id ==='
select 'membros' tabela, count(*) filter (where org_id is null) org_id_null from public.membros
union all select 'eventos', count(*) filter (where org_id is null) from public.eventos
union all select 'escalas', count(*) filter (where org_id is null) from public.escalas
union all select 'repertorio', count(*) filter (where org_id is null) from public.repertorio
union all select 'evento_repertorio', count(*) filter (where org_id is null) from public.evento_repertorio
union all select 'musica_estrutura', count(*) filter (where org_id is null) from public.musica_estrutura;

\echo '=== organizações / tokens (sem revelar token) ==='
select id, nome,
       invite_token is not null as possui_invite,
       user_id is not null as possui_owner_auth
  from public.organizacoes
 order by nome;

\echo '=== vínculos Auth ==='
select count(*) as dispositivos_vinculados from public.membro_dispositivos;
select count(*) as acessos_organizacao from public.organizacao_acessos;

\echo '=== grants SELECT sensível de organizacoes ==='
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'organizacoes'
   and grantee in ('anon','authenticated')
 order by grantee, privilege_type, column_name;
