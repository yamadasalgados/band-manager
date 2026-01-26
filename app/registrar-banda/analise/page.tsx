'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function PaginaAnalise() {
  const router = useRouter();

  useEffect(() => {
    // Pequeno delay para o usuário entender que o registro foi feito
    const timer = setTimeout(() => {
      router.push('/'); 
    }, 2000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="relative">
        {/* Círculo de brilho ao fundo */}
        <div className="absolute inset-0 bg-blue-500/20 blur-[100px] rounded-full" />
        
        <div className="relative z-10 flex flex-col items-center">
          <Loader2 className="animate-spin text-blue-500 mb-6" size={48} />
          
          <h1 className="text-white font-black uppercase italic tracking-tighter text-2xl mb-2">
            Registro Concluído
          </h1>
          
          <p className="text-slate-500 animate-pulse uppercase font-black tracking-widest text-[10px]">
            Redirecionando para o painel de análise...
          </p>
        </div>
      </div>

      {/* Footer minimalista */}
      <div className="fixed bottom-10">
        <p className="text-slate-700 text-[9px] font-bold uppercase tracking-[0.3em]">
          Backstage Protocol • Beta Phase
        </p>
      </div>
    </div>
  );
}