'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  LayoutGrid,
  Music,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Type,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import SongStageRenderer from '@/components/SongStageRenderer';
import { clampStage, type StageBlockInput, type StagePresentationMode, type StageViewMode } from '@/lib/songStage';

type SongPreviewModalProps = {
  open: boolean;
  onClose: () => void;
  titulo: string;
  bpm: number;
  timeline: StageBlockInput[];
};

type MeasureRef = {
  blockIndex: number;
  measureInBlock: number;
};

const BEATS_PER_MEASURE = 4;
const UI_INTERVAL_MS = 50;

function formatTime(ms: number) {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const tenths = Math.floor((safe % 1_000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export default function SongPreviewModal({ open, onClose, titulo, bpm, timeline }: SongPreviewModalProps) {
  const safeBpm = clampStage(Number.isFinite(bpm) ? bpm : 120, 30, 300);
  const beatMs = 60_000 / safeBpm;
  const measureMs = beatMs * BEATS_PER_MEASURE;

  const measures = useMemo<MeasureRef[]>(() => {
    const result: MeasureRef[] = [];
    timeline.forEach((block, blockIndex) => {
      const duration = Math.max(1, Number(block?.duracao_compassos) || 1);
      for (let measureInBlock = 0; measureInBlock < duration; measureInBlock += 1) {
        result.push({ blockIndex, measureInBlock });
      }
    });
    return result;
  }, [timeline]);

  const totalMs = measures.length * measureMs;
  const [playing, setPlaying] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [viewMode, setViewMode] = useState<StageViewMode>('both');
  const [presentationMode, setPresentationMode] = useState<StagePresentationMode>('scroll');
  const [fontScale, setFontScale] = useState(0.95);

  const elapsedRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastBeatRef = useRef(-1);
  const lastUiUpdateRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);

  const currentMeasureIndex = measures.length
    ? clampStage(Math.floor(elapsedMs / measureMs), 0, measures.length - 1)
    : 0;
  const current = measures[currentMeasureIndex] || { blockIndex: 0, measureInBlock: 0 };
  const beatInMeasure = measures.length
    ? clampStage(Math.floor((elapsedMs % measureMs) / beatMs) + 1, 1, BEATS_PER_MEASURE)
    : 1;
  const measureProgress = measureMs > 0 ? clampStage((elapsedMs % measureMs) / measureMs, 0, 1) : 0;
  const totalProgress = totalMs > 0 ? clampStage((elapsedMs / totalMs) * 100, 0, 100) : 0;

  const ensureAudio = useCallback(async () => {
    if (typeof window === 'undefined') return null;
    if (!audioRef.current) {
      const AudioContextCtor = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioRef.current = new AudioContextCtor();
    }
    if (audioRef.current.state === 'suspended') await audioRef.current.resume();
    return audioRef.current;
  }, []);

  const click = useCallback(async (accent: boolean) => {
    if (!metronomeOn) return;
    const ctx = await ensureAudio();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(accent ? 1_250 : 900, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.19 : 0.11, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.05);
  }, [ensureAudio, metronomeOn]);

  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const pause = useCallback(() => {
    if (startedAtRef.current !== null) {
      const value = clampStage(performance.now() - startedAtRef.current, 0, totalMs);
      elapsedRef.current = value;
      setElapsedMs(value);
    }
    startedAtRef.current = null;
    setPlaying(false);
    stopAnimation();
  }, [stopAnimation, totalMs]);

  const reset = useCallback(() => {
    stopAnimation();
    startedAtRef.current = null;
    elapsedRef.current = 0;
    lastBeatRef.current = -1;
    lastUiUpdateRef.current = 0;
    setElapsedMs(0);
    setPlaying(false);
  }, [stopAnimation]);

  const play = useCallback(async () => {
    if (!measures.length || totalMs <= 0) return;
    await ensureAudio();
    if (elapsedRef.current >= totalMs - 10) {
      elapsedRef.current = 0;
      setElapsedMs(0);
      lastBeatRef.current = -1;
    }
    startedAtRef.current = performance.now() - elapsedRef.current;
    lastUiUpdateRef.current = 0;
    setPlaying(true);
  }, [ensureAudio, measures.length, totalMs]);

  const seek = useCallback((value: number) => {
    const next = clampStage(value, 0, totalMs);
    elapsedRef.current = next;
    setElapsedMs(next);
    lastBeatRef.current = Math.floor(next / beatMs) - 1;
    if (playing) startedAtRef.current = performance.now() - next;
  }, [beatMs, playing, totalMs]);

  useEffect(() => {
    if (!playing) return;

    const frame = (frameNow: number) => {
      if (startedAtRef.current === null) return;
      const next = clampStage(performance.now() - startedAtRef.current, 0, totalMs);
      elapsedRef.current = next;

      const absoluteBeat = Math.floor(next / beatMs);
      if (absoluteBeat !== lastBeatRef.current && next < totalMs) {
        lastBeatRef.current = absoluteBeat;
        void click(absoluteBeat % BEATS_PER_MEASURE === 0);
      }

      if (frameNow - lastUiUpdateRef.current >= UI_INTERVAL_MS || next >= totalMs) {
        lastUiUpdateRef.current = frameNow;
        setElapsedMs(next);
      }

      if (next >= totalMs) {
        startedAtRef.current = null;
        setPlaying(false);
        rafRef.current = null;
        return;
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return stopAnimation;
  }, [beatMs, click, playing, stopAnimation, totalMs]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') onClose();
      if (event.code === 'Space' && !editing) {
        event.preventDefault();
        if (playing) pause();
        else void play();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, pause, play, playing, reset]);

  useEffect(() => {
    reset();
  }, [safeBpm, timeline, reset]);

  useEffect(() => () => {
    stopAnimation();
    if (audioRef.current) void audioRef.current.close();
    audioRef.current = null;
  }, [stopAnimation]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/96 backdrop-blur-xl overflow-y-auto">
      <div className="min-h-full max-w-[1500px] mx-auto p-3 sm:p-6 pb-10 text-white flex flex-col">
        <header className="flex items-start justify-between gap-4 mb-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] mb-1 flex items-center gap-2">
              <Eye size={13} /> Preview = Live
            </p>
            <h2 className="text-2xl sm:text-3xl font-black italic uppercase tracking-tighter break-words">{titulo}</h2>
            <p className="text-slate-500 text-xs font-bold mt-1">
              {safeBpm} BPM · 4/4 · {measures.length} compassos · {formatTime(totalMs)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="size-11 shrink-0 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white" aria-label="Fechar preview">
            <X size={20} />
          </button>
        </header>

        <section className="bg-slate-900/70 border border-white/5 rounded-[1.5rem] p-2 sm:p-3 mb-3 overflow-x-auto no-scrollbar">
          <div className="min-w-max flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950/70 border border-white/5 rounded-xl p-1">
              <button type="button" onClick={() => setViewMode('chords')} className={`min-h-9 px-3 rounded-lg text-[9px] font-black uppercase flex items-center gap-1.5 ${viewMode === 'chords' ? 'bg-yellow-500/15 text-yellow-300' : 'text-slate-500'}`}><Music size={13} /> Cifra</button>
              <button type="button" onClick={() => setViewMode('both')} className={`min-h-9 px-3 rounded-lg text-[9px] font-black uppercase flex items-center gap-1.5 ${viewMode === 'both' ? 'bg-blue-500/15 text-blue-300' : 'text-slate-500'}`}><LayoutGrid size={13} /> Cifra + letra</button>
              <button type="button" onClick={() => setViewMode('lyrics')} className={`min-h-9 px-3 rounded-lg text-[9px] font-black uppercase flex items-center gap-1.5 ${viewMode === 'lyrics' ? 'bg-sky-500/15 text-sky-300' : 'text-slate-500'}`}><Type size={13} /> Letra</button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950/70 border border-white/5 rounded-xl p-1">
              <button type="button" onClick={() => setPresentationMode('slides')} className={`min-h-9 px-3 rounded-lg text-[9px] font-black uppercase ${presentationMode === 'slides' ? 'bg-white/10 text-white' : 'text-slate-500'}`}>Slides</button>
              <button type="button" onClick={() => setPresentationMode('scroll')} className={`min-h-9 px-3 rounded-lg text-[9px] font-black uppercase ${presentationMode === 'scroll' ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-500'}`}>Rolagem</button>
            </div>

            <div className="flex items-center gap-1 bg-slate-950/70 border border-white/5 rounded-xl p-1">
              <button type="button" onClick={() => setFontScale((v) => Math.max(0.7, Math.round((v - 0.1) * 100) / 100))} className="min-h-9 px-2.5 text-xs font-black text-slate-300">A−</button>
              <button type="button" onClick={() => setFontScale(0.95)} className="min-h-9 px-2 text-[9px] font-black text-slate-500">{Math.round(fontScale * 100)}%</button>
              <button type="button" onClick={() => setFontScale((v) => Math.min(1.5, Math.round((v + 0.1) * 100) / 100))} className="min-h-9 px-2.5 text-xs font-black text-slate-300">A+</button>
            </div>
          </div>
        </section>

        <section className="h-[56vh] min-h-[360px] max-h-[760px] mb-3 flex">
          <SongStageRenderer
            blocks={timeline}
            activeBlockIndex={current.blockIndex}
            activeMeasureIndex={current.measureInBlock}
            activeMeasureProgress={measureProgress}
            viewMode={viewMode}
            presentationMode={presentationMode}
            fontScale={fontScale}
            semitones={0}
            focusRatio={0.34}
            autoScroll={playing}
            stageTone="preview"
            className="w-full"
          />
        </section>

        <section className="bg-slate-900 border border-white/5 rounded-[1.5rem] p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button type="button" onClick={() => (playing ? pause() : void play())} disabled={!measures.length} className="min-h-11 px-5 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 font-black uppercase text-[10px] tracking-widest flex items-center gap-2">
              {playing ? <Pause size={17} /> : <Play size={17} />} {playing ? 'Pausar' : elapsedMs > 0 ? 'Continuar' : 'Tocar'}
            </button>
            <button type="button" onClick={reset} className="min-h-11 px-4 rounded-2xl bg-slate-800 border border-white/5 font-black uppercase text-[10px] tracking-widest flex items-center gap-2"><RotateCcw size={15} /> Reiniciar</button>
            <button type="button" onClick={() => setMetronomeOn((value) => !value)} className={`min-h-11 px-4 rounded-2xl border font-black uppercase text-[10px] tracking-widest flex items-center gap-2 ${metronomeOn ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 'bg-slate-800 border-white/5 text-slate-500'}`}>
              {metronomeOn ? <Volume2 size={15} /> : <VolumeX size={15} />} Metrônomo
            </button>

            <div className="sm:ml-auto flex items-center gap-3">
              <div className="grid grid-cols-4 gap-1" aria-label="Tempos">
                {[1, 2, 3, 4].map((beat) => (
                  <div key={beat} className={`size-8 rounded-lg border flex items-center justify-center font-black text-xs ${beat === beatInMeasure ? beat === 1 ? 'bg-blue-500/20 border-blue-400 text-blue-300' : 'bg-yellow-500/15 border-yellow-400/60 text-yellow-300' : 'bg-slate-950/40 border-white/5 text-slate-700'}`}>{beat}</div>
                ))}
              </div>
              <div className="text-right font-mono">
                <p className="text-xl sm:text-2xl font-black tabular-nums">{formatTime(elapsedMs)}</p>
                <p className="text-[9px] text-slate-600 font-black uppercase">de {formatTime(totalMs)}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-slate-500 text-[10px] font-black uppercase"><Timer size={14} /> {safeBpm} BPM</div>
            </div>
          </div>

          <input type="range" min={0} max={Math.max(totalMs, 1)} step={25} value={elapsedMs} onChange={(event) => seek(Number(event.target.value))} className="w-full mt-4 accent-blue-500" aria-label="Posição da música" />
          <div className="h-1.5 rounded-full bg-slate-950 overflow-hidden mt-2"><div className="h-full bg-blue-500" style={{ width: `${totalProgress}%` }} /></div>
        </section>
      </div>
    </div>
  );
}
