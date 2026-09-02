'use client';

import { useEffect, useMemo, useRef } from 'react';
import { LayoutGrid, Music, Type } from 'lucide-react';
import {
  buildChordGuide,
  chordCellNames,
  clampStage,
  parseStageBlocks,
  formatStageChord,
  type StageBlockInput,
  type StageHarmonyNotation,
  type StagePresentationMode,
  type StageViewMode,
} from '@/lib/songStage';

export type SongStageRendererProps = {
  blocks: StageBlockInput[];
  activeBlockIndex: number;
  activeMeasureIndex: number;
  activeMeasureProgress?: number;
  viewMode?: StageViewMode;
  presentationMode?: StagePresentationMode;
  semitones?: number;
  fontScale?: number;
  focusRatio?: number;
  autoScroll?: boolean;
  className?: string;
  showNextHint?: boolean;
  stageTone?: 'dark' | 'preview';
  harmonyNotation?: StageHarmonyNotation;
  keySignature?: string;
};

type ChordLyricLineProps = {
  lyric: string;
  chordCell: string;
  active: boolean;
  viewMode: StageViewMode;
  semitones: number;
  fontScale: number;
  compact?: boolean;
  harmonyNotation?: StageHarmonyNotation;
  keySignature?: string;
};

const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

function scaledClamp(minPx: number, fluidVw: number, maxPx: number, scale: number) {
  return `clamp(${Math.round(minPx * scale)}px, ${(fluidVw * scale).toFixed(2)}vw, ${Math.round(maxPx * scale)}px)`;
}

