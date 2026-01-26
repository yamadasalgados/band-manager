'use client'
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Função necessária para converter a chave VAPID de string base64 para Uint8Array
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

// ✅ MUDANÇA: membroId agora é opcional (?) para não travar o layout.tsx
interface PushProps {
  membroId?: string; 
}

export default function PushInitializer({ membroId }: PushProps) {
  useEffect(() => {
    // 1. Verifica suporte do navegador e se temos um ID (seja via prop ou localStorage)
    const idFinal = membroId || (typeof window !== 'undefined' ? localStorage.getItem('usuario_ativo_id') : null);

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !idFinal) {
      return;
    }

    const initPush = async () => {
      try {
        // 2. Verifica se a permissão já foi negada para não incomodar o usuário
        if (Notification.permission === 'denied') return;

        // 3. Pede permissão ao usuário
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // 4. Registra ou recupera o Service Worker
        // Certifique-se que o arquivo sw.js existe em /public
        const registration = await navigator.serviceWorker.register('/sw.js');
        const ready = await navigator.serviceWorker.ready;

        // 5. Verifica se já existe uma assinatura
        let subscription = await ready.pushManager.getSubscription();

        // 6. Se não existir, cria uma nova
        if (!subscription) {
          const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
          
          if (!vapidKey) {
            console.error('VAPID Key não encontrada no .env');
            return;
          }

          subscription = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey)
          });
        }

        // 7. Salva no Supabase
        // Usamos idFinal que pode vir da prop ou do storage
        const { error } = await supabase
          .from('membros')
          .update({ 
            push_subscription: JSON.parse(JSON.stringify(subscription)) 
          })
          .eq('id', idFinal);

        if (error) console.error('Erro ao salvar push no Supabase:', error);

      } catch (err) {
        console.error('Erro no fluxo de Push:', err);
      }
    };

    initPush();
  }, [membroId]);

  return null;
}