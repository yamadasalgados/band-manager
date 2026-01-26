import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { event, payment } = body;

    // Eventos de Pagamento Confirmado
    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      const orgId = payment.externalReference;

      if (orgId) {
        // Calcula nova data de expiração (+30 dias)
        const novaData = new Date();
        novaData.setDate(novaData.getDate() + 30);

        // Atualiza o Supabase
        await supabase
          .from('organizacoes')
          .update({
            status_assinatura: 'ativo',
            data_expiracao: novaData.toISOString()
          })
          .eq('id', orgId);
          
        console.log(`✅ Pagamento confirmado para Org: ${orgId}`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json({ error: 'Webhook falhou' }, { status: 500 });
  }
}