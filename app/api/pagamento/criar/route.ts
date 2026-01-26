/* import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- HARDCODE DA CHAVE NOVA ---
//const ASAAS_KEY = "$";
const ASAAS_URL = "https://sandbox.asaas.com/api/v3";

export async function POST(req: Request) {
  try {
    const { orgId } = await req.json();

    // 1. Busca dados da Organização
    const { data: org, error } = await supabase
      .from('organizacoes')
      .select('*')
      .eq('id', orgId)
      .single();

    if (error || !org) throw new Error('Organização não encontrada');

    let customerId = org.asaas_customer_id;

    // 2. CRIA CLIENTE (Se não tiver ou se o ID for antigo)
    // DICA: Se você quiser FORÇAR a criação de um novo, 
    // mude a condição abaixo para: if (true) {
// 2. CRIA CLIENTE (Com CPF para evitar o erro invalid_customer.cpfCnpj)
    if (!customerId) {
      console.log("🆕 Criando novo cliente com CPF para:", org.nome);
      const resCustomer = await fetch(`${ASAAS_URL}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
        body: JSON.stringify({ 
          name: org.nome, 
          externalReference: org.id,
          //cpfCnpj: "" // CNPJ de teste para o Asaas aceitar
        })
      });

      const customerData = await resCustomer.json();
      
      if (customerData.errors) {
        console.error('❌ Erro Cliente:', customerData.errors);
        return NextResponse.json({ error: customerData.errors[0].description }, { status: 400 });
      }
      customerId = customerData.id;

      await supabase.from('organizacoes').update({ asaas_customer_id: customerId }).eq('id', orgId);
    }

    // 3. GERA COBRANÇA
    console.log(`💸 Gerando cobrança para o Customer ID: ${customerId}`);
    const resPayment = await fetch(`${ASAAS_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
      body: JSON.stringify({
        customer: customerId,
        billingType: 'PIX',
        value: 49.90,
        dueDate: new Date().toISOString().split('T')[0],
        description: 'Assinatura Backstage',
        externalReference: orgId
      })
    });

    const paymentData = await resPayment.json();

    if (paymentData.errors) {
      console.error('❌ Erro Pagamento:', paymentData.errors);
      // Se o erro for "Customer inválido", limpa o ID no banco para a próxima tentativa
      if (paymentData.errors[0].code === 'invalid_customer') {
          await supabase.from('organizacoes').update({ asaas_customer_id: null }).eq('id', orgId);
      }
      return NextResponse.json({ error: paymentData.errors[0].description }, { status: 400 });
    }

    // 4. PEGA QR CODE
    const resQr = await fetch(`${ASAAS_URL}/payments/${paymentData.id}/pixQrCode`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY }
    });

    const qrData = await resQr.json();

    return NextResponse.json({
      success: true,
      pixCopiaCola: qrData.payload,
      qrCodeImage: qrData.encodedImage
    });

  } catch (error: any) {
    console.error('🔥 Erro API:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
} */

  // app/api/pagamento/criar/route.ts
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ message: "Modo manual ativo" });
}