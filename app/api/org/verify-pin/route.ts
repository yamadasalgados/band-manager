import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { requireUserOrg } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const orgId = String(body?.orgId || '').trim();
    const pin = String(body?.pin || '').replace(/\D/g, '').slice(0, 6);

    if (!orgId || pin.length !== 6) {
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }

    const { user, service } = await requireUserOrg(req, orgId);
    const { data, error } = await service
      .from('organizacoes')
      .select('pin_acesso')
      .eq('id', orgId)
      .maybeSingle();

    if (error) throw error;

    const storedPin = String(data?.pin_acesso || '').replace(/\D/g, '').slice(0, 6);
    const ok = storedPin.length === 6 && safeEqual(storedPin, pin);

    if (ok) {
      // O PIN continua sendo a elevação administrativa do fluxo atual.
      await service.from('organizacao_acessos').upsert(
        {
          user_id: user.id,
          org_id: orgId,
          role: 'admin',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    }

    return NextResponse.json({ ok });
  } catch (e: any) {
    const code = String(e?.message || '');
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' ? 401 : code === 'ORG_FORBIDDEN' ? 403 : 500;
    console.error('[org/verify-pin]', e);
    return NextResponse.json({ ok: false, error: code || 'server' }, { status });
  }
}
