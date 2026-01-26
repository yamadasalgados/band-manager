import { NextResponse } from 'next/server';
import webpush from 'web-push';

// 1. Validação de chaves antes de iniciar
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;

if (!publicKey || !privateKey) {
  console.error("ERRO: Chaves VAPID não configuradas no .env");
} else {
  webpush.setVapidDetails(
    'mailto:suporte@weekendloop.com', // Use um email real do seu domínio
    publicKey,
    privateKey
  );
}

export async function POST(request: Request) {
  try {
    const { subscription, title, body, url } = await request.json();

    // 2. Validação de Payload
    if (!subscription || !subscription.endpoint) {
      return NextResponse.json({ error: 'Subscription inválida ou ausente' }, { status: 400 });
    }

    // 3. Monta o Payload visual
    const payload = JSON.stringify({
      title: title || 'Nova Notificação',
      body: body || 'Você tem uma nova atualização no Backstage.',
      icon: '/icon-192x192.png', // Caminho do ícone no public
      url: url || '/',
    });

    // 4. Envia a notificação
    await webpush.sendNotification(subscription, payload);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao enviar push:', error);

    // Tratamento específico para inscrição expirada (limpeza de banco)
    if (error.statusCode === 410) {
      return NextResponse.json({ error: 'Subscription expired (Gone)' }, { status: 410 });
    }

    return NextResponse.json({ error: error.message || 'Erro interno' }, { status: 500 });
  }
}