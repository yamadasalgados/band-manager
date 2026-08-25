'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft,
  Play,
  Pause,
  ChevronRight,
  ChevronLeft,
  Gauge,
  ListMusic,
  XCircle,
  Search,
  Music,
  Type,
  LayoutGrid,
  Lock,
  Unlock,
  RotateCcw,
  Maximize2,
  Minimize2,
  Wifi,
  WifiOff,
  Star,
  StickyNote,
  ClipboardCheck,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import SongStageRenderer from '@/components/SongStageRenderer';

type ViewMode = 'both' | 'chords' | 'lyrics';
type PresentationMode = 'slides' | 'scroll';
type QuickTab = 'songs' | 'history';

type ShowHistoryEntry = {
  id: string;
  musicaId: string;
  titulo: string;
  artista?: string;
  categoria?: string;
  tom?: string;
  bpm?: number;
  avulsa: boolean;
  playedAt: string;
};

type LiveDisplayPreferences = {
  viewMode: ViewMode;
  presentationMode: PresentationMode;
  fontScale: number;
  focusRatio: number;
  visualTimingOffsetMs: number;
  showMemberNotes: boolean;
};

type PermanentSongStats = {
  plays: number;
  requests: number;
  lastPlayedAt: string | null;
};

type ActiveMember = {
  id: string;
  nome?: string;
  funcao?: string;
};

type CifraLine = {
  measureIndex: number;
  chord: string;
  lyric: string;
};

type CifraBlock = {
  label: string;
  duration: number;
  lines: CifraLine[];
  lyricsSynced: boolean;
};

const LIVE_PREFS_VERSION = 'v2';

function getLivePreferencesStorageKey() {
  if (typeof window === 'undefined') return `band-manager:live-preferences:${LIVE_PREFS_VERSION}:device`;

  try {
    const raw = window.localStorage.getItem('usuario_ativo');
    const user = raw ? JSON.parse(raw) : null;
    const memberId = user?.id ? String(user.id) : 'device';
    return `band-manager:live-preferences:${LIVE_PREFS_VERSION}:${memberId}`;
  } catch {
    return `band-manager:live-preferences:${LIVE_PREFS_VERSION}:device`;
  }
}

function isViewMode(value: unknown): value is ViewMode {
  return value === 'both' || value === 'chords' || value === 'lyrics';
}

function isPresentationMode(value: unknown): value is PresentationMode {
  return value === 'slides' || value === 'scroll';
}

function blockLabel(block: any) {
  const custom = String(block?.nome_personalizado || '').trim();
  return custom || String(block?.tipo || 'Bloco');
}

function buildCifraBlock(block: any): CifraBlock {
  const duration = Math.max(1, Number(block?.duracao_compassos) || 1);
  const rawChords = String(block?.acordes || '')
    .split('|')
    .map((item) => item.trim());
  const lyricText = String(block?.letra || '').replace(/\r\n/g, '\n');
  const lyricLines = lyricText ? lyricText.split('\n') : [];
  const lyricsSynced = lyricLines.length === 0 || lyricLines.length === duration;
  const lineCount = lyricsSynced ? duration : Math.max(duration, lyricLines.length);

  return {
    label: blockLabel(block),
    duration,
    lyricsSynced,
    lines: Array.from({ length: lineCount }, (_, index) => ({
      measureIndex: Math.min(index, duration - 1),
      chord: rawChords[index] || '',
      lyric: lyricLines[index] || '',
    })),
  };
}

/** Broadcast payloads (sync)
 *  ✅ Sem “modo maestro” na UI — automaticamente:
 *  - Quem dispara START vira a referência (maestroId)
 *  - Seguidores fazem NTP leve via PING/PONG para remover micro-delay
 */
type SyncMessage =
  | {
      kind: 'START';
      senderId: string;
      maestroId: string;
      maestroStartAtMs: number; // tempo no relógio do sender (referência)
      bpm: number;
      indexMusicaAtual: number;
      blocoAtivo: number;
      semitons: number;
      musicaId?: string;
      viewMode?: ViewMode; // compatibilidade com clientes antigos; preferência visual agora é local
    }
  | { kind: 'PAUSE'; senderId: string }
  | {
      kind: 'GOTO';
      senderId: string;
      indexMusicaAtual: number;
      blocoAtivo: number;
      musicaId?: string;
      resume?: boolean;
      maestroStartAtMs?: number;
    }
  | { kind: 'QUEUE'; senderId: string; musicaId: string | null }
  | { kind: 'STATE_REQUEST'; senderId: string }
  | {
      kind: 'STATE';
      senderId: string;
      maestroId: string;
      playing: boolean;
      musicaId?: string;
      blocoAtivo: number;
      blockStartEpochMs: number | null;
      bpm: number;
      semitons: number;
      queuedMusicaId?: string | null;
    }
  | { kind: 'PING'; senderId: string; pingId: string; t0: number } // t0 no relógio do follower
  | { kind: 'PONG'; senderId: string; pingId: string; t0: number; t1: number }; // t1 no relógio do “referência”

function genId() {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

const LIVE_SONG_CACHE_VERSION = 'v1';
const LIVE_EVENT_CACHE_VERSION = 'v1';
const LIVE_HISTORY_VERSION = 'v1';

function songCacheKey(musicaId: string) {
  return `band-manager:live-song:${LIVE_SONG_CACHE_VERSION}:${musicaId}`;
}

function eventCacheKey(eventId: string) {
  return `band-manager:live-event:${LIVE_EVENT_CACHE_VERSION}:${eventId}`;
}

function historyCacheKey(eventId: string) {
  return `band-manager:live-history:${LIVE_HISTORY_VERSION}:${eventId}`;
}

function readJsonStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache é uma camada de resiliência. O Live não para se storage estiver cheio/bloqueado.
  }
}

function readCachedSong(musicaId: string): any | null {
  const cached = readJsonStorage<any>(songCacheKey(String(musicaId)));
  if (!cached?.musica?.id || !Array.isArray(cached?.estrutura)) return null;
  return cached;
}

function cacheSongItem(item: any) {
  const musicaId = item?.musica?.id;
  if (!musicaId) return;
  writeJsonStorage(songCacheKey(String(musicaId)), {
    musica: item.musica,
    estrutura: item.estrutura || [],
    savedAt: Date.now(),
  });
}

