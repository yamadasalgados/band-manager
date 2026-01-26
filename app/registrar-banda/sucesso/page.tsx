'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Copy, Check, ArrowRight, ShieldCheck, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState, Suspense } from 'react';

function ConteudoSucesso() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = searchParams.get('id') || '';

  const [origin, setOrigin] = useState<string>('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // ✅ Link aponta para /perfil, onde o contexto lê o ?org= e conecta o membro
  const linkMembros = useMemo(() => {
    if (!origin || !orgId) return '';
    return `${origin}/perfil?org=${encodeURIComponent(orgId)}`;
  }, [origin, orgId]);

  const copiarLink = async () => {
    if (!linkMembros) return;
    try {
      await navigator.clipboard.writeText(linkMembros);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      alert('Copie manualmente: ' + linkMembros);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
      <div className="max-w-lg w-full text-center">
        
        <div className="inline-flex items-center justify-center size-20 bg-emerald-500/10 rounded-full mb-6 border border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.2)]">
            <ShieldCheck size={40} className="text-emerald-500" />
        </div>

        <h1 className="text-5xl font-black italic uppercase tracking-tighter text-white mb-4">
          Tudo Pronto!
        </h1>
        <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest mb-10">
          O Painel da sua banda está ativo
        </p>

        <div className="bg-slate-900 border border-white/5 p-8 rounded-[2.5rem] shadow-2xl">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-blue-500 mb-6">
            Convite para Músicos
          </h2>

          <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 mb-6 break-all relative group">
            <code className="text-slate-300 text-xs font-mono block">
              {linkMembros || 'Gerando link...'}
            </code>
          </div>

          <button
            onClick={copiarLink}
            disabled={!linkMembros}
            className={[
              'w-full py-5 rounded-2xl font-black uppercase italic tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95',
              copiado 
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' 
                : 'bg-white text-black hover:bg-slate-200',
              !linkMembros ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {copiado ? (
              <>
                <Check size={20} /> Link Copiado!
              </>
            ) : (
              <>
                <Copy size={20} /> Copiar Link
              </>
            )}
          </button>
        </div>

        <button
          onClick={() => router.push('/')}
          className="mt-10 inline-flex items-center justify-center gap-2 text-slate-500 font-bold uppercase text-[10px] tracking-[0.3em] hover:text-white transition-colors border-b border-transparent hover:border-white/20 pb-1"
        >
          Acessar Dashboard <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ✅ Wrapper com Suspense obrigatório para useSearchParams funcionar no build
export default function SucessoRegistroPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    }>
      <ConteudoSucesso />
    </Suspense>
  );
}