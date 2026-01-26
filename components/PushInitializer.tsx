'use client'
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

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

interface PushProps {
  membroId?: string; 
}

export default function PushInitializer({ membroId }: PushProps) {
  useEffect(() => {
    // 1. Verifica apenas o suporte básico do navegador
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    const initPush = async () => {
      try {
        // 2. Verifica se a permissão já foi negada. Se for 'default', ele pedirá.
        if (Notification.permission === 'denied') return;

        // 3. Pede permissão ao usuário (Aqui o navegador mostra o prompt)
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        // 4. Registra ou recupera o Service Worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        const ready = await navigator.serviceWorker.ready;

        // 5. Gerencia a assinatura
        let subscription = await ready.pushManager.getSubscription();

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

        // 6. LÓGICA DE SALVAMENTO CONDICIONAL
        // Tenta pegar o ID da prop ou de qualquer chave comum de perfil ativo
        const idFinal = membroId || localStorage.getItem('usuario_ativo_id') || localStorage.getItem('perfil_id');

        // Só tenta dar o update no Supabase se de fato tivermos um ID de membro
        if (idFinal && subscription) {
          const { error } = await supabase
            .from('membros')
            .update({ 
              push_subscription: JSON.parse(JSON.stringify(subscription)) 
            })
            .eq('id', idFinal);

          if (error) console.error('Erro ao salvar push no Supabase:', error);
        }

      } catch (err) {
        console.error('Erro no fluxo de Push:', err);
      }
    };

    initPush();
  }, [membroId]); // Se o membroId mudar (login), ele tenta salvar novamente

  return null;
}