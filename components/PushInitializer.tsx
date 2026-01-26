'use client'
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Função necessária para converter a chave VAPID de string base64 para Uint8Array
// (O navegador exige esse formato específico)
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushInitializer({ membroId }: { membroId: string }) {
  useEffect(() => {
    // 1. Verifica suporte do navegador
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !membroId) {
      return;
    }

    const initPush = async () => {
      try {
        // 2. Pede permissão ao usuário (se ainda não tiver)
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // 3. Registra ou recupera o Service Worker
        // Nota: O arquivo sw.js precisa estar na pasta /public
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        // 4. Verifica se já existe uma assinatura
        let subscription = await registration.pushManager.getSubscription();

        // 5. Se não existir, cria uma nova
        if (!subscription) {
          const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
          
          if (!vapidKey) {
            console.error('VAPID Key não encontrada no .env');
            return;
          }

          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey)
          });
        }

        // 6. Salva no Supabase (apenas o JSON da subscription)
        // A coluna 'push_subscription' no banco deve ser do tipo JSON ou JSONB
        const { error } = await supabase
          .from('membros')
          .update({ 
            push_subscription: JSON.parse(JSON.stringify(subscription)) 
          })
          .eq('id', membroId);

        if (error) console.error('Erro ao salvar push no Supabase:', error);

      } catch (err) {
        console.error('Erro no fluxo de Push:', err);
      }
    };

    initPush();
  }, [membroId]);

  return null;
}