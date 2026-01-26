import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; 

// Inicializa Supabase Admin (Service Role para ignorar RLS e gravar dados)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper para adicionar 1 mês à data atual
function addMonthsISO(base: Date, months: number) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    
    if (!body || !body.event) {
      return NextResponse.json({ ignored: true }, { status: 200 });
    }

    const { event, payment } = body;
    
    // ✅ O PULO DO GATO: Usamos o ID da nossa org que enviamos na criação do PIX
    const orgId = payment?.externalReference;
    const asaasCustomerId = payment?.customer;

    console.log(`[Asaas Webhook] Event: ${event} | Org: ${orgId} | Customer: ${asaasCustomerId}`);

    // Se não tivermos nem o ID da Org nem o Customer, não dá pra fazer nada
    if (!orgId && !asaasCustomerId) {
      return NextResponse.json({ error: 'Identificação ausente' }, { status: 400 });
    }

    // Listas de eventos
    const EVENTOS_PAGAMENTO_SUCESSO = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
    const EVENTOS_BLOQUEIO = ['PAYMENT_OVERDUE', 'PAYMENT_REFUNDED'];

    let dadosAtualizacao: any = null;

    // --- CENÁRIO 1: PAGOU (Ativar) ---
    if (EVENTOS_PAGAMENTO_SUCESSO.includes(event)) {
      console.log('✅ Pagamento confirmado! Ativando assinatura...');
      
      dadosAtualizacao = {
        status_assinatura: 'ativo',
        data_expiracao: addMonthsISO(new Date(), 1), // +30 dias a partir de agora
        updated_at: new Date().toISOString(),
        // Se por acaso não tínhamos o customer_id salvo, salvamos agora
        ...(asaasCustomerId ? { asaas_customer_id: asaasCustomerId } : {})
      };
    } 
    
    // --- CENÁRIO 2: VENCEU/ESTORNOU (Bloquear) ---
    else if (EVENTOS_BLOQUEIO.includes(event)) {
      console.log('❌ Pagamento vencido ou estornado. Bloqueando...');
      
      dadosAtualizacao = {
        status_assinatura: 'vencido', // O Guard vai pegar isso e bloquear
        updated_at: new Date().toISOString()
      };
    }

    // Se houver dados para atualizar, executa no banco
    if (dadosAtualizacao) {
      let query = supabaseAdmin.from('organizacoes').update(dadosAtualizacao);

      // Prioridade: Busca pelo ID da Org (externalReference), se falhar tenta pelo Customer do Asaas
      if (orgId) {
        query = query.eq('id', orgId);
      } else {
        query = query.eq('asaas_customer_id', asaasCustomerId);
      }

      const { error } = await query;

      if (error) {
        console.error('[Supabase Error]', error);
        return NextResponse.json({ error: 'Erro ao atualizar banco' }, { status: 500 });
      }
    }

    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('[Webhook Critical Error]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}