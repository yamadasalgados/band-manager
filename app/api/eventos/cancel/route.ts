import { NextResponse } from 'next/server';
import { requireUserOrg } from '@/lib/serverAuth';

export const runtime = 'nodejs';

function cleanReason(value: unknown) {
  const reason = String(value || '').trim();
  return reason ? reason.slice(0, 280) : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = String(body?.eventId || '').trim();
    if (!eventId) {
      return NextResponse.json({ ok: false, error: 'Evento não informado.' }, { status: 400 });
    }

    const { service, user, orgId } = await requireUserOrg(req);
    const reason = cleanReason(body?.reason);

    const { data: event, error: eventError } = await service
      .from('eventos')
      .select('id,org_id,local,finalizado,cancelado')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event) {
      return NextResponse.json({ ok: false, error: 'Evento não encontrado.' }, { status: 404 });
    }

    if (event.cancelado) {
      return NextResponse.json({ ok: true, eventId, alreadyCancelled: true });
    }

    if (event.finalizado) {
      return NextResponse.json(
        { ok: false, error: 'Um evento já finalizado não pode ser cancelado por esta tela.' },
        { status: 409 }
      );
    }

    const cancelledAt = new Date().toISOString();
    const { error: updateError } = await service
      .from('eventos')
      .update({
        cancelado: true,
        cancelado_em: cancelledAt,
        cancelado_por: user.id,
        motivo_cancelamento: reason,
        finalizado: true,
      })
      .eq('id', eventId)
      .eq('org_id', orgId);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      eventId,
      cancelledAt,
      reason,
    });
  } catch (error: any) {
    const code = String(error?.message || '');
    const status = code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID' ? 401 : code === 'ORG_NOT_LINKED' || code === 'ORG_FORBIDDEN' ? 403 : 500;

    console.error('[api/eventos/cancel]', error);
    return NextResponse.json(
      { ok: false, error: status === 500 ? 'Não foi possível cancelar o evento.' : 'Sessão sem permissão para cancelar este evento.' },
      { status }
    );
  }
}
