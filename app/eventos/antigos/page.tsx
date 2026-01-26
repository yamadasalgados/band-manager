'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Calendar, ChevronRight, History, Loader2, Music, Search } from 'lucide-react';
// ✅ Import do contexto para segurança
import { useOrg } from '@/contexts/OrgContext';

// ✅ Função de data idêntica à do HomeMembro para evitar erro de fuso
function formatEventDate(evData: string) {
  if (!evData) return 'Data não definida';
  const [datePart] = evData.split('T');
  const [year, month, day] = datePart.split('-');
  if (!day || !month) return 'Data inválida';
  return `${day}/${month}/${year.slice(-2)}`;
}

export default function HistoricoEventos() {
  const { org } = useOrg(); // ✅ Pegando a organização atual
  const [eventos, setEventos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  if (!org) return null; // Ou um loader customizado

  useEffect(() => {
    async function carregarHistorico() {
      // Se não tiver org carregada, não busca nada para não misturar dados
      if (!org?.id) return;

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('eventos')
          .select(`
            id,
            local,
            data,
            paleta_cores,
            finalizado,
            evento_repertorio(
              id,
              repertorio(titulo, tom, bpm)
            )
          `)
          .eq('org_id', org.id) // 🔒 CRUCIAL: Filtra apenas eventos desta banda
          .eq('finalizado', true)
          .order('data', { ascending: false });

        if (error) {
          console.error('Erro Supabase:', error.message);
        } else {
          setEventos(data || []);
        }
      } catch (err) {
        console.error('Erro ao carregar histórico:', err);
      } finally {
        setLoading(false);
      }
    }

    carregarHistorico();
  }, [org?.id]); // ✅ Recarrega se a organização mudar

  const eventosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return eventos;

    return eventos.filter((ev: any) => {
      const local = String(ev?.local || '').toLowerCase();
      const paleta = String(ev?.paleta_cores || '').toLowerCase();
      // Opcional: permitir buscar por data também (ex: "17/01")
      const dataFmt = formatEventDate(ev.data).toLowerCase();
      
      return local.includes(q) || paleta.includes(q) || dataFmt.includes(q);
    });
  }, [eventos, busca]);

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-blue-500" size={40} />
      <span className="text-blue-500 font-black italic uppercase tracking-widest text-[10px]">Acessando Arquivos...</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-6 pb-24 font-sans">
      <div className="w-full max-w-6xl mx-auto">
        <header className="flex justify-between items-end mb-10 pt-2">
          {/* Título clicável para a Home */}
          <Link href="/" className="group block transition-transform active:scale-95">
            <div>
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org?.nome || 'Banda'}
            </h2>
              <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors">
                Histórico
              </h1>
            </div>
          </Link>

          {/* Link de voltar */}
          <Link 
            href="/" 
            className="text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors pb-1"
          >
            <ArrowLeft size={16} /> Voltar
          </Link>
        </header>

        <div className="relative mb-8">
                                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-white-600 size-5" />
          <input
            type="text"
            placeholder="Buscar por local, data ou estilo..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-slate-900 border border-white/5 rounded-[2rem] py-5 pl-14 pr-6 outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm transition-all shadow-inner placeholder:text-white-600"
          />
        </div>

        <div className="space-y-4">
          {eventosFiltrados.length === 0 ? (
            <div className="p-10 border-2 border-dashed border-white/5 rounded-[2.5rem] text-center opacity-40">
              <History className="mx-auto mb-4 text-slate-700" size={44} />
              <p className="font-black uppercase text-xs tracking-widest text-slate-500">Nenhum evento finalizado encontrado</p>
            </div>
          ) : (
            eventosFiltrados.map((ev: any) => {
              const qtd = ev?.evento_repertorio?.length || 0;
              return (
                <Link key={ev.id} href={`/eventos/antigos/${ev.id}`} className="block relative bg-slate-900 border border-white/5 p-6 rounded-[2.5rem] hover:border-blue-500/50 transition-all group active:scale-[0.98]">
                  <div className="flex items-center justify-between">
                                                          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-blue-500 mb-1">
                        <Calendar size={14} className="opacity-70" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-500/80">{formatEventDate(ev.data)}</span>
                      </div>
                      <h3 className="text-xl font-black uppercase italic tracking-tight truncate group-hover:text-blue-400 transition-colors">{ev.local}</h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full">{ev.paleta_cores || 'Look Livre'}</span>
                        <span className="text-[11px] font-black uppercase tracking-widest text-blue-400 bg-blue-500/10 border border-white/5 px-3 py-1.5 rounded-full flex items-center gap-2">
                          <Music size={12} className="text-slate-600" /> {qtd} {qtd === 1 ? 'música' : 'músicas'}
                        </span>
                      </div>
                    </div>
                    <ChevronRight size={18} className="text-slate-700 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}