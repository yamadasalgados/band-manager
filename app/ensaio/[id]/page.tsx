'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Gauge,
  LayoutGrid,
  Music,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import SongStageRenderer from '@/components/SongStageRenderer';
import { clampStage, type StageBlockInput, type StageHarmonyNotation, type StagePresentationMode, type StageViewMode } from '@/lib/songStage';

const BEATS_PER_MEASURE = 4;
const UI_INTERVAL = 50;

export default function ModoEnsaio() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [musica, setMusica] = useState<any>(null);
  const [blocks, setBlocks] = useState<StageBlockInput[]>([]);
  const [blockIndex, setBlockIndex] = useState(0);
  const [measureIndex, setMeasureIndex] = useState(0);
  const [measureProgress, setMeasureProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [repeatBlock, setRepeatBlock] = useState(false);
  const [metronome, setMetronome] = useState(true);
  const [bpm, setBpm] = useState(120);
  const [speed, setSpeed] = useState(1);
  const [semitones, setSemitones] = useState(0);
  const [timingOffsetMs, setTimingOffsetMs] = useState(0);
  const [viewMode, setViewMode] = useState<StageViewMode>('both');
  const [presentationMode, setPresentationMode] = useState<StagePresentationMode>('scroll');
  const [harmonyNotation, setHarmonyNotation] = useState<StageHarmonyNotation>('chords');

  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedInBlockRef = useRef(0);
  const lastUiRef = useRef(0);
  const lastBeatRef = useRef(-1);
  const audioRef = useRef<AudioContext | null>(null);

  const effectiveBpm = clampStage(bpm * speed, 30, 300);
  const beatMs = 60_000 / effectiveBpm;
  const measureMs = beatMs * BEATS_PER_MEASURE;
  const currentDuration = Math.max(1, Number(blocks[blockIndex]?.duracao_compassos) || 1);
  const blockMs = currentDuration * measureMs;

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const [songRes, blocksRes, structureRes] = await Promise.all([
          supabase.from('repertorio').select('id,titulo,artista,tom,bpm,categoria').eq('id', id).single(),
          supabase.from('musica_blocos').select('id,tipo,nome_personalizado,letra,acordes,duracao_compassos').eq('repertorio_id', id),
          supabase.from('musica_estrutura').select('bloco_id,posicao').eq('repertorio_id', id).order('posicao'),
        ]);
        if (!alive) return;
        if (songRes.error) throw songRes.error;
        if (blocksRes.error) throw blocksRes.error;
        if (structureRes.error) throw structureRes.error;

        const byId = new Map((blocksRes.data || []).map((block: any) => [String(block.id), block]));
        const timeline = (structureRes.data || [])
          .map((entry: any) => byId.get(String(entry.bloco_id)))
          .filter(Boolean) as StageBlockInput[];

        setMusica(songRes.data);
        setBpm(Number(songRes.data?.bpm) || 120);
        setBlocks(timeline);
      } catch (error) {
        console.error('Erro ao carregar ensaio:', error);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, [id]);

  const ensureAudio = useCallback(async () => {
    if (!audioRef.current) {
      const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioRef.current = new Ctor();
    }
    if (audioRef.current.state === 'suspended') await audioRef.current.resume();
    return audioRef.current;
  }, []);

  const click = useCallback(async (accent: boolean) => {
    if (!metronome) return;
    const ctx = await ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.frequency.value = accent ? 1250 : 900;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.09, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(now); osc.stop(now + 0.05);
  }, [ensureAudio, metronome]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const pause = useCallback(() => {
    if (startedAtRef.current !== null) elapsedInBlockRef.current = Math.max(0, performance.now() - startedAtRef.current);
    startedAtRef.current = null;
    setPlaying(false);
    stopRaf();
  }, [stopRaf]);

  const resetBlock = useCallback(() => {
    elapsedInBlockRef.current = 0;
    startedAtRef.current = playing ? performance.now() : null;
    lastBeatRef.current = -1;
    setMeasureIndex(0);
    setMeasureProgress(0);
  }, [playing]);

  const play = useCallback(async () => {
    if (!blocks.length) return;
    await ensureAudio();
    startedAtRef.current = performance.now() - elapsedInBlockRef.current;
    setPlaying(true);
  }, [blocks.length, ensureAudio]);

  useEffect(() => {
    if (!playing) return;

    const frame = (now: number) => {
      if (startedAtRef.current === null) return;
      const rawElapsed = Math.max(0, performance.now() - startedAtRef.current + timingOffsetMs);
      const elapsed = Math.min(rawElapsed, blockMs);
      elapsedInBlockRef.current = Math.max(0, performance.now() - startedAtRef.current);

      const measureFloat = elapsed / measureMs;
      const nextMeasure = Math.min(currentDuration - 1, Math.floor(Math.min(measureFloat, currentDuration - 0.000001)));
      const nextProgress = elapsed >= blockMs ? 1 : clampStage(measureFloat - nextMeasure, 0, 1);
      const beatAbsolute = Math.floor(elapsed / beatMs);
      if (beatAbsolute !== lastBeatRef.current && elapsed < blockMs) {
        lastBeatRef.current = beatAbsolute;
        void click(beatAbsolute % 4 === 0);
      }

      if (now - lastUiRef.current >= UI_INTERVAL || elapsed >= blockMs) {
        lastUiRef.current = now;
        setMeasureIndex(nextMeasure);
        setMeasureProgress(nextProgress);
      }

      if (elapsed >= blockMs) {
        elapsedInBlockRef.current = 0;
        lastBeatRef.current = -1;
        if (repeatBlock) {
          startedAtRef.current = performance.now();
          setMeasureIndex(0);
          setMeasureProgress(0);
        } else if (blockIndex < blocks.length - 1) {
          setBlockIndex((value) => value + 1);
          startedAtRef.current = performance.now();
          setMeasureIndex(0);
          setMeasureProgress(0);
        } else {
          startedAtRef.current = null;
          setPlaying(false);
          rafRef.current = null;
          return;
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return stopRaf;
  }, [beatMs, blockIndex, blockMs, blocks.length, click, currentDuration, measureMs, playing, repeatBlock, stopRaf, timingOffsetMs]);

  useEffect(() => () => {
    stopRaf();
    if (audioRef.current) void audioRef.current.close();
  }, [stopRaf]);

  const gotoMeasure = (delta: number) => {
    pause();
    const next = clampStage(measureIndex + delta, 0, currentDuration - 1);
    elapsedInBlockRef.current = next * measureMs;
    setMeasureIndex(next);
    setMeasureProgress(0);
    lastBeatRef.current = -1;
  };

  const gotoBlock = (delta: number) => {
    pause();
    const next = clampStage(blockIndex + delta, 0, Math.max(0, blocks.length - 1));
    setBlockIndex(next);
    elapsedInBlockRef.current = 0;
    setMeasureIndex(0);
    setMeasureProgress(0);
    lastBeatRef.current = -1;
  };

  const changeBpm = (next: number) => {
    pause();
    setBpm(clampStage(next, 30, 300));
    elapsedInBlockRef.current = measureIndex * (60_000 / clampStage(next * speed, 30, 300)) * 4;
    setMeasureProgress(0);
  };

  if (loading) return <div className="min-h-screen bg-slate-950 text-blue-400 flex items-center justify-center font-black animate-pulse">CARREGANDO ENSAIO...</div>;

  return (
    <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
      <header className="px-3 sm:px-5 py-3 border-b border-white/5 bg-black flex items-center justify-between gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-xl bg-white/5"><ArrowLeft size={18} /></button>
        <div className="text-center min-w-0">
          <p className="text-[9px] uppercase tracking-[0.25em] text-emerald-400 font-black">Modo ensaio</p>
          <h1 className="font-black uppercase truncate max-w-[55vw]">{musica?.titulo || 'Música'}</h1>
          <p className="text-[9px] text-slate-500 font-bold">{Math.round(effectiveBpm)} BPM · {musica?.tom || '—'}</p>
        </div>
        <button onClick={() => (playing ? pause() : void play())} className={`p-3 rounded-full ${playing ? 'bg-red-600' : 'bg-emerald-600'}`}>{playing ? <Pause size={19} /> : <Play size={19} />}</button>
      </header>

      <div className="px-2 sm:px-4 py-2 border-b border-white/5 bg-black/90 overflow-x-auto no-scrollbar">
        <div className="min-w-max flex items-center gap-2">
          <div className="flex bg-white/5 border border-white/10 p-1 rounded-xl">
            <button onClick={() => setViewMode('chords')} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 ${viewMode === 'chords' ? 'bg-yellow-500/15 text-yellow-300' : 'text-zinc-500'}`}><Music size={12}/> Cifra</button>
            <button onClick={() => setViewMode('both')} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 ${viewMode === 'both' ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-500'}`}><LayoutGrid size={12}/> Ambos</button>
            <button onClick={() => setViewMode('lyrics')} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 ${viewMode === 'lyrics' ? 'bg-sky-500/15 text-sky-300' : 'text-zinc-500'}`}><Type size={12}/> Letra</button>
          </div>
          <div className="flex bg-white/5 border border-white/10 p-1 rounded-xl">
            <button onClick={() => setHarmonyNotation('chords')} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase ${harmonyNotation === 'chords' ? 'bg-yellow-500/15 text-yellow-300' : 'text-zinc-500'}`}>Acordes</button>
            <button onClick={() => setHarmonyNotation('degrees')} disabled={!String(musica?.tom || '').trim()} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase disabled:opacity-30 ${harmonyNotation === 'degrees' ? 'bg-violet-500/15 text-violet-300' : 'text-zinc-500'}`}>Graus</button>
          </div>
          <div className="flex bg-white/5 border border-white/10 p-1 rounded-xl">
            <button onClick={() => setPresentationMode('slides')} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase ${presentationMode === 'slides' ? 'bg-white/10 text-white' : 'text-zinc-500'}`}>Slides</button>
            <button onClick={() => setPresentationMode('scroll')} className={`px-3 min-h-9 rounded-lg text-[9px] font-black uppercase ${presentationMode === 'scroll' ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-500'}`}>Rolagem</button>
          </div>
        </div>
      </div>

      <main className="flex-1 min-h-0 p-2 sm:p-4 flex">
        <SongStageRenderer
          blocks={blocks}
          activeBlockIndex={blockIndex}
          activeMeasureIndex={measureIndex}
          activeMeasureProgress={measureProgress}
          viewMode={viewMode}
          presentationMode={presentationMode}
          semitones={semitones}
          harmonyNotation={harmonyNotation}
          keySignature={String(musica?.tom || '')}
          fontScale={0.95}
          focusRatio={0.34}
          autoScroll={playing}
          className="w-full"
        />
      </main>

      <footer className="bg-black border-t border-white/5 p-2 sm:p-3 overflow-x-auto no-scrollbar">
        <div className="min-w-max flex items-center justify-center gap-2">
          <button onClick={() => gotoMeasure(-1)} className="px-3 min-h-11 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase flex items-center gap-1"><ChevronLeft size={15}/> 1 comp.</button>
          <button onClick={() => gotoMeasure(1)} className="px-3 min-h-11 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase flex items-center gap-1">1 comp. <ChevronRight size={15}/></button>
          <button onClick={() => setRepeatBlock((v) => !v)} className={`px-3 min-h-11 rounded-xl border text-[9px] font-black uppercase flex items-center gap-1 ${repeatBlock ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}><Repeat2 size={15}/> Repetir bloco</button>
          <button onClick={resetBlock} className="px-3 min-h-11 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase flex items-center gap-1"><RotateCcw size={14}/> Reiniciar</button>

          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-1">
            <button onClick={() => changeBpm(bpm - 2)} className="size-9 rounded-lg">−</button>
            <span className="px-2 text-[9px] font-black text-yellow-300 flex items-center gap-1"><Gauge size={12}/>{bpm}</span>
            <button onClick={() => changeBpm(bpm + 2)} className="size-9 rounded-lg">+</button>
          </div>

          <div className="flex bg-white/5 border border-white/10 rounded-xl p-1">
            {[0.75, 0.9, 1].map((value) => <button key={value} onClick={() => { pause(); setSpeed(value); setMeasureProgress(0); }} className={`px-3 min-h-9 rounded-lg text-[9px] font-black ${speed === value ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-500'}`}>{Math.round(value * 100)}%</button>)}
          </div>

          <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 items-center">
            <button onClick={() => setSemitones((v) => v - 1)} className="size-9">−</button>
            <span className="px-2 text-[9px] font-black text-yellow-300">TOM {semitones >= 0 ? '+' : ''}{semitones}</span>
            <button onClick={() => setSemitones((v) => v + 1)} className="size-9">+</button>
          </div>

          <button onClick={() => setMetronome((v) => !v)} className={`px-3 min-h-11 rounded-xl border text-[9px] font-black uppercase flex items-center gap-1 ${metronome ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300' : 'bg-white/5 border-white/10 text-zinc-500'}`}>{metronome ? <Volume2 size={14}/> : <VolumeX size={14}/>} Metrônomo</button>

          <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 items-center">
            <button onClick={() => setTimingOffsetMs((v) => Math.max(-1500, v - 100))} className="px-2 min-h-9 text-[9px]">−0.1s</button>
            <button onClick={() => setTimingOffsetMs(0)} className="px-2 min-h-9 text-[9px] font-black text-amber-300">{timingOffsetMs >= 0 ? '+' : ''}{(timingOffsetMs / 1000).toFixed(1)}s</button>
            <button onClick={() => setTimingOffsetMs((v) => Math.min(1500, v + 100))} className="px-2 min-h-9 text-[9px]">+0.1s</button>
          </div>

          <button onClick={() => gotoBlock(-1)} disabled={blockIndex <= 0} className="px-3 min-h-11 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase disabled:opacity-20">← Bloco</button>
          <button onClick={() => gotoBlock(1)} disabled={blockIndex >= blocks.length - 1} className="px-3 min-h-11 rounded-xl bg-white/5 border border-white/10 text-[9px] font-black uppercase disabled:opacity-20">Bloco →</button>
        </div>
      </footer>
    </div>
  );
}