export default function ModoLiveNonStop() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  // ================== UI / Responsivo ==================
  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);
  useEffect(() => {
    const upd = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    upd();
    window.addEventListener('resize', upd);
    window.addEventListener('orientationchange', upd);
    return () => {
      window.removeEventListener('resize', upd);
      window.removeEventListener('orientationchange', upd);
    };
  }, []);
  const isMobile = vw < 640;

  // ================== Dados ==================
  const [loading, setLoading] = useState(true);
  const [eventoInfo, setEventoInfo] = useState<any>(null);
  const [musicas, setMusicas] = useState<any[]>([]);
  const musicasRef = useRef<any[]>([]);
  const [repertorioGeral, setRepertorioGeral] = useState<any[]>([]);
  const [pedidoCounts, setPedidoCounts] = useState<Record<string, number>>({});
  const originalSetlistIdsRef = useRef<Set<string>>(new Set());
  const [networkOnline, setNetworkOnline] = useState(true);
  const [loadedFromCache, setLoadedFromCache] = useState(false);
  const [activeMember, setActiveMember] = useState<ActiveMember | null>(null);
  const [songStats, setSongStats] = useState<Record<string, PermanentSongStats>>({});
  const [pinnedSongIds, setPinnedSongIds] = useState<Set<string>>(new Set());
  const [memberNotes, setMemberNotes] = useState<Record<string, string>>({});
  const [preflightOpen, setPreflightOpen] = useState(true);
  const [preflightDetailsOpen, setPreflightDetailsOpen] = useState(false);

  // ================== Realtime / Sync ==================
  const clientIdRef = useRef<string>(genId());
  const [connected, setConnected] = useState(false);
  const [syncEnabled] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const suppressBroadcastRef = useRef(false);

  // ✅ Clock Sync (NTP leve): offset = (refTime - localTime)
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const clockOffsetRef = useRef(0);
  useEffect(() => {
    clockOffsetRef.current = clockOffsetMs;
  }, [clockOffsetMs]);

  // Quem iniciou o último START vira a referência (sem UI)
  const isReferenceRef = useRef(false);
  const referenceIdRef = useRef<string | null>(null);

  const lastPingIdRef = useRef<string | null>(null);

  // ================== Playback ==================
  const [indexMusicaAtual, setIndexMusicaAtual] = useState(0);
  const [blocoAtivo, setBlocoAtivo] = useState(0);
  const [autoScroll, setAutoScroll] = useState(false);
  const [progresso, setProgresso] = useState(0);

  // countdown
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

  // config palco
  const [semitons, setSemitons] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [presentationMode, setPresentationMode] = useState<PresentationMode>('slides');
  const [fontScale, setFontScale] = useState(1);
  const [focusRatio, setFocusRatio] = useState(0.34);
  const [visualTimingOffsetMs, setVisualTimingOffsetMs] = useState(0);
  const [showMemberNotes, setShowMemberNotes] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const preferencesStorageKeyRef = useRef('');
  const [bpmOverride] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [buscaMenu, setBuscaMenu] = useState('');
  const [quickLoadingId, setQuickLoadingId] = useState<string | null>(null);
  const [quickTab, setQuickTab] = useState<QuickTab>('songs');
  const [queuedMusicaId, setQueuedMusicaId] = useState<string | null>(null);
  const queuedIndexRef = useRef<number | null>(null);
  const [showHistory, setShowHistory] = useState<ShowHistoryEntry[]>([]);
  const activeRunLoggedRef = useRef(false);
  const lastPlaybackIndexRef = useRef(-1);
  const [stageNotice, setStageNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [lockUI, setLockUI] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsHideTimerRef = useRef<number | null>(null);

  // Fullscreen
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const autoFullscreenOnPlay = true;

  // Wake lock
  const wakeLockRef = useRef<any>(null);
  const wakeLockEnabled = true;

  // Bloquear scroll/gestos
  const lockGesturesEnabled = true;

  // Engine refs
  const blockStartEpochRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastProgressUiRef = useRef(0);
  const pendingClockCorrectionMsRef = useRef(0);
  const playbackSnapshotRef = useRef({
    indexMusicaAtual: 0,
    blocoAtivo: 0,
    autoScroll: false,
    musicaId: null as string | null,
    effectiveBpm: 120,
    semitons: 0,
    queuedMusicaId: null as string | null,
  });

  // Rolagem da cifra/letra

  // Highlight acorde
  const [subChordIndex, setSubChordIndex] = useState(0);
  const subChordIndexRef = useRef(0);

  // Identidade do integrante neste aparelho. É usada apenas para preferências/notas pessoais.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('usuario_ativo');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.id) {
        setActiveMember({
          id: String(parsed.id),
          nome: parsed?.nome ? String(parsed.nome) : undefined,
          funcao: parsed?.funcao ? String(parsed.funcao) : undefined,
        });
      } else {
        setActiveMember(null);
      }
    } catch {
      setActiveMember(null);
    }
  }, []);

  // Rede física e histórico local do show.
  useEffect(() => {
    const updateNetwork = () => setNetworkOnline(navigator.onLine);
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    const saved = readJsonStorage<ShowHistoryEntry[]>(historyCacheKey(id));
    setShowHistory(Array.isArray(saved) ? saved.slice(-300) : []);
  }, [id]);

  useEffect(() => {
    writeJsonStorage(historyCacheKey(id), showHistory.slice(-300));
  }, [id, showHistory]);

  // Preferências do Live: ficam ligadas ao membro ativo neste aparelho.
  useEffect(() => {
    const key = getLivePreferencesStorageKey();
    preferencesStorageKeyRef.current = key;

    try {
      const raw = window.localStorage.getItem(key);
      const saved = raw ? (JSON.parse(raw) as Partial<LiveDisplayPreferences>) : null;
      if (saved && isViewMode(saved.viewMode)) setViewMode(saved.viewMode);
      if (saved && isPresentationMode(saved.presentationMode)) setPresentationMode(saved.presentationMode);
      if (typeof saved?.fontScale === 'number') setFontScale(Math.max(0.75, Math.min(1.5, saved.fontScale)));
      if (typeof saved?.focusRatio === 'number') setFocusRatio(Math.max(0.2, Math.min(0.55, saved.focusRatio)));
      if (typeof saved?.visualTimingOffsetMs === 'number') setVisualTimingOffsetMs(Math.max(-1500, Math.min(1500, saved.visualTimingOffsetMs)));
      if (typeof saved?.showMemberNotes === 'boolean') setShowMemberNotes(saved.showMemberNotes);
    } catch {
      // Mantém os padrões caso a preferência esteja corrompida.
    } finally {
      setPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesReady || !preferencesStorageKeyRef.current) return;

    try {
      const payload: LiveDisplayPreferences = {
        viewMode,
        presentationMode,
        fontScale,
        focusRatio,
        visualTimingOffsetMs,
        showMemberNotes,
      };
      window.localStorage.setItem(preferencesStorageKeyRef.current, JSON.stringify(payload));
    } catch {
      // O Live continua funcionando mesmo se o navegador bloquear storage.
    }
  }, [focusRatio, fontScale, preferencesReady, presentationMode, showMemberNotes, viewMode, visualTimingOffsetMs]);

  // ============== HELPERS ==============
  const cn = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(' ');

  useEffect(() => {
    musicasRef.current = musicas;
  }, [musicas]);

  const showStageNotice = useCallback((message: string) => {
    setStageNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setStageNotice(null);
      noticeTimerRef.current = null;
    }, 2600);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsHideTimerRef.current) window.clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;

    if (autoScroll && !menuAberto) {
      controlsHideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 4200);
    }
  }, [autoScroll, menuAberto]);

  useEffect(() => {
    if (!autoScroll || menuAberto) {
      setControlsVisible(true);
      if (controlsHideTimerRef.current) window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
      return;
    }
    revealControls();
    return () => {
      if (controlsHideTimerRef.current) window.clearTimeout(controlsHideTimerRef.current);
    };
  }, [autoScroll, menuAberto, revealControls]);

  const musicaAtual = useMemo(() => musicas[indexMusicaAtual]?.musica || null, [musicas, indexMusicaAtual]);
  const estruturaAtual = useMemo(() => musicas[indexMusicaAtual]?.estrutura || [], [musicas, indexMusicaAtual]);
  const blocoAtual = useMemo(() => estruturaAtual?.[blocoAtivo]?.bloco || null, [estruturaAtual, blocoAtivo]);

  const blocoSeguinte = useMemo(() => {
    if (blocoAtivo < estruturaAtual.length - 1) return estruturaAtual[blocoAtivo + 1]?.bloco;
    if (indexMusicaAtual < musicas.length - 1) return musicas[indexMusicaAtual + 1]?.estrutura?.[0]?.bloco;
    return null;
  }, [blocoAtivo, estruturaAtual, indexMusicaAtual, musicas]);

  const effectiveBpm = useMemo(() => {
    const base = Number(musicaAtual?.bpm || 120) || 120;
    const ov = bpmOverride;
    if (typeof ov === 'number' && Number.isFinite(ov) && ov > 20 && ov < 300) return ov;
    return base;
  }, [musicaAtual?.bpm, bpmOverride]);

  useEffect(() => {
    playbackSnapshotRef.current = {
      indexMusicaAtual,
      blocoAtivo,
      autoScroll,
      musicaId: musicaAtual?.id ? String(musicaAtual.id) : null,
      effectiveBpm,
      semitons,
      queuedMusicaId,
    };
  }, [autoScroll, blocoAtivo, effectiveBpm, indexMusicaAtual, musicaAtual?.id, queuedMusicaId, semitons]);

  const queuedMusica = useMemo(() => {
    if (!queuedMusicaId) return null;
    const item = musicas.find((entry) => String(entry?.musica?.id) === String(queuedMusicaId));
    return item?.musica || repertorioGeral.find((m) => String(m?.id) === String(queuedMusicaId)) || null;
  }, [musicas, queuedMusicaId, repertorioGeral]);

  const transpor = useCallback((ac: string, diff: number) => {
    if (diff === 0 || !ac) return ac;
    const notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return ac.replace(/[A-G][#b]?/g, (m) => {
      let n =
        m === 'Db'
          ? 'C#'
          : m === 'Eb'
          ? 'D#'
          : m === 'Gb'
          ? 'F#'
          : m === 'Ab'
          ? 'G#'
          : m === 'Bb'
          ? 'A#'
          : m;
      const i = notas.indexOf(n);
      if (i === -1) return m;
      let ni = (i + diff) % 12;
      return notas[ni < 0 ? ni + 12 : ni];
    });
  }, []);

  const getBlockDurationMs = useCallback(
    (blocoData: any) => {
      const bpm = Math.max(30, Math.min(300, Number(effectiveBpm || 120)));
      const compassosRaw = Number(blocoData?.duracao_compassos ?? 4);
      const compassos = Math.max(1, Number.isFinite(compassosRaw) && compassosRaw > 0 ? compassosRaw : 4);
      return (60000 / bpm) * 4 * compassos;
    },
    [effectiveBpm]
  );

  const clearCountdown = useCallback(() => {
    setCountdown(null);
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const cancelRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release?.();
        wakeLockRef.current = null;
      }
    } catch {}
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!wakeLockEnabled) return;
    try {
      // @ts-ignore
      const wl = await navigator.wakeLock?.request?.('screen');
      wakeLockRef.current = wl;
      wl?.addEventListener?.('release', () => {});
    } catch {}
  }, []);

  const resetTimeForNewBlock = useCallback(() => {
    blockStartEpochRef.current = Date.now();
    setProgresso(0);
    subChordIndexRef.current = 0;
    setSubChordIndex(0);
  }, []);

  const stopShow = useCallback(async () => {
    setAutoScroll(false);
    clearCountdown();
    setProgresso(0);
    blockStartEpochRef.current = null;
    subChordIndexRef.current = 0;
    setSubChordIndex(0);
    cancelRaf();
    await releaseWakeLock();
  }, [cancelRaf, clearCountdown, releaseWakeLock]);

  const pauseShow = useCallback(async () => {
    setAutoScroll(false);
    clearCountdown();
    cancelRaf();
    await releaseWakeLock();
  }, [cancelRaf, clearCountdown, releaseWakeLock]);

  const fetchMusicaCompleta = useCallback(async (musicaId: string) => {
    const cached = readCachedSong(String(musicaId));
    if (cached) return cached;

    const { data, error } = await supabase
      .from('repertorio')
      .select(`
        id, titulo, artista, tom, bpm, categoria,
        estrutura:musica_estrutura (
          posicao,
          bloco:musica_blocos (id, tipo, nome_personalizado, letra, acordes, duracao_compassos)
        )
      `)
      .eq('id', musicaId)
      .single();

    if (error || !data) throw error || new Error('Música não encontrada');

    const estrutura = [...((data as any).estrutura || [])].sort((a: any, b: any) => a.posicao - b.posicao);
    const cachedItem = { musica: data, estrutura };
    cacheSongItem(cachedItem);
    return cachedItem;
  }, []);

  const preloadMusicaCacheOnly = useCallback(async (musicaId: string) => {
    if (!musicaId || readCachedSong(String(musicaId))) return;
    try {
      await fetchMusicaCompleta(String(musicaId));
    } catch {
      // Pré-carga nunca bloqueia o palco.
    }
  }, [fetchMusicaCompleta]);

  const ensureMusicaDisponivel = useCallback(async (musicaId: string) => {
    const idNormalizado = String(musicaId);
    const existente = musicasRef.current.findIndex((item) => String(item?.musica?.id) === idNormalizado);
    if (existente >= 0) return existente;

    const cached = await fetchMusicaCompleta(idNormalizado);
    const item = {
      ordem: musicasRef.current.length + 1,
      musica: cached.musica,
      estrutura: cached.estrutura || [],
      avulsa: true,
    };

    const novamente = musicasRef.current.findIndex((entry) => String(entry?.musica?.id) === idNormalizado);
    if (novamente >= 0) return novamente;

    const next = [...musicasRef.current, item];
    const nextIndex = next.length - 1;
    musicasRef.current = next;
    setMusicas(next);
    return nextIndex;
  }, [fetchMusicaCompleta]);

  const bumpPedido = useCallback((musicaId: string) => {
    setPedidoCounts((prev) => ({ ...prev, [String(musicaId)]: (prev[String(musicaId)] || 0) + 1 }));
  }, []);

  const clearQueue = useCallback(() => {
    queuedIndexRef.current = null;
    setQueuedMusicaId(null);
  }, []);

  const recordPlayedSong = useCallback((item: any) => {
    const musica = item?.musica;
    if (!musica?.id) return;
    const musicaId = String(musica.id);
    const avulsa = !originalSetlistIdsRef.current.has(musicaId);
    const playedAt = new Date().toISOString();
    const entry: ShowHistoryEntry = {
      id: `${Date.now()}-${musicaId}`,
      musicaId,
      titulo: String(musica.titulo || 'Sem título'),
      artista: musica.artista ? String(musica.artista) : undefined,
      categoria: musica.categoria ? String(musica.categoria) : undefined,
      tom: musica.tom ? String(musica.tom) : undefined,
      bpm: Number.isFinite(Number(musica.bpm)) ? Number(musica.bpm) : undefined,
      avulsa,
      playedAt,
    };
    setShowHistory((prev) => [...prev.slice(-299), entry]);

    // Atualiza imediatamente a inteligência local; o banco é persistência, não bloqueio do palco.
    setSongStats((prev) => {
      const current = prev[musicaId] || { plays: 0, requests: 0, lastPlayedAt: null };
      return {
        ...prev,
        [musicaId]: {
          plays: current.plays + 1,
          requests: current.requests + (avulsa ? 1 : 0),
          lastPlayedAt: playedAt,
        },
      };
    });

    const orgId = eventoInfo?.org_id ? String(eventoInfo.org_id) : '';
    if (orgId && networkOnline && isReferenceRef.current) {
      void supabase
        .from('repertorio_execucoes')
        .insert({
          org_id: orgId,
          evento_id: String(id),
          repertorio_id: musicaId,
          membro_id: activeMember?.id || null,
          origem: avulsa ? 'request' : 'setlist',
          titulo: entry.titulo,
          artista: entry.artista || null,
          categoria: entry.categoria || null,
          tom: entry.tom || null,
          bpm: entry.bpm || null,
          played_at: playedAt,
        })
        .then(({ error }: any) => {
          if (error) console.warn('[Live Intelligence] histórico permanente indisponível:', error.message);
        });
    }
  }, [activeMember?.id, eventoInfo?.org_id, id, networkOnline]);

  useEffect(() => {
    if (lastPlaybackIndexRef.current !== indexMusicaAtual) {
      lastPlaybackIndexRef.current = indexMusicaAtual;
      activeRunLoggedRef.current = false;
    }

    if (!autoScroll || activeRunLoggedRef.current) return;
    const item = musicas[indexMusicaAtual];
    if (!item?.musica?.id) return;
    activeRunLoggedRef.current = true;
    recordPlayedSong(item);
  }, [autoScroll, indexMusicaAtual, musicas, recordPlayedSong]);

  // ================== FULLSCREEN ==================
  const toggleFullscreen = useCallback(async () => {
    try {
      const el = containerRef.current;
      if (!el) return;

      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.log('fullscreen error', e);
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    onFs();
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ================== BLOQUEAR SCROLL / GESTOS ==================
  useEffect(() => {
    if (!lockGesturesEnabled) return;

    const prevOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevOverscroll = (document.documentElement.style as any).overscrollBehaviorY;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    (document.documentElement.style as any).overscrollBehaviorY = 'none';

    const onTouchMove = (e: TouchEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const insideLiveScroll = !!target?.closest('[data-live-scroll="true"]');
      const insideToolbarScroll = !!target?.closest('[data-live-toolbar="true"]');
      if ((presentationMode === 'scroll' && insideLiveScroll) || insideToolbarScroll) return;
      e.preventDefault();
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      document.documentElement.style.overflow = prevOverflow;
      document.body.style.overflow = prevBodyOverflow;
      (document.documentElement.style as any).overscrollBehaviorY = prevOverscroll;
      document.removeEventListener('touchmove', onTouchMove as any);
    };
  }, [lockGesturesEnabled, presentationMode]);

  // ================== WAKELOCK em visibilitychange ==================
  useEffect(() => {
    if (!wakeLockEnabled) return;

    const onVis = async () => {
      if (document.visibilityState === 'visible') {
        if (autoScroll) await requestWakeLock();
      } else {
        await releaseWakeLock();
      }
    };

    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [wakeLockEnabled, autoScroll, requestWakeLock, releaseWakeLock]);

  // ================== SYNC: Canal realtime ==================
  const sendSync = useCallback(
    async (msg: SyncMessage) => {
      if (!syncEnabled) return;
      if (suppressBroadcastRef.current) return;

      const ch = channelRef.current;
      if (!ch) return;

      try {
        await ch.send({
          type: 'broadcast',
          event: 'sync',
          payload: msg,
        });
      } catch (e) {
        console.log('sync send error', e);
      }
    },
    [syncEnabled]
  );

  // ✅ Ping loop: seguidores fazem NTP com a referência atual
  useEffect(() => {
    if (!connected) return;
    if (!syncEnabled) return;

    const t = window.setInterval(async () => {
      const refId = referenceIdRef.current;
      if (!refId) return;
      if (isReferenceRef.current) return; // quem é referência não precisa calcular offset

      const ch = channelRef.current;
      if (!ch) return;

      const pingId = `${clientIdRef.current}-${Date.now()}`;
      lastPingIdRef.current = pingId;

      try {
        await ch.send({
          type: 'broadcast',
          event: 'sync',
          payload: {
            kind: 'PING',
            senderId: clientIdRef.current,
            pingId,
            t0: Date.now(),
          } satisfies SyncMessage,
        });
      } catch {}
    }, 2000);

    return () => window.clearInterval(t);
  }, [connected, syncEnabled]);

  useEffect(() => {
    const ch = supabase.channel(`live:${id}`, {
      config: { broadcast: { self: false } },
    });

    channelRef.current = ch;

    ch.on('broadcast', { event: 'sync' }, async ({ payload }: any) => {
      const msg = payload as SyncMessage;
      if (!msg || msg.senderId === clientIdRef.current) return;

      suppressBroadcastRef.current = true;

      try {
        // ====== NTP: responder PING (se eu for a referência atual) ======
        if (msg.kind === 'PING') {
          if (isReferenceRef.current) {
            await ch.send({
              type: 'broadcast',
              event: 'sync',
              payload: {
                kind: 'PONG',
                senderId: clientIdRef.current,
                pingId: msg.pingId,
                t0: msg.t0,
                t1: Date.now(), // tempo da referência
              } satisfies SyncMessage,
            });
          }
          return;
        }

        // ====== NTP: calcular offset ao receber PONG ======
        if (msg.kind === 'PONG') {
          if (msg.pingId !== lastPingIdRef.current) return;

          const t2 = Date.now(); // follower receive time
          const t0 = msg.t0; // follower send time
          const t1 = msg.t1; // reference respond time

          const offset = t1 - (t0 + t2) / 2; // referenceTime - localTime

          // suaviza para reduzir jitter (EWMA)
          const alpha = 0.18;
          const next = clockOffsetRef.current * (1 - alpha) + offset * alpha;
          setClockOffsetMs(next);

          return;
        }

        // ====== STATE REQUEST / RECONNECT ======
        if (msg.kind === 'STATE_REQUEST') {
          if (isReferenceRef.current) {
            const snapshot = playbackSnapshotRef.current;
            await ch.send({
              type: 'broadcast',
              event: 'sync',
              payload: {
                kind: 'STATE',
                senderId: clientIdRef.current,
                maestroId: clientIdRef.current,
                playing: snapshot.autoScroll,
                musicaId: snapshot.musicaId || undefined,
                blocoAtivo: snapshot.blocoAtivo,
                blockStartEpochMs: blockStartEpochRef.current,
                bpm: snapshot.effectiveBpm,
                semitons: snapshot.semitons,
                queuedMusicaId: snapshot.queuedMusicaId,
              } satisfies SyncMessage,
            });
          }
          return;
        }

        if (msg.kind === 'STATE') {
          if (isReferenceRef.current) return;
          referenceIdRef.current = msg.maestroId;
          setSemitons(msg.semitons ?? 0);

          if (msg.queuedMusicaId) {
            try {
              const qIndex = await ensureMusicaDisponivel(String(msg.queuedMusicaId));
              queuedIndexRef.current = qIndex;
              setQueuedMusicaId(String(msg.queuedMusicaId));
            } catch {}
          } else {
            queuedIndexRef.current = null;
            setQueuedMusicaId(null);
          }

          if (!msg.musicaId) return;
          const targetIndex = await ensureMusicaDisponivel(String(msg.musicaId));
          const current = playbackSnapshotRef.current;
          const samePosition =
            current.musicaId === String(msg.musicaId) && current.blocoAtivo === msg.blocoAtivo;

          if (!samePosition) {
            await pauseShow();
            setIndexMusicaAtual(targetIndex);
            setBlocoAtivo(msg.blocoAtivo);
            setProgresso(0);
            subChordIndexRef.current = 0;
            setSubChordIndex(0);
          }

          if (msg.playing && typeof msg.blockStartEpochMs === 'number') {
            const targetLocalStart = msg.blockStartEpochMs - clockOffsetRef.current;
            if (samePosition && blockStartEpochRef.current !== null) {
              pendingClockCorrectionMsRef.current = targetLocalStart - blockStartEpochRef.current;
            } else {
              blockStartEpochRef.current = targetLocalStart;
            }
            await requestWakeLock();
            setAutoScroll(true);
          } else if (!msg.playing) {
            await pauseShow();
            blockStartEpochRef.current = null;
          }
          return;
        }

        // ====== FILA / PRÓXIMA MÚSICA ======
        if (msg.kind === 'QUEUE') {
          if (!msg.musicaId) {
            queuedIndexRef.current = null;
            setQueuedMusicaId(null);
            return;
          }
          try {
            const qIndex = await ensureMusicaDisponivel(String(msg.musicaId));
            queuedIndexRef.current = qIndex;
            setQueuedMusicaId(String(msg.musicaId));
          } catch (error) {
            console.error('Não foi possível preparar a música da fila:', error);
          }
          return;
        }

        // ====== PAUSE ======
        if (msg.kind === 'PAUSE') {
          await pauseShow();
          return;
        }

        // ====== GOTO ======
        if (msg.kind === 'GOTO') {
          await pauseShow();
          const targetIndex = msg.musicaId
            ? await ensureMusicaDisponivel(msg.musicaId)
            : msg.indexMusicaAtual;

          setIndexMusicaAtual(targetIndex);
          setBlocoAtivo(msg.blocoAtivo);
          setProgresso(0);
          subChordIndexRef.current = 0;
          setSubChordIndex(0);

          if (msg.resume && typeof msg.maestroStartAtMs === 'number') {
            const localStartAtMs = msg.maestroStartAtMs - clockOffsetRef.current;
            blockStartEpochRef.current = localStartAtMs;
            await requestWakeLock();
            setAutoScroll(true);
          } else {
            blockStartEpochRef.current = null;
          }
          return;
        }

        // ====== START ======
        if (msg.kind === 'START') {
          // Quem mandou START vira referência atual
          isReferenceRef.current = false;
          referenceIdRef.current = msg.maestroId;

          setSemitons(msg.semitons ?? 0);
          // A preferência visual é individual. Um START sincroniza a música,
          // mas não força cantor/guitarrista a usarem a mesma apresentação.
          const targetStartIndex = msg.musicaId
            ? await ensureMusicaDisponivel(msg.musicaId)
            : msg.indexMusicaAtual;
          setIndexMusicaAtual(targetStartIndex);
          setBlocoAtivo(msg.blocoAtivo);
          setProgresso(0);
          subChordIndexRef.current = 0;
          setSubChordIndex(0);

          await pauseShow();

          // ✅ converter start do relógio da referência para relógio local
          const offset = clockOffsetRef.current; // ref - local
          const localStartAtMs = msg.maestroStartAtMs - offset;

          const now = Date.now();
          const msToStart = Math.max(0, localStartAtMs - now);

          const beatMs = 60000 / Math.max(30, Math.min(300, Number(msg.bpm || 120)));
          const beatsLeft = Math.max(0, Math.round(msToStart / beatMs));

          if (msToStart <= 150) {
            blockStartEpochRef.current = localStartAtMs;
            await requestWakeLock();
            setAutoScroll(true);
          } else {
            let c = Math.min(4, Math.max(1, beatsLeft || 4));
            setCountdown(c);

            if (countdownTimerRef.current) {
              window.clearInterval(countdownTimerRef.current);
              countdownTimerRef.current = null;
            }

            countdownTimerRef.current = window.setInterval(async () => {
              c -= 1;
              if (c <= 0) {
                if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
                setCountdown(null);

                const now2 = Date.now();
                const wait = Math.max(0, localStartAtMs - now2);
                if (wait > 0) await new Promise((r) => setTimeout(r, wait));

                blockStartEpochRef.current = localStartAtMs;
                await requestWakeLock();
                setAutoScroll(true);
                return;
              }
              setCountdown(c);
            }, beatMs);
          }

          return;
        }
      } finally {
        window.setTimeout(() => {
          suppressBroadcastRef.current = false;
        }, 0);
      }
    });

    const resyncTimers: number[] = [];
    ch.subscribe((status) => {
      const subscribed = status === 'SUBSCRIBED';
      setConnected(subscribed);
      if (!subscribed) return;

      const requestState = () => {
        void ch.send({
          type: 'broadcast',
          event: 'sync',
          payload: { kind: 'STATE_REQUEST', senderId: clientIdRef.current } satisfies SyncMessage,
        });
      };
      resyncTimers.push(window.setTimeout(requestState, 250));
      resyncTimers.push(window.setTimeout(requestState, 3200));
    });

    return () => {
      resyncTimers.forEach((timer) => window.clearTimeout(timer));
      try {
        supabase.removeChannel(ch);
      } catch {}
      channelRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ================== START COM COUNTDOWN (quem apertou play) ==================
  const startShowWithCountdown = useCallback(async () => {
    if (lockUI) return;
    if (autoScroll || countdown !== null) return;

    // ✅ auto fullscreen (precisa ser dentro do gesto do usuário)
    if (autoFullscreenOnPlay && !document.fullscreenElement) {
      try {
        const el = containerRef.current;
        if (el) await el.requestFullscreen();
      } catch {}
    }

    // Quem disparou START vira referência automaticamente (sem UI)
    isReferenceRef.current = true;
    referenceIdRef.current = clientIdRef.current;

    const beatMs = 60000 / Math.max(30, Math.min(300, Number(effectiveBpm || 120)));

    // ✅ lead maior para comer jitter + dar tempo do ping ajustar
    const leadBeats = 8;

    let c = 4;
    setCountdown(c);

    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    // tempo no MEU relógio (referência)
    const maestroStartAtMs = Date.now() + beatMs * leadBeats;

    await sendSync({
      kind: 'START',
      senderId: clientIdRef.current,
      maestroId: clientIdRef.current,
      maestroStartAtMs,
      bpm: effectiveBpm,
      indexMusicaAtual,
      blocoAtivo,
      semitons,
      musicaId: musicaAtual?.id ? String(musicaAtual.id) : undefined,
    });

    countdownTimerRef.current = window.setInterval(async () => {
      c -= 1;
      if (c <= 0) {
        if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;

        setCountdown(null);

        const now2 = Date.now();
        const wait = Math.max(0, maestroStartAtMs - now2);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        blockStartEpochRef.current = maestroStartAtMs;
        await requestWakeLock();
        setAutoScroll(true);
        return;
      }
      setCountdown(c);
    }, beatMs);
  }, [
    lockUI,
    autoScroll,
    countdown,
    effectiveBpm,
    sendSync,
    indexMusicaAtual,
    blocoAtivo,
    semitons,
    musicaAtual?.id,
    requestWakeLock,
    autoFullscreenOnPlay,
  ]);

  const togglePlay = useCallback(async () => {
    if (lockUI) return;

    if (autoScroll || countdown !== null) {
      await pauseShow();
      await sendSync({ kind: 'PAUSE', senderId: clientIdRef.current });
    } else {
      await startShowWithCountdown();
    }
  }, [lockUI, autoScroll, countdown, pauseShow, sendSync, startShowWithCountdown]);

  // ✅ "INICIAR BLOCO"
  const restartCurrentBlock = useCallback(() => {
    if (lockUI) return;
    resetTimeForNewBlock();
  }, [lockUI, resetTimeForNewBlock]);

  const saltarParaIndex = useCallback(
    async (nextIndex: number) => {
      if (lockUI) return;
      if (nextIndex < 0 || nextIndex >= musicas.length) return;

      await pauseShow();
      setMenuAberto(false);
      activeRunLoggedRef.current = false;
      if (queuedIndexRef.current === nextIndex) clearQueue();
      setIndexMusicaAtual(nextIndex);
      setBlocoAtivo(0);
      blockStartEpochRef.current = null;
      setProgresso(0);
      subChordIndexRef.current = 0;
      setSubChordIndex(0);

      await sendSync({
        kind: 'GOTO',
        senderId: clientIdRef.current,
        indexMusicaAtual: nextIndex,
        blocoAtivo: 0,
      });
    },
    [clearQueue, lockUI, musicas.length, pauseShow, sendSync]
  );

  const saltarParaMusicaRapida = useCallback(
    async (musicaId: string) => {
      if (lockUI) return;
      setQuickLoadingId(String(musicaId));
      try {
        await pauseShow();
        const nextIndex = await ensureMusicaDisponivel(String(musicaId));
        setMenuAberto(false);
        activeRunLoggedRef.current = false;
        if (queuedIndexRef.current === nextIndex) clearQueue();
        setIndexMusicaAtual(nextIndex);
        setBlocoAtivo(0);
        blockStartEpochRef.current = null;
        setProgresso(0);
        subChordIndexRef.current = 0;
        setSubChordIndex(0);
        bumpPedido(String(musicaId));

        await sendSync({
          kind: 'GOTO',
          senderId: clientIdRef.current,
          indexMusicaAtual: nextIndex,
          blocoAtivo: 0,
          musicaId: String(musicaId),
        });
      } catch (error) {
        console.error('Erro ao abrir música fora do setlist:', error);
        alert('Não foi possível abrir essa música agora.');
      } finally {
        setQuickLoadingId(null);
      }
    },
    [bumpPedido, clearQueue, ensureMusicaDisponivel, lockUI, pauseShow, sendSync]
  );

  const colocarComoProxima = useCallback(
    async (musicaId: string) => {
      if (lockUI) return;
      setQuickLoadingId(String(musicaId));
      try {
        const nextIndex = await ensureMusicaDisponivel(String(musicaId));
        queuedIndexRef.current = nextIndex;
        setQueuedMusicaId(String(musicaId));
        bumpPedido(String(musicaId));
        setMenuAberto(false);
        showStageNotice('Próxima música preparada');

        await sendSync({
          kind: 'QUEUE',
          senderId: clientIdRef.current,
          musicaId: String(musicaId),
        });
      } catch (error) {
        console.error('Erro ao preparar próxima música:', error);
        alert('Não foi possível preparar essa música agora.');
      } finally {
        setQuickLoadingId(null);
      }
    },
    [bumpPedido, ensureMusicaDisponivel, lockUI, sendSync, showStageNotice]
  );

  const saltarParaBloco = useCallback(
    async (nextBlock: number) => {
      if (lockUI || nextBlock < 0 || nextBlock >= estruturaAtual.length) return;

      const wasPlaying = autoScroll;
      const musicaId = musicaAtual?.id ? String(musicaAtual.id) : undefined;
      const maestroStartAtMs = wasPlaying ? Date.now() + 220 : undefined;

      setBlocoAtivo(nextBlock);
      setProgresso(0);
      subChordIndexRef.current = 0;
      setSubChordIndex(0);
      blockStartEpochRef.current = maestroStartAtMs ?? null;

      if (wasPlaying && maestroStartAtMs) {
        await requestWakeLock();
        setAutoScroll(true);
      }

      await sendSync({
        kind: 'GOTO',
        senderId: clientIdRef.current,
        indexMusicaAtual,
        blocoAtivo: nextBlock,
        musicaId,
        resume: wasPlaying,
        maestroStartAtMs,
      });
    },
    [autoScroll, estruturaAtual.length, indexMusicaAtual, lockUI, musicaAtual?.id, requestWakeLock, sendSync]
  );

  const prevBlock = useCallback(() => void saltarParaBloco(blocoAtivo - 1), [blocoAtivo, saltarParaBloco]);
  const nextBlock = useCallback(() => void saltarParaBloco(blocoAtivo + 1), [blocoAtivo, saltarParaBloco]);

  const prevSong = useCallback(async () => {
    if (lockUI) return;
    if (indexMusicaAtual === 0) return;

    const nextIndex = indexMusicaAtual - 1;
    await pauseShow();
    setIndexMusicaAtual(nextIndex);
    setBlocoAtivo(0);
    blockStartEpochRef.current = null;
    setProgresso(0);
    subChordIndexRef.current = 0;
    setSubChordIndex(0);

    await sendSync({
      kind: 'GOTO',
      senderId: clientIdRef.current,
      indexMusicaAtual: nextIndex,
      blocoAtivo: 0,
    });
  }, [lockUI, indexMusicaAtual, pauseShow, sendSync]);

  const nextSong = useCallback(async () => {
    if (lockUI) return;

    const queuedIndex = queuedIndexRef.current;
    const nextIndex = queuedIndex !== null ? queuedIndex : indexMusicaAtual + 1;
    if (nextIndex < 0 || nextIndex >= musicas.length || nextIndex === indexMusicaAtual) return;

    await pauseShow();
    activeRunLoggedRef.current = false;
    setIndexMusicaAtual(nextIndex);
    setBlocoAtivo(0);
    blockStartEpochRef.current = null;
    setProgresso(0);
    subChordIndexRef.current = 0;
    setSubChordIndex(0);

    const targetId = musicas[nextIndex]?.musica?.id ? String(musicas[nextIndex].musica.id) : undefined;
    if (queuedIndex !== null) {
      clearQueue();
      await sendSync({ kind: 'QUEUE', senderId: clientIdRef.current, musicaId: null });
    }

    await sendSync({
      kind: 'GOTO',
      senderId: clientIdRef.current,
      indexMusicaAtual: nextIndex,
      blocoAtivo: 0,
      musicaId: targetId,
    });
  }, [clearQueue, indexMusicaAtual, lockUI, musicas, pauseShow, sendSync]);

  // ================== ENGINE RAF ==================
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    const item = estruturaAtual?.[blocoAtivo];
    if (!item?.bloco) return;

    const duracao = getBlockDurationMs(item.bloco);
    // O editor novo trabalha 1 compasso por posição. Usar a duração do bloco
    // mantém acorde, linha da letra e andamento alinhados mesmo em compassos sem acorde.
    const acordesCount = Math.max(1, Number(item.bloco?.duracao_compassos) || 1);

    const step = () => {
      if (!autoScroll) return;

      const now = Date.now();

      if (blockStartEpochRef.current === null) blockStartEpochRef.current = now;

      // Ao reconectar, corrige drift aos poucos. Nunca dá um salto visual brusco.
      if (blockStartEpochRef.current !== null && Math.abs(pendingClockCorrectionMsRef.current) >= 0.5) {
        const correctionStep = Math.max(-8, Math.min(8, pendingClockCorrectionMsRef.current));
        blockStartEpochRef.current += correctionStep;
        pendingClockCorrectionMsRef.current -= correctionStep;
      }

      let elapsed = now - blockStartEpochRef.current + visualTimingOffsetMs;
      if (elapsed > duracao * 1.5) {
        blockStartEpochRef.current = now;
        elapsed = 0;
      }

      const progress01 = Math.max(0, Math.min(1, elapsed / duracao));

      // O motor continua em requestAnimationFrame, mas a UI não precisa
      // rerenderizar o componente inteiro ~60 vezes por segundo.
      if (progress01 >= 1 || now - lastProgressUiRef.current >= 80) {
        lastProgressUiRef.current = now;
        setProgresso(progress01 * 100);
      }

      const nextSub = Math.min(acordesCount - 1, Math.floor(progress01 * acordesCount));
      if (nextSub !== subChordIndexRef.current) {
        subChordIndexRef.current = nextSub;
        setSubChordIndex(nextSub);
      }

      if (progress01 >= 1) {
        if (blocoAtivo < estruturaAtual.length - 1) {
          // IMPORTANTE: zera o progresso no MESMO render em que troca o bloco.
          // Sem isso, por alguns frames o bloco novo herdava progresso=100 do
          // bloco anterior. A rolagem calculava o alvo como se o bloco novo
          // também estivesse terminando, avançava para o bloco seguinte e logo
          // depois voltava para 0% — o "buraco" visual percebido na transição.
          setProgresso(0);
          lastProgressUiRef.current = now;
          setBlocoAtivo((p) => p + 1);
          blockStartEpochRef.current = now;
          subChordIndexRef.current = 0;
          setSubChordIndex(0);
        } else if (queuedIndexRef.current !== null && queuedIndexRef.current !== indexMusicaAtual) {
          // Request preparado: entra imediatamente no fim da música atual.
          const qIndex = queuedIndexRef.current;
          queuedIndexRef.current = null;
          setQueuedMusicaId(null);
          if (isReferenceRef.current) void sendSync({ kind: 'QUEUE', senderId: clientIdRef.current, musicaId: null });
          setProgresso(0);
          lastProgressUiRef.current = now;
          activeRunLoggedRef.current = false;
          setIndexMusicaAtual(qIndex);
          setBlocoAtivo(0);
          blockStartEpochRef.current = now;
          subChordIndexRef.current = 0;
          setSubChordIndex(0);
        } else if (indexMusicaAtual < musicas.length - 1) {
          // Mesma proteção na troca automática de música.
          setProgresso(0);
          lastProgressUiRef.current = now;
          activeRunLoggedRef.current = false;
          setIndexMusicaAtual((p) => p + 1);
          setBlocoAtivo(0);
          blockStartEpochRef.current = now;
          subChordIndexRef.current = 0;
          setSubChordIndex(0);
        } else {
          pauseShow();
          return;
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    if (autoScroll) rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [autoScroll, estruturaAtual, blocoAtivo, indexMusicaAtual, musicas.length, getBlockDurationMs, pauseShow, sendSync, visualTimingOffsetMs]);

  // ================== LOAD DATA ==================
  useEffect(() => {
    let alive = true;

    async function carregar() {
      try {
        const [eventoRes, setlistRes, repertorioRes, historicoRes] = await Promise.all([
          supabase.from('eventos').select('id,local,org_id').eq('id', id).single(),
          supabase
            .from('evento_repertorio')
            .select(`
              ordem,
              musica:repertorio (
                id, titulo, artista, categoria, tom, bpm,
                estrutura:musica_estrutura (
                  posicao,
                  bloco:musica_blocos (id, tipo, nome_personalizado, letra, acordes, duracao_compassos)
                )
              )
            `)
            .eq('evento_id', id)
            .order('ordem'),
          supabase.from('repertorio').select('id, titulo, artista, categoria, tom, bpm').order('titulo'),
          supabase.from('evento_repertorio').select('repertorio_id').limit(2000),
        ]);

        if (!alive) return;
        if (eventoRes.error) throw eventoRes.error;
        if (setlistRes.error) throw setlistRes.error;
        if (repertorioRes.error) throw repertorioRes.error;

        setEventoInfo(eventoRes.data);

        // Inteligência permanente do repertório. Se a migration v8 ainda não foi aplicada,
        // o Live continua normalmente usando os dados locais/fallback existentes.
        const orgId = eventoRes.data?.org_id ? String(eventoRes.data.org_id) : '';
        if (orgId) {
          const [execucoesRes, pinsRes, notasRes] = await Promise.all([
            supabase
              .from('repertorio_execucoes')
              .select('repertorio_id,origem,played_at,titulo,artista,categoria,tom,bpm')
              .eq('org_id', orgId)
              .order('played_at', { ascending: false })
              .limit(5000),
            supabase
              .from('repertorio_live_favoritos')
              .select('repertorio_id')
              .eq('org_id', orgId),
            activeMember?.id
              ? supabase
                  .from('repertorio_notas_membro')
                  .select('repertorio_id,nota')
                  .eq('org_id', orgId)
                  .eq('membro_id', activeMember.id)
              : Promise.resolve({ data: [], error: null } as any),
          ]);

          if (!execucoesRes.error && execucoesRes.data) {
            const nextStats: Record<string, PermanentSongStats> = {};
            execucoesRes.data.forEach((row: any) => {
              const musicaId = String(row?.repertorio_id || '');
              if (!musicaId) return;
              const current = nextStats[musicaId] || { plays: 0, requests: 0, lastPlayedAt: null };
              current.plays += 1;
              if (row?.origem === 'request') current.requests += 1;
              if (!current.lastPlayedAt && row?.played_at) current.lastPlayedAt = String(row.played_at);
              nextStats[musicaId] = current;
            });
            setSongStats(nextStats);

            // Recupera o histórico deste evento quando o cache local não existir.
            const eventRowsRes = await supabase
              .from('repertorio_execucoes')
              .select('id,repertorio_id,origem,played_at,titulo,artista,categoria,tom,bpm')
              .eq('org_id', orgId)
              .eq('evento_id', String(id))
              .order('played_at', { ascending: true })
              .limit(500);
            const eventRows = eventRowsRes.data || [];
            if (!eventRowsRes.error && eventRows.length) {
              setShowHistory((prev) => {
                if (prev.length) return prev;
                return eventRows.map((row: any) => ({
                  id: String(row.id),
                  musicaId: String(row.repertorio_id),
                  titulo: String(row.titulo || 'Sem título'),
                  artista: row.artista ? String(row.artista) : undefined,
                  categoria: row.categoria ? String(row.categoria) : undefined,
                  tom: row.tom ? String(row.tom) : undefined,
                  bpm: Number.isFinite(Number(row.bpm)) ? Number(row.bpm) : undefined,
                  avulsa: row.origem === 'request',
                  playedAt: String(row.played_at),
                }));
              });
            }
          }

          if (!pinsRes.error && pinsRes.data) {
            setPinnedSongIds(new Set(pinsRes.data.map((row: any) => String(row.repertorio_id))));
          }

          if (!(notasRes as any).error && (notasRes as any).data) {
            const notes: Record<string, string> = {};
            (notasRes as any).data.forEach((row: any) => {
              const musicaId = String(row?.repertorio_id || '');
              const nota = String(row?.nota || '').trim();
              if (musicaId && nota) notes[musicaId] = nota;
            });
            setMemberNotes(notes);
          }
        }

        const it = setlistRes.data;
        let nextMusicas: any[] = [];
        if (it) {
          nextMusicas = it.map((x: any) => ({
            ...x,
            estrutura: x.musica?.estrutura?.sort((a: any, b: any) => a.posicao - b.posicao) || [],
          }));
          originalSetlistIdsRef.current = new Set(
            nextMusicas.map((entry: any) => String(entry?.musica?.id || '')).filter(Boolean)
          );
          nextMusicas.forEach(cacheSongItem);
          musicasRef.current = nextMusicas;
          setMusicas(nextMusicas);
        }

        const nextRepertorio = repertorioRes.data || [];
        if (repertorioRes.data) setRepertorioGeral(repertorioRes.data);
        writeJsonStorage(eventCacheKey(id), {
          eventoInfo: eventoRes.data,
          musicas: nextMusicas,
          repertorioGeral: nextRepertorio,
          savedAt: Date.now(),
        });
        setLoadedFromCache(false);

        if (!historicoRes.error && historicoRes.data) {
          const counts: Record<string, number> = {};
          historicoRes.data.forEach((row: any) => {
            const key = String(row?.repertorio_id || '');
            if (key) counts[key] = (counts[key] || 0) + 1;
          });
          setPedidoCounts(counts);
        }
        setLoading(false);
      } catch (e) {
        console.error(e);
        if (!alive) return;
        const cached = readJsonStorage<any>(eventCacheKey(id));
        if (cached?.eventoInfo && Array.isArray(cached?.musicas)) {
          setEventoInfo(cached.eventoInfo);
          const cachedMusicas = cached.musicas;
          originalSetlistIdsRef.current = new Set(
            cachedMusicas.map((entry: any) => String(entry?.musica?.id || '')).filter(Boolean)
          );
          musicasRef.current = cachedMusicas;
          setMusicas(cachedMusicas);
          if (Array.isArray(cached.repertorioGeral)) setRepertorioGeral(cached.repertorioGeral);
          setLoadedFromCache(true);
        }
        setLoading(false);
      }
    }

    carregar();
    return () => {
      alive = false;
    };
  }, [id]);

  // Notas pessoais podem chegar depois do carregamento inicial porque a identidade ativa
  // vem do localStorage. Recarrega somente as notas, sem mexer no setlist/relógio.
  useEffect(() => {
    const orgId = eventoInfo?.org_id ? String(eventoInfo.org_id) : '';
    const memberId = activeMember?.id ? String(activeMember.id) : '';
    if (!orgId || !memberId || !networkOnline) return;

    let alive = true;
    void supabase
      .from('repertorio_notas_membro')
      .select('repertorio_id,nota')
      .eq('org_id', orgId)
      .eq('membro_id', memberId)
      .then(({ data, error }: any) => {
        if (!alive || error || !data) return;
        const notes: Record<string, string> = {};
        data.forEach((row: any) => {
          const musicaId = String(row?.repertorio_id || '');
          const nota = String(row?.nota || '').trim();
          if (musicaId && nota) notes[musicaId] = nota;
        });
        setMemberNotes(notes);
      });

    return () => {
      alive = false;
    };
  }, [activeMember?.id, eventoInfo?.org_id, networkOnline]);

  // Pré-carrega em segundo plano as músicas mais prováveis de virar request.
  useEffect(() => {
    if (!repertorioGeral.length || !networkOnline) return;
    const ordered = [...repertorioGeral]
      .sort((a, b) => {
        const aId = String(a?.id || '');
        const bId = String(b?.id || '');
        const aScore = (songStats[aId]?.requests || 0) * 3 + (songStats[aId]?.plays || 0) + (pedidoCounts[aId] || 0);
        const bScore = (songStats[bId]?.requests || 0) * 3 + (songStats[bId]?.plays || 0) + (pedidoCounts[bId] || 0);
        return bScore - aScore;
      })
      .slice(0, 6)
      .map((m) => String(m?.id || ''))
      .filter(Boolean);

    const timer = window.setTimeout(() => {
      void Promise.allSettled(ordered.map((musicaId) => preloadMusicaCacheOnly(musicaId)));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [networkOnline, pedidoCounts, preloadMusicaCacheOnly, repertorioGeral, songStats]);

  // ================== LOCK: não mata mais ==================
  useEffect(() => {
    if (!lockUI) return;
    pauseShow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockUI]);

  // ================== MEMOS P/ RENDER ==================
  const indiceMusicaNoSetlist = useMemo(() => {
    const map = new Map<string, number>();
    musicas.forEach((item, index) => {
      const musicaId = item?.musica?.id;
      if (musicaId) map.set(String(musicaId), index);
    });
    return map;
  }, [musicas]);

  const repertorioMenuFiltrado = useMemo(() => {
    const q = buscaMenu.trim().toLowerCase();
    const base = q
      ? repertorioGeral.filter((m) => `${String(m?.titulo || '')} ${String(m?.artista || '')}`.toLowerCase().includes(q))
      : repertorioGeral;
    return [...base].sort((a, b) => String(a?.titulo || '').localeCompare(String(b?.titulo || ''), 'pt-BR'));
  }, [repertorioGeral, buscaMenu]);

  const togglePinnedSong = useCallback(async (musicaId: string) => {
    const orgId = eventoInfo?.org_id ? String(eventoInfo.org_id) : '';
    if (!orgId || !musicaId) return;
    const isPinned = pinnedSongIds.has(String(musicaId));

    // Optimistic UI: palco não espera round-trip para responder.
    setPinnedSongIds((prev) => {
      const next = new Set(prev);
      if (isPinned) next.delete(String(musicaId));
      else next.add(String(musicaId));
      return next;
    });

    const result = isPinned
      ? await supabase
          .from('repertorio_live_favoritos')
          .delete()
          .eq('org_id', orgId)
          .eq('repertorio_id', String(musicaId))
      : await supabase
          .from('repertorio_live_favoritos')
          .upsert(
            { org_id: orgId, repertorio_id: String(musicaId), pinned_at: new Date().toISOString() },
            { onConflict: 'org_id,repertorio_id' }
          );

    if (result.error) {
      // Reverte caso a migration ainda não esteja aplicada ou a gravação falhe.
      setPinnedSongIds((prev) => {
        const next = new Set(prev);
        if (isPinned) next.add(String(musicaId));
        else next.delete(String(musicaId));
        return next;
      });
      showStageNotice('Não foi possível salvar a fixação');
    }
  }, [eventoInfo?.org_id, pinnedSongIds, showStageNotice]);

  const fixadas = useMemo(() => {
    if (buscaMenu.trim()) return [];
    return repertorioGeral
      .filter((m) => pinnedSongIds.has(String(m?.id)))
      .sort((a, b) => String(a?.titulo || '').localeCompare(String(b?.titulo || ''), 'pt-BR'));
  }, [buscaMenu, pinnedSongIds, repertorioGeral]);

  const maisTocadas = useMemo(() => {
    if (buscaMenu.trim()) return [];
    return [...repertorioGeral]
      .filter((m) => (songStats[String(m?.id)]?.plays || 0) > 0)
      .sort((a, b) => (songStats[String(b?.id)]?.plays || 0) - (songStats[String(a?.id)]?.plays || 0))
      .slice(0, 8);
  }, [buscaMenu, repertorioGeral, songStats]);

  const maisPedidas = useMemo(() => {
    if (buscaMenu.trim()) return [];
    const hasPermanent = Object.keys(songStats).length > 0;
    return [...repertorioGeral]
      .filter((m) => {
        const key = String(m?.id || '');
        return hasPermanent ? (songStats[key]?.requests || 0) > 0 : (pedidoCounts[key] || 0) > 0;
      })
      .sort((a, b) => {
        const aId = String(a?.id || '');
        const bId = String(b?.id || '');
        const diff = hasPermanent
          ? (songStats[bId]?.requests || 0) - (songStats[aId]?.requests || 0)
          : (pedidoCounts[bId] || 0) - (pedidoCounts[aId] || 0);
        if (diff !== 0) return diff;
        return String(a?.titulo || '').localeCompare(String(b?.titulo || ''), 'pt-BR');
      })
      .slice(0, 8);
  }, [buscaMenu, pedidoCounts, repertorioGeral, songStats]);

  const recentes = useMemo(() => {
    if (buscaMenu.trim()) return [];
    return [...repertorioGeral]
      .filter((m) => !!songStats[String(m?.id)]?.lastPlayedAt)
      .sort((a, b) => {
        const aTime = new Date(songStats[String(a?.id)]?.lastPlayedAt || 0).getTime();
        const bTime = new Date(songStats[String(b?.id)]?.lastPlayedAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [buscaMenu, repertorioGeral, songStats]);

  const gruposTrocaRapida = useMemo(() => {
    if (buscaMenu.trim()) {
      return [{ label: 'Resultados', tone: 'blue', items: repertorioMenuFiltrado }];
    }

    const rapidas = repertorioMenuFiltrado.filter((m) => m?.categoria === 'Rápida');
    const moderadas = repertorioMenuFiltrado.filter((m) => m?.categoria === 'Moderada');
    const lentas = repertorioMenuFiltrado.filter((m) => m?.categoria === 'Lenta');
    const outras = repertorioMenuFiltrado.filter((m) => !['Rápida', 'Moderada', 'Lenta'].includes(String(m?.categoria || '')));

    return [
      { label: 'Fixadas', tone: 'amber', items: fixadas },
      { label: 'Mais pedidas', tone: 'amber', items: maisPedidas },
      { label: 'Mais tocadas', tone: 'green', items: maisTocadas },
      { label: 'Recentes', tone: 'blue', items: recentes },
      { label: 'Rápidas', tone: 'green', items: rapidas },
      { label: 'Moderadas', tone: 'blue', items: moderadas },
      { label: 'Lentas', tone: 'purple', items: lentas },
      ...(outras.length ? [{ label: 'Outras', tone: 'zinc', items: outras }] : []),
    ].filter((grupo) => grupo.items.length > 0);
  }, [buscaMenu, fixadas, maisPedidas, maisTocadas, recentes, repertorioMenuFiltrado]);

  const historyStats = useMemo(() => {
    const requests = showHistory.filter((entry) => entry.avulsa).length;
    const unique = new Set(showHistory.map((entry) => entry.musicaId)).size;
    const first = showHistory[0]?.playedAt ? new Date(showHistory[0].playedAt).getTime() : null;
    const last = showHistory[showHistory.length - 1]?.playedAt
      ? new Date(showHistory[showHistory.length - 1].playedAt).getTime()
      : null;
    const spanMinutes = first && last ? Math.max(0, Math.round((last - first) / 60000)) : 0;
    return { requests, unique, spanMinutes };
  }, [showHistory]);

  const stageBlocks = useMemo(
    () => estruturaAtual.map((entry: any) => entry?.bloco).filter(Boolean),
    [estruturaAtual]
  );

  const activeMeasureProgress = useMemo(() => {
    const duration = Math.max(1, Number(blocoAtual?.duracao_compassos) || 1);
    const totalMeasures = Math.max(0, Math.min(duration, (Math.max(0, Math.min(100, progresso)) / 100) * duration));
    const currentMeasure = Math.min(duration - 1, Math.floor(Math.min(totalMeasures, duration - 0.000001)));
    if (totalMeasures >= duration) return 1;
    return Math.max(0, Math.min(1, totalMeasures - currentMeasure));
  }, [blocoAtual?.duracao_compassos, progresso]);

  const currentMemberNote = useMemo(() => {
    const musicaId = musicaAtual?.id ? String(musicaAtual.id) : '';
    return musicaId ? String(memberNotes[musicaId] || '').trim() : '';
  }, [memberNotes, musicaAtual?.id]);

  const preflight = useMemo(() => {
    const originals = musicas.filter((entry) => originalSetlistIdsRef.current.has(String(entry?.musica?.id || '')));
    const total = originals.length;
    let missingBpm = 0;
    let missingKey = 0;
    let missingStructure = 0;
    let freeLyrics = 0;
    let chordsWithoutPositions = 0;
    let offlineReady = 0;

    originals.forEach((entry) => {
      const musica = entry?.musica || {};
      const songId = String(musica?.id || '');
      if (!Number(musica?.bpm)) missingBpm += 1;
      if (!String(musica?.tom || '').trim()) missingKey += 1;
      if (!Array.isArray(entry?.estrutura) || entry.estrutura.length === 0) missingStructure += 1;
      if (songId && readCachedSong(songId)) offlineReady += 1;

      let hasChord = false;
      let hasPositionedChord = false;
      let hasFreeLyric = false;
      (entry?.estrutura || []).forEach((structureEntry: any) => {
        const block = structureEntry?.bloco || {};
        const duration = Math.max(1, Number(block?.duracao_compassos) || 1);
        const lyric = String(block?.letra || '').replace(/\r\n/g, '\n');
        const lines = lyric ? lyric.split('\n') : [];
        if (lines.length > 0 && lines.length !== duration) hasFreeLyric = true;
        const chords = String(block?.acordes || '').trim();
        if (chords) {
          hasChord = true;
          if (chords.includes('@')) hasPositionedChord = true;
        }
      });
      if (hasFreeLyric) freeLyrics += 1;
      if (hasChord && !hasPositionedChord) chordsWithoutPositions += 1;
    });

    const warnings = missingBpm + missingKey + missingStructure + freeLyrics;
    return {
      total,
      missingBpm,
      missingKey,
      missingStructure,
      freeLyrics,
      chordsWithoutPositions,
      offlineReady,
      warnings,
    };
  }, [musicas]);

  // ================== RENDER ==================
  if (loading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center text-blue-500 font-black italic animate-pulse">
        CARREGANDO PALCO...
      </div>
    );
  }

  const pagePad = isMobile ? 'p-2' : 'p-4';
  const chromeVisible = controlsVisible || !autoScroll || menuAberto;
  const chromeClass = cn(
    'transition-opacity duration-300',
    chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
  );

  return (
    <div
      ref={containerRef}
      onPointerDown={revealControls}
      className="h-screen w-screen bg-zinc-950 text-white overflow-hidden flex flex-col font-sans select-none"
    >
      {preflightOpen && (
        <div className="fixed inset-0 z-[420] bg-black/95 backdrop-blur-xl overflow-y-auto p-4 sm:p-8 flex items-center justify-center">
          <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-zinc-950 shadow-2xl p-5 sm:p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <div className="flex items-center gap-2 text-emerald-300 mb-2">
                  <ClipboardCheck size={18} />
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]">Pré-show</span>
                </div>
                <h2 className="text-2xl sm:text-4xl font-black uppercase italic">Pronto para o palco?</h2>
                <p className="mt-2 text-xs sm:text-sm text-zinc-500">
                  Verificação rápida antes de entrar no Live. Avisos não bloqueiam a apresentação.
                </p>
              </div>
              <div className={cn(
                'shrink-0 px-3 py-2 rounded-xl border text-[9px] font-black uppercase tracking-wider',
                connected ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
              )}>
                {connected ? 'Realtime OK' : networkOnline ? 'Conectando…' : 'Offline'}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                <p className="text-2xl font-black">{preflight.total}</p>
                <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">músicas</p>
              </div>
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4 text-center">
                <p className="text-2xl font-black text-emerald-300">{preflight.offlineReady}/{preflight.total}</p>
                <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">cache offline</p>
              </div>
              <div className="rounded-2xl border border-blue-500/15 bg-blue-500/5 p-4 text-center">
                <p className="text-2xl font-black text-blue-300">{activeMember?.nome ? '✓' : '—'}</p>
                <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">integrante</p>
              </div>
              <div className={cn(
                'rounded-2xl border p-4 text-center',
                preflight.warnings ? 'border-yellow-500/15 bg-yellow-500/5' : 'border-emerald-500/15 bg-emerald-500/5'
              )}>
                <p className={cn('text-2xl font-black', preflight.warnings ? 'text-yellow-300' : 'text-emerald-300')}>{preflight.warnings}</p>
                <p className="text-[8px] font-black uppercase tracking-wider text-zinc-500">avisos</p>
              </div>
            </div>

            <button
              onClick={() => setPreflightDetailsOpen((v) => !v)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 flex items-center justify-between text-left"
            >
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-300">
                {preflight.warnings ? 'Ver pontos para revisar' : 'Checklist principal aprovado'}
              </span>
              <span className="text-zinc-500 text-sm">{preflightDetailsOpen ? '−' : '+'}</span>
            </button>

            {preflightDetailsOpen && (
              <div className="mt-3 grid sm:grid-cols-2 gap-2 text-[10px] font-bold">
                {[
                  ['BPM não preenchido', preflight.missingBpm],
                  ['Tom não preenchido', preflight.missingKey],
                  ['Sem estrutura', preflight.missingStructure],
                  ['Letra em modo livre', preflight.freeLyrics],
                  ['Cifra ainda sem posição sobre palavras', preflight.chordsWithoutPositions],
                ].map(([label, count]) => (
                  <div key={String(label)} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 flex items-center justify-between gap-3">
                    <span className="text-zinc-400">{String(label)}</span>
                    <span className={Number(count) ? 'text-yellow-300' : 'text-emerald-300'}>{Number(count) || 'OK'}</span>
                  </div>
                ))}
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 flex items-center justify-between gap-3">
                  <span className="text-zinc-400">Identidade ativa</span>
                  <span className={activeMember?.nome ? 'text-emerald-300' : 'text-yellow-300'}>{activeMember?.nome || 'Não selecionada'}</span>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setPreflightOpen(false)}
                className="flex-1 min-h-14 rounded-2xl bg-blue-600 text-white font-black uppercase tracking-[0.16em] text-xs active:scale-[0.99]"
              >
                Entrar no Live
              </button>
              <button
                onClick={() => router.back()}
                className="sm:w-44 min-h-14 rounded-2xl border border-white/10 bg-white/5 text-zinc-400 font-black uppercase tracking-wider text-[10px]"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OVERLAY COUNTDOWN */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-md flex items-center justify-center">
          <div className="text-[clamp(120px,26vw,260px)] font-black italic text-white drop-shadow-[0_0_40px_rgba(59,130,246,0.35)] animate-pulse">
            {countdown}
          </div>
        </div>
      )}

      {stageNotice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[280] px-4 py-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/15 backdrop-blur-xl text-[10px] sm:text-xs font-black uppercase tracking-widest text-emerald-200 shadow-2xl">
          {stageNotice}
        </div>
      )}

      {/* BARRA PROGRESSO */}
      <div className="h-1.5 w-full bg-white/5 z-50">
        <div className="h-full bg-blue-500 transition-all duration-75 shadow-[0_0_15px_#3b82f6]" style={{ width: `${progresso}%` }} />
      </div>

      {/* HEADER */}
      <header className={cn('px-2 sm:px-3 py-2 sm:py-3 flex justify-between items-center bg-black border-b border-white/5 z-50', chromeClass)}>
        <div className="flex items-center gap-2">
          <button onClick={() => router.back()} className="p-2 bg-white/5 rounded-xl">
            <ArrowLeft size={18} />
          </button>

          {/* FULLSCREEN */}
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-white/5 rounded-xl text-zinc-300 hover:bg-white/10"
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

        </div>

        <div className="text-center">
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{eventoInfo?.local}</p>
          <h1 className="text-sm font-black uppercase truncate max-w-[220px] sm:max-w-[320px]">{musicaAtual?.titulo || '—'}</h1>
          <div className="mt-0.5 flex items-center justify-center gap-2">
            <div className="px-2 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center gap-1">
              <Gauge size={12} className="text-yellow-400" />
              <span className="text-[10px] font-black text-yellow-300">{effectiveBpm}</span>
            </div>

            <div
              className={cn(
                'px-2 py-1 rounded-lg border text-[9px] font-black uppercase tracking-widest flex items-center gap-1',
                connected
                  ? 'border-green-500/25 bg-green-500/10 text-green-300'
                  : networkOnline
                  ? 'border-white/10 bg-white/5 text-zinc-400'
                  : 'border-amber-500/25 bg-amber-500/10 text-amber-300'
              )}
              title={connected ? 'Realtime conectado' : networkOnline ? 'Sem Realtime — modo local' : 'Sem internet — música continua localmente'}
            >
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {connected ? 'SYNC' : networkOnline ? 'LOCAL' : 'OFFLINE'}
            </div>
            {loadedFromCache && (
              <div className="px-2 py-1 rounded-lg border border-amber-500/20 bg-amber-500/10 text-[8px] font-black uppercase tracking-wider text-amber-300">
                Cache
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* LOCK UI */}
          <button
            onClick={() => setLockUI((v) => !v)}
            className={cn(
              'p-2 rounded-xl border transition-all',
              lockUI ? 'bg-red-500/10 border-red-500/25 text-red-300' : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
            )}
            title={lockUI ? 'Destravar UI' : 'Travar UI'}
          >
            {lockUI ? <Lock size={18} /> : <Unlock size={18} />}
          </button>

          {/* PLAY */}
          <button
            onClick={togglePlay}
            disabled={lockUI}
            className={cn(
              'p-3 rounded-full transition-all',
              autoScroll || countdown !== null ? 'bg-red-600' : 'bg-blue-600',
              lockUI ? 'opacity-40' : 'active:scale-95'
            )}
            title={autoScroll ? 'Pausar' : 'Iniciar (com contagem e sync)'}
          >
            {autoScroll || countdown !== null ? <Pause size={20} fill="white" /> : <Play size={20} fill="white" />}
          </button>
        </div>
      </header>

      {/* PREFERÊNCIAS DE EXIBIÇÃO — salvas por membro neste aparelho */}
      <div
        data-live-toolbar="true"
        className={cn('bg-black/95 border-b border-white/5 px-2 sm:px-4 py-1.5 z-40 overflow-x-auto no-scrollbar', chromeClass)}
      >
        <div className="min-w-max mx-auto flex items-center justify-center gap-2">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button
              disabled={lockUI}
              onClick={() => setViewMode('chords')}
              className={cn(
                'min-h-9 px-3 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
                viewMode === 'chords' ? 'bg-yellow-500/15 text-yellow-300' : 'text-zinc-400 hover:bg-white/5',
                lockUI ? 'opacity-40' : ''
              )}
              title="Somente cifra"
            >
              <Music size={13} /> Cifra
            </button>
            <button
              disabled={lockUI}
              onClick={() => setViewMode('both')}
              className={cn(
                'min-h-9 px-3 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
                viewMode === 'both' ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-400 hover:bg-white/5',
                lockUI ? 'opacity-40' : ''
              )}
              title="Cifra acima da letra"
            >
              <LayoutGrid size={13} /> Cifra + letra
            </button>
            <button
              disabled={lockUI}
              onClick={() => setViewMode('lyrics')}
              className={cn(
                'min-h-9 px-3 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all',
                viewMode === 'lyrics' ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-400 hover:bg-white/5',
                lockUI ? 'opacity-40' : ''
              )}
              title="Somente letra"
            >
              <Type size={13} /> Letra
            </button>
          </div>

          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button
              disabled={lockUI}
              onClick={() => setPresentationMode('slides')}
              className={cn(
                'min-h-9 px-3 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all',
                presentationMode === 'slides' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300',
                lockUI ? 'opacity-40' : ''
              )}
            >
              Slides
            </button>
            <button
              disabled={lockUI}
              onClick={() => setPresentationMode('scroll')}
              className={cn(
                'min-h-9 px-3 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all',
                presentationMode === 'scroll' ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300',
                lockUI ? 'opacity-40' : ''
              )}
            >
              Rolagem
            </button>
          </div>

          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button disabled={lockUI} onClick={() => setFontScale((v) => Math.max(0.75, Math.round((v - 0.1) * 100) / 100))} className="min-h-9 px-2.5 rounded-lg text-[10px] font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">A−</button>
            <button disabled={lockUI} onClick={() => setFontScale(1)} className="min-h-9 px-2 rounded-lg text-[9px] font-black text-zinc-500 hover:text-white disabled:opacity-40">{Math.round(fontScale * 100)}%</button>
            <button disabled={lockUI} onClick={() => setFontScale((v) => Math.min(1.5, Math.round((v + 0.1) * 100) / 100))} className="min-h-9 px-2.5 rounded-lg text-[10px] font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">A+</button>
          </div>

          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button disabled={lockUI} onClick={() => setFocusRatio((v) => Math.max(0.2, Math.round((v - 0.04) * 100) / 100))} className="min-h-9 px-2.5 rounded-lg text-xs font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">↑</button>
            <button disabled={lockUI} onClick={() => setFocusRatio(0.34)} className="min-h-9 px-2 rounded-lg text-[9px] font-black text-zinc-500 hover:text-white disabled:opacity-40">LINHA {Math.round(focusRatio * 100)}%</button>
            <button disabled={lockUI} onClick={() => setFocusRatio((v) => Math.min(0.55, Math.round((v + 0.04) * 100) / 100))} className="min-h-9 px-2.5 rounded-lg text-xs font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">↓</button>
          </div>

          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button disabled={lockUI} onClick={() => setVisualTimingOffsetMs((v) => Math.max(-1500, v - 100))} className="min-h-9 px-2.5 rounded-lg text-[9px] font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">−0.1s</button>
            <button disabled={lockUI} onClick={() => setVisualTimingOffsetMs(0)} className="min-h-9 px-2 rounded-lg text-[9px] font-black text-amber-300 hover:bg-white/5 disabled:opacity-40">AJUSTE {visualTimingOffsetMs >= 0 ? '+' : ''}{(visualTimingOffsetMs / 1000).toFixed(1)}s</button>
            <button disabled={lockUI} onClick={() => setVisualTimingOffsetMs((v) => Math.min(1500, v + 100))} className="min-h-9 px-2.5 rounded-lg text-[9px] font-black text-zinc-300 hover:bg-white/5 disabled:opacity-40">+0.1s</button>
          </div>

          <button
            disabled={lockUI}
            onClick={() => setShowMemberNotes((v) => !v)}
            className={cn(
              'min-h-9 px-3 rounded-xl border text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-40',
              showMemberNotes ? 'border-violet-500/25 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-white/5 text-zinc-500'
            )}
            title="Mostrar/ocultar minha anotação nesta música"
          >
            <StickyNote size={12} /> Notas
          </button>

          <span className="hidden lg:inline text-[8px] font-black uppercase tracking-[0.16em] text-zinc-600">
            Preferências salvas neste aparelho
          </span>
        </div>
      </div>

      {/* PALCO — mesmo renderer usado no Preview e no Ensaio */}
      <main className={cn('relative flex-1 min-h-0 flex flex-col gap-2 sm:gap-4', pagePad)}>
        <SongStageRenderer
          blocks={stageBlocks}
          activeBlockIndex={blocoAtivo}
          activeMeasureIndex={subChordIndex}
          activeMeasureProgress={activeMeasureProgress}
          viewMode={viewMode}
          presentationMode={presentationMode}
          semitones={semitons}
          fontScale={fontScale}
          focusRatio={focusRatio}
          autoScroll={autoScroll}
          className="w-full"
        />

        {showMemberNotes && currentMemberNote && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-30 w-[min(92%,760px)] rounded-2xl border border-violet-400/20 bg-violet-950/80 backdrop-blur-xl px-4 py-3 shadow-2xl pointer-events-none">
            <div className="flex items-start gap-3">
              <StickyNote size={15} className="text-violet-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-300/70">
                  Minha nota{activeMember?.nome ? ` • ${activeMember.nome}` : ''}
                </p>
                <p className="mt-1 text-sm sm:text-base font-bold leading-snug text-violet-50 whitespace-pre-wrap break-words">
                  {currentMemberNote}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className={cn('px-2 sm:px-4 py-3 sm:py-4 bg-black border-t border-white/5 flex items-center justify-between gap-2', chromeClass)}>
        {/* Transposição */}
        <div className="flex items-center gap-2">
          <button disabled={lockUI} onClick={() => setSemitons((s) => s - 1)} className="size-10 bg-white/5 rounded-xl font-black text-xl disabled:opacity-40">
            -
          </button>
          <div className="px-2 sm:px-4 text-center">
            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Tom</p>
            <p className="text-lg font-black text-yellow-500 leading-none">{transpor(musicaAtual?.tom || 'C', semitons)}</p>
          </div>
          <button disabled={lockUI} onClick={() => setSemitons((s) => s + 1)} className="size-10 bg-white/5 rounded-xl font-black text-xl disabled:opacity-40">
            +
          </button>
        </div>

        {/* Centro */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button disabled={lockUI || indexMusicaAtual === 0} onClick={prevSong} className="p-3 bg-white/5 rounded-2xl disabled:opacity-10">
            <ChevronLeft />
          </button>

          <div className={cn('bg-blue-600 px-4 sm:px-6 py-2 rounded-2xl text-center shadow-lg', isMobile ? 'min-w-[150px]' : 'min-w-[190px]')}>
            <p className="text-[8px] font-black text-blue-200 uppercase leading-none mb-1">
              {indexMusicaAtual + 1} / {musicas.length} • Bloco {Math.min(blocoAtivo + 1, Math.max(1, estruturaAtual.length))}
            </p>
            <p className="font-black italic uppercase text-[10px] truncate leading-none">{musicaAtual?.titulo || '—'}</p>
            <p className={cn('mt-1 text-[8px] font-black uppercase tracking-wider truncate', queuedMusica ? 'text-amber-200' : 'text-blue-200/70')}>
              {queuedMusica
                ? `Na fila: ${queuedMusica.titulo || 'música preparada'}`
                : `Próximo: ${blocoSeguinte ? blockLabel(blocoSeguinte) : 'Fim'}`}
            </p>
          </div>

          <button disabled={lockUI || (!queuedMusicaId && indexMusicaAtual === musicas.length - 1)} onClick={nextSong} className="p-3 bg-white/5 rounded-2xl disabled:opacity-10">
            <ChevronRight />
          </button>
        </div>

        {/* Direita */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            disabled={lockUI || blocoAtivo <= 0}
            onClick={prevBlock}
            className="min-h-11 px-3 rounded-2xl border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-wider text-zinc-200 disabled:opacity-20"
            title="Bloco anterior"
          >
            ← Bloco
          </button>
          <button
            disabled={lockUI || blocoAtivo >= estruturaAtual.length - 1}
            onClick={nextBlock}
            className="min-h-11 px-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 text-[9px] font-black uppercase tracking-wider text-blue-200 disabled:opacity-20"
            title="Próximo bloco"
          >
            Bloco →
          </button>
          <button
            disabled={lockUI}
            onClick={restartCurrentBlock}
            className={cn(
              'px-3 sm:px-4 py-3 rounded-2xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all',
              'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10 active:scale-95',
              lockUI ? 'opacity-40' : ''
            )}
            title="Reiniciar o tempo do bloco atual"
          >
            <RotateCcw size={16} className="text-blue-300" />
            Iniciar bloco
          </button>

          <button
            disabled={lockUI}
            onClick={() => setMenuAberto(true)}
            className="p-4 bg-red-600 rounded-2xl shadow-xl active:scale-90 transition-transform disabled:opacity-40"
            title="Menu de emergência"
          >
            <ListMusic size={24} />
          </button>
        </div>
      </footer>

      {/* MODAL EMERGÊNCIA */}
      {menuAberto && (
        <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-xl p-4 sm:p-8 flex flex-col animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-blue-500 font-black uppercase tracking-[0.4em] text-xs">Troca Rápida</h2>
              <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-zinc-600">
                {networkOnline ? 'Repertório + cache local disponíveis' : 'Offline: usando músicas já preparadas neste aparelho'}
              </p>
            </div>
            <button onClick={() => setMenuAberto(false)}>
              <XCircle size={32} className="text-zinc-500" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 mb-4 sm:mb-5 flex-wrap">
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-2xl p-1">
              <button
                onClick={() => setQuickTab('songs')}
                className={cn(
                  'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                  quickTab === 'songs' ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-500'
                )}
              >
                Músicas
              </button>
              <button
                onClick={() => setQuickTab('history')}
                className={cn(
                  'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
                  quickTab === 'history' ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-500'
                )}
              >
                Histórico {showHistory.length ? `(${showHistory.length})` : ''}
              </button>
            </div>

            <div className="flex items-center gap-2">
              {queuedMusica && (
                <div className="px-3 py-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 text-[9px] font-black uppercase tracking-wider text-amber-200 max-w-[52vw] truncate">
                  Próxima: {queuedMusica.titulo}
                </div>
              )}
              <button
                onClick={() => setLockUI(false)}
                className="px-4 py-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15"
              >
                <Unlock size={16} className="text-green-400" /> Destravar
              </button>
              <button
                onClick={() => stopShow()}
                className="px-4 py-2 rounded-2xl border border-red-500/25 bg-red-500/10 text-red-300 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/15 transition-all"
              >
                Parar Tudo
              </button>
            </div>
          </div>

          {quickTab === 'songs' ? (
            <>
              <div className="relative mb-4 sm:mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={buscaMenu}
                  onChange={(e) => setBuscaMenu(e.target.value)}
                  placeholder="Pesquisar música ou artista..."
                  className="w-full bg-white/5 border border-white/10 p-4 sm:p-5 pl-12 rounded-2xl text-base sm:text-lg font-bold outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-8 pr-2 pb-8">
                {gruposTrocaRapida.map((grupo) => (
                  <section key={grupo.label}>
                    <div className="sticky top-0 z-10 bg-black/95 py-2 mb-2 flex items-center justify-between gap-3">
                      <h3 className={cn(
                        'text-[10px] sm:text-xs font-black uppercase tracking-[0.22em]',
                        grupo.tone === 'amber' ? 'text-amber-300' :
                        grupo.tone === 'green' ? 'text-emerald-300' :
                        grupo.tone === 'purple' ? 'text-violet-300' :
                        grupo.tone === 'blue' ? 'text-blue-300' : 'text-zinc-400'
                      )}>
                        {grupo.label}
                      </h3>
                      <span className="text-[9px] font-black text-zinc-600 uppercase">{grupo.items.length} músicas</span>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {grupo.items.map((m: any) => {
                        const i = indiceMusicaNoSetlist.get(String(m.id)) ?? -1;
                        const inSetlist = originalSetlistIdsRef.current.has(String(m.id));
                        const loadingThis = quickLoadingId === String(m.id);
                        const queuedThis = queuedMusicaId === String(m.id);
                        const isPinned = pinnedSongIds.has(String(m.id));
                        const stats = songStats[String(m.id)] || { plays: 0, requests: 0, lastPlayedAt: null };
                        return (
                          <div
                            key={`${grupo.label}-${m.id}`}
                            className={cn(
                              'w-full p-4 sm:p-5 border rounded-[1.5rem] flex flex-col sm:flex-row sm:items-center gap-4 transition-all',
                              queuedThis
                                ? 'bg-amber-500/10 border-amber-400/30'
                                : inSetlist
                                ? 'bg-white/5 border-white/10'
                                : 'bg-yellow-500/5 border-yellow-500/15'
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className={cn('text-[9px] font-black uppercase tracking-widest', inSetlist ? 'text-blue-400/70' : 'text-yellow-500/70')}>
                                  {inSetlist ? 'SETLIST DE HOJE' : 'REQUEST / FORA DO SETLIST'}
                                </span>
                                {m?.categoria && (
                                  <span className="text-[8px] font-black uppercase tracking-wider text-zinc-500">{m.categoria}</span>
                                )}
                                {queuedThis && (
                                  <span className="text-[8px] font-black uppercase tracking-wider text-amber-300">NA FILA</span>
                                )}
                              </div>
                              <span className="block text-base sm:text-lg font-black uppercase italic break-words">
                                {m.titulo}
                              </span>
                              {m?.artista && (
                                <span className="block mt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 truncate">
                                  {m.artista}
                                </span>
                              )}
                              <span className="block mt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-600">
                                {m?.tom ? `Tom ${m.tom}` : 'Tom —'} {m?.bpm ? `• ${m.bpm} BPM` : ''}
                              </span>
                              {(stats.plays > 0 || stats.requests > 0) && (
                                <span className="block mt-2 text-[8px] font-black uppercase tracking-wider text-zinc-500">
                                  {stats.plays} tocada{stats.plays === 1 ? '' : 's'}
                                  {stats.requests > 0 ? ` • ${stats.requests} request${stats.requests === 1 ? '' : 's'}` : ''}
                                  {stats.lastPlayedAt ? ` • ${new Date(stats.lastPlayedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}
                                </span>
                              )}
                                </div>
                                <button
                                  onClick={() => void togglePinnedSong(String(m.id))}
                                  className={cn(
                                    'shrink-0 size-9 rounded-xl border flex items-center justify-center transition-all',
                                    isPinned
                                      ? 'border-amber-400/30 bg-amber-400/15 text-amber-300'
                                      : 'border-white/10 bg-white/5 text-zinc-600 hover:text-amber-300'
                                  )}
                                  title={isPinned ? 'Remover das fixadas' : 'Fixar na Troca Rápida'}
                                >
                                  <Star size={15} fill={isPinned ? 'currentColor' : 'none'} />
                                </button>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-2 sm:flex-col sm:min-w-[132px]">
                              <button
                                disabled={!!quickLoadingId}
                                onClick={() => {
                                  if (i >= 0) {
                                    bumpPedido(String(m.id));
                                    void saltarParaIndex(i);
                                  } else {
                                    void saltarParaMusicaRapida(String(m.id));
                                  }
                                }}
                                className="flex-1 sm:w-full min-h-10 px-3 rounded-xl bg-blue-600 text-[9px] font-black uppercase tracking-wider text-white disabled:opacity-50 active:scale-95"
                              >
                                {loadingThis ? 'Abrindo…' : 'Tocar agora'}
                              </button>
                              <button
                                disabled={!!quickLoadingId || queuedThis}
                                onClick={() => void colocarComoProxima(String(m.id))}
                                className="flex-1 sm:w-full min-h-10 px-3 rounded-xl border border-amber-500/25 bg-amber-500/10 text-[9px] font-black uppercase tracking-wider text-amber-200 disabled:opacity-40 active:scale-95"
                              >
                                {queuedThis ? 'Preparada' : 'Próxima'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}

                {gruposTrocaRapida.length === 0 && (
                  <div className="py-16 text-center text-zinc-600 font-black uppercase tracking-widest text-xs">
                    Nenhuma música encontrada
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-8">
              <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4 text-center">
                  <p className="text-xl sm:text-2xl font-black">{showHistory.length}</p>
                  <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-zinc-500">execuções</p>
                </div>
                <div className="rounded-2xl border border-yellow-500/15 bg-yellow-500/5 p-3 sm:p-4 text-center">
                  <p className="text-xl sm:text-2xl font-black text-yellow-300">{historyStats.requests}</p>
                  <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-zinc-500">requests</p>
                </div>
                <div className="rounded-2xl border border-violet-500/15 bg-violet-500/5 p-3 sm:p-4 text-center">
                  <p className="text-xl sm:text-2xl font-black text-violet-300">{historyStats.unique}</p>
                  <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-wider text-zinc-500">músicas únicas</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-zinc-600">
                  Janela entre primeira e última entrada: ~{historyStats.spanMinutes} min
                </p>
                {showHistory.length > 0 && (
                  <button
                    onClick={() => {
                      if (confirm('Limpar o histórico local deste show?')) setShowHistory([]);
                    }}
                    className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/5 text-[8px] font-black uppercase tracking-wider text-red-300"
                  >
                    Limpar
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {[...showHistory].reverse().map((entry, reverseIndex) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 flex items-center gap-4">
                    <div className="shrink-0 w-14 text-center">
                      <p className="text-sm font-black text-blue-300">
                        {new Date(entry.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-[8px] font-black uppercase tracking-wider text-zinc-600">
                        #{showHistory.length - reverseIndex}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black uppercase italic break-words">{entry.titulo}</p>
                        {entry.avulsa && (
                          <span className="px-2 py-1 rounded-lg bg-yellow-500/10 text-[8px] font-black uppercase tracking-wider text-yellow-300">Request</span>
                        )}
                      </div>
                      <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 truncate">
                        {entry.artista || 'Artista não informado'} {entry.tom ? `• Tom ${entry.tom}` : ''} {entry.bpm ? `• ${entry.bpm} BPM` : ''}
                      </p>
                    </div>
                  </div>
                ))}

                {showHistory.length === 0 && (
                  <div className="py-16 text-center text-zinc-600 font-black uppercase tracking-widest text-xs">
                    O histórico começa quando uma música entra em execução
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
