export type ChordPaletteEntry = {
  chord: string;
  degree: string;
  kind: 'diatonic' | 'inversion' | 'custom';
};

const NOTE_INDEX: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
  'B#': 0,
};

const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_MAJOR_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']);
const FLAT_MINOR_KEYS = new Set(['Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);

function normalizeRoot(raw: string) {
  const match = String(raw || '').trim().match(/^([A-Ga-g])([#b]?)(m?)/);
  if (!match) return null;

  const root = `${match[1].toUpperCase()}${match[2] || ''}`;
  if (NOTE_INDEX[root] === undefined) return null;

  return {
    root,
    minor: match[3] === 'm',
  };
}

function noteAt(root: string, semitones: number, preferFlats: boolean) {
  const start = NOTE_INDEX[root];
  if (start === undefined) return root;
  const index = (start + semitones + 1200) % 12;
  return (preferFlats ? FLAT_NOTES : SHARP_NOTES)[index];
}

function slash(chord: string, bass: string) {
  return `${chord}/${bass}`;
}

/**
 * Paleta rápida derivada do tom da música.
 *
 * Em tonalidades maiores segue o formato usado no fluxo do Band Manager:
 * I, ii7, iii7, IV, V, vi7, vii° + duas inversões muito comuns (I/3 e V/7).
 * Ex.: C, Dm7, Em7, F, G, Am7, B°, C/E, G/B.
 *
 * Em tonalidades menores usamos a escala menor natural como sugestão inicial.
 * A paleta é apenas um atalho: o editor continua aceitando acordes fora dela.
 */
export function buildChordPalette(keySignature: string): ChordPaletteEntry[] {
  const parsed = normalizeRoot(keySignature);
  if (!parsed) return [];

  const { root, minor } = parsed;
  const keyName = `${root}${minor ? 'm' : ''}`;
  const preferFlats = root.includes('b') || (minor ? FLAT_MINOR_KEYS.has(keyName) : FLAT_MAJOR_KEYS.has(root));

  if (minor) {
    const offsets = [0, 2, 3, 5, 7, 8, 10];
    const qualities = ['m', '°', '', 'm7', 'm7', '', ''];
    const degrees = ['1m', '2°', 'b3', '4m7', '5m7', 'b6', 'b7'];
    const scale = offsets.map((offset, index) => ({
      chord: `${noteAt(root, offset, preferFlats)}${qualities[index]}`,
      degree: degrees[index],
      kind: 'diatonic' as const,
    }));

    const tonicBass = noteAt(root, 3, preferFlats);
    const fifthRoot = noteAt(root, 7, preferFlats);
    const fifthBass = noteAt(root, 10, preferFlats);

    return [
      ...scale,
      { chord: slash(scale[0].chord, tonicBass), degree: '1/b3', kind: 'inversion' },
      { chord: slash(`${fifthRoot}m7`, fifthBass), degree: '5/b7', kind: 'inversion' },
    ];
  }

  const offsets = [0, 2, 4, 5, 7, 9, 11];
  const qualities = ['', 'm7', 'm7', '', '', 'm7', '°'];
  const degrees = ['1', '2m7', '3m7', '4', '5', '6m7', '7°'];
  const scale = offsets.map((offset, index) => ({
    chord: `${noteAt(root, offset, preferFlats)}${qualities[index]}`,
    degree: degrees[index],
    kind: 'diatonic' as const,
  }));

  const tonicThird = noteAt(root, 4, preferFlats);
  const fifthRoot = noteAt(root, 7, preferFlats);
  const fifthThird = noteAt(root, 11, preferFlats);

  return [
    ...scale,
    { chord: slash(scale[0].chord, tonicThird), degree: '1/3', kind: 'inversion' },
    { chord: slash(fifthRoot, fifthThird), degree: '5/7', kind: 'inversion' },
  ];
}

export function normalizeChordInput(value: string) {
  return String(value || '')
    .trim()
    .replace(/^([a-g])/, (letter) => letter.toUpperCase())
    .replace(/\/([a-g])/, (_, letter: string) => `/${letter.toUpperCase()}`);
}
