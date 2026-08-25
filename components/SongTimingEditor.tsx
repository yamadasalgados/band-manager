'use client';

import { useMemo, useState } from 'react';
import { AlignLeft, Clock3, MousePointer2, Plus, Rows3, X } from 'lucide-react';
import { ChordLyricLine } from '@/components/SongStageRenderer';
import { parseChordCell, serializeChordAnchors, type ChordAnchor } from '@/lib/songStage';

type SongTimingEditorProps = {
  duration: number;
  chords: string[];
  lyrics: string;
  onDurationChange: (value: number) => void;
  onChordChange: (index: number, value: string) => void;
  onLyricsChange: (value: string) => void;
  maxMeasures?: number;
};

function smartChordCase(value: string) {
  const raw = String(value || '');
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function wordPositions(text: string) {
  const result: Array<{ label: string; start: number; key: string }> = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    result.push({ label: match[0], start: match.index, key: `${match.index}-${match[0]}` });
  }
  return result;
}

export default function SongTimingEditor({
  duration,
  chords,
  lyrics,
  onDurationChange,
  onChordChange,
  onLyricsChange,
  maxMeasures = 16,
}: SongTimingEditorProps) {
  const [mode, setMode] = useState<'sync' | 'free'>('sync');
  const [anchorDrafts, setAnchorDrafts] = useState<Record<number, string>>({});
  const safeDuration = Math.max(1, Math.min(maxMeasures, Number(duration) || 1));

  const rawLines = useMemo(() => {
    if (!lyrics) return [];
    return String(lyrics).replace(/\r\n/g, '\n').split('\n');
  }, [lyrics]);

  const hasLyrics = rawLines.some((line) => line.trim().length > 0);
  const lyricLineCount = hasLyrics ? rawLines.length : 0;
  const missingLines = hasLyrics ? Math.max(0, safeDuration - rawLines.length) : 0;
  const extraLines = hasLyrics ? Math.max(0, rawLines.length - safeDuration) : 0;
  const isSynced = !hasLyrics || rawLines.length === safeDuration;

  const measureLines = useMemo(
    () => Array.from({ length: safeDuration }, (_, index) => rawLines[index] ?? ''),
    [rawLines, safeDuration],
  );

  const changeLyricLine = (index: number, value: string) => {
    const next = rawLines.length ? [...rawLines] : [];
    while (next.length < safeDuration) next.push('');
    next[index] = value;
    onLyricsChange(next.join('\n'));
  };

  const setAnchors = (measureIndex: number, anchors: ChordAnchor[]) => {
    onChordChange(measureIndex, serializeChordAnchors(anchors));
  };

  const addAnchor = (measureIndex: number, charIndex: number) => {
    const chord = smartChordCase(String(anchorDrafts[measureIndex] || '').trim());
    if (!chord) return;

    const current = parseChordCell(chords[measureIndex]);
    const next = current.filter((anchor) => anchor.charIndex !== charIndex);
    next.push({ chord, charIndex });
    setAnchors(measureIndex, next);
    setAnchorDrafts((prev) => ({ ...prev, [measureIndex]: '' }));
  };

  const removeAnchor = (measureIndex: number, charIndex: number) => {
    const current = parseChordCell(chords[measureIndex]);
    setAnchors(measureIndex, current.filter((anchor) => anchor.charIndex !== charIndex));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 bg-slate-950/30 p-4 rounded-2xl border border-white/5">
        <div className="flex flex-wrap justify-between gap-2 text-[12px] font-black uppercase text-slate-500">
          <span className="flex items-center gap-2">
            <Clock3 size={14} /> Extensão do bloco
          </span>
          <span className="text-yellow-500">{safeDuration} compassos</span>
        </div>
        <input
          type="range"
          min="1"
          max={maxMeasures}
          step="1"
          value={safeDuration}
          onChange={(event) => onDurationChange(Number(event.target.value))}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            Cifra + letra
          </p>
          <p className="text-[11px] text-slate-600 mt-1 max-w-2xl">
            No modo por compasso você pode colocar vários acordes sobre as palavras exatas. Músicas antigas continuam compatíveis.
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-slate-950/60 border border-white/5 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setMode('sync')}
            className={`min-h-10 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-2 transition-all ${
              mode === 'sync' ? 'bg-blue-500/15 text-blue-300' : 'text-slate-600 hover:text-slate-300'
            }`}
          >
            <Rows3 size={14} /> Por compasso
          </button>
          <button
            type="button"
            onClick={() => setMode('free')}
            className={`min-h-10 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-2 transition-all ${
              mode === 'free' ? 'bg-blue-500/15 text-blue-300' : 'text-slate-600 hover:text-slate-300'
            }`}
          >
            <AlignLeft size={14} /> Texto livre
          </button>
        </div>
      </div>

      {mode === 'sync' ? (
        <div className="space-y-3">
          {measureLines.map((line, index) => {
            const anchors = parseChordCell(chords[index]);
            const words = wordPositions(line);
            const draft = anchorDrafts[index] || '';

            return (
              <div key={index} className="bg-slate-950/35 border border-white/5 rounded-2xl p-3 sm:p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-950 border border-white/5 flex flex-col items-center justify-center size-14 shrink-0">
                    <span className="text-[8px] text-slate-600 font-black uppercase">Comp.</span>
                    <strong className="text-base text-blue-400">{index + 1}</strong>
                  </div>

                  <div className="relative min-w-0 flex-1">
                    <input
                      value={line}
                      onChange={(event) => changeLyricLine(index, event.target.value)}
                      className="w-full min-h-14 bg-slate-950/70 p-3 pt-5 rounded-xl outline-none text-slate-100 border border-white/5 focus:border-blue-500/40 text-sm transition-all"
                      placeholder={index === 0 ? 'Trecho cantado neste compasso…' : 'Letra deste compasso…'}
                    />
                    <span className="absolute top-1 left-3 text-[8px] font-black text-slate-600 uppercase tracking-wider">
                      Letra
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-950/60 border border-white/5 p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-yellow-500/80 flex items-center gap-1.5">
                        <MousePointer2 size={12} /> Posicionar acorde sobre a palavra
                      </p>
                      <p className="text-[9px] text-slate-600 mt-1">
                        Digite o acorde e toque na palavra onde a troca acontece.
                      </p>
                    </div>
                    {!!anchors.length && (
                      <span className="text-[9px] font-black uppercase text-emerald-400/80">
                        {anchors.length} posição{anchors.length === 1 ? '' : 'ões'}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={draft}
                      onChange={(event) => setAnchorDrafts((prev) => ({ ...prev, [index]: smartChordCase(event.target.value) }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addAnchor(index, 0);
                        }
                      }}
                      className="w-32 sm:w-40 bg-slate-900 border border-yellow-500/20 rounded-xl px-3 py-2 outline-none font-mono font-black text-yellow-400 focus:border-yellow-500/50"
                      placeholder="Ex: Em7"
                    />
                    <button
                      type="button"
                      onClick={() => addAnchor(index, 0)}
                      disabled={!draft.trim()}
                      className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-30 flex items-center gap-1.5"
                      title="Colocar no começo da linha"
                    >
                      <Plus size={13} /> Início
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 min-h-10 items-center">
                    {line.trim() ? (
                      words.map((word) => (
                        <button
                          key={word.key}
                          type="button"
                          onClick={() => addAnchor(index, word.start)}
                          disabled={!draft.trim()}
                          className="px-2 py-1.5 rounded-lg border border-white/5 bg-slate-900/80 text-xs font-bold text-slate-300 hover:border-yellow-500/30 hover:text-yellow-300 disabled:opacity-45 disabled:hover:text-slate-300"
                          title={draft.trim() ? `Colocar ${draft} sobre “${word.label}”` : 'Digite um acorde primeiro'}
                        >
                          {word.label}
                        </button>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-700 italic">Digite a letra deste compasso para posicionar acordes sobre palavras.</span>
                    )}
                  </div>

                  {!!anchors.length && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {anchors.map((anchor) => {
                        const nearWord = words.find((word) => word.start === anchor.charIndex)?.label;
                        return (
                          <span key={`${anchor.chord}-${anchor.charIndex}`} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-[10px] font-black">
                            <span className="font-mono">{anchor.chord}</span>
                            <span className="text-yellow-500/50">@</span>
                            <span className="max-w-[140px] truncate">{nearWord || `posição ${anchor.charIndex}`}</span>
                            <button type="button" onClick={() => removeAnchor(index, anchor.charIndex)} className="text-yellow-500/50 hover:text-red-300" aria-label={`Remover ${anchor.chord}`}>
                              <X size={12} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="rounded-xl bg-black/20 border border-white/5 px-3 py-2 overflow-hidden">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-700 mb-2">Como aparecerá no Live</p>
                    <ChordLyricLine
                      lyric={line}
                      chordCell={chords[index] || ''}
                      active
                      viewMode="both"
                      semitones={0}
                      fontScale={0.72}
                      compact
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: safeDuration }, (_, index) => {
              const names = parseChordCell(chords[index]).map((anchor) => anchor.chord).join(' / ');
              return (
                <div key={index} className="relative group overflow-hidden rounded-xl">
                  <input
                    value={names}
                    onChange={(event) => onChordChange(index, smartChordCase(event.target.value))}
                    className="w-full bg-slate-950 p-3 pt-4 rounded-xl outline-none text-center font-mono font-black text-yellow-500 border border-white/5 focus:border-yellow-500/50 text-sm transition-all focus:bg-slate-900"
                    placeholder="—"
                    title="Edição rápida: ao alterar aqui, as posições avançadas deste compasso são substituídas por um acorde no início."
                  />
                  <span className="absolute top-1 left-2 text-[8px] font-black text-slate-600 uppercase tracking-wider">
                    C.{index + 1}
                  </span>
                </div>
              );
            })}
          </div>

          <textarea
            value={lyrics}
            placeholder="Letra do bloco…\nUma linha por compasso permite sincronização precisa no preview."
            className="w-full bg-slate-950/50 p-4 rounded-2xl outline-none border border-white/5 min-h-32 text-sm leading-relaxed focus:border-blue-500/40 transition-all"
            onChange={(event) => onLyricsChange(event.target.value)}
          />
          <p className="text-[9px] text-slate-600 leading-relaxed">
            A edição rápida mantém compatibilidade com o formato antigo. Para vários acordes na mesma linha, volte para “Por compasso”.
          </p>
        </div>
      )}

      {hasLyrics && (
        <div
          className={`rounded-xl border px-3 py-2 text-[10px] font-bold leading-relaxed ${
            isSynced
              ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400'
              : 'bg-yellow-500/5 border-yellow-500/15 text-yellow-400'
          }`}
        >
          {isSynced
            ? `Letra sincronizada: ${lyricLineCount} linhas para ${safeDuration} compassos.`
            : extraLines > 0
              ? `Atenção: há ${extraLines} linha(s) de letra a mais que compassos. O renderer mostrará a letra do bloco em modo livre até você alinhar.`
              : `Faltam ${missingLines} linha(s) para casar letra e compassos. Linhas vazias também contam como compassos instrumentais.`}
        </div>
      )}
    </div>
  );
}
