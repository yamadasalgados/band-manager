'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Save, ArrowLeft, Building2, CreditCard, 
  Copy, Check, Users, Loader2, AlertTriangle, Link as LinkIcon
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ✅ IMPORT CORRIGIDO
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';

function slugify(input: string) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default function ConfiguracoesPage() {
  const router = useRouter();
  // ✅ Pega funções de recarga e dados atualizados
  const { org, loadingOrg, refreshOrg, setOrg } = useOrg(); 

  const [loading, setLoading] = useState(false);
  const [copiado, setCopiado] = useState(false);
  
  // Estados do formulário
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');

  // Carrega dados iniciais sem piscar
  useEffect(() => {
    if (org) {
      setNome(org.nome || '');
      setSlug(org.slug || '');
    }
  }, [org]);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org?.id) return;

    setLoading(true);
    try {
      const novoSlug = slugify(slug || nome);

      const { data, error } = await supabase
        .from('organizacoes')
        .update({ 
          nome: nome.trim(),
          slug: novoSlug 
        })
        .eq('id', org.id)
        .select()
        .single();

      if (error) throw error;

      // Atualiza estado local e global
      setOrg({ ...org, nome: data.nome, slug: data.slug });
      await refreshOrg(); 
      
      alert('Configurações salvas com sucesso!');
    } catch (err: any) {
      console.error(err);
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copiarConvite = () => {
    if (!org?.id) return;
    // ✅ Gera link clicável para facilitar a vida do líder
    const link = `${window.location.origin}/perfil?org=${org.id}`;
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  if (loadingOrg) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <Loader2 className="animate-spin text-blue-500" />
    </div>
  );

  if (!org) return null;

  // Helpers de Status
  const status = org.status_assinatura || 'indefinido';
  const expiracao = org.data_expiracao 
    ? new Date(org.data_expiracao).toLocaleDateString('pt-BR') 
    : '—';
  const isAtivo = status === 'ativo' || status === 'trial';

  return (
    <SubscriptionGuard>
      <div className="min-h-screen bg-slate-950 text-white p-6 pb-24 font-sans">
        <div className="max-w-3xl mx-auto">
          
          <header className="flex justify-between items-end mb-10 pt-4">
            <Link href="/" className="group flex items-center gap-4 transition-transform active:scale-95">
            <div>
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org.nome || 'Banda'}
            </h2>
              <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white">
                Configurações
              </h1>
            </div>
            </Link>
            <button 
              onClick={() => router.back()} 
              className="text-slate-500 flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest hover:text-white transition-colors pb-1"
            >
              <ArrowLeft size={16} /> Voltar
            </button>
          </header>

          <div className="grid gap-8">
            
            {/* 1. DADOS DA BANDA */}
            <section className="bg-slate-900 border border-white/5 p-8 rounded-[2.5rem] shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-blue-600/10 rounded-xl text-blue-500 border border-blue-500/20">
                  <Building2 size={24} />
                </div>
                <h2 className="text-xl font-black italic uppercase tracking-tight">Identidade</h2>
              </div>

              <form onSubmit={handleSalvar} className="space-y-5">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 ml-2 mb-2 block tracking-widest">
                    Nome da Banda
                  </label>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="w-full bg-slate-950 border border-white/5 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold transition-all"
                    placeholder="Minha Banda"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 ml-2 mb-2 block tracking-widest">
                    Link Personalizado (Slug)
                  </label>
                  <div className="flex items-center bg-slate-950 border border-white/5 rounded-2xl px-4 focus-within:border-blue-500 transition-all">
                    <span className="text-slate-600 text-xs font-mono select-none">backstage.com/</span>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(slugify(e.target.value))}
                      className="w-full bg-transparent p-4 outline-none font-bold text-white placeholder:text-slate-700"
                      placeholder="minha-banda"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center gap-2 transition-all disabled:opacity-50 mt-4 shadow-lg shadow-blue-900/20"
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                  Salvar Alterações
                </button>
              </form>
            </section>

            {/* 2. CONVITE (Otimizado com Link Completo) */}
            <section className="bg-slate-900 border border-white/5 p-8 rounded-[2.5rem] shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-500 border border-emerald-500/20">
                  <Users size={24} />
                </div>
                <h2 className="text-xl font-black italic uppercase tracking-tight">Membros</h2>
              </div>
              
              <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 mb-4 flex items-center justify-between gap-4 group hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center gap-3 overflow-hidden">
                    <LinkIcon size={16} className="text-slate-600 shrink-0" />
                    <code className="text-slate-400 text-xs font-mono truncate">
                    {typeof window !== 'undefined' ? `${window.location.origin}/perfil?org=${org.id}` : 'Carregando link...'}
                    </code>
                </div>
                <button 
                  onClick={copiarConvite}
                  className="p-2 bg-slate-900 hover:bg-emerald-500 hover:text-white rounded-lg text-slate-300 transition-all border border-white/5"
                  title="Copiar Link"
                >
                  {copiado ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-l text-white-100 font-bold uppercase tracking-wide">
                Envie este link para seus músicos entrarem na banda.
              </p>
            </section>

            {/* 3. ASSINATURA (Novo) */}
            <section className="bg-slate-900 border border-white/5 p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-10">
                <CreditCard size={120} className="text-white" />
              </div>

              <div className="relative z-10">
                <h2 className="text-xl font-black italic uppercase tracking-tight mb-6">Plano & Assinatura</h2>
                
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-white/5">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Status</span>
                    <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${isAtivo ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {status === 'trial' ? 'Teste Grátis' : status.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-white/5">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Expira em</span>
                    <span className="text-white font-mono font-bold">{expiracao}</span>
                  </div>

                  {!isAtivo && (
                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-3 items-start">
                      <AlertTriangle className="text-red-500 shrink-0" size={20} />
                      <div>
                        <p className="text-red-200 font-bold text-xs mb-2">Sua assinatura está pendente.</p>
                        <Link href="/checkout" className="text-[10px] font-black uppercase tracking-widest text-white bg-red-600 px-4 py-2 rounded-lg inline-block hover:bg-red-500 transition-colors shadow-lg">
                          Regularizar Pagamento
                        </Link>
                      </div>
                    </div>
                  )}
                  
                  {isAtivo && (
                    <Link href="/checkout" className="mt-4 block text-center p-4 rounded-2xl bg-white/5 hover:bg-white/10 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all border border-white/5">
                      Gerenciar / Renovar Assinatura
                    </Link>
                  )}
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </SubscriptionGuard>
  );
}