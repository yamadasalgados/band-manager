'use client';

import React, { useMemo } from 'react';
import { 
  Lock, 
  ArrowRight, 
  Loader2, 
  CalendarOff, 
  ShieldAlert 
} from 'lucide-react';
import Link from 'next/link';
import { useOrg } from '@/contexts/OrgContext';
import { temAcesso } from '@/lib/checkAccess';
import { usePathname } from 'next/navigation';

export default function SubscriptionGuard({
  children,
  
}: {
  children: React.ReactNode;
}) {
  // 1. TODOS OS HOOKS DEVEM VIR PRIMEIRO
  const pathname = usePathname();
  const { org, loadingOrg } = useOrg();

  // 2. Lógica de Verificação de Acesso
  const liberado = useMemo(() => {
    if (loadingOrg) return true; 
    if (!org) return false;      
    return temAcesso(org);
  }, [org, loadingOrg]);

  // 3. DEFINIÇÃO DAS PÁGINAS PÚBLICAS (Adicionado /registrar-banda/analise)
  const paginasPublicas = [
    '/checkout', 
    '/registrar-banda', 
    '/registrar-banda/analise', 
    '/login'
  ];
  const isPublicPage = paginasPublicas.includes(pathname);

  // --- RENDERS CONDICIONAIS ---

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (loadingOrg) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <div className="size-20 bg-red-500/10 border border-red-500/20 rounded-3xl flex items-center justify-center text-red-500 mx-auto mb-6">
            <ShieldAlert size={40} />
          </div>
          <h1 className="text-2xl font-black uppercase italic text-white mb-4">Banda não encontrada</h1>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            Não identificamos uma organização ativa para você.
          </p>
          <button 
            onClick={() => {
              localStorage.clear();
              window.location.href = '/registrar-banda';
            }}
            className="bg-white text-black px-8 py-4 rounded-2xl font-black uppercase italic tracking-widest text-[10px] hover:bg-slate-200 transition-all"
          >
            Registrar Nova Banda
          </button>
        </div>
      </div>
    );
  }

  // 🚀 SE ESTIVER TUDO OK NO BANCO, LIBERA O DASHBOARD
  if (liberado) return <>{children}</>;

  // -----------------------------------------------------------
  // LÓGICA DE BLOQUEIO POR STATUS (PENDENTE OU EXPIRADO)
  // -----------------------------------------------------------
  const status = String(org?.status_assinatura || 'indefinido').toLowerCase();

  // 🔵 TELA DE ANÁLISE (MODO BETA)
  if (status === 'pendente') {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-6 text-center animate-in fade-in duration-700">
        <div className="max-w-md w-full bg-slate-900 border border-blue-500/20 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
          {/* Efeito visual azul */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-blue-600/10 blur-[60px]" />
          
          <div className="relative z-10">
            <div className="size-20 bg-blue-600/10 border border-blue-500/30 rounded-3xl flex items-center justify-center text-blue-500 mx-auto mb-8 shadow-lg shadow-blue-900/20">
              <Loader2 size={36} className="animate-spin" />
            </div>

            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-2">
              Acesso em Análise
            </h2>

            <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none text-white mb-6">
              Quase lá!
            </h1>

            <p className="text-slate-400 text-sm font-medium mb-8 leading-relaxed">
              Recebemos o registro da banda <span className="text-white">"{org?.nome}"</span>. 
              Nossa equipe está validando os dados e liberará seu acesso em instantes.
            </p>

            <div className="flex flex-col items-center gap-4">
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">
                Você será redirecionado automaticamente.
              </p>
              <button 
                onClick={() => { localStorage.clear(); window.location.href = '/registrar-banda'; }}
                className="text-slate-500 text-[8px] uppercase font-bold hover:text-white transition-colors"
              >
                Cancelar solicitação
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 🔴 TELA DE PAYWALL (TRIAL EXPIRADO OU SUSPENSO)
  const expiracao = org?.data_expiracao ? new Date(org.data_expiracao) : null;
  const dataFormatada = expiracao && !Number.isNaN(expiracao.getTime())
    ? expiracao.toLocaleDateString('pt-BR')
    : 'Data desconhecida';

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-6 text-center animate-in fade-in duration-500">
      <div className="max-w-md w-full bg-slate-900 border border-white/10 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
        
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-32 bg-red-600/10 blur-[60px]" />

        <div className="relative z-10">
          <div className="size-20 bg-slate-950 border border-red-500/30 rounded-3xl flex items-center justify-center text-red-500 mx-auto mb-8 shadow-lg shadow-red-900/20">
            {status === 'trial' ? <CalendarOff size={36} /> : <Lock size={36} />}
          </div>

          <h2 className="text-red-500 text-[10px] font-black uppercase tracking-[0.4em] mb-2">
            {status === 'trial' ? 'Período de Teste' : 'Acesso Suspenso'}
          </h2>

          <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none text-white mb-6">
            {status === 'trial' ? 'Trial Expirado' : 'Assinatura Pendente'}
          </h1>

          <p className="text-slate-400 text-sm font-medium mb-8 leading-relaxed">
            {status === 'trial' 
              ? `Seu teste gratuito encerrou em ${dataFormatada}. Para continuar, escolha um plano.`
              : `A assinatura venceu em ${dataFormatada}. Regularize para liberar o acesso.`
            }
          </p>

          <Link
            href="/checkout"
            className="w-full bg-white hover:bg-slate-200 text-black py-5 rounded-2xl font-black uppercase italic tracking-widest flex items-center justify-center gap-3 transition-all"
          >
            {status === 'trial' ? 'Assinar Agora' : 'Regularizar Pagamento'} <ArrowRight size={18} />
          </Link>

          <p className="mt-8 text-[9px] font-black text-slate-600 uppercase tracking-widest">
            ID: <span className="text-slate-500 font-mono">{org?.id?.slice(0,8)}...</span>
          </p>
        </div>
      </div>
    </div>
  );
}