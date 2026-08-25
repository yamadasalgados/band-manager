import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export function createServiceSupabase(): SupabaseClient<any> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Supabase server credentials are not configured.');
  }

  return createClient<any>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function getRequestUser(
  req: Request,
  service = createServiceSupabase()
): Promise<{ user: User; token: string; service: SupabaseClient<any> }> {
  const token = getBearerToken(req);
  if (!token) throw new Error('AUTH_REQUIRED');

  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error('AUTH_INVALID');

  return { user: data.user, token, service };
}

export async function resolveUserOrgId(
  service: SupabaseClient<any>,
  userId: string
): Promise<string | null> {
  // Mantém a mesma prioridade usada por current_org_id() no banco.
  const { data: device } = await service
    .from('membro_dispositivos')
    .select('org_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (device?.org_id) return String(device.org_id);

  const { data: member } = await service
    .from('membros')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (member?.org_id) return String(member.org_id);

  const { data: access } = await service
    .from('organizacao_acessos')
    .select('org_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (access?.org_id) return String(access.org_id);

  const { data: owner } = await service
    .from('organizacoes')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  return owner?.id ? String(owner.id) : null;
}

export async function requireUserOrg(req: Request, requestedOrgId?: string) {
  const ctx = await getRequestUser(req);
  const orgId = await resolveUserOrgId(ctx.service, ctx.user.id);
  if (!orgId) throw new Error('ORG_NOT_LINKED');

  if (requestedOrgId && String(requestedOrgId) !== orgId) {
    throw new Error('ORG_FORBIDDEN');
  }

  return { ...ctx, orgId };
}
