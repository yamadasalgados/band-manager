'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Music,
  Plus,
  Trash2,
  Search,
  ArrowLeft,
  Loader2,
  Gauge,
  Music2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ✅ Contexto e Segurança
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';

export default function GerenciarSetlist({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const eventoId = resolvedParams.id;

  const router = useRouter();
  const { org } = useOrg();

  const [repertorioGeral, setRepertorioGeral] = useState<any[]>([]);
  const [setlistAtual, setSetlistAtual] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [adicionando, setAdicionando] = useState<string | null>(null);

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  const carregarDados = useCallback(async () => {
    if (!org?.id || !eventoId) return;

    setLoading(true);
    try {
      const { data: todas } = await supabase
        .from('repertorio')
        .select('*')
        .eq('org_id', org.id)
        .order('titulo');

      setRepertorioGeral(todas || []);

      const { data: atual } = await supabase
        .from('evento_repertorio')
        .select('id, ordem, repertorio(*)')
        .eq('evento_id', eventoId)
        .order('ordem', { ascending: true });

      setSetlistAtual(atual || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [org?.id, eventoId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  async function adicionarMusica(musicaId: string) {
    if (adicionando) return;
    setAdicionando(musicaId);

    const proximaOrdem = setlistAtual.length + 1;

    const { error } = await supabase.from('evento_repertorio').insert([
      {
        evento_id: eventoId,
        repertorio_id: musicaId,
        ordem: proximaOrdem,
      },
    ]);

    if (!error) await carregarDados();
    setAdicionando(null);
  }

  async function removerMusica(idRelacao: string) {
    const { error } = await supabase.from('evento_repertorio').delete().eq('id', idRelacao);
    if (!error) carregarDados();
  }

  const musicasDisponiveis = repertorioGeral.filter(
    (m) =>
      String(m?.titulo || '').toLowerCase().includes(busca.toLowerCase()) &&
      !setlistAtual.some((s) => s.repertorio?.id === m.id)
  );

  // ✅ Agrupamento por categoria
  const rapidas = musicasDisponiveis.filter((m) => m.categoria === 'Rápida');
  const moderadas = musicasDisponiveis.filter((m) => m.categoria === 'Moderada');
  const lentas = musicasDisponiveis.filter((m) => m.categoria === 'Lenta');
  const outras = musicasDisponiveis.filter(
    (m) => !['Rápida', 'Moderada', 'Lenta'].includes(m.categoria)
  );

  const Section = ({
    title,
    color,
    items,
  }: {
    title: string;
    color: string;
    items: any[];
  }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className={cn('size-2 rounded-full', color)} />
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          {title}
        </span>
        <span className="ml-auto text-[10px] font-black text-slate-600">{items.length}</span>
      </div>

      {items.map((musica) => {
        const isAdding = adicionando === musica.id;
        return (
          <button
            key={musica.id}
            onClick={() => adicionarMusica(musica.id)}
            disabled={!!adicionando}
            className="w-full flex items-center relative justify-between p-4 bg-slate-900/30 border border-white/5 rounded-2xl hover:bg-slate-900/80 hover:border-blue-500/20 transition-all group active:scale-[0.98] disabled:opacity-50 text-left"
          >
            {/* Conteúdo de Texto */}
            <div className="min-w-0 flex-1">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
              <p className="text-[18px] font-black uppercase tracking-tight truncate text-slate-300 group-hover:text-white transition-colors">
                {musica.titulo}
              </p>
              <p className="text-[12px] text-slate-400 uppercase font-bold tracking-widest group-hover:text-slate-300 transition-colors">
                {musica.artista || '—'}
              </p>
            </div>

            {/* Indicador Visual (Ícone) */}
            <div className="size-10 flex items-center justify-center bg-blue-600/10 text-blue-500 group-hover:bg-blue-600 group-hover:text-white rounded-xl transition-all ml-4">
              {isAdding ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={18} className="group-hover:scale-110 transition-transform" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (!org) return null;

  return (
<SubscriptionGuard {...({ status: org?.status_assinatura } as any)}>
        <div className="min-h-screen bg-slate-950 font-sans text-white p-6 pb-24">
        <div className="max-w-6xl mx-auto">
          <header className="flex justify-between items-end mb-10">
            <div>
              <Link href="/" className="block active:scale-[0.99] transition-transform">
                <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
                  {org.nome || 'Banda'}
                </h2>
                <h1 className="text-4xl font-black italic uppercase tracking-tight">
                  Setlist
                  <br />
                  do dia
                </h1>
              </Link>
            </div>

            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-blue-500 hover:text-white text-[16px] font-bold uppercase"
            >
              <ArrowLeft size={16} /> Voltar
            </button>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* ✅ SETLIST (linha inteira clicável pra remover) */}
            <section className="lg:col-span-3 space-y-4">
              {setlistAtual.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => removerMusica(item.id)}
                  className="w-full text-left relative flex items-center justify-between p-5 bg-slate-900 border border-white/5 rounded-[2rem] hover:bg-slate-900/80 hover:border-blue-500/20 transition-all group active:scale-[0.99]"
                  title="Clique para remover"
                >
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-blue-500 font-black italic text-lg shrink-0">
                      #{index + 1}
                    </span>

                    <div className="min-w-0">
                      <p className="font-black uppercase truncate text-[18px] text-slate-200 group-hover:text-white transition-colors">
                        {item.repertorio?.titulo}
                      </p>

                      <p className="text-[12px] text-slate-400 flex items-center gap-2 mt-1">
                        <Music size={16} /> {item.repertorio?.tom || '—'}
                        {item.repertorio?.bpm && (
                          <>
                            <span className="opacity-40">•</span>
                            <Gauge size={16} /> {item.repertorio.bpm}
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* ✅ Lixeira opcional (não dispara o clique do card) */}
                  <span className="ml-4 flex items-center justify-center size-11 rounded-2xl border border-white/5 bg-slate-950/40 text-slate-500 group-hover:text-red-500 group-hover:border-red-500/20 transition-all">
                    <Trash2 size={18} />
                  </span>
                </button>
              ))}

              {setlistAtual.length === 0 && (
                <div className="py-20 border border-dashed relative border-white/5 rounded-3xl text-center opacity-40">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                  <div className="flex flex-col items-center gap-3">
                    <Music2 size={48} />
                    <p className="mt-2 text-[20px] uppercase font-black">Setlist vazio</p>
                  </div>
                </div>
              )}
            </section>

            {/* BIBLIOTECA */}
            <section className="lg:col-span-2 space-y-6">
              <div className="relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 size-5 text-slate-600" />
                <input
                  placeholder="Buscar músicas..."
                  className="w-full py-5 pl-14 pr-6 rounded-2xl bg-slate-900 border border-white/5 outline-none focus:ring-2 focus:ring-blue-500/50 font-black text-xs"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>

              <div className="space-y-6 max-h-[65vh] overflow-y-auto no-scrollbar pr-1">
                <Section title="Rápidas" color="bg-orange-500" items={rapidas} />
                <Section title="Moderadas" color="bg-yellow-400" items={moderadas} />
                <Section title="Lentas" color="bg-emerald-400" items={lentas} />
                {outras.length > 0 && (
                  <Section title="Outras" color="bg-slate-500" items={outras} />
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </SubscriptionGuard>
  );
}
