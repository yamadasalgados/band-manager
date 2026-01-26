'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/contexts/OrgContext';
import { supabase } from '@/lib/supabase';
import { 
  Repeat, 
  Trash2, 
  Clock, 
  MapPin, 
  Calendar, 
  ArrowLeft, 
  Loader2, 
  AlertCircle,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import Link from 'next/link';

const DIAS_NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function GerenciarRecorrencias() {
  const { org } = useOrg();
  const router = useRouter();
  const [recorrencias, setRecorrencias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletandoId, setDeletandoId] = useState<string | null>(null);

  const carregarRecorrencias = useCallback(async () => {
    if (!org?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('eventos_recorrentes')
        .select('*')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecorrencias(data || []);
    } catch (err) {
      console.error('Erro ao carregar recorrências:', err);
    } finally {
      setLoading(false);
    }
  }, [org?.id]);

  useEffect(() => {
    carregarRecorrencias();
  }, [carregarRecorrencias]);

  async function excluirRecorrencia(id: string) {
    if (!confirm('Isso impedirá a geração de novos eventos para esta regra. Os eventos já criados no calendário permanecerão. Confirmar?')) return;

    setDeletandoId(id);
    try {
      const { error } = await supabase
        .from('eventos_recorrentes')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setRecorrencias(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      alert('Erro ao excluir');
    } finally {
      setDeletandoId(null);
    }
  }

  async function alternarAtivo(id: string, statusAtual: boolean) {
    try {
      const { error } = await supabase
        .from('eventos_recorrentes')
        .update({ ativo: !statusAtual })
        .eq('id', id);

      if (error) throw error;
      setRecorrencias(prev => prev.map(r => r.id === id ? { ...r, ativo: !statusAtual } : r));
    } catch (err) {
      alert('Erro ao atualizar status');
    }
  }

  if (!org) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-10 font-sans">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div>
                      <Link href="/">
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org.nome || 'Banda'}
            </h2>
            <h1 className="text-3xl font-black italic uppercase tracking-tighter">
              Regras de 
              <br />
              Recorrência
            </h1>
            </Link>
          </div>
                   <button 
            onClick={() => router.back()} 
            className="text-blue-500 flex items-center gap-2 text-[16px] font-black hover:text-white uppercase tracking-widest mb-2"
          >
            <ArrowLeft size={16} /> Voltar
          </button>
      
             </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="animate-spin text-blue-500" size={40} />
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">Carregando regras...</p>
          </div>
        ) : recorrencias.length === 0 ? (
          
          <div className="bg-slate-900 border border-white/5 p-10 rounded-[2.5rem] text-center space-y-4">
            <AlertCircle className="mx-auto text-slate-700" size={40} />
            <p className="font-black uppercase text-xs text-slate-500 tracking-widest">Nenhuma regra automática configurada</p>
            <Link href="/eventos/novo" className="inline-block bg-blue-600 px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest">
              Criar Primeira Regra
            </Link>
            
          </div>
        ) : (
          <div className="space-y-4">
            {recorrencias.map((rec) => (
              <div 
                key={rec.id} 
                className={`bg-slate-900 relative border border-white/5 p-6 rounded-[2rem] transition-all ${!rec.ativo ? 'opacity-50' : 'shadow-xl'}`}
              >                                       <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-black italic uppercase tracking-tight">{rec.local}</h2>
                    <div className="flex items-center gap-2 text-blue-400 mt-1">
                      <Clock size={12} />
                      <span className="text-[11px] font-black uppercase tracking-widest">{rec.hora.slice(0, 5)} - {rec.tz}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <button 
                      onClick={() => alternarAtivo(rec.id, rec.ativo)}
                      className="p-2 hover:bg-white/5 rounded-xl transition-colors"
                    >
                      {rec.ativo ? <ToggleRight className="text-emerald-500" size={28} /> : <ToggleLeft className="text-slate-600" size={28} />}
                    </button>
                    <button 
                      onClick={() => excluirRecorrencia(rec.id)}
                      disabled={deletandoId === rec.id}
                      className="p-3 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all"
                    >
                      {deletandoId === rec.id ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {DIAS_NOMES.map((nome, idx) => {
                    const ativo = rec.dias_semana.includes(idx);
                    return (
                      <span 
                        key={idx}
                        className={`text-[9px] font-black px-3 py-1.5 rounded-lg uppercase tracking-widest border ${
                          ativo ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-slate-950 border-white/5 text-slate-700'
                        }`}
                      >
                        {nome}
                      </span>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <span className="text-[12px] font-bold text-white-600 uppercase tracking-widest">
                    Início: {new Date(rec.data_inicio).toLocaleDateString('pt-BR')}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className={`size-2 rounded-full ${rec.auto_escalar ? 'bg-yellow-500' : 'bg-slate-700'}`} />
                    <span className="text-[10px] font-bold text-white-500 uppercase tracking-widest">
                      {rec.auto_escalar ? 'Auto-Escala Ativa' : 'Sem Auto-Escala'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <footer className="mt-10 text-center">
           <p className="text-[14px] font-bold text-white-600 uppercase tracking-[0.2em]">
             As alterações aqui afetam apenas os eventos futuros que ainda serão gerados.
           </p>
        </footer>
      </div>
    </div>
  );
}