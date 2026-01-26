'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrgContext'; // ✅ Importar Contexto

import {
  ArrowLeft,
  Calendar,
  Users,
  Palette,
  ListMusic,
  Loader2,
  Music,
  Gauge,
} from 'lucide-react';

// ✅ FORMATADOR DE DATA SEGURO
function formatEventDateLong(evData: string) {
  if (!evData) return 'Data não definida';
  const [datePart] = evData.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return 'Data inválida';

  return d.toLocaleDateString('pt-BR', { 
    weekday: 'long', 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric' 
  }).replace(/^\w/, (c) => c.toUpperCase());
}

function safeText(v: any, fallback = '-') {
  const s = String(v ?? '').trim();
  return s ? s : fallback;
}

export default function HistoricoEventoDetalhe() {
  const params = useParams();
  const id = String(params?.id || '').trim();
  
  // ✅ Contexto da organização para segurança
  const { org } = useOrg();

  const [loading, setLoading] = useState(true);
  const [evento, setEvento] = useState<any>(null);
  const [participantes, setParticipantes] = useState<any[]>([]);
  const [setlist, setSetlist] = useState<any[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  if (!org) return null; // Ou um loader customizado

  useEffect(() => {
    async function load() {
      // Se não tiver ID ou Organização, não busca
      if (!id || !org?.id) return;

      setLoading(true);
      setErrMsg(null);

      try {
        const { data: ev, error: evErr } = await supabase
          .from('eventos')
          .select(`
            id,
            local,
            data,
            finalizado,
            paleta_cores,
            evento_repertorio(
              id,
              ordem,
              repertorio(id, titulo, categoria, tom, bpm)
            )
          `)
          .eq('id', id)
          .eq('org_id', org.id) // 🔒 SEGURANÇA: Garante que o evento é desta banda
          .single();

        if (evErr) throw evErr;

        setEvento(ev);

        const lista = (ev?.evento_repertorio || [])
          .map((x: any) => ({
            id: x?.id,
            ordem: x?.ordem ?? 999,
            titulo: x?.repertorio?.titulo ?? 'Música sem título',
            categoria: x?.repertorio?.categoria ?? '',
            tom: x?.repertorio?.tom ?? '?',
            bpm: x?.repertorio?.bpm ?? '',
          }))
          .sort((a: any, b: any) => a.ordem - b.ordem);

        setSetlist(lista);

        const { data: esc } = await supabase
          .from('escalas')
          .select('id, status, membro_id, membros!membro_id(nome, funcao)')
          .eq('evento_id', id)
          .eq('status', 'confirmado');

        setParticipantes(esc || []);
      } catch (e: any) {
        console.error('Erro ao carregar detalhes:', e.message);
        setErrMsg('Não foi possível localizar este evento ou você não tem permissão.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, org?.id]); // ✅ Recarrega se a org mudar

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-blue-500" size={40} />
      <span className="text-blue-500 font-black italic uppercase tracking-widest text-[10px]">Recuperando Memória...</span>
    </div>
  );

  if (!evento || errMsg) return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="p-10 border-2 border-dashed border-white/5 rounded-[2.5rem] max-w-sm">
        <p className="font-black uppercase text-xs tracking-widest text-slate-500 mb-6">{errMsg || 'Evento não encontrado'}</p>
        <Link href="/eventos/antigos" className="bg-blue-600 px-6 py-3 rounded-xl font-black uppercase text-[10px]">Voltar ao Histórico</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-6 pb-24 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        
        <header className="flex justify-between items-end mb-8 pt-2">
          {/* Identidade do Evento - Atalho para Home */}
          <Link href="/" className="group block transition-transform active:scale-95">
            <div>
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org?.nome || 'Banda'}
            </h2>
              <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors">
                Evento
                <br />
                Detalhes
              </h1>
            </div>
          </Link>

          {/* Botão Voltar */}
          <Link 
            href="/eventos/antigos" 
            className="text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-all pb-1"
          >
            <ArrowLeft size={16} /> Voltar
          </Link>
        </header>

        {/* INFO PRINCIPAL */}
        <section className="bg-slate-900 border border-white/5 rounded-[2.5rem] p-8 shadow-2xl mb-8 relative overflow-hidden">
                                              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

          <div className="absolute top-0 right-0 p-6">
            <div className="text-[10px] font-black uppercase tracking-[0.2em]  px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              Finalizado
            </div>
          </div>

          <div className="flex items-center gap-2 mb-3 text-blue-500">
            <Calendar size={16} />
            <span className="text-[11px] font-black uppercase tracking-widest">{formatEventDateLong(evento?.data)}</span>
          </div>
          
          <h2 className="text-4xl font-black uppercase italic tracking-tighter mb-6">{evento?.local}</h2>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-slate-950/50 border border-white/5">
              <Palette size={12} className="text-pink-500" /> {safeText(evento?.paleta_cores, 'Look Livre')}
            </div>
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-slate-950/50 border border-white/5">
              <Music size={12} className="text-blue-500" /> {setlist.length} músicas
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* COLUNA: LINEUP */}
          <section>
            <h3 className="text-[14px] font-black text-slate-500 uppercase relative tracking-[0.3em] mb-4 flex items-center gap-2">
              <Users size={14} /> Equipe do Dia
            </h3>
            <div className="space-y-2">
              {participantes.length > 0 ? participantes.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4 bg-slate-900/40 border border-white/5 rounded-2xl">
                                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                  <span className="text-xl font-bold uppercase">{p.membros?.nome}</span>
                  <span className="text-l font-black uppercase px-2 py-1 bg-slate-800 rounded-md text-slate-400">{p.membros?.funcao}</span>
                </div>
              )) : (
                <p className="text-[10px] uppercase text-slate-600 italic">Sem registros de equipe.</p>
              )}
            </div>
          </section>

          {/* COLUNA: SETLIST */}
          <section>
            <h3 className="text-[14px] font-black text-slate-500 uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
              <ListMusic size={14} /> Repertório
            </h3>
            <div className="space-y-2">
              {setlist.length > 0 ? setlist.map((m, idx) => (
                <div key={m.id} className="p-4 bg-slate-900 border border-white/5 rounded-2xl relative group hover:border-blue-500/30 transition-all">
                                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-black uppercase leading-tight">{m.titulo}</span>
                    <span className="text-xl font-bold text-slate-600">#{idx + 1}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="flex items-center gap-1 text-xl font-black uppercase text-blue-500 bg-blue-500/5 px-2 py-1 rounded">
                      <Music size={18} /> {m.tom}
                    </span>
                    {m.bpm && (
                      <span className="flex items-center gap-1 text-l font-black uppercase text-yellow-500 bg-slate-950 px-2 py-1 rounded">
                        <Gauge size={10} /> {m.bpm} BPM
                      </span>
                    )}
                  </div>
                </div>
              )) : (
                <p className="text-[10px] uppercase text-slate-600 italic">Nenhuma música tocada.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}