// src/lib/temAcesso.ts

export type OrgAssinaturaStatus = 'ativo' | 'trial' | 'bloqueado' | 'vencido' | string;

export type OrgRow = {
  id?: string;
  status_assinatura?: OrgAssinaturaStatus | null;
  data_expiracao?: string | Date | null;
};

// Helper para garantir que temos um objeto Date válido
function parseDateSafe(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function temAcesso(org: OrgRow | null | undefined): boolean {
  if (!org) return false;

  const status = String(org.status_assinatura || '').trim().toLowerCase();
  const expiracao = parseDateSafe(org.data_expiracao);

  // 1. Segurança Máxima: Se não tem data de expiração definida, bloqueia.
  // Isso força que toda conta tenha uma validade (mesmo que seja trial).
  if (!expiracao) return false;

  // 2. Definição do Agora
  const agora = new Date();

  // 3. Regra Unificada:
  // Tanto para 'ativo' quanto para 'trial', a data de hoje deve ser MENOR que a expiração.
  if (status === 'ativo' || status === 'trial') {
    // Retorna TRUE se a expiração for no futuro
    return expiracao.getTime() > agora.getTime();
  }

  // Se status for 'bloqueado', 'vencido' ou qualquer outro, retorna false.
  return false;
}