import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getRequestUser } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export async function POST(req: Request) {
  try {
    const { user, service } = await getRequestUser(req);
    const body = await req.json().catch(() => null);
    const email = String(body?.email || '').trim().toLowerCase();
    const pin = String(body?.pin || '').replace(/\D/g, '').slice(0, 6);

    if (!email || pin.length !== 6) {
      return NextResponse.json({ ok: false, error: 'invalid_fields' }, { status: 400 });
    }

    const { data: org, error } = await service
      .from('organizacoes')
      .select('id,nome,slug,status_assinatura,data_expiracao,pin_acesso,user_id')
      .ilike('email_admin', email)
      .maybeSingle();

    if (error) throw error;

    const storedPin = String(org?.pin_acesso || '').replace(/\D/g, '').slice(0, 6);
    if (!org || storedPin.length !== 6 || !safeEqual(storedPin, pin)) {
      return NextResponse.json({ ok: false, error: 'invalid_credentials' }, { status: 401 });
    }

    await service
      .from('membro_dispositivos')
      .delete()
      .eq('user_id', user.id)
      .neq('org_id', org.id);

    const { error: accessError } = await service.from('organizacao_acessos').upsert(
      {
        user_id: user.id,
        org_id: org.id,
        role: 'admin',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (accessError) throw accessError;

    // Primeiro login Auth de uma organização antiga: preserva um owner canônico.
    if (!org.user_id) {
      await service.from('organizacoes').update({ user_id: user.id }).eq('id', org.id).is('user_id', null);
    }

    return NextResponse.json({
      ok: true,
      org: {
        id: org.id,
        nome: org.nome,
        slug: org.slug,
        status_assinatura: org.status_assinatura,
        data_expiracao: org.data_expiracao,
      },
    });
  } catch (e: any) {
    const code = String(e?.message || '');
    if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
      return NextResponse.json({ ok: false, error: code }, { status: 401 });
    }
    console.error('[org/login]', e);
    return NextResponse.json({ ok: false, error: e?.message || 'server' }, { status: 500 });
  }
}
