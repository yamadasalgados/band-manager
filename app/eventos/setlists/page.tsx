'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Music,
  Calendar,
  Save,
  CheckCircle2,
  ChevronRight,
  Search,
  Edit3,
  X,
  PlusCircle,
  Loader2,
  Music2,
  Gauge,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ✅ Contextos e Segurança
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';
import GlassCard from '@/components/GlassCard';

/** ✅ Helpers de Data */
function toDatetimeLocalValue(input: any) {
  if (!input) return '';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function fromDatetimeLocalToISO(v: string) {
  const s = String(v || '').trim();
  if (!s) return null;
  return new Date(s).toISOString();
}

function formatarDataExibicao(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type RangeMode = '60d' | '120d' | 'all';

export default function GerenciarSetlistsSemanais() {
  const router = useRouter();
  const { org, loadingOrg } = useOrg();

  const [eventos, setEventos] = useState<any[]>([]);
  const [musicasBiblioteca, setMusicasBiblioteca] = useState<any[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVocal, setFilterVocal] = useState('Todos');
  const [eventoSelecionado, setEventoSelecionado] = useState<any>(null);
  const [setlistTemp, setSetlistTemp] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [deletandoId, setDeletandoId] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editEvento, setEditEvento] = useState<any>(null);
  const [editLocal, setEditLocal] = useState('');
  const [editData, setEditData] = useState('');
  const [editPaleta, setEditPaleta] = useState('');
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>('60d');

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  const carregarDados = useCallback(async () => {
    if (!org?.id) return;
    setLoading(true);

    try {
      const now = new Date().toISOString();
      let q = supabase
        .from('eventos')
        .select('*, evento_repertorio(ordem, repertorio(*))')
        .eq('org_id', org.id)
        .eq('finalizado', false)
        .gte('data', now)
        .order('data', { ascending: true });

      if (rangeMode !== 'all') {
        const days = rangeMode === '120d' ? 120 : 60;
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() + days);
        q = q.lte('data', limitDate.toISOString());
      }

      const { data: evs } = await q;

      const { data: libs } = await supabase
        .from('repertorio')
        .select('*, membros(nome)')
        .eq('org_id', org.id)
        .order('titulo');

      setEventos(evs || []);
      setMusicasBiblioteca(libs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [rangeMode, org?.id]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const getVocalName = (song: any) => song?.lead_vocal_custom || song?.membros?.nome || '—';

  const selectedIds = useMemo(() => new Set(setlistTemp.map((m) => String(m?.id))), [setlistTemp]);

  const toggleMusicaNoSetlist = (m: any) => {
    const id = String(m?.id);
    setSetlistTemp((prev) => {
      const exists = prev.some((x) => String(x?.id) === id);
      if (exists) return prev.filter((x) => String(x?.id) !== id);
      return [...prev, m];
    });
  };

  const musicasFiltradas = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (musicasBiblioteca || []).filter((m: any) => {
      const matchesCategory = categoriaAtiva === 'Todas' || m.categoria === categoriaAtiva;
      const matchesSearch = !q || m.titulo.toLowerCase().includes(q) || m.artista?.toLowerCase().includes(q);
      const vocalName = getVocalName(m);
      const matchesVocal =
        filterVocal === 'Todos' || (filterVocal === 'Sem vocal' ? !vocalName : vocalName === filterVocal);
      return matchesCategory && matchesSearch && matchesVocal;
    });
  }, [musicasBiblioteca, categoriaAtiva, searchTerm, filterVocal]);

  const abrirEditor = (evento: any) => {
    setEventoSelecionado(evento);
    const atuais = [...(evento.evento_repertorio || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((er) => er.repertorio)
      .filter(Boolean);
    setSetlistTemp(atuais);
  };

const salvarRepertorioShow = async () => {
  if (!eventoSelecionado || !org?.id) return;

  setSalvando(true);
  try {
    await supabase
      .from('evento_repertorio')
      .delete()
      .eq('evento_id', eventoSelecionado.id);

    if (setlistTemp.length > 0) {
      const novosItens = setlistTemp.map((m, index) => ({
        evento_id: eventoSelecionado.id,
        repertorio_id: m.id,
        ordem: index + 1,
      }));

      await supabase.from('evento_repertorio').insert(novosItens);
    }

    // 🔔 PUSH AQUI (🔥 ponto-chave)
    await sendPushEventoRepertorio(eventoSelecionado.id, org.id);

    setEventoSelecionado(null);
    await carregarDados();
  } catch (e) {
    console.error(e);
  } finally {
    setSalvando(false);
  }
};


  const deletarEvento = async (id: string) => {
    if (!confirm('Excluir evento permanentemente?')) return;
    setDeletandoId(id);
    await supabase.from('eventos').delete().eq('id', id);
    await carregarDados();
    setDeletandoId(null);
  };

  // ✅ PILL PADRÃO
  const RangePill = ({ k, label }: { k: RangeMode; label: string }) => {
    const isActive = rangeMode === k;
    return (
      <button
        onClick={() => setRangeMode(k)}
        className={cn(
          'px-5 py-2.5 rounded-xl text-[12px] font-black uppercase flex-shrink-0 transition-all relative group border',
          isActive
            ? 'bg-blue-500/10 text-blue-400 scale-105 border-blue-500/20'
            : 'bg-slate-900 border-white/5 text-slate-500 hover:text-white hover:border-blue-500/20 active:scale-95'
        )}
      >
        {label}
        {isActive && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6] animate-in fade-in zoom-in duration-300" />
        )}
      </button>
    );
  };

  // ✅ Renderizador de música (reuso)
  const renderSongButton = (m: any) => (
    <button
      key={m.id}
      onClick={() => toggleMusicaNoSetlist(m)}
      className={cn(
        'w-full flex items-center justify-between p-4 rounded-2xl border transition-all group active:scale-[0.99]',
        selectedIds.has(String(m.id))
          ? 'bg-blue-600 border-blue-400 text-white'
          : 'bg-slate-900 border-white/5 hover:border-blue-500/30'
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {/* bolinha de cor por categoria */}
        <div
          className={cn(
            'mt-1.5 size-2 rounded-full shrink-0',
            m?.categoria === 'Rápida'
              ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.6)]'
              : m?.categoria === 'Moderada'
              ? 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.55)]'
              : m?.categoria === 'Lenta'
              ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]'
              : 'bg-slate-600'
          )}
        />

        <div className="text-left min-w-0">
          <p
            className={cn(
              'font-black text-xs uppercase truncate',
              selectedIds.has(String(m.id)) ? 'text-white' : 'text-slate-200'
            )}
          >
            {m.titulo}
          </p>
          <p
            className={cn(
              'text-[9px] font-bold uppercase',
              selectedIds.has(String(m.id)) ? 'text-blue-100' : 'text-slate-500'
            )}
          >
            {getVocalName(m)}
          </p>
        </div>
      </div>

      {selectedIds.has(String(m.id)) ? (
        <CheckCircle2 size={18} />
      ) : (
        <Plus size={18} className="text-slate-600 group-hover:text-blue-400" />
      )}
    </button>
  );

  const Section = ({
    title,
    dotClass,
    items,
  }: {
    title: string;
    dotClass: string;
    items: any[];
  }) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('size-2 rounded-full shadow-[0_0_10px]', dotClass)} />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{title}</span>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">{items.length}</span>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">{items.map(renderSongButton)}</div>
      ) : (
        <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 text-slate-600 text-[10px] font-black uppercase tracking-widest">
          Nenhuma música aqui
        </div>
      )}
    </div>
  );

  if (loadingOrg || loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-blue-500" size={40} />
        <span className="text-blue-500 font-black uppercase tracking-[0.3em] text-[10px]">Sincronizando Agenda...</span>
      </div>
    );
  }

  async function sendPushEventoRepertorio(eventoId: string, orgId: string) {
  try {
    // 🔹 busca membros confirmados do evento
    const { data: confs, error } = await supabase
      .from("escalas")
      .select("membro_id")
      .eq("org_id", orgId)
      .eq("evento_id", eventoId)
      .eq("status", "confirmado");

    if (error) throw error;

    const ids = (confs || [])
      .map((x: any) => String(x?.membro_id || "").trim())
      .filter(Boolean);

    if (!ids.length) {
      console.warn("Push ignorado: nenhum membro confirmado.");
      return;
    }

    const r = await fetch("/api/onesignal/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Setlist atualizada 🎵",
        message: "O repertório do próximo evento foi atualizado.",
        url: `/eventos`,
        externalUserIds: ids,
        data: {
          kind: "setlist_bulk_update",
          eventoId,
        },
      }),
    });

    const json = await r.json().catch(() => ({}));

    if (!r.ok || !json?.ok) {
      console.error("Push setlist semanal falhou:", json);
    } else {
      console.log("Push setlist semanal enviado:", json.result);
    }
  } catch (err) {
    console.error("Erro ao enviar push do setlist semanal:", err);
  }
}


  return (
<SubscriptionGuard {...({ status: org?.status_assinatura } as any)}>  
      <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-slate-950 text-white px-4 pb-24 font-sans pt-[env(safe-area-inset-top)]">
        <div className="pt-6 w-full max-w-6xl mx-auto">
          {editOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-white/10 rounded-[2.5rem] p-8 w-full max-w-lg shadow-2xl">
                <h3 className="text-2xl font-black italic uppercase tracking-tighter mb-6">
                  Editar evento
                </h3>

                <div className="space-y-4 relative">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                  <input
                    value={editLocal}
                    onChange={(e) => setEditLocal(e.target.value)}
                    placeholder="Local do Show"
                    className="w-full bg-slate-950 border border-white/5 rounded-2xl p-4 outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  <input
                    type="datetime-local"
                    value={editData}
                    onChange={(e) => setEditData(e.target.value)}
                    className="w-full bg-slate-950 border border-white/5 rounded-2xl p-4 outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => setEditOpen(false)}
                      className="flex-1 py-4 bg-slate-900 border border-white/5 rounded-2xl font-black uppercase text-[10px] text-slate-400 hover:text-white hover:border-blue-500/20 transition-all active:scale-95"
                    >
                      Cancelar
                    </button>

                    <button
                      onClick={async () => {
                        if (!editEvento?.id) return;
                        setSalvandoEdicao(true);
                        await supabase
                          .from('eventos')
                          .update({
                            local: editLocal,
                            data: fromDatetimeLocalToISO(editData),
                            paleta_cores: editPaleta,
                          })
                          .eq('id', editEvento.id);

                        setEditOpen(false);
                        await carregarDados();
                        setSalvandoEdicao(false);
                      }}
                      className="flex-1 py-4 bg-blue-600 rounded-2xl font-black uppercase text-[10px] text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-all active:scale-95"
                    >
                      {salvandoEdicao ? '...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <header className="flex justify-between items-start mb-4">
            <div className="min-w-0">
              <Link href="/" className="group block transition-transform active:scale-95">
                <div className="flex flex-col min-w-0">
                  <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
                    {org?.nome || 'Banda'}
                  </h2>
                  <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors break-words">
                    Repertorio <span className="text-blue-500"></span>
                  </h1>
                </div>
              </Link>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Setlists dos Eventos</p>
            </div>

            <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="mt-2 text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> voltar
          </button>
            </div>
          </header>

          {!eventoSelecionado && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
             <GlassCard>
              <Link
                href="/repertorio"
                className="flex items-center justify-between p-7 bg-slate-900 border border-white/5 rounded-[2.5rem] hover:border-blue-500/20 hover:bg-slate-900/80 transition-all gap-4 shadow-2xl"
              >
                <div className="flex items-center gap-5 min-w-0">
                  <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-600/40 shrink-0">
                    <Music size={28} />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[12px] font-black uppercase tracking-widest">Biblioteca</span>
                    <span className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">
                      Ver todas as músicas
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} className="text-blue-500 shrink-0" />
              </Link>
              </GlassCard>
              <GlassCard>
              <Link
                href="/eventos/novo"
                className="flex items-center justify-between p-7 bg-slate-900 border border-white/5 rounded-[2.5rem] hover:border-blue-500/20 hover:bg-slate-900/80 transition-all gap-4 shadow-2xl"
              >
                <div className="flex items-center gap-5 min-w-0">
                  <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-600/30 shrink-0">
                    <PlusCircle size={28} />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[12px] font-black uppercase tracking-widest">Novo Evento</span>
                    <span className="text-[9px] text-blue-400 font-bold uppercase tracking-widest">Agendar evento</span>
                  </div>
                </div>
                <ChevronRight size={20} className="text-blue-400 shrink-0" />
              </Link>
              </GlassCard>
            </div>
          )}

          {!eventoSelecionado && (
            <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-4">
              <RangePill k="60d" label="60 dias" />
              <RangePill k="120d" label="120 dias" />
              <RangePill k="all" label="Tudo" />
            </div>
          )}

          {!eventoSelecionado ? (
            <div className="space-y-8 mb-12">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
                  <div className="size-2 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]" />
                  Próximos eventos
                </h2>
              </div>

              <div className="grid gap-4">
  {eventos.map((ev) => (
    <div
      key={ev.id}
      className="bg-slate-900 border border-white/5 p-6 rounded-[2.5rem] flex items-center justify-between group hover:border-blue-500/20 transition-all shadow-2xl relative overflow-hidden"
    >
      {/* --- LINHA DE LUZ NO TOPO --- */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent opacity-50 group-hover:via-blue-400 group-hover:opacity-100 transition-all duration-500" />

      {/* Botão de Área Total para abrir o editor */}
      <button 
        onClick={() => abrirEditor(ev)} 
        className="flex-1 text-left min-w-0 mr-4 active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center gap-2 text-blue-500 mb-1">
          <Calendar size={16} />
          <span className="text-[10px] font-black uppercase tracking-widest">
            {formatarDataExibicao(ev.data)}
          </span>
        </div>

        <h3 className="text-xl font-black uppercase italic tracking-tight truncate group-hover:text-blue-400 transition-colors">
          {ev.local}
        </h3>

        <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest mt-1">
          {ev.evento_repertorio?.length || 0} Músicas • {ev.paleta_cores || 'Look Livre'}
        </p>
      </button>

      {/* Ações do Card */}
      <div className="flex items-center gap-2 relative z-10">
        <button
          onClick={() => {
            setEditEvento(ev);
            setEditLocal(ev.local);
            setEditData(toDatetimeLocalValue(ev.data));
            setEditPaleta(ev.paleta_cores || '');
            setEditOpen(true);
          }}
          className="size-12 flex items-center justify-center rounded-2xl bg-slate-950/50 border border-white/5 text-slate-500 hover:text-blue-400 hover:border-blue-500/20 transition-all active:scale-95"
          title="Editar"
        >
          <Edit3 size={18} />
        </button>

        <button
          onClick={() => deletarEvento(ev.id)}
          className="size-12 flex items-center justify-center rounded-2xl bg-slate-950/50 border border-white/5 text-slate-500 hover:text-red-500 hover:border-red-500/20 transition-all active:scale-95"
          title="Excluir"
        >
          {deletandoId === ev.id ? <Loader2 className="animate-spin" /> : <Trash2 size={18} />}
        </button>
      </div>
    </div>
  ))}

  {/* Estado Vazio (Empty State) */}
  {eventos.length === 0 && (
    <div className="w-full bg-blue-500/5 py-12 rounded-[2.5rem] border border-dashed border-white/10 flex flex-col items-center gap-4 shadow-2xl">
      <div className="p-4 bg-slate-900 rounded-full border border-white/5">
        <Calendar className="text-blue-500" size={32} />
      </div>
      <div className="text-center">
        <p className="font-black uppercase text-xs tracking-[0.2em] text-slate-300">Nenhum evento encontrado</p>
        <p className="text-[9px] font-bold text-slate-500 uppercase mt-1">Sua agenda está limpa por enquanto</p>
      </div>
      <Link
        href="/eventos/novo"
        className="mt-2 inline-flex items-center gap-3 px-8 py-4 bg-blue-600 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-all active:scale-95"
      >
        <Plus size={16} /> Criar primeiro evento
      </Link>
    </div>
  )}
</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* BIBLIOTECA */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-3">
                    <div className="size-2 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]" />
                    Biblioteca
                  </h2>

                  <div className="flex gap-1 overflow-x-auto no-scrollbar">
                    {['Todas', 'Rápida', 'Moderada', 'Lenta'].map((c) => (
                      <button
                        key={c}
                        onClick={() => setCategoriaAtiva(c)}
                        className={cn(
                          'px-4 py-2 rounded-xl text-[10px] font-black uppercase border transition-all flex-shrink-0',
                          categoriaAtiva === c
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : 'bg-slate-900 text-slate-500 border-white/5 hover:text-white hover:border-blue-500/20 active:scale-95'
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 size-5" />
                  <input
                    placeholder="BUSCAR NA BIBLIOTECA..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-900 border border-white/5 rounded-[1.5rem] py-5 pl-14 pr-6 outline-none focus:ring-2 focus:ring-blue-500 font-black text-xs shadow-inner"
                  />
                </div>

                {/* ✅ LISTA SECCIONADA quando "Todas" */}
                <div className="bg-slate-900 border border-white/5 rounded-[2.5rem] p-6 h-[550px] overflow-hidden relative no-scrollbar space-y-6 shadow-2xl">
                                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                  {categoriaAtiva !== 'Todas' ? (
                    <div className="space-y-2">{musicasFiltradas.map((m) => renderSongButton(m))}</div>
                  ) : (
                    (() => {
                      const rapidas = musicasFiltradas.filter((m: any) => m?.categoria === 'Rápida');
                      const moderadas = musicasFiltradas.filter((m: any) => m?.categoria === 'Moderada');
                      const lentas = musicasFiltradas.filter((m: any) => m?.categoria === 'Lenta');
                      const outras = musicasFiltradas.filter(
                        (m: any) => !['Rápida', 'Moderada', 'Lenta'].includes(String(m?.categoria || ''))
                      );

                      return (
                        <>
                          <Section title="Rápidas" dotClass="bg-orange-500 shadow-orange-500/50" items={rapidas} />
                          <Section title="Moderadas" dotClass="bg-yellow-400 shadow-yellow-400/50" items={moderadas} />
                          <Section title="Lentas" dotClass="bg-emerald-400 shadow-emerald-400/50" items={lentas} />

                          {outras.length > 0 && (
                            <div className="pt-2">
                              <div className="flex items-center gap-3 mb-3">
                                <div className="size-2 rounded-full bg-slate-500 shadow-[0_0_10px_#64748b]" />
                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                                  Outras
                                </span>
                                <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-slate-600">
                                  {outras.length}
                                </span>
                              </div>
                              <div className="space-y-2">{outras.map((m: any) => renderSongButton(m))}</div>
                            </div>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              </div>

              {/* SETLIST ATUAL */}
              <div className="space-y-6">
                <div className="bg-slate-900 border border-white/5 rounded-[2.5rem] p-8 h-[740px] flex flex-col shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                  <div className="flex justify-between items-start mb-8">
                    <div className="min-w-0">
                      <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Repertório Atual</span>
                      <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white truncate max-w-[340px]">
                        {eventoSelecionado.local}
                      </h2>
                      <p className="mt-2 text-[9px] text-slate-500 uppercase font-black tracking-widest">
                        {formatarDataExibicao(eventoSelecionado.data)} • {eventoSelecionado.paleta_cores || 'Look Livre'}
                      </p>
                    </div>

                    <button
                      onClick={() => setEventoSelecionado(null)}
                      className="size-12 rounded-2xl flex items-center justify-center bg-red-00 border border-white/5 text-white-500 hover:text-red-500 hover:border-red-500/40 transition-all active:scale-95"
                      title="Fechar"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar pr-2">
                    {setlistTemp.map((m, i) => (
                      <div
                        key={`${m.id}-${i}`}
                        className="flex items-center gap-4 bg-slate-950/50 p-4 rounded-2xl border border-white/5 shadow-lg group hover:border-blue-500/20 transition-all"
                      >
                        <span className="text-blue-500 font-black italic text-sm w-10">#{i + 1}</span>

                        <div className="flex-1 min-w-0">
                          <p className="font-black text-xs uppercase truncate">{m.titulo}</p>
                          <p className="text-[9px] font-black text-slate-600 flex items-center gap-2 mt-1">
                            <Music size={10} /> {m.tom || '—'} • <Gauge size={10} /> {m.bpm || '—'}
                          </p>
                        </div>

                        <button
                          onClick={() => setSetlistTemp(setlistTemp.filter((_, idx) => idx !== i))}
                          className="size-10 rounded-2xl flex items-center justify-center bg-slate-900 border border-white/5 text-slate-500 hover:text-red-500 hover:border-red-500/20 transition-all active:scale-95"
                          title="Remover"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}

                    {setlistTemp.length === 0 && (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-30">
                        <Music2 size={64} className="mb-4" />
                        <p className="font-black uppercase text-xs tracking-widest">Setlist vazia</p>
                        <p className="mt-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                          Adicione músicas pela biblioteca
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={salvarRepertorioShow}
                    disabled={salvando}
                    className="mt-8 w-full bg-blue-600 hover:bg-blue-500 py-6 rounded-[2rem] font-black uppercase text-[12px] tracking-[0.2em] flex items-center justify-center gap-3 shadow-xl shadow-blue-600/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {salvando ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <>
                        <Save size={20} /> Salvar Arquivo
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SubscriptionGuard>
  );
}
