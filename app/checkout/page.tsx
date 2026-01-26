'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  QrCode, Copy, Check, ShieldCheck, 
  Clock, ArrowLeft, Loader2, Zap, AlertCircle 
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/contexts/OrgContext'; // ✅ Importado o contexto

export default function CheckoutPage() {
  const router = useRouter();
  const { refreshOrg } = useOrg(); // ✅ Extraindo a função de refresh
  
  // Estados Visuais
  const [pixCopiado, setPixCopiado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'pendente' | 'pago'>('pendente');
  const [erro, setErro] = useState('');

  // Estados de Dados Reais
  const [pixCopiaCola, setPixCopiaCola] = useState('');
  const [qrCodeImage, setQrCodeImage] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);

  // 1. AO CARREGAR: Identifica a banda
  useEffect(() => {
    const idLocal = localStorage.getItem('org_id_ativo');
    
    if (!idLocal) {
      setErro("Organização não identificada. Tente registrar novamente.");
      setLoading(false);
      return;
    }
    setOrgId(idLocal);

    // Modo Manual Beta: Apenas exibe os dados sem chamar API externa
    setTimeout(() => {
      setLoading(false);
      setPixCopiaCola("SUA_CHAVE_PIX_AQUI"); // 👈 Coloque sua chave real aqui
    }, 1000);
  }, []);

  // 2. REALTIME: Escuta a liberação manual no Supabase
  useEffect(() => {
    if (!orgId) return;

    console.log(`🔌 Ouvindo atualizações para banda: ${orgId}`);

    const channel = supabase
      .channel(`checkout_realtime_${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'organizacoes',
          filter: `id=eq.${orgId}`,
        },
        async (payload: any) => {
          console.log("🔔 Mudança detectada!", payload.new.status_assinatura);
          
          if (payload.new.status_assinatura === 'ativo') {
            console.log("✅ Pagamento aprovado pelo admin!");
            await refreshOrg(); // Atualiza o contexto global
            setStatus('pago');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, refreshOrg]);

  const handleCopyPix = () => {
    if (!pixCopiaCola) return;
    navigator.clipboard.writeText(pixCopiaCola);
    setPixCopiado(true);
    setTimeout(() => setPixCopiado(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 flex flex-col items-center justify-center font-sans">
      <div className="max-w-md w-full">
        
        <div className="text-center mb-10">
          <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-2">Assinatura Mensal</h2>
          <h1 className="text-4xl font-black italic uppercase tracking-tighter">Ativar Painel</h1>
        </div>

        <div className="bg-slate-900 border border-white/5 rounded-[3rem] p-8 shadow-2xl relative overflow-hidden min-h-[400px] flex flex-col justify-center">
          
          {loading ? (
            <div className="flex flex-col items-center justify-center space-y-4">
              <Loader2 className="animate-spin text-blue-500" size={40} />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Preparando checkout...</p>
            </div>
          ) : erro ? (
            <div className="text-center">
              <AlertCircle className="mx-auto text-red-500 mb-4" size={40} />
              <p className="text-sm font-bold text-slate-300">{erro}</p>
            </div>
          ) : status === 'pago' ? (
            <div className="py-2 text-center animate-in zoom-in duration-500">
               <div className="size-20 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-500 mx-auto mb-6 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                <ShieldCheck size={40} />
              </div>
              <h2 className="text-2xl font-black italic uppercase mb-2 text-white">Acesso Liberado!</h2>
              <p className="text-slate-400 text-sm mb-8 font-medium">Sua conta foi ativada com sucesso. Aproveite o Backstage!</p>
              <Link href="/" className="block w-full bg-blue-600 hover:bg-blue-500 transition-colors py-5 rounded-2xl font-black uppercase italic tracking-widest text-center shadow-lg shadow-blue-900/20">
                Acessar Dashboard
              </Link>
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex justify-between items-center mb-8 pb-8 border-b border-white/5">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase">Plano Beta Mensal</p>
                  <p className="text-xl font-black italic uppercase text-slate-200">Acesso Total</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black text-emerald-400">R$ 49,90</p>
                  <p className="text-[9px] font-bold text-slate-500 uppercase">por mês</p>
                </div>
              </div>

              <div className="bg-white p-4 rounded-3xl mb-8 w-48 h-48 mx-auto flex items-center justify-center shadow-lg shadow-blue-500/10 relative overflow-hidden">
                <QrCode size={160} className="text-black opacity-10" />
                <p className="absolute text-[8px] text-black font-black uppercase text-center px-4">
                  Escaneie o QR Code ou copie a chave abaixo
                </p>
              </div>

              <div className="space-y-4">
                <p className="text-center text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-center gap-2">
                  <Clock size={12} className="animate-pulse text-yellow-500" /> Aguardando confirmação...
                </p>

                <button 
                  onClick={handleCopyPix}
                  className={`w-full py-5 rounded-2xl font-black uppercase italic tracking-widest flex items-center justify-center gap-2 transition-all ${pixCopiado ? 'bg-emerald-600 text-white' : 'bg-slate-950 border border-white/10 text-slate-300 hover:border-blue-500 hover:text-white'}`}
                >
                  {pixCopiado ? <><Check size={18}/> Copiado!</> : <><Copy size={18}/> Copiar Chave Pix</>}
                </button>
              </div>

              <div className="mt-8 flex items-center justify-center gap-2 opacity-30">
                <Zap size={12} />
                <span className="text-[8px] font-black uppercase tracking-widest">Ativação via Pix</span>
              </div>
            </div>
          )}
        </div>

        <Link href="/" className="mt-10 flex items-center justify-center gap-2 text-slate-600 hover:text-white transition-colors text-[10px] font-black uppercase tracking-widest">
          <ArrowLeft size={14} /> Voltar para o início
        </Link>
      </div>
    </div>
  );
}