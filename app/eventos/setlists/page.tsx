'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getAuthAccessToken } from '@/lib/deviceIdentity';
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
  ArrowUp,
  ArrowDown,
  GripVertical,
  Sparkles,
  AlertTriangle,
  Timer,
  TrendingUp,
  Zap,
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

type SongIntelligenceStats = {
  played: number;
  requests: number;
  lastPlayedAt: string | null;
};

type SetlistWarning = {
  id: string;
  label: string;
  detail: string;
};

type SmartSuggestion = {
  song: any;
  score: number;
  reasons: string[];
};

function categoryEnergy(song: any) {
  const categoria = String(song?.categoria || '').toLowerCase();
  if (categoria.includes('ráp') || categoria.includes('rap')) return 3;
  if (categoria.includes('lenta')) return 1;
  if (categoria.includes('moder')) return 2;

  const bpm = Number(song?.bpm);
  if (Number.isFinite(bpm) && bpm > 0) {
    if (bpm >= 126) return 3;
    if (bpm <= 82) return 1;
  }
  return 2;
}

function categoryLabel(song: any) {
  const value = categoryEnergy(song);
  return value === 3 ? 'Rápida' : value === 1 ? 'Lenta' : 'Moderada';
}

function estimateSongSeconds(song: any) {
  const bpm = Number(song?.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;

  const estrutura = Array.isArray(song?.estrutura) ? song.estrutura : [];
  const totalCompassos = estrutura.reduce((sum: number, entry: any) => {
    const raw = Number(entry?.bloco?.duracao_compassos);
    return sum + (Number.isFinite(raw) && raw > 0 ? raw : 0);
  }, 0);

  if (totalCompassos <= 0) return null;
  return (totalCompassos * 4 * 60) / bpm;
}

function formatSetDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `~${minutes} min`;
  return `~${hours}h${String(minutes).padStart(2, '0')}`;
}

