import { NextResponse } from 'next/server';
import { requireUserOrg } from '@/lib/serverAuth';

type Body = {
  title: string;
  message: string;
  url?: string;
  externalUserIds?: string[];
  data?: Record<string, any>;
  lang?: 'en' | 'pt' | 'pt-BR';
};

function normString(v: any) {
  return String(v ?? '').trim();
}

function toExternalIds(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return Array.from(new Set(v.map(String).map((s) => s.trim()).filter(Boolean)));
  const s = String(v).trim();
  return s ? [s] : [];
}

export async function POST(req: Request) {
  try {
    const { service, orgId } = await requireUserOrg(req);

    const appId = process.env.ONESIGNAL_APP_ID || process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
    const restKey = process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restKey) {
      return NextResponse.json(
        { ok: false, error: 'Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY' },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const title = normString(body?.title);
    const message = normString(body?.message);
    const url = body?.url ? normString(body.url) : undefined;
    const data = body?.data && typeof body.data === 'object' ? body.data : undefined;

    if (!title || !message) {
      return NextResponse.json({ ok: false, error: 'Missing title/message' }, { status: 400 });
    }

    const requestedIds = toExternalIds(body?.externalUserIds);
    if (!requestedIds.length) {
      return NextResponse.json({ ok: false, error: 'No externalUserIds provided' }, { status: 400 });
    }

    // Nunca deixa um membro de uma organização disparar push para IDs de outra.
    const { data: allowedRows, error: memberError } = await service
      .from('membros')
      .select('id')
      .eq('org_id', orgId)
      .in('id', requestedIds);
    if (memberError) throw memberError;

    const allowedIds = new Set((allowedRows || []).map((row: any) => String(row.id)));
    const externalIds = requestedIds.filter((id) => allowedIds.has(id));
    if (!externalIds.length) {
      return NextResponse.json({ ok: false, error: 'No recipients in current organization' }, { status: 403 });
    }

    const langKey = body?.lang === 'pt-BR' ? 'pt-BR' : body?.lang === 'pt' ? 'pt' : 'en';
    const payload: any = {
      app_id: appId,
      headings: { en: title, pt: title, 'pt-BR': title, [langKey]: title },
      contents: { en: message, pt: message, 'pt-BR': message, [langKey]: message },
      include_external_user_ids: externalIds,
      channel_for_external_user_ids: 'push',
    };

    if (url) payload.url = url;
    if (data) payload.data = data;

    const r = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${restKey}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('OneSignal error:', json);
      return NextResponse.json({ ok: false, error: 'OneSignal request failed', details: json }, { status: 500 });
    }

    return NextResponse.json({ ok: true, result: json, recipients: externalIds.length });
  } catch (e: any) {
    const code = String(e?.message || '');
    const status =
      code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
        ? 401
        : code === 'ORG_NOT_LINKED' || code === 'ORG_FORBIDDEN'
        ? 403
        : 500;
    console.error('Send push error:', e);
    return NextResponse.json({ ok: false, error: code || 'Unknown error' }, { status });
  }
}
