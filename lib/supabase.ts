import { createClient } from '@supabase/supabase-js';

// Dica: Se você gerou os tipos do banco com 'supabase gen types', importe aqui:
// import { Database } from '@/types/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 1. Validação de Segurança (Evita tela branca da morte em produção)
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "⚠️ CRÍTICO: Variáveis de ambiente do Supabase (URL ou KEY) não encontradas. Verifique o arquivo .env.local ou as configurações da Vercel."
  );
}

// 2. Inicialização do Cliente
// Usamos <any> aqui para compatibilidade imediata, mas recomendamos trocar por <Database>
export const supabase = createClient<any>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // Mantém o usuário logado entre recarregamentos
    autoRefreshToken: true, // Renova o token automaticamente
    detectSessionInUrl: true, // Necessário para links de login/reset de senha
  },
  // Opcional: Aumentar timeout para conexões lentas (3G/4G em eventos)
  global: {
    headers: { 'x-application-name': 'backstage-control' },
  },
});