export default function GerenciarSetlistsSemanais() {
  const router = useRouter();
  const { org, loadingOrg } = useOrg();

  const [eventos, setEventos] = useState<any[]>([]);
  const [musicasBiblioteca, setMusicasBiblioteca] = useState<any[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState('Todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVocal, setFilterVocal] = useState('Todos');
  const [filterTom, setFilterTom] = useState('Todos');
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
  const [originalSetlistIds, setOriginalSetlistIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [executionStats, setExecutionStats] = useState<Record<string, SongIntelligenceStats>>({});
  const [transitionCounts, setTransitionCounts] = useState<Record<string, Record<string, number>>>({});
  const [intelligenceReady, setIntelligenceReady] = useState(false);

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  const carregarDados = useCallback(async () => {
    if (!org?.id) return;
    setLoading(true);

    try {
      const now = new Date().toISOString();
      let eventosQuery = supabase
        .from('eventos')
        .select(`
          id, local, data, paleta_cores,
          evento_repertorio(
            ordem,
            repertorio(id,titulo,artista,tom,bpm,categoria,lead_vocal_custom,lead_vocal_id,membros(nome),estrutura:musica_estrutura(posicao,bloco:musica_blocos(duracao_compassos)))
          )
        `)
        .eq('org_id', org.id)
        .eq('finalizado', false)
        .gte('data', now)
        .order('data', { ascending: true });

      if (rangeMode !== 'all') {
        const days = rangeMode === '120d' ? 120 : 60;
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() + days);
        eventosQuery = eventosQuery.lte('data', limitDate.toISOString());
      }

      const [eventosRes, bibliotecaRes, execucoesRes] = await Promise.all([
        eventosQuery,
        supabase
          .from('repertorio')
          .select('id,titulo,artista,tom,bpm,categoria,lead_vocal_custom,lead_vocal_id,membros(nome),estrutura:musica_estrutura(posicao,bloco:musica_blocos(duracao_compassos))')
          .eq('org_id', org.id)
          .order('titulo'),
        supabase
          .from('repertorio_execucoes')
          .select('evento_id,repertorio_id,origem,played_at')
          .eq('org_id', org.id)
          .order('played_at', { ascending: false })
          .limit(2500),
      ]);

      if (eventosRes.error) throw eventosRes.error;
      if (bibliotecaRes.error) throw bibliotecaRes.error;

      setEventos(eventosRes.data || []);
      setMusicasBiblioteca(bibliotecaRes.data || []);

      // A inteligência usa o histórico real da v8, mas é opcional.
      // Se a migration ainda não existir, o editor continua funcionando normalmente.
      if (execucoesRes.error) {
        console.warn('Setlist Intelligence: histórico v8 indisponível', execucoesRes.error);
        setExecutionStats({});
        setTransitionCounts({});
        setIntelligenceReady(false);
      } else {
        const stats: Record<string, SongIntelligenceStats> = {};
        const byEvent = new Map<string, any[]>();

        for (const row of execucoesRes.data || []) {
          const songId = String((row as any)?.repertorio_id || '');
          if (!songId) continue;

          if (!stats[songId]) {
            stats[songId] = { played: 0, requests: 0, lastPlayedAt: null };
          }
          stats[songId].played += 1;
          if (String((row as any)?.origem || '') === 'request') stats[songId].requests += 1;
          if (!stats[songId].lastPlayedAt) stats[songId].lastPlayedAt = String((row as any)?.played_at || '') || null;

          const eventId = String((row as any)?.evento_id || '');
          if (eventId) {
            const list = byEvent.get(eventId) || [];
            list.push(row);
            byEvent.set(eventId, list);
          }
        }

        const transitions: Record<string, Record<string, number>> = {};
        byEvent.forEach((rows) => {
          rows.sort(
            (a: any, b: any) =>
              new Date(a?.played_at || 0).getTime() - new Date(b?.played_at || 0).getTime()
          );
          for (let i = 0; i < rows.length - 1; i += 1) {
            const from = String(rows[i]?.repertorio_id || '');
            const to = String(rows[i + 1]?.repertorio_id || '');
            if (!from || !to || from === to) continue;
            if (!transitions[from]) transitions[from] = {};
            transitions[from][to] = (transitions[from][to] || 0) + 1;
          }
        });

        setExecutionStats(stats);
        setTransitionCounts(transitions);
        setIntelligenceReady(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [rangeMode, org?.id]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const getVocalName = (song: any) => song?.lead_vocal_custom || song?.membros?.nome || '';

  const selectedIds = useMemo(() => new Set(setlistTemp.map((m) => String(m?.id))), [setlistTemp]);

  const currentSetlistIds = useMemo(() => setlistTemp.map((m) => String(m?.id)), [setlistTemp]);
  const hasUnsavedChanges = useMemo(() => {
    if (currentSetlistIds.length !== originalSetlistIds.length) return true;
    return currentSetlistIds.some((id, index) => id !== originalSetlistIds[index]);
  }, [currentSetlistIds, originalSetlistIds]);

  const vocalOptions = useMemo(() => {
    return Array.from(
      new Set((musicasBiblioteca || []).map((m: any) => getVocalName(m)).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }, [musicasBiblioteca]);

  const tomOptions = useMemo(() => {
    return Array.from(
      new Set((musicasBiblioteca || []).map((m: any) => String(m?.tom || '').trim()).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }, [musicasBiblioteca]);

  const bpmMedio = useMemo(() => {
    const bpms = setlistTemp.map((m) => Number(m?.bpm)).filter((n) => Number.isFinite(n) && n > 0);
    if (!bpms.length) return null;
    return Math.round(bpms.reduce((acc, n) => acc + n, 0) / bpms.length);
  }, [setlistTemp]);

  const durationSummary = useMemo(() => {
    let knownSeconds = 0;
    let unknown = 0;
    setlistTemp.forEach((song) => {
      const seconds = estimateSongSeconds(song);
      if (seconds === null) unknown += 1;
      else knownSeconds += seconds;
    });
    return { knownSeconds, unknown };
  }, [setlistTemp]);

  const energySummary = useMemo(() => {
    return setlistTemp.reduce(
      (acc, song) => {
        const energy = categoryEnergy(song);
        if (energy === 3) acc.fast += 1;
        else if (energy === 1) acc.slow += 1;
        else acc.moderate += 1;
        return acc;
      },
      { fast: 0, moderate: 0, slow: 0 }
    );
  }, [setlistTemp]);

  const setlistWarnings = useMemo<SetlistWarning[]>(() => {
    const warnings: SetlistWarning[] = [];
    if (!setlistTemp.length) return warnings;

    const pushSequenceWarnings = (
      key: 'energy' | 'tom' | 'vocal',
      minRun: number,
      makeValue: (song: any) => string,
      makeWarning: (value: string, start: number, length: number) => SetlistWarning | null
    ) => {
      let start = 0;
      while (start < setlistTemp.length) {
        const value = makeValue(setlistTemp[start]);
        if (!value) {
          start += 1;
          continue;
        }
        let end = start + 1;
        while (end < setlistTemp.length && makeValue(setlistTemp[end]) === value) end += 1;
        const length = end - start;
        if (length >= minRun) {
          const warning = makeWarning(value, start, length);
          if (warning) warnings.push({ ...warning, id: `${key}-${start}-${value}` });
        }
        start = end;
      }
    };

    pushSequenceWarnings(
      'energy',
      3,
      (song) => String(categoryEnergy(song)),
      (value, start, length) => {
        if (value !== '1') return null;
        return {
          id: '',
          label: `${length} lentas consecutivas`,
          detail: `Faixa #${start + 1} até #${start + length}. Pode derrubar bastante a energia do bloco.`,
        };
      }
    );

    pushSequenceWarnings(
      'tom',
      3,
      (song) => String(song?.tom || '').trim().toUpperCase(),
      (value, start, length) => ({
        id: '',
        label: `${length} músicas seguidas em ${value}`,
        detail: `Da #${start + 1} à #${start + length}. Vale revisar se essa repetição de tom foi intencional.`,
      })
    );

    pushSequenceWarnings(
      'vocal',
      4,
      (song) => String(getVocalName(song) || '').trim().toLowerCase(),
      (value, start, length) => ({
        id: '',
        label: `${length} músicas consecutivas com o mesmo vocal`,
        detail: `Da #${start + 1} à #${start + length}. Pode ser pesado para a mesma voz sem intervalo.`,
      })
    );

    for (let i = 0; i < setlistTemp.length - 1; i += 1) {
      const current = Number(setlistTemp[i]?.bpm);
      const next = Number(setlistTemp[i + 1]?.bpm);
      if (!Number.isFinite(current) || !Number.isFinite(next) || current <= 0 || next <= 0) continue;
      const diff = Math.abs(current - next);
      if (diff >= 48) {
        warnings.push({
          id: `bpm-${i}`,
          label: `Salto de ${diff} BPM entre #${i + 1} e #${i + 2}`,
          detail: `${setlistTemp[i]?.titulo || 'Música'} → ${setlistTemp[i + 1]?.titulo || 'Música'}.`,
        });
      }
    }

    const missingBpm = setlistTemp.filter((song) => !Number(song?.bpm)).length;
    const missingTom = setlistTemp.filter((song) => !String(song?.tom || '').trim()).length;
    if (missingBpm) {
      warnings.push({
        id: 'missing-bpm',
        label: `${missingBpm} ${missingBpm === 1 ? 'música sem BPM' : 'músicas sem BPM'}`,
        detail: 'Preencha o BPM para melhorar duração estimada e análise de transições.',
      });
    }
    if (missingTom) {
      warnings.push({
        id: 'missing-tom',
        label: `${missingTom} ${missingTom === 1 ? 'música sem tom' : 'músicas sem tom'}`,
        detail: 'O tom ajuda a visualizar repetições e preparar a próxima música.',
      });
    }

    return warnings.slice(0, 8);
  }, [setlistTemp]);

  const smartSuggestions = useMemo<SmartSuggestion[]>(() => {
    const selected = new Set(setlistTemp.map((song) => String(song?.id)));
    const lastSong = setlistTemp.length ? setlistTemp[setlistTemp.length - 1] : null;
    const lastId = lastSong ? String(lastSong?.id) : '';
    const historicalNext = lastId ? transitionCounts[lastId] || {} : {};
    const recentEnergy = setlistTemp.slice(-2).map(categoryEnergy);
    const repeatedEnergy = recentEnergy.length === 2 && recentEnergy[0] === recentEnergy[1] ? recentEnergy[0] : null;
    const lastBpm = Number(lastSong?.bpm);

    const scored = (musicasBiblioteca || [])
      .filter((song: any) => !selected.has(String(song?.id)))
      .map((song: any) => {
        const songId = String(song?.id);
        const stats = executionStats[songId] || { played: 0, requests: 0, lastPlayedAt: null };
        const historical = Number(historicalNext[songId] || 0);
        const energy = categoryEnergy(song);
        const reasons: string[] = [];
        let score = 0;

        if (historical > 0) {
          score += Math.min(110, historical * 28);
          reasons.push(`${historical}x usada depois da atual`);
        }

        if (stats.requests > 0) {
          score += Math.min(50, stats.requests * 5);
          reasons.push(`${stats.requests} ${stats.requests === 1 ? 'request' : 'requests'}`);
        }

        if (stats.played > 0) {
          score += Math.min(28, stats.played * 1.4);
          if (!historical && reasons.length < 2) reasons.push(`${stats.played}x tocada`);
        }

        if (repeatedEnergy !== null && energy !== repeatedEnergy) {
          score += 22;
          reasons.push('equilibra a energia');
        }

        const bpm = Number(song?.bpm);
        if (Number.isFinite(lastBpm) && lastBpm > 0 && Number.isFinite(bpm) && bpm > 0) {
          const diff = Math.abs(lastBpm - bpm);
          if (diff <= 18) {
            score += 12;
            if (reasons.length < 2) reasons.push('BPM próximo');
          } else if (diff >= 55) {
            score -= 8;
          }
        }

        if (!lastSong && stats.requests + stats.played === 0) score += energy === 3 ? 4 : 0;

        return { song, score, reasons: reasons.slice(0, 2) };
      })
      .sort((a, b) => b.score - a.score || String(a.song?.titulo || '').localeCompare(String(b.song?.titulo || ''), 'pt-BR'));

    return scored.slice(0, 5);
  }, [executionStats, musicasBiblioteca, setlistTemp, transitionCounts]);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasUnsavedChanges]);

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
      const vocalName = getVocalName(m);
      const matchesSearch =
        !q ||
        String(m?.titulo || '').toLowerCase().includes(q) ||
        String(m?.artista || '').toLowerCase().includes(q) ||
        String(m?.tom || '').toLowerCase().includes(q) ||
        String(vocalName || '').toLowerCase().includes(q);
      const matchesVocal =
        filterVocal === 'Todos' || (filterVocal === 'Sem vocal' ? !vocalName : vocalName === filterVocal);
      const matchesTom = filterTom === 'Todos' || String(m?.tom || '') === filterTom;
      return matchesCategory && matchesSearch && matchesVocal && matchesTom;
    });
  }, [musicasBiblioteca, categoriaAtiva, searchTerm, filterVocal, filterTom]);

  const abrirEditor = (evento: any) => {
    setEventoSelecionado(evento);
    const atuais = [...(evento.evento_repertorio || [])]
      .sort((a, b) => a.ordem - b.ordem)
      .map((er) => er.repertorio)
      .filter(Boolean);
    setSetlistTemp(atuais);
    setOriginalSetlistIds(atuais.map((m) => String(m?.id)));
    setSearchTerm('');
    setCategoriaAtiva('Todas');
    setFilterVocal('Todos');
    setFilterTom('Todos');
  };

  const fecharEditor = () => {
    if (hasUnsavedChanges && !confirm('Existem alterações não salvas. Deseja sair mesmo assim?')) return;
    setEventoSelecionado(null);
    setSetlistTemp([]);
    setOriginalSetlistIds([]);
  };

  const voltarPagina = () => {
    if (hasUnsavedChanges && !confirm('Existem alterações não salvas. Deseja sair mesmo assim?')) return;
    router.back();
  };

  const moverMusica = (index: number, delta: number) => {
    setSetlistTemp((prev) => {
      const destino = index + delta;
      if (destino < 0 || destino >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(destino, 0, item);
      return next;
    });
  };

  const soltarMusica = (destino: number) => {
    const origem = dragIndexRef.current;
    dragIndexRef.current = null;
    if (origem === null || origem === destino) return;
    setSetlistTemp((prev) => {
      if (origem < 0 || origem >= prev.length || destino < 0 || destino >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(origem, 1);
      next.splice(destino, 0, item);
      return next;
    });
  };

const salvarRepertorioShow = async () => {
  if (!eventoSelecionado || !org?.id) return;

  setSalvando(true);
  try {
    const { error: deleteError } = await supabase
      .from('evento_repertorio')
      .delete()
      .eq('evento_id', eventoSelecionado.id);
    if (deleteError) throw deleteError;

    if (setlistTemp.length > 0) {
      const novosItens = setlistTemp.map((m, index) => ({
        evento_id: eventoSelecionado.id,
        repertorio_id: m.id,
        ordem: index + 1,
        org_id: org.id,
      }));

      const { error: insertError } = await supabase.from('evento_repertorio').insert(novosItens);
      if (insertError) throw insertError;
    }

    // Atualiza só o card alterado em memória; evita recarregar eventos + biblioteca inteira.
    setEventos((prev) =>
      prev.map((ev) =>
        String(ev.id) === String(eventoSelecionado.id)
          ? {
              ...ev,
              evento_repertorio: setlistTemp.map((m, index) => ({
                ordem: index + 1,
                repertorio: m,
              })),
            }
          : ev
      )
    );

    const eventoId = String(eventoSelecionado.id);
    setOriginalSetlistIds(setlistTemp.map((m) => String(m?.id)));
    showToast('success', 'Setlist salva com sucesso');

    // Notificação é secundária para a interação; envia em background.
    void sendPushEventoRepertorio(eventoId, org.id);
  } catch (e) {
    console.error(e);
    showToast('error', 'Não foi possível salvar a setlist');
  } finally {
    setSalvando(false);
  }
};


  const deletarEvento = async (id: string) => {
    if (!confirm('Excluir evento permanentemente?')) return;
    setDeletandoId(id);
    try {
      const { error } = await supabase.from('eventos').delete().eq('id', id);
      if (error) throw error;
      setEventos((prev) => prev.filter((ev) => String(ev.id) !== String(id)));
    } catch (error) {
      console.error('Erro ao excluir evento:', error);
    } finally {
      setDeletandoId(null);
    }
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
              'font-black text-sm uppercase leading-tight break-words',
              selectedIds.has(String(m.id)) ? 'text-white' : 'text-slate-200'
            )}
          >
            {m.titulo}
          </p>
          <p
            className={cn(
              'text-[11px] font-bold uppercase mt-1',
              selectedIds.has(String(m.id)) ? 'text-blue-100' : 'text-slate-500'
            )}
          >
            {getVocalName(m) || '—'}
          </p>
        </div>
      </div>

      {selectedIds.has(String(m.id)) ? (
        <span className="ml-3 flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
          <CheckCircle2 size={16} /> No setlist
        </span>
      ) : (
        <Plus size={18} className="ml-3 shrink-0 text-slate-600 group-hover:text-blue-400" />
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
          <span className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">{title}</span>
        </div>
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{items.length}</span>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">{items.map(renderSongButton)}</div>
      ) : (
        <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/5 text-slate-600 text-[11px] font-black uppercase tracking-widest">
          Nenhuma música aqui
        </div>
      )}
    </div>
  );


  const SetlistIntelligencePanel = () => (
    <div className="mb-6 rounded-[2rem] border border-white/5 bg-slate-900/75 p-5 sm:p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-violet-400/70 to-transparent" />

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-violet-300">
              <Sparkles size={16} />
              <span className="text-[11px] font-black uppercase tracking-[0.2em]">Inteligência do show</span>
            </div>
            <span className={cn(
              'rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-widest',
              intelligenceReady
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-white/10 bg-white/5 text-slate-500'
            )}>
              {intelligenceReady ? 'Histórico ativo' : 'Análise local'}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-[11px] font-bold leading-relaxed text-slate-500">
            Leitura editorial do setlist: duração, curva de energia, sequências e sugestões baseadas no histórico real do Live.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[610px]">
          <div className="rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3">
            <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500"><Timer size={12} /> Duração</span>
            <strong className="mt-1 block text-lg font-black text-white">{formatSetDuration(durationSummary.knownSeconds)}</strong>
            {durationSummary.unknown > 0 && (
              <span className="text-[9px] font-bold text-amber-400/80">{durationSummary.unknown} sem cálculo</span>
            )}
          </div>
          <div className="rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">⚡ Rápidas</span>
            <strong className="mt-1 block text-lg font-black text-orange-300">{energySummary.fast}</strong>
          </div>
          <div className="rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">● Moderadas</span>
            <strong className="mt-1 block text-lg font-black text-yellow-200">{energySummary.moderate}</strong>
          </div>
          <div className="rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">◐ Lentas</span>
            <strong className="mt-1 block text-lg font-black text-emerald-300">{energySummary.slow}</strong>
          </div>
        </div>
      </div>

      {setlistTemp.length > 0 && (
        <div className="mt-5 rounded-2xl border border-white/5 bg-slate-950/40 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-400" />
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Curva de energia</span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">1 baixa • 2 média • 3 alta</span>
          </div>
          <div className="flex h-20 items-end gap-1 overflow-x-auto pb-1 no-scrollbar">
            {setlistTemp.map((song, index) => {
              const energy = categoryEnergy(song);
              return (
                <div key={`energy-${song?.id}-${index}`} className="group flex min-w-[26px] flex-1 flex-col items-center justify-end gap-1" title={`#${index + 1} ${song?.titulo || ''} — ${categoryLabel(song)}`}>
                  <div
                    className={cn(
                      'w-full max-w-12 rounded-t-lg border transition-all group-hover:brightness-125',
                      energy === 3
                        ? 'h-16 border-orange-400/30 bg-orange-500/40'
                        : energy === 1
                        ? 'h-6 border-emerald-400/30 bg-emerald-500/35'
                        : 'h-10 border-yellow-300/30 bg-yellow-400/35'
                    )}
                  />
                  <span className="text-[8px] font-black text-slate-600">{index + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-slate-950/45 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className={setlistWarnings.length ? 'text-amber-300' : 'text-emerald-400'} />
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Revisão do fluxo</span>
            </div>
            <span className={cn(
              'rounded-full px-2.5 py-1 text-[8px] font-black uppercase tracking-widest',
              setlistWarnings.length ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'
            )}>
              {setlistWarnings.length ? `${setlistWarnings.length} aviso${setlistWarnings.length > 1 ? 's' : ''}` : 'Tudo equilibrado'}
            </span>
          </div>

          {setlistWarnings.length ? (
            <div className="space-y-2">
              {setlistWarnings.slice(0, 4).map((warning) => (
                <div key={warning.id} className="rounded-xl border border-amber-500/10 bg-amber-500/[0.04] px-3 py-2.5">
                  <p className="text-[10px] font-black uppercase tracking-wide text-amber-200">{warning.label}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{warning.detail}</p>
                </div>
              ))}
              {setlistWarnings.length > 4 && (
                <p className="px-1 text-[9px] font-bold uppercase tracking-widest text-slate-600">+ {setlistWarnings.length - 4} outros avisos</p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.035] px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-emerald-300/80">
              Nenhuma sequência crítica detectada nesta ordem.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/5 bg-slate-950/45 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-violet-300" />
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Sugestões para a próxima</span>
            </div>
            <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
              {setlistTemp.length ? `Depois de #${setlistTemp.length}` : 'Para começar'}
            </span>
          </div>

          {smartSuggestions.length ? (
            <div className="space-y-2">
              {smartSuggestions.slice(0, 4).map(({ song, reasons }) => (
                <button
                  key={`suggestion-${song?.id}`}
                  onClick={() => toggleMusicaNoSetlist(song)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-white/5 bg-slate-900/70 px-3 py-3 text-left transition-all hover:border-violet-400/25 hover:bg-violet-500/[0.045] active:scale-[0.99]"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
                    <Plus size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[11px] font-black uppercase leading-tight text-slate-200 group-hover:text-white">{song?.titulo}</p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                      {reasons.length ? reasons.join(' • ') : `${categoryLabel(song)} • ${song?.bpm || '—'} BPM`}
                    </p>
                  </div>
                  <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-violet-400/70">Adicionar</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-600">
              Não há músicas disponíveis para sugerir.
            </div>
          )}
        </div>
      </div>
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

    const accessToken = await getAuthAccessToken();
    if (!accessToken) return;

    const r = await fetch("/api/onesignal/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
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
      <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-slate-950 text-white px-4 sm:px-6 lg:px-8 pb-24 font-sans">
        <div className="pt-6 lg:pt-8 w-full max-w-[1680px] mx-auto">
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
                        const dataIso = fromDatetimeLocalToISO(editData);
                        const { error } = await supabase
                          .from('eventos')
                          .update({
                            local: editLocal,
                            data: dataIso,
                            paleta_cores: editPaleta,
                          })
                          .eq('id', editEvento.id);

                        if (error) {
                          console.error('Erro ao editar evento:', error);
                        } else {
                          setEventos((prev) =>
                            prev.map((ev) =>
                              String(ev.id) === String(editEvento.id)
                                ? { ...ev, local: editLocal, data: dataIso, paleta_cores: editPaleta }
                                : ev
                            )
                          );
                          setEditOpen(false);
                        }
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

          {toast && (
            <div
              className={cn(
                'fixed right-4 top-4 z-[70] rounded-2xl border px-5 py-4 text-sm font-black shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-2',
                toast.type === 'success'
                  ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-300'
                  : 'border-red-500/30 bg-red-950/90 text-red-300'
              )}
            >
              {toast.message}
            </div>
          )}

          <header className="flex justify-between items-start gap-4 mb-6 lg:mb-8">
            <div className="min-w-0">
              <Link href="/" className="group block transition-transform active:scale-95">
                <div className="flex flex-col min-w-0">
                  <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
                    {org?.nome || 'Banda'}
                  </h2>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors break-words">
                    Repertorio <span className="text-blue-500"></span>
                  </h1>
                </div>
              </Link>
              <p className="mt-2 text-xs font-bold uppercase tracking-widest text-slate-500">Setlists dos Eventos</p>
            </div>

            <div className="flex items-center gap-3">
          <button
            onClick={voltarPagina}
            className="mt-1 text-blue-500 flex items-center gap-2 font-bold uppercase text-sm sm:text-base tracking-widest hover:text-white transition-colors shrink-0"
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
                    <span className="block text-sm font-black uppercase tracking-widest">Biblioteca</span>
                    <span className="text-[11px] text-blue-500 font-bold uppercase tracking-widest">
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
                    <span className="block text-sm font-black uppercase tracking-widest">Novo Evento</span>
                    <span className="text-[11px] text-blue-400 font-bold uppercase tracking-widest">Agendar evento</span>
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
                <h2 className="text-xs sm:text-sm font-black text-slate-500 uppercase tracking-[0.25em] flex items-center gap-3">
                  <div className="size-2 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]" />
                  Próximos eventos
                </h2>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5">
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

        <h3 className="text-xl lg:text-2xl font-black uppercase italic tracking-tight leading-tight break-words group-hover:text-blue-400 transition-colors">
          {ev.local}
        </h3>

        <p className="text-[11px] text-slate-500 uppercase font-black tracking-widest mt-2">
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
        <p className="text-[11px] font-bold text-slate-500 uppercase mt-1">Sua agenda está limpa por enquanto</p>
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
            <>
              <SetlistIntelligencePanel />
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 xl:gap-8 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* BIBLIOTECA */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs sm:text-sm font-black uppercase text-slate-500 tracking-widest flex items-center gap-3">
                    <div className="size-2 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]" />
                    Biblioteca
                  </h2>

                  <div className="flex gap-1 overflow-x-auto no-scrollbar">
                    {['Todas', 'Rápida', 'Moderada', 'Lenta'].map((c) => (
                      <button
                        key={c}
                        onClick={() => setCategoriaAtiva(c)}
                        className={cn(
                          'px-4 py-2 rounded-xl text-[11px] font-black uppercase border transition-all flex-shrink-0',
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

                <div className="xl:sticky xl:top-4 z-20 space-y-3 rounded-[1.75rem] bg-slate-950/95 pb-2 backdrop-blur-xl">
                  <div className="relative">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 size-5" />
                    <input
                      placeholder="BUSCAR POR MÚSICA, ARTISTA, VOCAL OU TOM..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-900 border border-white/5 rounded-[1.5rem] py-4 sm:py-5 pl-14 pr-6 outline-none focus:ring-2 focus:ring-blue-500 font-black text-sm shadow-inner"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="rounded-2xl border border-white/5 bg-slate-900 px-4 py-3">
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Vocal</span>
                      <select
                        value={filterVocal}
                        onChange={(e) => setFilterVocal(e.target.value)}
                        className="w-full bg-transparent text-sm font-black text-slate-200 outline-none"
                      >
                        <option value="Todos" className="bg-slate-900">Todos</option>
                        <option value="Sem vocal" className="bg-slate-900">Sem vocal</option>
                        {vocalOptions.map((vocal) => (
                          <option key={String(vocal)} value={String(vocal)} className="bg-slate-900">
                            {String(vocal)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="rounded-2xl border border-white/5 bg-slate-900 px-4 py-3">
                      <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Tom</span>
                      <select
                        value={filterTom}
                        onChange={(e) => setFilterTom(e.target.value)}
                        className="w-full bg-transparent text-sm font-black text-slate-200 outline-none"
                      >
                        <option value="Todos" className="bg-slate-900">Todos</option>
                        {tomOptions.map((tom) => (
                          <option key={String(tom)} value={String(tom)} className="bg-slate-900">
                            {String(tom)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex items-center justify-between px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>{musicasFiltradas.length} encontradas</span>
                    {(searchTerm || filterVocal !== 'Todos' || filterTom !== 'Todos') && (
                      <button
                        onClick={() => {
                          setSearchTerm('');
                          setFilterVocal('Todos');
                          setFilterTom('Todos');
                        }}
                        className="text-blue-400 hover:text-white"
                      >
                        Limpar filtros
                      </button>
                    )}
                  </div>
                </div>

                {/* ✅ LISTA SECCIONADA quando "Todas" */}
                <div className="bg-slate-900 border border-white/5 rounded-[2rem] sm:rounded-[2.5rem] p-5 sm:p-6 max-h-[620px] xl:max-h-[calc(100dvh-300px)] xl:min-h-[560px] overflow-y-auto relative no-scrollbar space-y-6 shadow-2xl">
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
                <div className="bg-slate-900 border border-white/5 rounded-[2rem] sm:rounded-[2.5rem] p-5 sm:p-8 min-h-[560px] max-h-[760px] xl:h-[calc(100dvh-250px)] xl:min-h-[620px] xl:max-h-[860px] flex flex-col shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                  <div className="flex justify-between items-start gap-4 mb-5">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-black text-blue-500 uppercase tracking-widest">Repertório Atual</span>
                        <span
                          className={cn(
                            'rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest',
                            hasUnsavedChanges
                              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                          )}
                        >
                          {hasUnsavedChanges ? 'Alterações não salvas' : 'Tudo salvo'}
                        </span>
                      </div>
                      <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black italic uppercase tracking-tighter text-white leading-tight break-words">
                        {eventoSelecionado.local}
                      </h2>
                      <p className="mt-2 text-[11px] text-slate-500 uppercase font-black tracking-widest">
                        {formatarDataExibicao(eventoSelecionado.data)} • {eventoSelecionado.paleta_cores || 'Look Livre'}
                      </p>
                    </div>

                    <button
                      onClick={fecharEditor}
                      className="size-12 rounded-2xl flex items-center justify-center bg-slate-950 border border-white/5 text-slate-500 hover:text-red-500 hover:border-red-500/40 transition-all active:scale-95 shrink-0"
                      title="Fechar"
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">Músicas</span>
                      <strong className="mt-1 block text-xl font-black text-white">{setlistTemp.length}</strong>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">BPM médio</span>
                      <strong className="mt-1 block text-xl font-black text-white">{bpmMedio ?? '—'}</strong>
                    </div>
                    <div className="col-span-2 rounded-2xl border border-white/5 bg-slate-950/60 px-4 py-3 sm:col-span-1">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500">Ordem</span>
                      <strong className="mt-1 block text-sm font-black uppercase text-blue-400">Arraste ou use ↑ ↓</strong>
                    </div>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar pr-2">
                    {setlistTemp.map((m, i) => (
                      <div
                        key={`${m.id}-${i}`}
                        draggable
                        onDragStart={() => { dragIndexRef.current = i; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => soltarMusica(i)}
                        className="flex items-center gap-3 bg-slate-950/50 p-3 sm:p-4 rounded-2xl border border-white/5 shadow-lg group hover:border-blue-500/20 transition-all"
                      >
                        <div className="hidden cursor-grab text-slate-700 group-hover:text-slate-500 sm:block" title="Arrastar para reordenar">
                          <GripVertical size={18} />
                        </div>
                        <span className="text-blue-500 font-black italic text-sm w-9 shrink-0">#{i + 1}</span>

                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm uppercase leading-tight break-words">{m.titulo}</p>
                          <p className="text-[11px] font-black text-slate-500 flex flex-wrap items-center gap-2 mt-1">
                            <Music size={10} /> {m.tom || '—'} • <Gauge size={10} /> {m.bpm || '—'} • {getVocalName(m) || 'sem vocal'} • {categoryLabel(m)}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => moverMusica(i, -1)}
                            disabled={i === 0}
                            className="size-9 rounded-xl flex items-center justify-center bg-slate-900 border border-white/5 text-slate-500 hover:text-blue-400 hover:border-blue-500/20 transition-all active:scale-95 disabled:opacity-20"
                            title="Mover para cima"
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            onClick={() => moverMusica(i, 1)}
                            disabled={i === setlistTemp.length - 1}
                            className="size-9 rounded-xl flex items-center justify-center bg-slate-900 border border-white/5 text-slate-500 hover:text-blue-400 hover:border-blue-500/20 transition-all active:scale-95 disabled:opacity-20"
                            title="Mover para baixo"
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            onClick={() => setSetlistTemp((prev) => prev.filter((_, idx) => idx !== i))}
                            className="size-9 rounded-xl flex items-center justify-center bg-slate-900 border border-white/5 text-slate-500 hover:text-red-500 hover:border-red-500/20 transition-all active:scale-95"
                            title="Remover"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {setlistTemp.length === 0 && (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-30">
                        <Music2 size={64} className="mb-4" />
                        <p className="font-black uppercase text-xs tracking-widest">Setlist vazia</p>
                        <p className="mt-2 text-[11px] text-slate-500 font-bold uppercase tracking-widest">
                          Adicione músicas pela biblioteca
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 border-t border-white/5 pt-5">
                    <button
                      onClick={salvarRepertorioShow}
                      disabled={salvando || !hasUnsavedChanges}
                      className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-[1.5rem] font-black uppercase text-[12px] tracking-[0.16em] flex items-center justify-center gap-3 shadow-xl shadow-blue-600/30 transition-all active:scale-95 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none disabled:opacity-70"
                    >
                      {salvando ? (
                        <>
                          <Loader2 className="animate-spin" size={20} /> Salvando...
                        </>
                      ) : hasUnsavedChanges ? (
                        <>
                          <Save size={20} /> Salvar alterações
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={20} /> Tudo salvo
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </>
          )}
        </div>
      </div>
    </SubscriptionGuard>
  );
}
