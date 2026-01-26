import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const orgId = String(body?.orgId || '').trim();
    const pin = String(body?.pin || '').replace(/\D/g, '').slice(0, 6);

    if (!orgId || pin.length !== 6) {
      return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
    }

    // IMPORTANTE:
    // Use SERVICE ROLE no server (NUNCA no client)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('organizacoes')
      .select('pin_acesso')
      .eq('id', orgId)
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: 'query' }, { status: 500 });
    }

const pinBanco = String(data.pin_acesso || '').replace(/\D/g, '');    const ok = pinBanco.length === 6 && pinBanco === pin;

    return NextResponse.json({ ok: pinBanco === pin, });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
