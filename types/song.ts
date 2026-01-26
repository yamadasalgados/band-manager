// types/song.ts
export interface Song {
  id: string;
  titulo: string;
  bpm: number;
  tom: string;
  cifrasResumo: string; // Ex: "G | D | Em | C"
  letra: string;
  leadVocal: string;
  referencia: string; // Link YouTube/Spotify
}