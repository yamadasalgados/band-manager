'use client';

import { useState, useEffect, useCallback, use, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Music, Plus, Trash2, Search, ArrowLeft, Loader2, Gauge, Music2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ✅ Contexto e Segurança
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';

type Repertorio = {
  id: string;
  titulo?: string | null;
  artista?: string | null;
  tom?: string | null;
  bpm?: number | null;
  categoria?: string | null;
};

type EventoRepertorioRow = {
  id: string;
  ordem: number | null;
  repertorio: Repertorio | null;
};

export default function GerenciarSetlist({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const eventoId = resolvedParams.id;

  const router = useRouter();
  const { org } = useOrg();

  const [repertorioGeral, setRepertorioGeral] = useState<Repertorio[]>([]);
  const [setlistAtual, setSetlistAtual] = useState<EventoRepertorioRow[]>([]);
  const [membrosIds, setMembrosIds] = useState<string[]>([]);

  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);

  const [adicionando, setAdicionando] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  // =========================
  // ✅ push helper (agora manda externalUserIds)
  // =========================
const sendPush = useCallback(
  async (args: { title: string; message: string; url?: string; data?: Record<string, any> }) => {
    try {
      if (!membrosIds.length) {
        console.warn("Sem membrosIds para enviar push (externalUserIds vazio).");
        return;
      }

      const r = await fetch("/api/onesignal/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: args.title,
          message: args.message,
          url: args.url || `/eventos/setlists/${eventoId}`,
          externalUserIds: membrosIds,
          data: args.data || undefined,
        }),
      });

      const text = await r.text();
      const json = (() => {
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          return {};
        }
      })();

      if (!r.ok || !json?.ok) {
        console.error("sendPush(Setlist) failed:", json);
      } else {
        console.log("sendPush(Setlist) ok:", json?.result);
      }
    } catch (e) {
      console.error("Erro ao disparar push:", e);
    }
  },
  [eventoId, membrosIds]
);


  // =========================
  // ✅ carregar dados
  // =========================
  const carregarDados = useCallback(async () => {
    if (!org?.id || !eventoId) return;

    setLoading(true);
    try {
      // 1) membros da org => externalUserIds
const { data: confs, error: eM } = await supabase
  .from("escalas")
  .select("membro_id")
  .eq("org_id", org.id)
  .eq("evento_id", eventoId)
  .eq("status", "confirmado");

if (eM) throw eM;

setMembrosIds(
  (confs || [])
    .map((x: any) => String(x?.membro_id || "").trim())
    .filter(Boolean)
);

      // 2) repertório
      const { data: todas, error: e1 } = await supabase
        .from('repertorio')
        .select('*')
        .eq('org_id', org.id)
        .order('titulo');

      if (e1) throw e1;
      setRepertorioGeral((todas as any[]) || []);

      // 3) setlist atual
      const { data: atual, error: e2 } = await supabase
        .from('evento_repertorio')
        .select('id, ordem, repertorio(*)')
        .eq('evento_id', eventoId)
        .order('ordem', { ascending: true });

      if (e2) throw e2;
      setSetlistAtual((atual as any[]) || []);
    } catch (error) {
      console.error('Erro ao carregar setlist:', error);
    } finally {
      setLoading(false);
    }
  }, [org?.id, eventoId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // =========================
  // ✅ anti-duplicado (ids já presentes)
  // =========================
  const setlistRepertorioIds = useMemo(() => {
    const s = new Set<string>();
    for (const item of setlistAtual) {
      const rid = item?.repertorio?.id;
      if (rid) s.add(String(rid));
    }
    return s;
  }, [setlistAtual]);

  // =========================
  // ✅ reordenar setlist no DB (1..N)
  // =========================
  const reordenarSetlistNoBanco = useCallback(async (rows: EventoRepertorioRow[]) => {
    await Promise.all(
      rows.map((r, idx) =>
        supabase.from('evento_repertorio').update({ ordem: idx + 1 }).eq('id', r.id)
      )
    );
  }, []);

  // =========================
  // ✅ adicionar música (à prova de duplicados)
  // =========================
  async function adicionarMusica(musicaId: string) {
    if (!org?.id || !eventoId) return;
    if (adicionando || removendo) return;

    // anti-duplicado rápido (front)
    if (setlistRepertorioIds.has(String(musicaId))) return;

    setAdicionando(musicaId);

    try {
      // anti-duplicado real (DB)
      const { data: existente, error: e0 } = await supabase
        .from('evento_repertorio')
        .select('id')
        .eq('evento_id', eventoId)
        .eq('repertorio_id', musicaId)
        .maybeSingle();

      if (e0) throw e0;

      if (existente?.id) {
        await carregarDados();
        return;
      }

      const proximaOrdem = (setlistAtual?.length || 0) + 1;

      const { error } = await supabase.from('evento_repertorio').insert([
        {
          evento_id: eventoId,
          repertorio_id: musicaId,
          ordem: proximaOrdem,
        },
      ]);

      if (error) throw error;

      await carregarDados();

      const musica = repertorioGeral.find((m) => String(m.id) === String(musicaId));
      const titulo = musica?.titulo ? String(musica.titulo) : 'Música adicionada';

      await sendPush({
        title: 'Setlist atualizada: música adicionada!',
        message: `✅ Adicionada: ${titulo}`,
        url: `/eventos/setlists/${eventoId}`,
        data: { kind: 'setlist_add', eventoId, repertorioId: musicaId },
      });
    } catch (err) {
      console.error('Erro ao adicionar música:', err);
    } finally {
      setAdicionando(null);
    }
  }

  // =========================
  // ✅ remover música + reordenar
  // =========================
  async function removerMusica(idRelacao: string) {
    if (adicionando || removendo) return;
    setRemovendo(idRelacao);

    try {
      const item = setlistAtual.find((x) => String(x.id) === String(idRelacao));
      const titulo = item?.repertorio?.titulo ? String(item.repertorio.titulo) : 'Música removida';

      const { error } = await supabase.from('evento_repertorio').delete().eq('id', idRelacao);
      if (error) throw error;

      const novo = setlistAtual.filter((x) => String(x.id) !== String(idRelacao));
      setSetlistAtual(novo);

      await reordenarSetlistNoBanco(novo);
      await carregarDados();

      await sendPush({
        title: 'Setlist atualizada: música removida!',
        message: `🗑️ Removida: ${titulo}`,
        url: `/eventos/setlists/${eventoId}`,
        data: { kind: 'setlist_remove', eventoId, relacaoId: idRelacao },
      });
    } catch (err) {
      console.error('Erro ao remover música:', err);
      await carregarDados();
    } finally {
      setRemovendo(null);
    }
  }

  // =========================
  // filtros
  // =========================
  const musicasDisponiveis = useMemo(() => {
    const q = busca.toLowerCase();
    return repertorioGeral.filter((m) => {
      const titulo = String(m?.titulo || '').toLowerCase();
      return titulo.includes(q) && !setlistRepertorioIds.has(String(m.id));
    });
  }, [repertorioGeral, busca, setlistRepertorioIds]);

  const rapidas = musicasDisponiveis.filter((m) => m.categoria === 'Rápida');
  const moderadas = musicasDisponiveis.filter((m) => m.categoria === 'Moderada');
  const lentas = musicasDisponiveis.filter((m) => m.categoria === 'Lenta');
  const outras = musicasDisponiveis.filter(
    (m) => !['Rápida', 'Moderada', 'Lenta'].includes(String(m.categoria || ''))
  );

  const Section = ({ title, color, items }: { title: string; color: string; items: Repertorio[] }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className={cn('size-2 rounded-full', color)} />
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{title}</span>
        <span className="ml-auto text-[10px] font-black text-slate-600">{items.length}</span>
      </div>

      {items.map((musica) => {
        const isAdding = adicionando === musica.id;
        const disabled = !!adicionando || !!removendo;

        return (
          <button
            key={musica.id}
            onClick={() => adicionarMusica(musica.id)}
            disabled={disabled}
            className="w-full flex items-center relative justify-between p-4 bg-slate-900/30 border border-white/5 rounded-2xl hover:bg-slate-900/80 hover:border-blue-500/20 transition-all group active:scale-[0.98] disabled:opacity-50 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
              <p className="text-[18px] font-black uppercase tracking-tight truncate text-slate-300 group-hover:text-white transition-colors">
                {musica.titulo}
              </p>
              <p className="text-[12px] text-slate-400 uppercase font-bold tracking-widest group-hover:text-slate-300 transition-colors">
                {musica.artista || '—'}
              </p>
            </div>

            <div className="size-10 flex items-center justify-center bg-blue-600/10 text-blue-500 group-hover:bg-blue-600 group-hover:text-white rounded-xl transition-all ml-4">
              {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} className="group-hover:scale-110 transition-transform" />}
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
            {/* ✅ SETLIST */}
            <section className="lg:col-span-3 space-y-4">
              {setlistAtual.map((item, index) => {
                const isRemoving = removendo === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => removerMusica(item.id)}
                    disabled={!!adicionando || !!removendo}
                    className="w-full text-left relative flex items-center justify-between p-5 bg-slate-900 border border-white/5 rounded-[2rem] hover:bg-slate-900/80 hover:border-blue-500/20 transition-all group active:scale-[0.99] disabled:opacity-60"
                    title="Clique para remover"
                  >
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                    <div className="flex items-center gap-4 min-w-0">
                      <span className="text-blue-500 font-black italic text-lg shrink-0">#{index + 1}</span>

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

                    <span className="ml-4 flex items-center justify-center size-11 rounded-2xl border border-white/5 bg-slate-950/40 text-slate-500 group-hover:text-red-500 group-hover:border-red-500/20 transition-all">
                      {isRemoving ? <Loader2 size={18} className="animate-spin text-red-400" /> : <Trash2 size={18} />}
                    </span>
                  </button>
                );
              })}

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
                {outras.length > 0 && <Section title="Outras" color="bg-slate-500" items={outras} />}
              </div>
            </section>
          </div>
        </div>
      </div>
    </SubscriptionGuard>
  );
}
