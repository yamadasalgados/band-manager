'use client';

import { useEffect, useMemo, useState } from 'react';

function isIOS() {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua);
}

function isInStandaloneMode() {
  if (typeof window === 'undefined') return false;
  // iOS PWA
  // @ts-ignore
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export default function InstallIOSBanner() {
  const [show, setShow] = useState(false);

  const shouldShow = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return isIOS() && !isInStandaloneMode();
  }, []);

  useEffect(() => {
    if (shouldShow) setShow(true);
  }, [shouldShow]);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl">
      <p className="text-xs font-black uppercase tracking-widest text-blue-400">iPhone</p>
      <p className="mt-1 text-sm font-bold text-white">
        Para ativar notificações, instale como app:
      </p>
      <p className="mt-2 text-xs text-slate-300">
        Abra no <b>Safari</b> → <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.
      </p>
      <button
        onClick={() => setShow(false)}
        className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950 py-2 text-xs font-black uppercase tracking-widest text-slate-300"
      >
        Entendi
      </button>
    </div>
  );
}
