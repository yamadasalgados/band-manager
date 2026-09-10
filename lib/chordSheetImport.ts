import type { ChordAnchor } from '@/lib/songStage';

export type ImportedChordCue = {
  id: string;
  section: string;
  lyric: string;
  anchors: ChordAnchor[];
  chords: string[];
  kind: 'lyric' | 'chord-only';
  rawChordLine?: string;
  sourceLine: number;
};

export type ImportedChordSection = {
  label: string;
  startIndex: number;
  cueCount: number;
};

export type ParsedChordSheet = {
  keySignature: string;
  cues: ImportedChordCue[];
  sections: ImportedChordSection[];
  warnings: string[];
};

const SECTION_NAMES = [
  'intro',
  'introdução',
  'introducao',
  'verso',
  'estrofe',
  'pré-refrão',
  'pre-refrão',
  'pré refrão',
  'pre refrao',
  'refrão',
  'refrao',
  'ponte',
  'bridge',
  'chorus',
  'verse',
  'pre-chorus',
  'solo',
  'instrumental',
  'interlúdio',
  'interludio',
  'final',
  'outro',
  'parte',
];

const META_PREFIXES = [
  'afinação:',
  'afinacao:',
  'capotraste:',
  'capo:',
  'composição:',
  'composicao:',
  'acordes:',
  'tablatura:',
];

function normalizeLine(value: string) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\t/g, '    ').replace(/\r/g, '');
}

function normalizeSectionLabel(value: string) {
  const cleaned = String(value || '')
    .replace(/^\[|\]$/g, '')
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Trecho';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isSectionName(value: string) {
  const lower = String(value || '').toLowerCase().trim();
  return SECTION_NAMES.some((name) => lower === name || lower.startsWith(`${name} `) || lower.startsWith(`${name} `));
}

function parseSection(line: string): { label: string; trailing: string } | null {
  const trimmed = line.trim();
  const bracket = trimmed.match(/^\[([^\]]{1,60})\]\s*(.*)$/);
  if (bracket && isSectionName(bracket[1])) {
    return { label: normalizeSectionLabel(bracket[1]), trailing: bracket[2] || '' };
  }

  const colon = trimmed.match(/^([^:]{1,60}):\s*(.*)$/);
  if (colon && isSectionName(colon[1])) {
    return { label: normalizeSectionLabel(colon[1]), trailing: colon[2] || '' };
  }

  if (isSectionName(trimmed) && trimmed.length <= 40) {
    return { label: normalizeSectionLabel(trimmed), trailing: '' };
  }

  return null;
}

function cleanChordToken(raw: string) {
  return String(raw || '')
    .trim()
    .replace(/^[|:;,]+|[|:;,]+$/g, '')
    .replace(/^\((.+)\)$/, '$1');
}

export function isLikelyChordToken(raw: string) {
  const token = cleanChordToken(raw);
  if (!token) return false;
  if (/^(?:N\.?C\.?|%|x\d+|\d+x)$/i.test(token)) return true;

  // Deliberadamente permissivo: cobre C, Dm7, F#m7(11), Bb7M/D, C#°, G4, A7(13), etc.
  return /^[A-G](?:#|b)?(?:(?:maj|min|dim|aug|sus|add|m|M|°|º|\+|-)?(?:\d|M|m|°|º|\+|-|sus|add|dim|aug|maj|min|\(|\)|#|b)*)?(?:\/[A-G](?:#|b)?)?$/i.test(token);
}

function chordTokensWithColumns(line: string) {
  const result: Array<{ chord: string; column: number }> = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const chord = cleanChordToken(match[0]);
    if (!isLikelyChordToken(chord)) continue;
    if (/^(?:%|x\d+|\d+x)$/i.test(chord)) continue;
    result.push({ chord, column: match.index });
  }
  return result;
}

function isChordLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^tom\s*:/i.test(trimmed)) return false;

  const rawTokens = trimmed.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return false;
  const chordCount = rawTokens.filter((token) => isLikelyChordToken(token)).length;
  if (chordCount === 0) return false;

  // Evita classificar frases normais como cifra quando começam por A, D, E etc.
  return chordCount / rawTokens.length >= 0.7;
}

function anchorsFromChordLine(chordLine: string, lyric: string): ChordAnchor[] {
  const tokens = chordTokensWithColumns(chordLine);
  if (tokens.length === 0) return [];

  const lyricLength = Math.max(0, lyric.length);
  return tokens.map((item, index) => {
    let charIndex = item.column;
    if (lyricLength > 0) {
      charIndex = Math.max(0, Math.min(lyricLength, item.column));
    } else if (tokens.length > 1) {
      // Em trecho instrumental preserva a ordem relativa mesmo sem letra.
      charIndex = index * 4;
    } else {
      charIndex = 0;
    }
    return { chord: item.chord, charIndex };
  });
}

