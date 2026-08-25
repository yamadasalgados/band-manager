import { NextResponse } from 'next/server';
import { requireUserOrg } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const requestedOrgId = String(body?.orgId || '').trim();
    if (!requestedOrgId) {
      return NextResponse.json({ ok: false, error: 'invalid_org' }, { status: 400 });
    }

    const { service, orgId } = await requireUserOrg(req, requestedOrgId);
    const { data, error } = await service
      .from('organizacoes')
      .select('invite_token')
      .eq('id', orgId)
      .single();

    if (error || !data?.invite_token) throw error || new Error('invite_missing');

    return NextResponse.json({ ok: true, inviteToken: data.invite_token });
  } catch (e: any) {
    const code = String(e?.message || '');
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' ? 401 : code === 'ORG_FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ ok: false, error: code || 'server' }, { status });
  }
}