export function ChordLyricLine({
  lyric,
  chordCell,
  active,
  viewMode,
  semitones,
  fontScale,
  compact = false,
  harmonyNotation = 'chords',
  keySignature = '',
}: ChordLyricLineProps) {
  const anchors = useMemo(() => {
    const names = chordCellNames(chordCell);
    const guide = buildChordGuide(
      lyric,
      // buildChordGuide needs positions; parseStageBlocks already does this in the
      // parent, but keeping this component standalone makes it reusable in editor.
      // Reparse through a one-line pseudo block to preserve the same decoder.
      parseStageBlocks([{ letra: lyric, acordes: chordCell, duracao_compassos: 1 }])[0]?.lines[0]?.anchors || [],
      (chord) => formatStageChord(chord, semitones, harmonyNotation, keySignature),
    );
    return { names, guide };
  }, [chordCell, harmonyNotation, keySignature, lyric, semitones]);

  const showChords = viewMode === 'both' || viewMode === 'chords';
  const showLyrics = viewMode === 'both' || viewMode === 'lyrics';

  if (viewMode === 'lyrics') {
    return (
      <div
        style={{ fontSize: compact ? scaledClamp(18, 3.4, 30, fontScale) : scaledClamp(22, 4.2, 42, fontScale) }}
        className={cn(
          'font-bold leading-[1.16] whitespace-pre-wrap break-words',
          active ? 'text-white' : 'text-zinc-300',
        )}
      >
        {lyric || '\u00A0'}
      </div>
    );
  }

  const fallbackChordText = anchors.names
    .map((chord) => formatStageChord(chord, semitones, harmonyNotation, keySignature))
    .join('   ');

  return (
    <div className="min-w-0 overflow-x-auto no-scrollbar">
      <div className="inline-block min-w-full align-top">
        {showChords && (
          <pre
            style={{ fontSize: compact ? scaledClamp(16, 2.8, 28, fontScale) : scaledClamp(19, 3.3, 34, fontScale) }}
            className={cn(
              'font-mono font-black leading-[1.05] whitespace-pre min-h-[1.05em] m-0',
              active ? 'text-yellow-300' : 'text-yellow-500/75',
            )}
          >
            {anchors.guide || fallbackChordText || '\u00A0'}
          </pre>
        )}

        {showLyrics && (
          <pre
            style={{ fontSize: compact ? scaledClamp(18, 3.3, 30, fontScale) : scaledClamp(22, 4, 40, fontScale) }}
            className={cn(
              'font-mono font-bold leading-[1.12] whitespace-pre m-0',
              active ? 'text-white' : 'text-zinc-200',
            )}
          >
            {lyric || '\u00A0'}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function SongStageRenderer({
  blocks,
  activeBlockIndex,
  activeMeasureIndex,
  activeMeasureProgress = 0,
  viewMode = 'both',
  presentationMode = 'slides',
  semitones = 0,
  fontScale = 1,
  focusRatio = 0.34,
  autoScroll = false,
  className,
  showNextHint = true,
  stageTone = 'dark',
  harmonyNotation = 'chords',
  keySignature = '',
}: SongStageRendererProps) {
  const parsedBlocks = useMemo(() => parseStageBlocks(blocks || []), [blocks]);
  const safeBlockIndex = parsedBlocks.length
    ? clampStage(activeBlockIndex, 0, parsedBlocks.length - 1)
    : 0;
  const currentBlock = parsedBlocks[safeBlockIndex];
  const currentDuration = Math.max(1, currentBlock?.duration || 1);
  const safeMeasureIndex = clampStage(activeMeasureIndex, 0, currentDuration - 1);
  const nextBlock = parsedBlocks[safeBlockIndex + 1];

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const targetRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  const setLineRef = (key: string, node: HTMLDivElement | null) => {
    if (node) lineRefs.current.set(key, node);
    else lineRefs.current.delete(key);
  };

  useEffect(() => {
    if (presentationMode !== 'scroll') {
      targetRef.current = null;
      return;
    }

    const container = scrollRef.current;
    if (!container || !currentBlock) return;

    const currentNode =
      lineRefs.current.get(`${safeBlockIndex}-${safeMeasureIndex}`) ||
      lineRefs.current.get(`${safeBlockIndex}-0`);
    if (!currentNode) return;

    const nextNode =
      safeMeasureIndex < currentDuration - 1
        ? lineRefs.current.get(`${safeBlockIndex}-${safeMeasureIndex + 1}`)
        : lineRefs.current.get(`${safeBlockIndex + 1}-0`);

    const containerRect = container.getBoundingClientRect();
    const nodeTarget = (node: HTMLDivElement) => {
      const rect = node.getBoundingClientRect();
      return container.scrollTop + (rect.top - containerRect.top) - container.clientHeight * focusRatio;
    };

    const currentTarget = nodeTarget(currentNode);
    const nextTarget = nextNode ? nodeTarget(nextNode) : currentTarget;
    const fraction = autoScroll ? clampStage(activeMeasureProgress, 0, 1) : 0;
    const interpolated = currentTarget + (nextTarget - currentTarget) * fraction;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const target = clampStage(interpolated, 0, maxScroll);

    if (autoScroll) {
      targetRef.current = target;
    } else {
      targetRef.current = null;
      container.scrollTo({ top: target, behavior: 'smooth' });
    }
  }, [
    activeMeasureProgress,
    autoScroll,
    currentBlock,
    currentDuration,
    focusRatio,
    presentationMode,
    safeBlockIndex,
    safeMeasureIndex,
    viewMode,
  ]);

  useEffect(() => {
    if (presentationMode !== 'scroll' || !autoScroll) {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
      return;
    }

    const step = () => {
      const container = scrollRef.current;
      const target = targetRef.current;
      if (container && target !== null) {
        const delta = target - container.scrollTop;
        if (Math.abs(delta) > 0.15) container.scrollTop += delta * 0.12;
        else container.scrollTop = target;
      }
      scrollRafRef.current = requestAnimationFrame(step);
    };

    scrollRafRef.current = requestAnimationFrame(step);
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    };
  }, [autoScroll, presentationMode]);

  if (!parsedBlocks.length) {
    return (
      <div className={cn('flex-1 min-h-0 rounded-[1.5rem] border border-white/5 bg-zinc-900/40 flex items-center justify-center text-zinc-600 font-black italic', className)}>
        — SEM ESTRUTURA —
      </div>
    );
  }

  const surfaceClass = stageTone === 'preview' ? 'bg-slate-950/60' : 'bg-zinc-900/40';

  if (presentationMode === 'scroll') {
    return (
      <div
        ref={scrollRef}
        data-live-scroll="true"
        className={cn(
          'flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-[1.5rem] sm:rounded-[2.5rem] border border-white/5',
          surfaceClass,
          className,
        )}
      >
        <div
          className="w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 space-y-8 sm:space-y-12"
          style={{ paddingTop: '28vh', paddingBottom: '38vh' }}
        >
          {parsedBlocks.map((block, blockIndex) => {
            const activeBlock = blockIndex === safeBlockIndex;
            return (
              <section
                key={`${block.label}-${blockIndex}`}
                className={cn(
                  'rounded-3xl border px-4 sm:px-7 py-5 sm:py-7 transition-colors',
                  activeBlock ? 'bg-blue-500/[0.045] border-blue-500/20' : 'bg-black/10 border-white/5',
                )}
              >
                <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('text-[10px] sm:text-xs font-black uppercase tracking-[0.18em] truncate', activeBlock ? 'text-blue-300' : 'text-zinc-600')}>
                      {block.label}
                    </span>
                    {viewMode === 'both' && !block.lyricsSynced && (
                      <span className="shrink-0 px-2 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/15 text-[8px] font-black uppercase tracking-wider text-yellow-500/70">
                        Letra livre
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-wider text-zinc-700">{block.duration} comp.</span>
                </div>

                <div className="space-y-1 sm:space-y-2">
                  {block.lines.map((line, lineIndex) => {
                    const timedLine = lineIndex < block.duration;
                    const activeLine = activeBlock && timedLine && lineIndex === safeMeasureIndex;
                    return (
                      <div
                        key={`${blockIndex}-${lineIndex}`}
                        ref={timedLine ? (node) => setLineRef(`${blockIndex}-${lineIndex}`, node) : undefined}
                        className={cn(
                          'rounded-2xl px-3 sm:px-5 py-2 sm:py-3 border-l-2 transition-colors duration-150',
                          activeLine ? 'bg-white/[0.055] border-l-blue-400' : 'border-l-transparent',
                        )}
                      >
                        <ChordLyricLine
                          lyric={line.lyric}
                          chordCell={line.chordCell}
                          active={activeLine}
                          viewMode={viewMode}
                          semitones={semitones}
                          fontScale={fontScale}
                          harmonyNotation={harmonyNotation}
                          keySignature={keySignature}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex-1 min-h-0 rounded-[1.5rem] sm:rounded-[2.5rem] border border-white/5 flex flex-col overflow-hidden relative', surfaceClass, className)}>
      <div className="px-5 sm:px-8 pt-4 sm:pt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {viewMode === 'both' ? <LayoutGrid size={13} className="text-blue-400/70 shrink-0" /> : viewMode === 'chords' ? <Music size={13} className="text-yellow-400/70 shrink-0" /> : <Type size={13} className="text-sky-400/70 shrink-0" />}
          <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.18em] text-blue-400/70 truncate">
            {currentBlock?.label || 'Bloco'}
          </span>
        </div>
        {viewMode === 'both' && currentBlock && !currentBlock.lyricsSynced && (
          <span className="px-2 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/15 text-[8px] font-black uppercase tracking-wider text-yellow-500/70">
            Letra livre
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 lg:px-12 flex flex-col">
        <div className="my-auto w-full py-3 sm:py-5">
        {viewMode === 'chords' ? (
          <div className="w-full max-w-5xl mx-auto space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between gap-3 px-1">
              <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">
                Compassos
              </span>
              <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.18em] text-yellow-500/70">
                Agora {safeMeasureIndex + 1}/{currentDuration}
              </span>
            </div>

            <div
              className={cn(
                'grid gap-2.5 sm:gap-3',
                currentDuration <= 2
                  ? 'grid-cols-2 max-w-xl mx-auto'
                  : currentDuration <= 4
                    ? 'grid-cols-2 sm:grid-cols-4'
                    : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6',
              )}
            >
              {currentBlock?.lines.slice(0, currentBlock.duration).map((line, lineIndex) => {
                const names = chordCellNames(line.chordCell).map((chord) =>
                  formatStageChord(chord, semitones, harmonyNotation, keySignature),
                );
                const active = lineIndex === safeMeasureIndex;
                const densityScale = names.length >= 4 ? 0.68 : names.length === 3 ? 0.76 : names.length === 2 ? 0.88 : 1;

                return (
                  <div
                    key={`chord-${lineIndex}`}
                    className={cn(
                      'min-w-0 min-h-[106px] sm:min-h-[122px] rounded-[1.2rem] sm:rounded-[1.4rem] border px-3 py-2.5 sm:px-4 sm:py-3 flex flex-col transition-all duration-150',
                      active
                        ? 'border-yellow-400/55 bg-yellow-500/10 shadow-[0_0_26px_rgba(234,179,8,0.10)]'
                        : 'border-white/[0.065] bg-white/[0.025]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className={cn(
                          'text-[8px] sm:text-[9px] font-black uppercase tracking-[0.16em]',
                          active ? 'text-yellow-300' : 'text-zinc-600',
                        )}
                      >
                        C.{lineIndex + 1}
                      </span>
                      {active && (
                        <span className="rounded-full bg-yellow-400/15 border border-yellow-400/20 px-2 py-0.5 text-[7px] sm:text-[8px] font-black uppercase tracking-widest text-yellow-200">
                          Agora
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-wrap items-center justify-center content-center gap-x-2 gap-y-1.5">
                      {names.length ? (
                        names.map((name, chordIndex) => (
                          <div key={`${lineIndex}-${chordIndex}-${name}`} className="flex items-center gap-2 min-w-0">
                            {chordIndex > 0 && (
                              <span className="text-[clamp(16px,4vw,28px)] font-black text-zinc-700 select-none">/</span>
                            )}
                            <span
                              style={{
                                fontSize: active
                                  ? scaledClamp(28, 7.2, 56, fontScale * densityScale)
                                  : scaledClamp(24, 5.8, 44, fontScale * densityScale),
                              }}
                              className={cn(
                                'font-mono font-black leading-none whitespace-nowrap',
                                active ? 'text-white' : 'text-yellow-500/55',
                              )}
                            >
                              {name}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span
                          style={{ fontSize: scaledClamp(24, 5.8, 44, fontScale) }}
                          className={cn('font-mono font-black leading-none', active ? 'text-white' : 'text-zinc-700')}
                        >
                          —
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : viewMode === 'both' && currentBlock && !currentBlock.lyricsSynced ? (
          <div className="w-full max-w-6xl mx-auto space-y-5 sm:space-y-7">
            <div className="flex flex-wrap items-end justify-center gap-2 sm:gap-3">
              {currentBlock.lines.slice(0, currentBlock.duration).map((line, lineIndex) => {
                const names = chordCellNames(line.chordCell).map((chord) =>
                  formatStageChord(chord, semitones, harmonyNotation, keySignature),
                );
                const active = lineIndex === safeMeasureIndex;
                return (
                  <div
                    key={`free-chord-${lineIndex}`}
                    className={cn(
                      'min-w-[72px] sm:min-w-[92px] rounded-2xl border px-3 py-2 text-center transition-all duration-150',
                      active
                        ? 'border-blue-400/40 bg-blue-500/10 shadow-[0_0_24px_rgba(59,130,246,0.10)]'
                        : 'border-white/5 bg-white/[0.025]',
                    )}
                  >
                    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 mb-1">
                      {lineIndex + 1}
                    </p>
                    <p
                      style={{ fontSize: active ? scaledClamp(25, 4.2, 42, fontScale) : scaledClamp(20, 3.2, 32, fontScale) }}
                      className={cn('font-mono font-black leading-none', active ? 'text-yellow-300' : 'text-yellow-500/45')}
                    >
                      {names.length ? names.join(' / ') : '—'}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/15 px-4 sm:px-6 py-4 sm:py-5">
              <div
                style={{ fontSize: scaledClamp(20, 3, 34, fontScale) }}
                className="font-mono font-bold leading-[1.35] whitespace-pre-wrap break-words text-zinc-100"
              >
                {currentBlock.lines.map((line) => line.lyric).filter((line) => line.trim()).join('\n') || '\u00A0'}
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-6xl mx-auto space-y-1 sm:space-y-2">
            {currentBlock?.lines.map((line, lineIndex) => {
              const timedLine = lineIndex < currentBlock.duration;
              const active = timedLine && lineIndex === safeMeasureIndex;
              return (
                <div
                  key={`slide-${lineIndex}`}
                  className={cn(
                    'rounded-2xl px-3 sm:px-5 py-2 sm:py-3 border-l-2 transition-colors duration-150',
                    active ? 'bg-white/[0.055] border-l-blue-400' : 'border-l-transparent',
                  )}
                >
                  <ChordLyricLine
                    lyric={line.lyric}
                    chordCell={line.chordCell}
                    active={active}
                    viewMode={viewMode}
                    semitones={semitones}
                    fontScale={fontScale}
                  harmonyNotation={harmonyNotation}
                  keySignature={keySignature}
                  />
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {showNextHint && (
        <div className="border-t border-white/5 bg-black/20 px-4 sm:px-8 py-2.5 sm:py-3">
          <div className="max-w-6xl mx-auto flex items-start gap-4 sm:gap-6 opacity-45">
            <span className="shrink-0 px-2 py-1 rounded-lg bg-white/5 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {nextBlock ? nextBlock.label : 'FIM'}
            </span>
            {nextBlock && (
              <div className="min-w-0 overflow-hidden">
                <ChordLyricLine
                  lyric={nextBlock.lines[0]?.lyric || ''}
                  chordCell={nextBlock.lines[0]?.chordCell || ''}
                  active={false}
                  viewMode={viewMode}
                  semitones={semitones}
                  fontScale={Math.max(0.75, fontScale * 0.78)}
                  harmonyNotation={harmonyNotation}
                  keySignature={keySignature}
                  compact
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
