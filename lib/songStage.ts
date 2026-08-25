export type StageViewMode = 'both' | 'chords' | 'lyrics';
export type StagePresentationMode = 'slides' | 'scroll';

export type ChordAnchor = {
  chord: string;
  charIndex: number;
};

export type StageBlockInput = {
  id?: string;
  tempId?: string;
  tipo?: string | null;
  nome_personalizado?: string | null;
  letra?: string | null;
  acordes?: string | null;
  duracao_compassos?: number | null;
};

export type StageLine = {
  measureIndex: number;
  lyric: string;
  chordCell: string;
  anchors: ChordAnchor[];
};

export type StageBlock = {
  label: string;
  duration: number;
  lyricsSynced: boolean;
  lines: StageLine[];
};

export function clampStage(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function stageBlockLabel(block: StageBlockInput | null | undefined) {
  const custom = String(block?.nome_personalizado || '').trim();
  return custom || String(block?.tipo || 'Bloco');
}

/**
 * Backward-compatible chord-cell format.
 *
 * Legacy:   Em
 * Pro:      Em@7;Bm@24
 *
 * Each measure is still separated in musica_blocos.acordes by "|".
 * Inside one measure, multiple anchors are separated by ";" and @ stores the
 * zero-based character position in that lyric line. No database migration is
 * required because the column remains plain text.
 */
export function parseChordCell(raw: string | null | undefined): ChordAnchor[] {
  const value = String(raw || '').trim();
  if (!value) return [];

  const pieces = value.includes('@') ? value.split(';') : [value];
  const anchors: ChordAnchor[] = [];

  for (const pieceRaw of pieces) {
    const piece = pieceRaw.trim();
    if (!piece) continue;

    const match = piece.match(/^(.*)@(-?\d+)$/);
    if (match) {
      const chord = String(match[1] || '').trim();
      const charIndex = Math.max(0, Number(match[2]) || 0);
      if (chord) anchors.push({ chord, charIndex });
      continue;
    }

    // Legacy value: one chord at the beginning of the line.
    anchors.push({ chord: piece, charIndex: 0 });
  }

  const byPosition = new Map<number, ChordAnchor>();
  anchors.forEach((anchor) => byPosition.set(anchor.charIndex, anchor));
  return [...byPosition.values()].sort((a, b) => a.charIndex - b.charIndex);
}

export function serializeChordAnchors(anchors: ChordAnchor[]) {
  const normalized = [...anchors]
    .filter((anchor) => String(anchor?.chord || '').trim())
    .map((anchor) => ({
      chord: String(anchor.chord).trim(),
      charIndex: Math.max(0, Math.round(Number(anchor.charIndex) || 0)),
    }))
    .sort((a, b) => a.charIndex - b.charIndex);

  if (!normalized.length) return '';
  if (normalized.length === 1 && normalized[0].charIndex === 0) return normalized[0].chord;
  return normalized.map((anchor) => `${anchor.chord}@${anchor.charIndex}`).join(';');
}

export function mapChordCellChords(
  raw: string | null | undefined,
  mapChord: (chord: string) => string,
) {
  const anchors = parseChordCell(raw);
  if (!anchors.length) return String(raw || '');
  return serializeChordAnchors(
    anchors.map((anchor) => ({ ...anchor, chord: mapChord(anchor.chord) })),
  );
}

export function chordCellNames(raw: string | null | undefined) {
  return parseChordCell(raw).map((anchor) => anchor.chord);
}

export function buildChordGuide(
  lyric: string,
  anchors: ChordAnchor[],
  transformChord: (chord: string) => string = (chord) => chord,
) {
  if (!anchors.length) return '';

  const maxAnchor = anchors.reduce((max, anchor) => {
    const chord = transformChord(anchor.chord);
    return Math.max(max, anchor.charIndex + chord.length);
  }, lyric.length);

  const chars = Array.from({ length: Math.max(1, maxAnchor) }, () => ' ');

  anchors.forEach((anchor) => {
    const chord = transformChord(anchor.chord);
    const start = Math.max(0, Math.min(anchor.charIndex, Math.max(0, chars.length - 1)));
    for (let index = 0; index < chord.length; index += 1) {
      const target = start + index;
      if (target >= chars.length) chars.push(chord[index]);
      else chars[target] = chord[index];
    }
  });

  return chars.join('').replace(/\s+$/g, '');
}

export function parseStageBlocks(blocks: StageBlockInput[]): StageBlock[] {
  return (blocks || []).map((block) => {
    const duration = Math.max(1, Number(block?.duracao_compassos) || 1);
    const chordCells = String(block?.acordes || '')
      .split('|')
      .map((item) => item.trim());
    const lyricText = String(block?.letra || '').replace(/\r\n/g, '\n');
    const lyricLines = lyricText ? lyricText.split('\n') : [];
    const hasLyrics = lyricLines.some((line) => line.trim().length > 0);
    const lyricsSynced = !hasLyrics || lyricLines.length === duration;
    const lineCount = lyricsSynced ? duration : Math.max(duration, lyricLines.length);

    return {
      label: stageBlockLabel(block),
      duration,
      lyricsSynced,
      lines: Array.from({ length: lineCount }, (_, index) => {
        const chordCell = chordCells[index] || '';
        return {
          measureIndex: Math.min(index, duration - 1),
          lyric: lyricLines[index] || '',
          chordCell,
          anchors: parseChordCell(chordCell),
        };
      }),
    };
  });
}

export function transposeStageChord(chord: string, diff: number) {
  if (!chord || diff === 0) return chord;
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flats: Record<string, string> = {
    Db: 'C#',
    Eb: 'D#',
    Gb: 'F#',
    Ab: 'G#',
    Bb: 'A#',
  };

  return chord.replace(/[A-G](?:#|b)?/g, (match) => {
    const normalized = flats[match] || match;
    const index = notes.indexOf(normalized);
    if (index < 0) return match;
    const next = ((index + diff) % 12 + 12) % 12;
    return notes[next];
  });
}
