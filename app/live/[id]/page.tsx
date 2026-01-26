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
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

type ViewMode = 'both' | 'chords' | 'lyrics';

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
      viewMode: ViewMode;
    }
  | { kind: 'PAUSE'; senderId: string }
  | {
      kind: 'GOTO';
      senderId: string;
      indexMusicaAtual: number;
      blocoAtivo: number;
    }
  | { kind: 'PING'; senderId: string; pingId: string; t0: number } // t0 no relógio do follower
  | { kind: 'PONG'; senderId: string; pingId: string; t0: number; t1: number }; // t1 no relógio do “referência”

function genId() {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
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
  const [repertorioGeral, setRepertorioGeral] = useState<any[]>([]);

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
  const [bpmOverride] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [buscaMenu, setBuscaMenu] = useState('');
  const [lockUI, setLockUI] = useState(false);

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

  // Highlight acorde
  const [subChordIndex, setSubChordIndex] = useState(0);
  const subChordIndexRef = useRef(0);

  // ============== HELPERS ==============
  const cn = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(' ');

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
      e.preventDefault();
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      document.documentElement.style.overflow = prevOverflow;
      document.body.style.overflow = prevBodyOverflow;
      (document.documentElement.style as any).overscrollBehaviorY = prevOverscroll;
      document.removeEventListener('touchmove', onTouchMove as any);
    };
  }, [lockGesturesEnabled]);

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
    }, 700);

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
            await sendSync({
              kind: 'PONG',
              senderId: clientIdRef.current,
              pingId: msg.pingId,
              t0: msg.t0,
              t1: Date.now(), // tempo da referência
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

        // ====== PAUSE ======
        if (msg.kind === 'PAUSE') {
          await pauseShow();
          return;
        }

        // ====== GOTO ======
        if (msg.kind === 'GOTO') {
          await pauseShow();
          setIndexMusicaAtual(msg.indexMusicaAtual);
          setBlocoAtivo(msg.blocoAtivo);
          setProgresso(0);
          subChordIndexRef.current = 0;
          setSubChordIndex(0);
          blockStartEpochRef.current = null;
          return;
        }

        // ====== START ======
        if (msg.kind === 'START') {
          // Quem mandou START vira referência atual
          isReferenceRef.current = false;
          referenceIdRef.current = msg.maestroId;

          setSemitons(msg.semitons ?? 0);
          setViewMode(msg.viewMode ?? 'both');
          setIndexMusicaAtual(msg.indexMusicaAtual);
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

    ch.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED');
    });

    return () => {
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
      viewMode,
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
    viewMode,
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
    [lockUI, musicas.length, pauseShow, sendSync]
  );

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
    if (indexMusicaAtual >= musicas.length - 1) return;

    const nextIndex = indexMusicaAtual + 1;
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
  }, [lockUI, indexMusicaAtual, musicas.length, pauseShow, sendSync]);

  // ================== ENGINE RAF ==================
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    const step = () => {
      if (!autoScroll) return;

      const item = estruturaAtual?.[blocoAtivo];
      if (!item?.bloco) return;

      const duracao = getBlockDurationMs(item.bloco);
      const now = Date.now();

      if (blockStartEpochRef.current === null) blockStartEpochRef.current = now;

      let elapsed = now - blockStartEpochRef.current;
      if (elapsed > duracao * 1.5) {
        blockStartEpochRef.current = now;
        elapsed = 0;
      }

      const progress01 = Math.max(0, Math.min(1, elapsed / duracao));
      setProgresso(progress01 * 100);

      const acordesStr = String(item.bloco?.acordes || '');
      const acordesArr = acordesStr ? acordesStr.split(' | ').map((s) => s.trim()).filter(Boolean) : [];
      const n = Math.max(1, acordesArr.length);
      const nextSub = Math.min(n - 1, Math.floor(progress01 * n));
      if (nextSub !== subChordIndexRef.current) {
        subChordIndexRef.current = nextSub;
        setSubChordIndex(nextSub);
      }

      if (progress01 >= 1) {
        if (blocoAtivo < estruturaAtual.length - 1) {
          setBlocoAtivo((p) => p + 1);
          blockStartEpochRef.current = now;
          subChordIndexRef.current = 0;
          setSubChordIndex(0);
        } else if (indexMusicaAtual < musicas.length - 1) {
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
  }, [autoScroll, estruturaAtual, blocoAtivo, indexMusicaAtual, musicas.length, getBlockDurationMs, pauseShow]);

  // ================== LOAD DATA ==================
  useEffect(() => {
    let alive = true;

    async function carregar() {
      try {
        const { data: ev } = await supabase.from('eventos').select('*').eq('id', id).single();
        if (!alive) return;
        setEventoInfo(ev);

        const { data: it } = await supabase
          .from('evento_repertorio')
          .select(`ordem, musica:repertorio (*, estrutura:musica_estrutura (posicao, bloco:musica_blocos(*)))`)
          .eq('evento_id', id)
          .order('ordem');

        if (!alive) return;

        if (it) {
          setMusicas(
            it.map((x: any) => ({
              ...x,
              estrutura: x.musica?.estrutura?.sort((a: any, b: any) => a.posicao - b.posicao) || [],
            }))
          );
        }

        const { data: ger } = await supabase.from('repertorio').select('id, titulo').order('titulo');
        if (alive && ger) setRepertorioGeral(ger);

        if (alive) setLoading(false);
      } catch (e) {
        console.error(e);
        if (alive) setLoading(false);
      }
    }

    carregar();
    return () => {
      alive = false;
    };
  }, [id]);

  // ================== LOCK: não mata mais ==================
  useEffect(() => {
    if (!lockUI) return;
    pauseShow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockUI]);

  // ================== MEMOS P/ RENDER ==================
  const acordesAtuaisArr = useMemo(() => {
    const s = String(blocoAtual?.acordes || '');
    if (!s) return [];
    return s.split(' | ').map((x) => x.trim()).filter(Boolean);
  }, [blocoAtual?.acordes]);

  const acordesGhostArr = useMemo(() => {
    const s = String(blocoSeguinte?.acordes || '');
    if (!s) return [];
    return s.split(' | ').map((x) => x.trim()).filter(Boolean).slice(0, 4);
  }, [blocoSeguinte?.acordes]);

  const letraAtual = useMemo(() => String(blocoAtual?.letra || ''), [blocoAtual?.letra]);
  const letraGhost = useMemo(() => {
    const s = String(blocoSeguinte?.letra || '');
    return s ? s.split('\n')[0] : '';
  }, [blocoSeguinte?.letra]);

  // ================== RENDER ==================
  if (loading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center text-blue-500 font-black italic animate-pulse">
        CARREGANDO PALCO...
      </div>
    );
  }

  const showChords = viewMode === 'both' || viewMode === 'chords';
  const showLyrics = viewMode === 'both' || viewMode === 'lyrics';

  const pagePad = isMobile ? 'p-2' : 'p-4';

  const chordActiveClass = 'text-[clamp(52px,12vw,110px)]';
  const chordIdleClass = 'text-[clamp(44px,10vw,88px)]';
  const lyricClass = 'text-[clamp(22px,5.0vw,44px)]';
  const ghostLyricClass = 'text-[clamp(18px,4.2vw,34px)]';

  const chordsMinH = viewMode === 'both' && isMobile ? 'min-h-[92px]' : 'min-h-[120px]';
  const lyricsMinH = viewMode === 'both' && isMobile ? 'min-h-[110px]' : 'min-h-[140px]';

  return (
    <div ref={containerRef} className="h-screen w-screen bg-zinc-950 text-white overflow-hidden flex flex-col font-sans select-none">
      {/* OVERLAY COUNTDOWN */}
      {countdown !== null && (
        <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-md flex items-center justify-center">
          <div className="text-[clamp(120px,26vw,260px)] font-black italic text-white drop-shadow-[0_0_40px_rgba(59,130,246,0.35)] animate-pulse">
            {countdown}
          </div>
        </div>
      )}

      {/* BARRA PROGRESSO */}
      <div className="h-1.5 w-full bg-white/5 z-50">
        <div className="h-full bg-blue-500 transition-all duration-75 shadow-[0_0_15px_#3b82f6]" style={{ width: `${progresso}%` }} />
      </div>

      {/* HEADER */}
      <header className="px-2 sm:px-3 py-2 sm:py-3 flex justify-between items-center bg-black border-b border-white/5 z-50">
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

          {/* VIEW MODE */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button
              disabled={lockUI}
              onClick={() => setViewMode('chords')}
              className={cn(
                'px-2.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 transition-all',
                viewMode === 'chords' ? 'bg-yellow-500/15 text-yellow-300' : 'text-zinc-400 hover:bg-white/5',
                lockUI ? 'opacity-40' : ''
              )}
              title="Somente acordes"
            >
              <Music size={14} />
            </button>
            <button
              disabled={lockUI}
              onClick={() => setViewMode('both')}
              className={cn(
                'px-2.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 transition-all',
                viewMode === 'both' ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-400 hover:bg-white/5',
                lockUI ? 'opacity-40' : ''
              )}
              title="Acordes + letra"
            >
              <LayoutGrid size={14} />
            </button>
            <button
              disabled={lockUI}
              onClick={() => setViewMode('lyrics')}
              className={cn(
                'px-2.5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 transition-all',
                viewMode === 'lyrics' ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-400 hover:bg-white/5',
                lockUI ? 'opacity-40' : ''
              )}
              title="Somente letra"
            >
              <Type size={14} />
            </button>
          </div>
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
                connected ? 'border-green-500/25 bg-green-500/10 text-green-300' : 'border-white/10 bg-white/5 text-zinc-400'
              )}
              title={connected ? 'Realtime conectado' : 'Realtime desconectado'}
            >
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {connected ? 'SYNC' : 'LOCAL'}
            </div>
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

      {/* QUADRANTES */}
      <main className={cn('flex-1 flex flex-col gap-2 sm:gap-4', pagePad)}>
        {/* HARMONIA */}
        {showChords && (
          <div className={cn('bg-zinc-900/40 rounded-[2rem] sm:rounded-[2.5rem] border border-white/5 flex flex-col overflow-hidden relative', showLyrics ? 'flex-1' : 'flex-[2]')}>
            <div className="absolute top-3 sm:top-4 left-5 sm:left-6 flex items-center gap-2 text-yellow-500/50 text-[10px] font-black uppercase tracking-widest">
              <Music size={12} /> Harmonia
            </div>

            <div className="flex-1 flex flex-col items-center justify-center">
              <div className={cn('flex flex-wrap justify-center gap-x-6 sm:gap-x-8 gap-y-2 items-center px-4 sm:px-6', chordsMinH)}>
                {acordesAtuaisArr.length > 0 ? (
                  acordesAtuaisArr.map((ac: string, i: number) => {
                    const ativo = autoScroll && i === subChordIndex;
                    return (
                      <span
                        key={`${ac}-${i}`}
                        className={cn(
                          'font-mono font-black transition-all duration-200',
                          ativo
                            ? cn('text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.35)]', chordActiveClass)
                            : cn('text-yellow-500/20', chordIdleClass)
                        )}
                      >
                        {transpor(ac, semitons)}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-yellow-500/25 text-[48px] md:text-[64px] font-black italic">—</span>
                )}
              </div>

              <div className={cn('opacity-40 flex gap-4 sm:gap-6 items-center border-t border-white/5 w-full justify-center mt-2 sm:mt-4 px-4 sm:px-6', isMobile ? 'h-[56px]' : 'h-[70px]')}>
                <span className="text-[20px] sm:text-[30px] font-black bg-white/10 px-2 py-0.5 rounded text-white">{blocoSeguinte?.tipo || 'FIM'}</span>
                {acordesGhostArr.map((ac: string, i: number) => (
                  <span key={`${ac}-${i}`} className="font-mono font-black text-[clamp(24px,6vw,64px)] text-yellow-500">
                    {transpor(ac, semitons)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* LETRA */}
        {showLyrics && (
          <div className={cn('bg-zinc-900/40 rounded-[2rem] sm:rounded-[2.5rem] border border-white/5 flex flex-col overflow-hidden relative', showChords ? 'flex-1' : 'flex-[2]')}>
            <div className="absolute top-3 sm:top-4 left-5 sm:left-6 flex items-center gap-2 text-blue-500/50 text-[10px] font-black uppercase tracking-widest">
              <Type size={12} /> Letra
            </div>

            <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8">
              <div className={cn('flex items-center justify-center text-center', lyricsMinH)}>
                <p className={cn('text-white font-bold leading-tight drop-shadow-lg whitespace-pre-line', lyricClass)}>
                  {letraAtual ? letraAtual : '— INSTRUMENTAL —'}
                </p>
              </div>

              <div className={cn('opacity-20 border-t border-white/5 w-full flex items-center justify-center mt-2', isMobile ? 'h-[44px]' : 'h-[50px]')}>
                <p className={cn('text-white font-medium italic truncate max-w-[86vw]', ghostLyricClass)}>{letraGhost ? letraGhost : '...'}</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="px-2 sm:px-4 py-3 sm:py-4 bg-black border-t border-white/5 flex items-center justify-between gap-2">
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
          </div>

          <button disabled={lockUI || indexMusicaAtual === musicas.length - 1} onClick={nextSong} className="p-3 bg-white/5 rounded-2xl disabled:opacity-10">
            <ChevronRight />
          </button>
        </div>

        {/* Direita */}
        <div className="flex items-center gap-2 sm:gap-3">
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
          <div className="flex justify-between items-center mb-4 sm:mb-6">
            <h2 className="text-blue-500 font-black uppercase tracking-[0.4em] text-xs">Troca Rápida</h2>
            <button onClick={() => setMenuAberto(false)}>
              <XCircle size={32} className="text-zinc-500" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 mb-4 sm:mb-6">
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

          <div className="relative mb-4 sm:mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              value={buscaMenu}
              onChange={(e) => setBuscaMenu(e.target.value)}
              placeholder="Pesquisar música..."
              className="w-full bg-white/5 border border-white/10 p-4 sm:p-5 pl-12 rounded-2xl text-base sm:text-lg font-bold outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {repertorioGeral
              .filter((m) => String(m.titulo || '').toLowerCase().includes(buscaMenu.toLowerCase()))
              .map((m) => {
                const i = musicas.findIndex((x) => x?.musica?.id === m.id);
                const inSetlist = i >= 0;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (inSetlist) saltarParaIndex(i);
                      else alert('Música não está no setlist de hoje');
                    }}
                    className={cn(
                      'w-full p-4 sm:p-6 border rounded-[2rem] flex justify-between items-center transition-all group',
                      inSetlist ? 'bg-white/5 border-white/10 hover:bg-blue-600/10' : 'bg-yellow-500/5 border-yellow-500/15 hover:bg-yellow-500/10'
                    )}
                  >
                    <div className="text-left">
                      <span className={cn('block text-[10px] font-black uppercase tracking-widest', inSetlist ? 'text-zinc-500' : 'text-yellow-500/60')}>
                        {inSetlist ? 'NO SETLIST' : 'FORA DO SETLIST'}
                      </span>
                      <span className={cn('text-lg sm:text-xl font-black uppercase italic', inSetlist ? 'group-hover:text-blue-400' : 'group-hover:text-yellow-400')}>
                        {m.titulo}
                      </span>
                    </div>
                    <ChevronRight className={cn('text-zinc-600', inSetlist ? 'group-hover:text-blue-500' : 'group-hover:text-yellow-500')} />
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
