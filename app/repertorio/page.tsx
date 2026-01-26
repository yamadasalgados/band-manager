'use client'
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Music, Mic2, Search, Plus,
  Edit2, Trash2, LayoutGrid, ArrowLeft, Loader2
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ✅ Contexto e Segurança
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';

export default function RepertorioPage() {
  const router = useRouter();
  const { org } = useOrg(); // ✅ Pega a organização

  const [songs, setSongs] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState('Todas');
  const [filterVocal, setFilterVocal] = useState('Todos');
    const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');


  const fetchSongs = useCallback(async () => {
    if (!org?.id) return;
    
    setLoading(true);
    const { data } = await supabase
      .from('repertorio')
      .select('*, membros(nome)')
      .eq('org_id', org.id) // 🔒 Segurança
      .order('titulo');

    if (data) setSongs(data);
    setLoading(false);
  }, [org?.id]);

  useEffect(() => { 
    fetchSongs(); 
  }, [fetchSongs]);

  const handleDelete = async (id: string, titulo: string) => {
    if (confirm(`Excluir "${titulo}" permanentemente do arquivo?`)) {
      // O RLS deve garantir que só deleta da org certa, mas é bom filtrar
      const { error } = await supabase.from('repertorio').delete().eq('id', id);
      if (!error) setSongs(songs.filter(s => s.id !== id));
    }
  };

  const getVocalName = (song: any) => {
    const custom = String(song?.lead_vocal_custom || '').trim();
    const membro = String(song?.membros?.nome || '').trim();
    return custom || membro;
  };

  const vocalOptions = useMemo(() => {
    const names = songs
      .map(getVocalName)
      .map(v => String(v || '').trim())
      .filter(Boolean);

    const unique = Array.from(new Set(names)).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    );

    return ['Todos', ...unique, 'Sem vocal'];
  }, [songs]);

  const filteredSongs = songs.filter(s => {
    const titulo = String(s.titulo || '').toLowerCase();
    const artista = String(s.artista || '').toLowerCase();
    const q = searchTerm.toLowerCase();

    const matchesSearch =
      titulo.includes(q) ||
      artista.includes(q) ||
      getVocalName(s).toLowerCase().includes(q);

    const matchesCategory = filterType === 'Todas' || s.categoria === filterType;

    const vocalName = getVocalName(s);
    const matchesVocal =
      filterVocal === 'Todos'
        ? true
        : filterVocal === 'Sem vocal'
          ? !vocalName
          : vocalName === filterVocal;

    return matchesSearch && matchesCategory && matchesVocal;
  });

  const categories = {
    Rápidas: filteredSongs.filter(s => s.categoria === 'Rápida'),
    Moderadas: filteredSongs.filter(s => s.categoria === 'Moderada'),
    Lentas: filteredSongs.filter(s => s.categoria === 'Lenta'),
    Sem_Definição: filteredSongs.filter(s => !s.categoria)
  };

  if (!org) return null;

  return (
    <SubscriptionGuard>
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6 pb-24 font-sans">
        
        <header className="flex justify-between items-end mb-10 pt-4">
          
          <Link href="/" className="group block transition-transform active:scale-95">
            <div>
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org.nome || 'Banda'}
            </h2>
              <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors">
                repertório
              </h1>
            </div>
          </Link>

          <button 
            onClick={() => router.back()} 
            className="text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors pb-1"
          >
            <ArrowLeft size={16} /> Voltar
          </button>
        </header>

        {/* BUSCA + ADD */}
        <div className="space-y-4 mb-12">
          <div className="flex items-center gap-4 w-full">
            <div className="relative flex-1">        
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 size-5" />
              <input
                placeholder="Buscar título, artista ou vocal"
                className="w-full bg-slate-900 border border-white/5 rounded-[2rem] py-6 pl-14 pr-6 outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm transition-all shadow-inner placeholder:text-slate-600"
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <Link
              href="/repertorio/novo"
              className="bg-blue-600 hover:bg-blue-500 p-5 block rounded-[1.5rem] shadow-2xl shadow-blue-600/20 transition-all active:scale-90"
            >
              <Plus size={28} strokeWidth={3} />
            </Link>
          </div>

          {/* CATEGORIAS */}