function parseInlineChords(line: string): { lyric: string; anchors: ChordAnchor[] } | null {
  if (!/\[[A-G][^\]]*\]/i.test(line)) return null;

  const anchors: ChordAnchor[] = [];
  let lyric = '';
  let cursor = 0;
  const regex = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    lyric += line.slice(cursor, match.index);
    const chord = cleanChordToken(match[1]);
    if (isLikelyChordToken(chord)) {
      anchors.push({ chord, charIndex: lyric.length });
    } else {
      lyric += match[0];
    }
    cursor = match.index + match[0].length;
  }
  lyric += line.slice(cursor);

  if (anchors.length === 0) return null;
  return { lyric: lyric.trimEnd(), anchors };
}

function detectKey(lines: string[]) {
  for (const raw of lines.slice(0, 40)) {
    const match = raw.match(/\bTom\s*:\s*([A-G](?:#|b)?m?)\b/i);
    if (match) {
      const value = match[1];
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
  }
  return '';
}

function shouldIgnoreMetadata(line: string) {
  const lower = line.trim().toLowerCase();
  if (!lower) return false;
  if (/^tom\s*:/i.test(line)) return true;
  return META_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function parseChordSheet(input: string): ParsedChordSheet {
  const lines = String(input || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine);

  const cues: ImportedChordCue[] = [];
  const warnings: string[] = [];
  let section = 'Música';
  let cueId = 0;

  const pushCue = (cue: Omit<ImportedChordCue, 'id' | 'chords'>) => {
    const chords = cue.anchors.map((anchor) => anchor.chord);
    cues.push({ ...cue, chords, id: `import-${cueId++}` });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (shouldIgnoreMetadata(raw)) continue;

    const sectionInfo = parseSection(raw);
    if (sectionInfo) {
      section = sectionInfo.label;
      if (sectionInfo.trailing.trim()) {
        const trailing = sectionInfo.trailing;
        if (isChordLine(trailing)) {
          pushCue({
            section,
            lyric: '',
            anchors: anchorsFromChordLine(trailing, ''),
            kind: 'chord-only',
            rawChordLine: trailing,
            sourceLine: index + 1,
          });
        }
      }
      continue;
    }

    const inline = parseInlineChords(raw);
    if (inline) {
      pushCue({
        section,
        lyric: inline.lyric.trim(),
        anchors: inline.anchors,
        kind: inline.lyric.trim() ? 'lyric' : 'chord-only',
        rawChordLine: raw,
        sourceLine: index + 1,
      });
      continue;
    }

    if (isChordLine(raw)) {
      // Cifra tradicional: linha de acordes imediatamente acima da letra.
      let nextIndex = index + 1;
      while (nextIndex < lines.length && !lines[nextIndex].trim()) nextIndex += 1;
      const nextLine = lines[nextIndex] || '';
      const nextSection = nextLine ? parseSection(nextLine) : null;

      if (nextLine && !nextSection && !isChordLine(nextLine) && !shouldIgnoreMetadata(nextLine)) {
        pushCue({
          section,
          lyric: nextLine.trimEnd(),
          anchors: anchorsFromChordLine(raw, nextLine),
          kind: 'lyric',
          rawChordLine: raw,
          sourceLine: index + 1,
        });
        index = nextIndex;
      } else {
        pushCue({
          section,
          lyric: '',
          anchors: anchorsFromChordLine(raw, ''),
          kind: 'chord-only',
          rawChordLine: raw,
          sourceLine: index + 1,
        });
      }
      continue;
    }

    // Linha de letra sem acorde explícito.
    pushCue({
      section,
      lyric: trimmed,
      anchors: [],
      kind: 'lyric',
      sourceLine: index + 1,
    });
  }

  const sections: ImportedChordSection[] = [];
  cues.forEach((cue, index) => {
    const existing = sections.find((item) => item.label === cue.section);
    if (existing) {
      existing.cueCount += 1;
    } else {
      sections.push({ label: cue.section, startIndex: index, cueCount: 1 });
    }
  });

  if (cues.length === 0 && String(input || '').trim()) {
    warnings.push('Nenhuma linha de letra/acorde foi reconhecida. Revise a formatação copiada.');
  }
  if (cues.length > 0 && cues.every((cue) => cue.anchors.length === 0)) {
    warnings.push('A letra foi reconhecida, mas nenhuma linha de acordes foi detectada.');
  }

  return {
    keySignature: detectKey(lines),
    cues,
    sections,
    warnings,
  };
}
