'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlignLeft, Check, Clock3, MousePointer2, Plus, Rows3, X } from 'lucide-react';
import { ChordLyricLine } from '@/components/SongStageRenderer';
import { parseChordCell, serializeChordAnchors, type ChordAnchor } from '@/lib/songStage';
import { buildChordPalette, normalizeChordInput, type ChordPaletteEntry } from '@/lib/chordPalette';

type SongTimingEditorProps = {
  duration: number;
  chords: string[];
  lyrics: string;
  onDurationChange: (value: number) => void;
  onChordChange: (index: number, value: string) => void;
  onLyricsChange: (value: string) => void;
  keySignature?: string;
  maxMeasures?: number;
};

function uniqueStrings(items: string[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  keySignature = '',
  maxMeasures = 16,
}: SongTimingEditorProps) {
  const [mode, setMode] = useState<'sync' | 'free'>('sync');
  const [anchorDrafts, setAnchorDrafts] = useState<Record<number, string>>({});
  const [enabledChords, setEnabledChords] = useState<string[]>([]);
  const [customPalette, setCustomPalette] = useState<ChordPaletteEntry[]>([]);
  const [customChordDraft, setCustomChordDraft] = useState('');
  const [lyricPoolDraft, setLyricPoolDraft] = useState('');
  const [lyricPoolLines, setLyricPoolLines] = useState<string[]>([]);
  const [lyricPoolCursor, setLyricPoolCursor] = useState(0);
  const [ignoreBlankLyricPoolLines, setIgnoreBlankLyricPoolLines] = useState(true);
  const safeDuration = Math.max(1, Math.min(maxMeasures, Number(duration) || 1));

  const suggestedPalette = useMemo(() => buildChordPalette(keySignature), [keySignature]);

  const usedChords = useMemo(
    () =>
      uniqueStrings(
        chords.flatMap((cell) => parseChordCell(cell).map((anchor) => String(anchor.chord || '').trim())),
      ),
    [chords],
  );

  useEffect(() => {
    const defaults = suggestedPalette.map((entry) => entry.chord);
    setEnabledChords(uniqueStrings([...defaults, ...usedChords]));
    setCustomPalette((prev) => prev.filter((entry) => usedChords.includes(entry.chord)));
  }, [keySignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (usedChords.length === 0) return;
    setEnabledChords((prev) => uniqueStrings([...prev, ...usedChords]));
  }, [usedChords]);

  const paletteEntries = useMemo(() => {
    const byChord = new Map<string, ChordPaletteEntry>();
    suggestedPalette.forEach((entry) => byChord.set(entry.chord, entry));
    customPalette.forEach((entry) => byChord.set(entry.chord, entry));
    usedChords.forEach((chord) => {
      if (!byChord.has(chord)) byChord.set(chord, { chord, degree: 'extra', kind: 'custom' });
    });
    return [...byChord.values()];
  }, [customPalette, suggestedPalette, usedChords]);

  const activePalette = useMemo(
    () => paletteEntries.filter((entry) => enabledChords.includes(entry.chord)),
    [enabledChords, paletteEntries],
  );

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

  const nextLyricPoolLine = lyricPoolLines[lyricPoolCursor] ?? '';
  const lyricPoolRemaining = Math.max(0, lyricPoolLines.length - lyricPoolCursor);

  const loadLyricPool = () => {
    const normalized = String(lyricPoolDraft || '').replace(/\r\n?/g, '\n');
    const prepared = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => (ignoreBlankLyricPoolLines ? line.length > 0 : true));

    setLyricPoolLines(prepared);
    setLyricPoolCursor(0);
  };

  const clearLyricPool = () => {
    setLyricPoolDraft('');
    setLyricPoolLines([]);
    setLyricPoolCursor(0);
  };

  const changeLyricLine = (index: number, value: string) => {
    const next = rawLines.length ? [...rawLines] : [];
    while (next.length < safeDuration) next.push('');
    next[index] = value;
    onLyricsChange(next.join('\n'));
  };

  const useNextLyricLine = (measureIndex: number) => {
    if (lyricPoolCursor >= lyricPoolLines.length) return;
    changeLyricLine(measureIndex, lyricPoolLines[lyricPoolCursor] ?? '');
    setLyricPoolCursor((current) => Math.min(lyricPoolLines.length, current + 1));
  };

  const fillEmptyMeasuresFromLyricPool = () => {
    if (lyricPoolCursor >= lyricPoolLines.length) return;

    const next = rawLines.length ? [...rawLines] : [];
    while (next.length < safeDuration) next.push('');

    let cursor = lyricPoolCursor;
    for (let index = 0; index < safeDuration && cursor < lyricPoolLines.length; index += 1) {
      if (String(next[index] || '').trim()) continue;
      next[index] = lyricPoolLines[cursor] ?? '';
      cursor += 1;
    }

    onLyricsChange(next.join('\n'));
    setLyricPoolCursor(cursor);
  };

  const setAnchors = (measureIndex: number, anchors: ChordAnchor[]) => {
    onChordChange(measureIndex, serializeChordAnchors(anchors));
  };

  const addAnchor = (measureIndex: number, charIndex: number) => {
    const chord = normalizeChordInput(String(anchorDrafts[measureIndex] || ''));
    if (!chord) return;

    const current = parseChordCell(chords[measureIndex]);
    const next = current.filter((anchor) => anchor.charIndex !== charIndex);
    next.push({ chord, charIndex });
    setAnchors(measureIndex, next);
  };

  const removeAnchor = (measureIndex: number, charIndex: number) => {
    const current = parseChordCell(chords[measureIndex]);
    setAnchors(measureIndex, current.filter((anchor) => anchor.charIndex !== charIndex));
  };

  const togglePaletteChord = (chord: string) => {
    setEnabledChords((prev) =>
      prev.includes(chord) ? prev.filter((item) => item !== chord) : [...prev, chord],
    );
  };

  const addCustomChord = () => {
    const chord = normalizeChordInput(customChordDraft);
    if (!chord) return;
    setCustomPalette((prev) => {
      if (prev.some((entry) => entry.chord === chord)) return prev;
      return [...prev, { chord, degree: 'extra', kind: 'custom' }];
    });
    setEnabledChords((prev) => uniqueStrings([...prev, chord]));
    setCustomChordDraft('');
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

      <div className="rounded-2xl border border-blue-500/15 bg-blue-500/[0.04] p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-300">Paleta rápida do bloco</p>
            <p className="mt-1 text-[11px] text-slate-500 max-w-2xl">
              {suggestedPalette.length > 0
                ? `Tom ${keySignature}: escolha os acordes que podem aparecer neste bloco. Depois você só seleciona o acorde e toca na posição da letra.`
                : 'Defina o tom da música para gerar automaticamente a escala, sétimas e inversões comuns.'}
            </p>
          </div>
          {suggestedPalette.length > 0 && (
            <span className="rounded-lg border border-blue-500/15 bg-blue-500/5 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-blue-300">
              {enabledChords.length} ativos
            </span>
          )}
        </div>

        {paletteEntries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {paletteEntries.map((entry) => {
              const enabled = enabledChords.includes(entry.chord);
              return (
                <button
                  key={`${entry.kind}-${entry.chord}`}
                  type="button"
                  onClick={() => togglePaletteChord(entry.chord)}
                  className={`min-h-10 rounded-xl border px-3 py-2 text-left transition-all ${
                    enabled
                      ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
                      : 'border-white/5 bg-slate-950/50 text-slate-600 hover:text-slate-300'
                  }`}
                  title={enabled ? 'Remover da paleta deste bloco' : 'Usar neste bloco'}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-sm font-black">{entry.chord}</span>
                    <span className="text-[9px] font-black uppercase tracking-wider opacity-60">{entry.degree}</span>
                    {enabled && <Check size={12} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={customChordDraft}
            onChange={(event) => setCustomChordDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustomChord();
              }
            }}
            placeholder="Outro acorde: F/A, G7, Csus4..."
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-slate-950/70 px-3 font-mono text-sm font-bold text-yellow-300 outline-none focus:border-yellow-500/40"
          />
          <button
            type="button"
            onClick={addCustomChord}
            disabled={!customChordDraft.trim()}
            className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-[10px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-30"
          >
            + Outro acorde
          </button>
        </div>

        {suggestedPalette.length > 0 && (
          <p className="text-[9px] leading-relaxed text-slate-600">
            Padrão maior: <span className="text-slate-500">I · ii7 · iii7 · IV · V · vi7 · vii°</span> + inversões comuns <span className="text-slate-500">I/3 e V/7</span>. Ex.: em C, C · Dm7 · Em7 · F · G · Am7 · B° · C/E · G/B.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-violet-500/15 bg-violet-500/[0.035] p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Banco de letra da música</p>
            <p className="mt-1 text-[11px] text-slate-500 max-w-2xl">
              Cole a letra inteira uma vez. Enquanto você monta os blocos, use a próxima linha em cada compasso sem voltar ao site de letras.
            </p>
          </div>
          {lyricPoolLines.length > 0 && (
            <span className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-violet-300">
              {lyricPoolCursor}/{lyricPoolLines.length} usadas · {lyricPoolRemaining} restantes
            </span>
          )}
        </div>

        <textarea
          value={lyricPoolDraft}
          onChange={(event) => setLyricPoolDraft(event.target.value)}
          rows={6}
          placeholder={"Cole aqui a letra completa da música…\nCada quebra de linha vira uma linha disponível para os compassos."}
          className="w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-relaxed text-slate-200 outline-none focus:border-violet-500/35 resize-y"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-[10px] font-bold text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ignoreBlankLyricPoolLines}
              onChange={(event) => setIgnoreBlankLyricPoolLines(event.target.checked)}
              className="accent-violet-500"
            />
            Ignorar linhas vazias ao preparar
          </label>

          <div className="flex flex-wrap gap-2">
            {lyricPoolLines.length > 0 && (
              <button
                type="button"
                onClick={fillEmptyMeasuresFromLyricPool}
                disabled={lyricPoolRemaining === 0}
                className="min-h-10 rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 text-[9px] font-black uppercase tracking-wider text-violet-300 disabled:opacity-30"
                title="Distribui as próximas linhas somente nos compassos que ainda estão vazios"
              >
                Preencher vazios
              </button>
            )}
            <button
              type="button"
              onClick={loadLyricPool}
              disabled={!lyricPoolDraft.trim()}
              className="min-h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-[9px] font-black uppercase tracking-wider text-slate-300 disabled:opacity-30"
            >
              Preparar linhas
            </button>
            {lyricPoolLines.length > 0 && (
              <button
                type="button"
                onClick={clearLyricPool}
                className="min-h-10 rounded-xl border border-white/5 bg-slate-950/40 px-3 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-red-300"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {lyricPoolLines.length > 0 && (
          <div className="rounded-xl border border-white/5 bg-slate-950/45 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">Próxima linha</p>
                <p className="mt-1 truncate text-sm font-bold text-violet-200">
                  {nextLyricPoolLine || (lyricPoolRemaining === 0 ? 'Todas as linhas foram usadas.' : 'Linha vazia')}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLyricPoolCursor((current) => Math.max(0, current - 1))}
                  disabled={lyricPoolCursor === 0}
                  className="min-h-9 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 text-[9px] font-black uppercase text-slate-500 disabled:opacity-25"
                >
                  ← Voltar 1
                </button>
                <button
                  type="button"
                  onClick={() => setLyricPoolCursor((current) => Math.min(lyricPoolLines.length, current + 1))}
                  disabled={lyricPoolRemaining === 0}
                  className="min-h-9 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 text-[9px] font-black uppercase text-slate-500 disabled:opacity-25"
                >
                  Pular →
                </button>
              </div>
            </div>

            {lyricPoolRemaining > 0 && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {lyricPoolLines.slice(lyricPoolCursor, lyricPoolCursor + 6).map((line, offset) => {
                  const absoluteIndex = lyricPoolCursor + offset;
                  return (
                    <button
                      key={`${absoluteIndex}-${line}`}
                      type="button"
                      onClick={() => setLyricPoolCursor(absoluteIndex)}
                      className={`min-w-[170px] max-w-[240px] rounded-xl border px-3 py-2 text-left transition-all ${
                        offset === 0
                          ? 'border-violet-500/25 bg-violet-500/10 text-violet-200'
                          : 'border-white/5 bg-slate-950/60 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <span className="block text-[8px] font-black uppercase tracking-wider opacity-50">Linha {absoluteIndex + 1}</span>
                      <span className="mt-1 block truncate text-[10px] font-bold">{line || '(linha vazia)'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            Cifra + letra
          </p>
          <p className="text-[11px] text-slate-600 mt-1 max-w-2xl">
            No modo por compasso, selecione um acorde da paleta e toque na palavra exata onde ele entra.
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
            const selectedChord = anchorDrafts[index] || '';

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
                    {lyricPoolRemaining > 0 && (
                      <button
                        type="button"
                        onClick={() => useNextLyricLine(index)}
                        className="mt-2 w-full rounded-xl border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2 text-left text-[9px] font-black text-violet-300 hover:border-violet-500/30 transition-all"
                        title={line.trim() ? 'Substituir a letra deste compasso pela próxima linha do banco' : 'Usar a próxima linha do banco neste compasso'}
                      >
                        <span className="uppercase tracking-wider opacity-60">{line.trim() ? 'Substituir pela próxima' : 'Usar próxima linha'}:</span>{' '}
                        <span className="normal-case tracking-normal text-violet-100">{nextLyricPoolLine || '(linha vazia)'}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-950/60 border border-white/5 p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-yellow-500/80 flex items-center gap-1.5">
                        <MousePointer2 size={12} /> 1. Escolha o acorde · 2. Toque na posição
                      </p>
                      <p className="text-[9px] text-slate-600 mt-1">
                        O acorde selecionado fica ativo para você posicionar quantas vezes precisar.
                      </p>
                    </div>
                    {!!anchors.length && (
                      <span className="text-[9px] font-black uppercase text-emerald-400/80">
                        {anchors.length} posição{anchors.length === 1 ? '' : 'ões'}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {activePalette.map((entry) => {
                      const selected = selectedChord === entry.chord;
                      return (
                        <button
                          key={`${index}-${entry.chord}`}
                          type="button"
                          onClick={() => setAnchorDrafts((prev) => ({ ...prev, [index]: entry.chord }))}
                          className={`min-h-9 rounded-lg border px-2.5 py-1.5 transition-all ${
                            selected
                              ? 'border-yellow-400/50 bg-yellow-500/15 text-yellow-200 shadow-[0_0_18px_rgba(234,179,8,0.08)]'
                              : 'border-white/5 bg-slate-900/80 text-slate-400 hover:border-yellow-500/25 hover:text-yellow-300'
                          }`}
                        >
                          <span className="font-mono text-xs font-black">{entry.chord}</span>
                          {entry.degree !== 'extra' && (
                            <span className="ml-1.5 text-[8px] font-black uppercase opacity-50">{entry.degree}</span>
                          )}
                        </button>
                      );
                    })}
                    {activePalette.length === 0 && (
                      <span className="text-[10px] text-slate-700 italic">
                        Ative acordes na paleta do bloco acima ou adicione um acorde personalizado.
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-600">Selecionado:</span>
                    <span className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs font-black ${
                      selectedChord
                        ? 'border-yellow-500/25 bg-yellow-500/10 text-yellow-300'
                        : 'border-white/5 bg-white/[0.02] text-slate-700'
                    }`}>
                      {selectedChord || 'nenhum'}
                    </span>
                    {selectedChord && (
                      <button
                        type="button"
                        onClick={() => addAnchor(index, 0)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-white"
                        title="Colocar no início deste compasso"
                      >
                        <Plus size={11} className="inline mr-1" /> Início
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 min-h-10 items-center">
                    {line.trim() ? (
                      words.map((word) => (
                        <button
                          key={word.key}
                          type="button"
                          onClick={() => addAnchor(index, word.start)}
                          disabled={!selectedChord}
                          className="px-2 py-1.5 rounded-lg border border-white/5 bg-slate-900/80 text-xs font-bold text-slate-300 hover:border-yellow-500/30 hover:text-yellow-300 disabled:opacity-35 disabled:hover:text-slate-300"
                          title={selectedChord ? `Colocar ${selectedChord} sobre “${word.label}”` : 'Escolha um acorde da paleta primeiro'}
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
                    onChange={(event) => onChordChange(index, normalizeChordInput(event.target.value))}
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