<div className="flex gap-2 overflow-x-auto no-scrollbar pb-4 relative"> {/* Aumentado pb para não cortar a barra */}
  
  {['Todas', 'Rápida', 'Moderada', 'Lenta'].map(cat => {
    const isActive = filterType === cat;
    return (
      <button
        key={cat}
        onClick={() => setFilterType(cat)}
        className={cn(
          'px-5 py-2.5 rounded-xl text-[12px] font-black uppercase flex-shrink-0 transition-all relative group border',
          isActive
            ? 'bg-blue-500/10 text-blue-400 scale-105 border-blue-500/20'
            : 'bg-slate-900 border-white/5 text-slate-500 hover:text-white'
        )}
      >                                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

        {cat}
        
        {/* Barra de Indicação */}
        {isActive && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6] animate-in fade-in zoom-in duration-300" />
        )}
      </button>
    );
  })}
</div>
        </div>

        {/* LISTAGEM */}
        <div className="space-y-1 ">
          {loading ? (
            <div className="py-20 text-center">
              <Loader2 className="animate-spin text-blue-600 mx-auto mb-4" size={32} />
              <p className="text-white-600 font-black uppercase tracking-[0.3em] text-[12px]">
                Sincronizando Base...
              </p>
            </div>
          ) : (
            Object.entries(categories).map(([label, list]) =>
              list.length > 0 && (
                <section key={label}>
                  <div className="flex items-center gap-4 px-2 mb-6 mt-8">
                    <h2 className={`text-x font-black uppercase tracking-[0.4em] ${
                      label === 'Rápidas' ? 'text-orange-500' :
                      label === 'Lentas' ? 'text-emerald-400' :
                      label === 'Moderadas' ? 'text-yellow-400' : 'text-slate-600'
                    }`}>
                      {label.replace('_', ' ')}
                    </h2>
                    <div className="h-[1px] flex-1 bg-white/5" />
                    <span className="text-x font-black text-blue-600 tracking-tighter">
                      {list.length} ITEMS
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {list.map(song => (
                      <div
                        key={song.id}
                        className="bg-slate-900/50 border relative rounded-[2.5rem] p-7  transition-all w-full bg-blue-500/5 border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] tracking-widest active:scale-95  gap-3 hover:border-blue-500/40 shadow-blue-500/10 hover:text-white  shadow-xl"
                      >                                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <span className="text-[9px] font-black text-blue-500/60 uppercase tracking-[0.2em] block mb-1">
                              {song.artista || 'Artista Desconhecido'}
                            </span>
                            <h3 className="text-2xl font-black italic uppercase text-white truncate max-w-[200px]">
                              {song.titulo}
                            </h3>

                            <div className="flex gap-4 mt-4">
                              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-white/5">
                                <Music size={12} className="text-yellow-500" />
                                <span className="text-xs font-black text-yellow-500">
                                  {song.tom || '??'}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 text-xs font-black text-slate-400">
                                <Mic2 size={12} />
                                {getVocalName(song) || '—'}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <Link
                              href={`/repertorio/editar/${song.id}`}
                              className="p-3 bg-slate-950 rounded-2xl border border-white/5 text-slate-600 hover:text-blue-400 transition-colors"
                            >
                              <Edit2 size={18} />
                            </Link>
                            <button
                              onClick={() => handleDelete(song.id, song.titulo)}
                              className="p-3 bg-slate-950 rounded-2xl border border-white/5 text-slate-800 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            )
          )}
        </div>

        {!loading && filteredSongs.length === 0 && (
          <div className="text-center py-24 opacity-30">
            <LayoutGrid size={48} className="mx-auto mb-4" />
            <p className="font-black uppercase tracking-widest text-xs">
              Nenhum arquivo encontrado
            </p>
          </div>
        )}
      </div>
    </SubscriptionGuard>
  );
}