# Baseline do Supabase depois da v14

O repositório recebido contém migrations apenas a partir da v8, enquanto o banco remoto
já possui tabelas/funções anteriores. Não coloque o dump antigo no Git porque ele contém
definições históricas de webhook com credencial privilegiada.

Depois de:

1. aplicar `20260825_supabase_sync_repair_v14.sql`;
2. rotacionar a chave privilegiada que apareceu no dump antigo;
3. confirmar o diagnóstico da v14;

gere uma baseline NOVA e sanitizada diretamente do banco corrigido:

```bash
pg_dump   --schema=public   --schema-only   --no-owner   --no-privileges   > supabase/baseline/public-schema-after-v14.sql
```

Antes de versionar, confira que não há segredos literais:

```bash
grep -nE "Authorization|Bearer|service_role|secret"   supabase/baseline/public-schema-after-v14.sql
```

O resultado esperado é não encontrar JWT/service-role embutido em triggers.

A baseline é referência para recriar um projeto novo; NÃO deve ser executada sobre o
projeto atual já existente.
