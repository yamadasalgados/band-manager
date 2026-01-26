'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  ListOrdered,
  CheckCircle2,
  Clock,
  Music,
  GitMerge,
  Search,
  XCircle,
  Timer,
  Loader2,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

// ✅ Contexto e Segurança
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';

type BlocoDB = {
  id: string; // local (temp/import/db)
  repertorio_id?: string;
  client_id?: string | null; // ✅ NOVO (estável, usado pra salvar sem duplicar)
  tipo: string;
  nome_personalizado?: string | null;
  letra?: string | null;
  acordes?: string | null; // no DB é TEXT
  duracao_compassos?: number | null;
  __imported?: boolean;
};

function makeClientId() {
  // id bem estável e único (sem libs)
  return `cid_${Date.now()}_${Math.random().toString(16).slice(2)}_${Math.random().toString(16).slice(2)}`;
}

// Garante que TODO bloco no estado tenha um client_id
function ensureClientId(b: BlocoDB): BlocoDB {
  if (b.client_id && String(b.client_id).trim()) return b;
  return { ...b, client_id: makeClientId() };
}

export default function EditarMusica() {
  const router = useRouter();
  const { id } = useParams();
  const { org } = useOrg();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [membros, setMembros] = useState<any[]>([]);

  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [musicasCatalogo, setMusicasCatalogo] = useState<any[]>([]);
  const [termoBusca, setTermoBusca] = useState('');

  const [dadosBase, setDadosBase] = useState({
    titulo: '',
    artista: '',
    tom: '',
    bpm: '',
    categoria: 'Moderada',
    lead_vocal_id: '',
    lead_vocal_custom: '',
  });

  const [blocosDisponiveis, setBlocosDisponiveis] = useState<BlocoDB[]>([]);
  const [timeline, setTimeline] = useState<BlocoDB[]>([]);

  // =========================
  // ✅ Transposição (Música toda)
  // =========================
  const [transposeUI, setTransposeUI] = useState<{ from: string; to: string }>({ from: '', to: '' });

  // backup p/ reverter (apenas sessão atual)
  const transposeBackupRef = useRef<{
    tom: string;
    blocosDisponiveis: BlocoDB[];
    timeline: BlocoDB[];
    blocoAtual?: any;
    editingBlockId?: string | null;
  } | null>(null);

  const NOTE_TO_INDEX: Record<string, number> = {
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

  const INDEX_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const INDEX_TO_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  function normalizeKeyInput(k: string) {
    // aceita "Am", "A#m", "Bb", "F#", "C", "Dm", etc.
    const raw = String(k || '').trim();
    if (!raw) return { root: '', suffix: '' };

    // root = A-G + (#|b)?
    const m = raw.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!m) return { root: '', suffix: '' };

    const letter = m[1].toUpperCase();
    const accidental = m[2] || '';
    const rest = m[3] || '';

    return { root: `${letter}${accidental}`, suffix: rest }; // suffix mantém "m", "maj7", etc.
  }

  function shouldPreferFlatsByContext(fromKey: string, sampleChordText: string) {
    const t = `${fromKey || ''} ${sampleChordText || ''}`.toLowerCase();
    // se usuário digitou b ou keys típicas com bemol, tende a bemol
    if (t.includes('bb') || t.includes('ab') || t.includes('db') || t.includes('eb') || t.includes('gb')) return true;
    if (t.includes('b') && !t.includes('#')) return true;
    return false;
  }

  function transposeRoot(root: string, semitones: number, preferFlats: boolean) {
    const idx = NOTE_TO_INDEX[root];
    if (idx === undefined) return root;

    const next = (idx + semitones) % 12;
    const fixed = next < 0 ? next + 12 : next;

    return preferFlats ? INDEX_TO_FLAT[fixed] : INDEX_TO_SHARP[fixed];
  }

  function transposeChordToken(token: string, semitones: number, preferFlats: boolean) {
    const t = String(token || '');
    if (!t.trim()) return t;

    // separadores / coisas que não são acorde
    if (t === '|' || t === '/' || t === '-' || t === '—') return t;

    // captura: ROOT + resto (qualidade) + optional /BASS
    // exemplos: "Am", "C#maj7", "Bb7", "F#m7(b5)", "G/B", "D/F#"
    const m = t.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!m) return t;

    const root = `${m[1].toUpperCase()}${m[2] || ''}`;
    const rest = m[3] || '';

    // se tiver slash, transpor o baixo também
    const slashIdx = rest.indexOf('/');
    if (slashIdx >= 0) {
      const before = rest.slice(0, slashIdx); // qualidade
      const after = rest.slice(slashIdx + 1); // baixo (pode vir com qualidade? geralmente não)
      const bassMatch = after.match(/^([A-Ga-g])([#b]?)(.*)$/);

      const newRoot = transposeRoot(root, semitones, preferFlats);

      if (bassMatch) {
        const bassRoot = `${bassMatch[1].toUpperCase()}${bassMatch[2] || ''}`;
        const bassRest = bassMatch[3] || '';
        const newBass = transposeRoot(bassRoot, semitones, preferFlats);
        return `${newRoot}${before}/${newBass}${bassRest}`;
      }

      return `${newRoot}${before}/${after}`;
    }

    const newRoot = transposeRoot(root, semitones, preferFlats);
    return `${newRoot}${rest}`;
  }

  function transposeChordString(text: string | null | undefined, semitones: number, preferFlats: boolean) {
    const raw = String(text || '');
    if (!raw.trim() || semitones === 0) return raw;

    // mantém separadores e espaços: divide por grupos (palavras e não-palavras)
    // Ex: "Am | F G | C/E" -> tokens ["Am"," ","|"," ","F"," ","G"," ","|"," ","C/E"]
    const tokens = raw.split(/(\s+|\|)/g);
    return tokens
      .map((tk) => {
        if (tk === '|' || /^\s+$/.test(tk)) return tk;
        // ainda pode vir "Am-" ou "Am," etc → tenta só transpor o miolo
        // pega primeira “palavra de acorde” até achar um caractere que não faz parte
        const mm = tk.match(/^([A-Ga-g][#b]?(?:[^A-Ga-g\s|]*)?)(.*)$/);
        if (!mm) return tk;

        const chordPart = mm[1] || '';
        const tail = mm[2] || '';
        const transposed = transposeChordToken(chordPart, semitones, preferFlats);
        return `${transposed}${tail}`;
      })
      .join('');
  }

  const semitonesBetweenKeys = useMemo(() => {
    const fromN = normalizeKeyInput(transposeUI.from);
    const toN = normalizeKeyInput(transposeUI.to);
    if (!fromN.root || !toN.root) return 0;

    const a = NOTE_TO_INDEX[fromN.root];
    const b = NOTE_TO_INDEX[toN.root];
    if (a === undefined || b === undefined) return 0;

    // menor distância “para cima” (0..11)
    let diff = b - a;
    diff = ((diff % 12) + 12) % 12;
    return diff;
  }, [transposeUI.from, transposeUI.to]);

  const aplicarTransposicao = useCallback(() => {
    const from = String(transposeUI.from || '').trim();
    const to = String(transposeUI.to || '').trim();
    if (!from || !to) return;

    const nFrom = normalizeKeyInput(from);
    const nTo = normalizeKeyInput(to);
    if (!nFrom.root || !nTo.root) return;

    const a = NOTE_TO_INDEX[nFrom.root];
    const b = NOTE_TO_INDEX[nTo.root];
    if (a === undefined || b === undefined) return;

    let diff = b - a;
    diff = ((diff % 12) + 12) % 12;

    if (diff === 0) {
      // só atualiza o tom “visual” (se quiser)
      setDadosBase((prev) => ({ ...prev, tom: to }));
      return;
    }

    // decide preferir bemol ou sustenido pelo contexto (tom + alguns acordes existentes)
    const sample = `${blocosDisponiveis?.[0]?.acordes || ''} ${timeline?.[0]?.acordes || ''}`;
    const preferFlats = shouldPreferFlatsByContext(from, sample);

    // salva backup uma vez (pra reverter)
    if (!transposeBackupRef.current) {
      transposeBackupRef.current = {
        tom: dadosBase.tom,
        blocosDisponiveis: JSON.parse(JSON.stringify(blocosDisponiveis)),
        timeline: JSON.parse(JSON.stringify(timeline)),
      };
    }

    // atualiza TOM da música (mantém sufixo do "to" como digitado pelo usuário)
    setDadosBase((prev) => ({ ...prev, tom: to }));

    // transpõe catálogo
    setBlocosDisponiveis((prev) =>
      prev.map((b) => ({
        ...b,
        acordes: transposeChordString(b.acordes, diff, preferFlats),
      }))
    );

    // transpõe timeline
    setTimeline((prev) =>
      prev.map((b) => ({
        ...b,
        acordes: transposeChordString(b.acordes, diff, preferFlats),
      }))
    );

    // se estiver editando agora, transpõe também o editor
    try {
      // @ts-ignore
      if (typeof setBlocoAtual === 'function') {
        // nada
      }
    } catch {}
  }, [transposeUI.from, transposeUI.to, blocosDisponiveis, timeline, dadosBase.tom]);

  const reverterTransposicao = useCallback(() => {
    const bk = transposeBackupRef.current;
    if (!bk) return;

    setDadosBase((prev) => ({ ...prev, tom: bk.tom }));
    setBlocosDisponiveis(bk.blocosDisponiveis as any);
    setTimeline(bk.timeline as any);

    transposeBackupRef.current = null;
  }, []);

  const KEYS = useMemo(
    () => ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'],
    []
  );

  // =========================
  // ✅ Editor de bloco (NOVO + EDITAR)
  // =========================
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null); // null = criando novo
  const [blocoAtual, setBlocoAtual] = useState<{
    tipo: string;
    nome_personalizado: string;
    letra: string;
    acordes: string[];
    duracao_compassos: number;
  }>({
    tipo: 'Verso',
    nome_personalizado: '',
    letra: '',
    acordes: Array(4).fill(''),
    duracao_compassos: 4,
  });

  const isEditing = !!editingBlockId;
  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  // --- CÁLCULO DE DURAÇÃO ESTIMADA ---
  const duracaoEstimada = useMemo(() => {
    const bpm = parseInt(dadosBase.bpm) || 120;
    const totalCompassos = timeline.reduce((acc, b) => acc + (b.duracao_compassos || 0), 0);
    const segundosTotais = (totalCompassos * 4 / bpm) * 60;
    const minutos = Math.floor(segundosTotais / 60);
    const segundos = Math.round(segundosTotais % 60);
    return `${minutos}:${segundos < 10 ? '0' : ''}${segundos}`;
  }, [timeline, dadosBase.bpm]);

  // =========================
  // ✅ Helpers acordes (DB <-> Editor)
  // =========================
  const parseAcordesToArray = useCallback((acordesText: string | null | undefined, duracao: number) => {
    const raw = String(acordesText || '').trim();
    const parts =
      raw.length === 0
        ? []
        : raw
            .split('|')
            .map((p) => p.trim())
            .filter(Boolean);

    const out = Array(Math.max(1, duracao)).fill('');
    for (let i = 0; i < out.length; i++) out[i] = parts[i] || '';
    return out;
  }, []);

  const formatAcordesToText = useCallback((arr: string[]) => {
    const cleaned = (arr || []).map((x) => String(x || '').trim());
    return cleaned.join(' | ').trim();
  }, []);

  // =========================
  // ✅ Carregar dados
  // =========================
  const carregarDados = useCallback(async () => {
    if (!org?.id || !id) return;

    setLoading(true);
    try {
      const { data: membrosData } = await supabase
        .from('membros')
        .select('id, nome')
        .eq('org_id', org.id)
        .order('nome');
      if (membrosData) setMembros(membrosData);

      const { data: musica } = await supabase
        .from('repertorio')
        .select('*')
        .eq('id', id)
        .eq('org_id', org.id)
        .single();

      if (musica) {
        const tomCarregado = musica.tom || '';
        setDadosBase({
          titulo: musica.titulo || '',
          artista: musica.artista || '',
          tom: tomCarregado,
          bpm: musica.bpm?.toString() || '',
          categoria: musica.categoria || 'Moderada',
          lead_vocal_id: musica.lead_vocal_id || (musica.lead_vocal_custom ? 'custom' : ''),
          lead_vocal_custom: musica.lead_vocal_custom || '',
        });

        // inicializa transposição (from = tom atual)
        setTransposeUI({ from: tomCarregado, to: tomCarregado });
        transposeBackupRef.current = null;
      }

      const { data: blocos } = await supabase.from('musica_blocos').select('*').eq('repertorio_id', id);

      if (blocos) {
        // ✅ garante client_id em todos
        const blocosComClient = (blocos as any[]).map((b) => ensureClientId(b as BlocoDB));
        setBlocosDisponiveis(blocosComClient);

        const { data: estrutura } = await supabase
          .from('musica_estrutura')
          .select('bloco_id')
          .eq('repertorio_id', id)
          .order('posicao');

        if (estrutura) {
          const timelineMontada = estrutura
            .map((e: any) => blocosComClient.find((b) => String(b.id) === String(e.bloco_id)))
            .filter(Boolean) as BlocoDB[];

          setTimeline(timelineMontada);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar:', error);
    } finally {
      setLoading(false);
    }
  }, [id, org?.id]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // =========================
  // ✅ Importação
  // =========================
  async function abrirModalImportacao() {
    if (!org?.id) return;
    const { data } = await supabase
      .from('repertorio')
      .select('id, titulo, artista')
      .eq('org_id', org.id)
      .order('titulo');
    if (data) setMusicasCatalogo(data);
    setMostrarImportar(true);
  }

  async function importarEstrutura(musicaOrigemId: string) {
    const { data: blocosOrigem } = await supabase.from('musica_blocos').select('*').eq('repertorio_id', musicaOrigemId);
    const { data: estruturaOrigem } = await supabase
      .from('musica_estrutura')
      .select('bloco_id, posicao')
      .eq('repertorio_id', musicaOrigemId)
      .order('posicao');

    if (blocosOrigem && estruturaOrigem) {
      const novosDisponiveis = [...blocosDisponiveis];

      const blocosParaTimeline = estruturaOrigem
        .map((est: any) => {
          const b = (blocosOrigem as any[]).find((ob: any) => String(ob.id) === String(est.bloco_id));
          if (!b) return null;

          // ✅ IMPORTADO = novo bloco local, com client_id novo, pra não conflitar
          const novoBlocoTemp: BlocoDB = ensureClientId({
            ...(b as any),
            __imported: true,
            id: `import-${Date.now()}-${Math.random()}`, // id local
            client_id: null, // força gerar novo
          });

          novosDisponiveis.push(novoBlocoTemp);
          return novoBlocoTemp;
        })
        .filter(Boolean) as BlocoDB[];

      setBlocosDisponiveis(novosDisponiveis);
      setTimeline([...timeline, ...blocosParaTimeline]);
      setMostrarImportar(false);
    }
  }

  // =========================
  // ✅ Edição de bloco (abrir / salvar / cancelar)
  // =========================
  const abrirEdicaoDoBloco = useCallback(
    (b: BlocoDB) => {
      const dur = Number(b.duracao_compassos || 4) || 4;

      setEditingBlockId(String(b.id));
      setBlocoAtual({
        tipo: String(b.tipo || 'Verso'),
        nome_personalizado: String(b.nome_personalizado || ''),
        letra: String(b.letra || ''),
        duracao_compassos: dur,
        acordes: parseAcordesToArray(b.acordes, dur),
      });

      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {}
    },
    [parseAcordesToArray]
  );

  const resetEditorParaNovo = useCallback(() => {
    setEditingBlockId(null);
    setBlocoAtual({
      tipo: 'Verso',
      nome_personalizado: '',
      letra: '',
      acordes: Array(4).fill(''),
      duracao_compassos: 4,
    });
  }, []);

  const salvarEdicaoDoBloco = useCallback(() => {
    if (!editingBlockId) return;

    const payloadAtualizado: Partial<BlocoDB> = {
      id: editingBlockId,
      tipo: blocoAtual.tipo,
      nome_personalizado: blocoAtual.nome_personalizado || null,
      letra: blocoAtual.letra || null,
      duracao_compassos: blocoAtual.duracao_compassos,
      acordes: formatAcordesToText(blocoAtual.acordes),
    };

    setBlocosDisponiveis((prev) =>
      prev.map((b) => (String(b.id) === String(editingBlockId) ? ({ ...b, ...payloadAtualizado } as BlocoDB) : b))
    );

    setTimeline((prev) =>
      prev.map((b) => (String(b.id) === String(editingBlockId) ? ({ ...b, ...payloadAtualizado } as BlocoDB) : b))
    );

    resetEditorParaNovo();
  }, [editingBlockId, blocoAtual, formatAcordesToText, resetEditorParaNovo]);

  // =========================
  // ✅ Catálogo: remover bloco
  // =========================
  const removerBlocoDoCatalogo = (idBloco: string) => {
    if (editingBlockId && String(editingBlockId) === String(idBloco)) resetEditorParaNovo();
    setBlocosDisponiveis((prev) => prev.filter((b) => String(b.id) !== String(idBloco)));
    setTimeline((prev) => prev.filter((b) => String(b.id) !== String(idBloco)));
  };

  // =========================
  // ✅ Editor: duração e acordes
  // =========================
  const handleCompassoChange = (valor: number) => {
    const v = Math.max(1, Math.min(16, Number(valor || 1)));
    const prevDur = blocoAtual.duracao_compassos;
    if (v === prevDur) return;

    const novosAcordes = [...blocoAtual.acordes];

    if (v > prevDur) {
      const diferenca = v - prevDur;
      setBlocoAtual({
        ...blocoAtual,
        duracao_compassos: v,
        acordes: [...novosAcordes, ...Array(diferenca).fill('')],
      });
    } else {
      setBlocoAtual({
        ...blocoAtual,
        duracao_compassos: v,
        acordes: novosAcordes.slice(0, v),
      });
    }
  };

  const updateAcordeNoCompasso = (idx: number, v: string) => {
    const n = [...blocoAtual.acordes];
    n[idx] = v.toUpperCase();
    setBlocoAtual({ ...blocoAtual, acordes: n });
  };

  // =========================
  // ✅ Criar novo bloco
  // =========================
  const adicionarBlocoAoCatalogo = () => {
    if (isEditing) {
      salvarEdicaoDoBloco();
      return;
    }

    const letraOk = !!blocoAtual.letra?.trim();
    const acordesOk = blocoAtual.acordes.some((a) => String(a || '').trim() !== '');
    const nomeOk = !!blocoAtual.nome_personalizado?.trim();
    if (!letraOk && !acordesOk && !nomeOk) return;

    const novo: BlocoDB = ensureClientId({
      id: `temp-${Date.now()}-${Math.random()}`,
      tipo: blocoAtual.tipo,
      nome_personalizado: blocoAtual.nome_personalizado || null,
      letra: blocoAtual.letra || null,
      acordes: formatAcordesToText(blocoAtual.acordes),
      duracao_compassos: blocoAtual.duracao_compassos,
    });

    setBlocosDisponiveis((prev) => [...prev, novo]);

    setBlocoAtual({
      ...blocoAtual,
      nome_personalizado: '',
      letra: '',
      acordes: Array(blocoAtual.duracao_compassos).fill(''),
    });
  };

  // =========================
  // ✅ Salvar música no banco (À PROVA DE DUPLICADOS)
  // =========================
  async function atualizarMusica() {
    if (!org?.id) return;
    setSaving(true);

    try {
      const payload = {
        titulo: dadosBase.titulo,
        artista: dadosBase.artista || null,
        tom: dadosBase.tom || null,
        bpm: dadosBase.bpm ? parseInt(dadosBase.bpm) : null,
        categoria: dadosBase.categoria,
        lead_vocal_id: dadosBase.lead_vocal_id === 'custom' || !dadosBase.lead_vocal_id ? null : dadosBase.lead_vocal_id,
        lead_vocal_custom: dadosBase.lead_vocal_id === 'custom' ? dadosBase.lead_vocal_custom : null,
      };

      // 1) atualiza música
      await supabase.from('repertorio').update(payload).eq('id', id).eq('org_id', org.id);

      // 2) apaga estrutura e blocos antigos
      await supabase.from('musica_estrutura').delete().eq('repertorio_id', id);
      await supabase.from('musica_blocos').delete().eq('repertorio_id', id);

      // 3) garante que todos blocos do catálogo tenham client_id
      const catalogoComClient = blocosDisponiveis.map((b) => ensureClientId(b));

      // também sincroniza state (opcional, mas ajuda a manter consistente depois)
      setBlocosDisponiveis(catalogoComClient);

      // 4) insere blocos com client_id no banco
      const inserts = catalogoComClient.map(({ id: _localId, __imported: _imp, ...rest }) => ({
        ...rest,
        repertorio_id: id,
        client_id: rest.client_id ? String(rest.client_id) : makeClientId(),
        tipo: String(rest.tipo || 'Verso'),
        nome_personalizado: rest.nome_personalizado ? String(rest.nome_personalizado) : null,
        letra: rest.letra ? String(rest.letra) : null,
        acordes: rest.acordes ? String(rest.acordes) : null,
        duracao_compassos: Number(rest.duracao_compassos || 4) || 4,
      }));

      const { data: novos, error: errInsert } = await supabase.from('musica_blocos').insert(inserts).select();
      if (errInsert) throw errInsert;

      const novosList = (novos as any[]) || [];

      // 5) monta map client_id -> id_real
      const mapClientToReal = new Map<string, string>();
      for (const nb of novosList) {
        if (nb?.client_id && nb?.id) mapClientToReal.set(String(nb.client_id), String(nb.id));
      }

      // 6) monta estrutura usando client_id
      //    ⚠️ se na timeline tiver bloco sem client_id (não deveria), tentamos achar no catálogo e usar o dele.
      const getClientIdForTimelineItem = (item: BlocoDB) => {
        if (item.client_id) return String(item.client_id);

        // tenta achar no catálogo pelo id local
        const found = catalogoComClient.find((b) => String(b.id) === String(item.id));
        if (found?.client_id) return String(found.client_id);

        // fallback final: cria um novo (mas aí não vai achar no map → não entra na estrutura)
        return '';
      };

      const estrutura = timeline
        .map((item, index) => {
          const cid = getClientIdForTimelineItem(item);
          const realId = cid ? mapClientToReal.get(cid) : undefined;
          if (!realId) return null;

          return {
            repertorio_id: id,
            bloco_id: realId,
            posicao: index + 1,
          };
        })
        .filter(Boolean) as Array<{ repertorio_id: any; bloco_id: string; posicao: number }>;

      if (estrutura.length > 0) {
        const { error: errEstrutura } = await supabase.from('musica_estrutura').insert(estrutura);
        if (errEstrutura) throw errEstrutura;
      }

      alert('Projeto Salvo!');
      router.push('/repertorio');
    } catch (err: any) {
      alert(err?.message || 'Erro ao salvar');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // =========================
  // UI
  // =========================
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-blue-500 font-black animate-pulse gap-2">
        <Loader2 className="animate-spin" /> CARREGANDO...
      </div>
    );
  }

  if (!org) return null;

  return (
    <SubscriptionGuard>
      <div className="min-h-screen bg-slate-950 text-white p-6 pb-32 font-sans">
        {/* MODAL IMPORTAÇÃO */}
        {mostrarImportar && (
          <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md p-6 flex flex-col items-center justify-center">
            <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-[3rem] p-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-black uppercase italic flex items-center gap-3">
                  <GitMerge className="text-blue-500" /> Importar de Outra Obra
                </h2>
                <button onClick={() => setMostrarImportar(false)}>
                  <XCircle className="text-slate-500" />
                </button>
              </div>

              <div className="relative mb-6">
                <Search className="absolute left-4 top-3.5 size-4 text-slate-500" />
                <input
                  placeholder="Buscar no catálogo..."
                  className="w-full bg-slate-950 p-4 pl-12 rounded-2xl border border-white/5 outline-none focus:border-blue-500 font-bold"
                  onChange={(e) => setTermoBusca(e.target.value)}
                />
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {musicasCatalogo
                  .filter((m) => m.titulo.toLowerCase().includes(termoBusca.toLowerCase()))
                  .map((m) => (
                    <button
                      key={m.id}
                      onClick={() => importarEstrutura(m.id)}
                      className="w-full p-4 bg-slate-950 border border-white/5 rounded-2xl flex justify-between items-center hover:border-blue-500 transition-all"
                    >
                      <span className="font-black uppercase text-sm tracking-tight">{m.titulo}</span>
                      <Plus size={18} className="text-blue-500" />
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* HEADER */}
        <header className="max-w-6xl mx-auto flex justify-between items-center mb-10 pt-4">
          <Link href="/" className="group block transition-transform active:scale-95">
            <div>
              <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">{org.nome || 'Banda'}</h2>
              <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors">
                editar
                <br />
                música
              </h1>
            </div>
          </Link>

          <button
            onClick={() => router.back()}
            className="text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Voltar
          </button>
        </header>

        <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* COLUNA ESQUERDA */}
          <div className="space-y-6">
            {/* 1. DADOS BÁSICOS */}
            <section className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 space-y-5 shadow-2xl">
              <h2 className="text-blue-500 text-[14px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                <CheckCircle2 size={14} /> 1. Propriedades
              </h2>

              <input
                value={dadosBase.titulo}
                placeholder="Título da Música"
                className="w-full bg-slate-950/50 p-5 rounded-2xl border border-white/5 focus:border-blue-500 outline-none font-bold text-lg"
                onChange={(e) => setDadosBase({ ...dadosBase, titulo: e.target.value })}
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-xs font-black text-slate-500 uppercase block mb-1">Tom</span>
                  <input
                    value={dadosBase.tom}
                    placeholder="Ex: Am"
                    className="bg-transparent w-full outline-none font-bold text-yellow-500 capitalize text-lg"
                    onChange={(e) => {
                      const v = e.target.value;
                      setDadosBase({ ...dadosBase, tom: v });
                      // mantém transposição alinhada com a edição manual
                      setTransposeUI((p) => ({ ...p, from: p.from || v, to: p.to || v }));
                    }}
                  />
                </div>

                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-xs font-black text-slate-500 uppercase block mb-1">BPM</span>
                  <input
                    value={dadosBase.bpm}
                    placeholder="120"
                    type="number"
                    className="bg-transparent w-full outline-none font-bold text-blue-400 text-lg"
                    onChange={(e) => setDadosBase({ ...dadosBase, bpm: e.target.value })}
                  />
                </div>
              </div>

              {/* ✅ Transposição da música inteira */}
              <div className="bg-slate-950/40 p-4 rounded-2xl border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Transpor música inteira</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-yellow-500/80">
                    +{semitonesBetweenKeys} semitons
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-950/60 p-3 rounded-2xl border border-white/5">
                    <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Tom original</span>
                    <select
                      value={transposeUI.from}
                      onChange={(e) => setTransposeUI((p) => ({ ...p, from: e.target.value }))}
                      className="w-full bg-transparent outline-none font-black text-sm"
                    >
                      <option value="" className="bg-slate-900">
                        —
                      </option>
                      {KEYS.map((k) => (
                        <option key={`from-${k}`} value={k} className="bg-slate-900">
                          {k}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-600 font-bold mt-1">Use o tom “como veio” (original).</p>
                  </div>

                  <div className="bg-slate-950/60 p-3 rounded-2xl border border-white/5">
                    <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Tom p/ tocar</span>
                    <select
                      value={transposeUI.to}
                      onChange={(e) => setTransposeUI((p) => ({ ...p, to: e.target.value }))}
                      className="w-full bg-transparent outline-none font-black text-sm"
                    >
                      <option value="" className="bg-slate-900">
                        —
                      </option>
                      {KEYS.map((k) => (
                        <option key={`to-${k}`} value={k} className="bg-slate-900">
                          {k}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-600 font-bold mt-1">Isso atualiza o tom + todos acordes.</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={aplicarTransposicao}
                    className="flex-1 py-3 rounded-2xl font-black uppercase text-[12px] tracking-widest border border-yellow-500/20 bg-yellow-500/10 text-yellow-400 hover:border-yellow-500/40 hover:text-white transition-all"
                    title="Transpõe todos os acordes do catálogo + timeline e ajusta o tom"
                  >
                    Aplicar transposição
                  </button>

                  <button
                    type="button"
                    onClick={reverterTransposicao}
                    disabled={!transposeBackupRef.current}
                    className={cn(
                      'px-4 py-3 rounded-2xl font-black uppercase text-[12px] tracking-widest border transition-all flex items-center gap-2',
                      transposeBackupRef.current
                        ? 'border-white/10 bg-slate-950/50 text-slate-200 hover:bg-white/5'
                        : 'border-white/5 bg-slate-950/20 text-slate-600 cursor-not-allowed'
                    )}
                    title="Reverte para o estado antes da transposição (somente nesta tela)"
                  >
                    <RotateCcw size={14} className="text-slate-400" />
                    Reverter
                  </button>
                </div>
              </div>

              <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                <span className="text-xs font-black text-slate-500 uppercase block mb-2 tracking-widest">Leading vocal</span>
                <select
                  value={dadosBase.lead_vocal_id}
                  className="w-full bg-transparent outline-none font-bold text-sm"
                  onChange={(e) => setDadosBase({ ...dadosBase, lead_vocal_id: e.target.value })}
                >
                  <option value="">Selecione um cantor</option>
                  {membros.map((m) => (
                    <option key={m.id} value={m.id} className="bg-slate-900">
                      {m.nome}
                    </option>
                  ))}
                  <option value="custom" className="bg-slate-900">
                    Personalizado
                  </option>
                </select>

                {dadosBase.lead_vocal_id === 'custom' && (
                  <input
                    value={dadosBase.lead_vocal_custom}
                    placeholder="Nome do cantor..."
                    className="w-full bg-slate-900 p-3 rounded-xl outline-none border border-blue-500/30 mt-3 text-sm"
                    onChange={(e) => setDadosBase({ ...dadosBase, lead_vocal_custom: e.target.value })}
                  />
                )}
              </div>
            </section>

            {/* 2. DESIGN DE BLOCOS */}
            <section className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 space-y-6 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-blue-500 text-[14px] font-black uppercase tracking-[0.3em]">
                    2. {isEditing ? 'Editar Bloco' : 'Design de Novos Blocos'}
                  </h2>
                  {isEditing && (
                    <p className="text-[10px] text-yellow-400 font-black uppercase tracking-widest mt-1">
                      Modo edição ativo — salvando atualiza catálogo + timeline
                    </p>
                  )}
                </div>

                {isEditing && (
                  <button
                    onClick={resetEditorParaNovo}
                    className="px-3 py-2 rounded-2xl border border-white/10 bg-slate-950/40 text-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all flex items-center gap-2"
                    title="Cancelar edição"
                  >
                    <RotateCcw size={14} className="text-slate-400" />
                    Cancelar
                  </button>
                )}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar relative">
                {['Intro', 'Verso', 'Pré-Refrão', 'Refrão', 'Ponte', 'Idioma', 'Break'].map((t) => {
                  const isActive = blocoAtual.tipo === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setBlocoAtual({ ...blocoAtual, tipo: t })}
                      className={cn(
                        'px-5 py-2.5 rounded-xl text-[12px] font-black uppercase flex-shrink-0 transition-all relative group',
                        isActive ? 'bg-blue-500/10 text-blue-400 scale-105' : 'bg-slate-800 text-slate-500 hover:text-white'
                      )}
                    >
                      {t}
                      {isActive && (
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="bg-slate-950/30 p-4 rounded-2xl border border-white/5 space-y-2">
                <span className="text-xs font-black text-slate-500 uppercase block tracking-widest">Nome personalizado (opcional)</span>
                <input
                  value={blocoAtual.nome_personalizado}
                  placeholder="Ex: Verso 1 (JP), Refrão final..."
                  className="w-full bg-slate-950/50 p-4 rounded-2xl border border-white/5 focus:border-blue-500 outline-none font-bold text-sm"
                  onChange={(e) => setBlocoAtual({ ...blocoAtual, nome_personalizado: e.target.value })}
                />
              </div>

              <div className="space-y-3 bg-slate-950/30 p-4 rounded-2xl border border-white/5">
                <div className="flex justify-between text-[14px] font-black uppercase text-slate-500">
                  <span className="flex items-center gap-2">
                    <Clock size={12} /> Extensão
                  </span>
                  <span className="text-yellow-500">{blocoAtual.duracao_compassos} Compassos</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="16"
                  step="1"
                  value={blocoAtual.duracao_compassos}
                  onChange={(e) => handleCompassoChange(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {blocoAtual.acordes.map((acorde, idx) => (
                  <div key={idx} className="relative">
                    <input
                      value={acorde}
                      onChange={(e) => updateAcordeNoCompasso(idx, e.target.value)}
                      className="w-full bg-slate-950 p-3 rounded-xl outline-none text-center font-mono font-black text-yellow-500 border border-white/5 focus:border-yellow-500/50 text-xs"
                      placeholder="-"
                    />
                    <span className="absolute -top-1.5 left-2 text-[11px] font-black text-slate-600 bg-slate-900 px-1 rounded">
                      C.{idx + 1}
                    </span>
                  </div>
                ))}
              </div>

              <textarea
                value={blocoAtual.letra}
                placeholder="Letra do bloco..."
                className="w-full bg-slate-950/50 p-5 rounded-2xl outline-none border border-white/5 h-24 text-sm focus:border-yellow-500/30 transition-all"
                onChange={(e) => setBlocoAtual({ ...blocoAtual, letra: e.target.value })}
              />

              <button
                onClick={adicionarBlocoAoCatalogo}
                className={cn(
                  'w-full py-5 rounded-2xl font-black uppercase text-[14px] tracking-widest transition-all border shadow-xl flex items-center justify-center gap-2',
                  isEditing
                    ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400 hover:border-yellow-500/40 hover:text-white'
                    : 'bg-blue-500/5 border-yellow-500/20 text-blue-500 hover:border-blue-500/40 hover:text-white'
                )}
              >
                {isEditing ? (
                  <>
                    <Save size={18} /> salvar edição
                  </>
                ) : (
                  <>
                    <Plus size={18} /> adicionar bloco
                  </>
                )}
              </button>
            </section>
          </div>

          {/* COLUNA DIREITA - TIMELINE */}
          <div className="space-y-6">
            <section className="bg-slate-900 p-8 rounded-[2.5rem] min-h-[600px] flex flex-col border border-white/5 space-y-5 shadow-2xl">
              <h2 className="text-blue-500 text-[14px] font-black uppercase tracking-[0.3em] mb-8 flex items-center gap-2">
                <ListOrdered size={16} /> 3. Estrutura (Timeline)
              </h2>

              {/* CATÁLOGO + REMOVER + EDITAR */}
              <div className="flex flex-wrap gap-2 mb-10">
                {blocosDisponiveis.map((b: any, i: number) => {
                  const imported = !!b.__imported;
                  const label = b.nome_personalizado?.trim() ? b.nome_personalizado : b.tipo;

                  return (
                    <div key={b.id || i} className="group relative">
                      <button
                        onClick={() => setTimeline((prev) => [...prev, b])}
                        className={cn(
                          'px-4 py-2.5 rounded-xl text-[10px] font-black border transition-all pr-16 truncate max-w-[220px]',
                          imported
                            ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border-yellow-500/20'
                            : 'bg-emerald-500/5 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'
                        )}
                        title={imported ? 'Importado p/ Medley (clique adiciona na timeline)' : 'Adicionar na timeline'}
                      >
                        + {label}
                      </button>

                      {/* ✏️ Editar */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirEdicaoDoBloco(b);
                        }}
                        className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-blue-500/50 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Ver/Editar bloco"
                      >
                        <Pencil size={12} />
                      </button>

                      {/* 🗑 Remover */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removerBlocoDoCatalogo(b.id);
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-red-500/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remover do catálogo"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}

                <button
                  onClick={abrirModalImportacao}
                  className="flex items-center gap-2 bg-blue-600/10 text-blue-500 px-3 py-1.5 rounded-full text-[14px] font-black uppercase border border-blue-500/20 hover:bg-blue-600 hover:text-white transition-all"
                >
                  <GitMerge size={15} /> Importar P/ Medley
                </button>
              </div>

              {/* LISTA TIMELINE */}
              <div className="space-y-3 flex-1 pr-2">
                {timeline.map((b: any, i: number) => {
                  const imported = !!b.__imported;
                  const label = b.nome_personalizado?.trim() ? b.nome_personalizado : b.tipo;

                  return (
                    <div
                      key={`${b.id || i}-${i}`}
                      className={cn(
                        'flex justify-between items-center p-5 rounded-[1.5rem] border group transition-all shadow-lg animate-in slide-in-from-right-4 duration-300 cursor-pointer',
                        imported
                          ? 'bg-yellow-500/5 border-yellow-500/20 hover:border-yellow-500/40 shadow-yellow-500/10'
                          : 'bg-green-500/5 border-green-500/20 hover:border-green-500/40 shadow-green-500/10'
                      )}
                      style={{ animationDelay: `${i * 50}ms` }}
                      title="Clique para ver/editar este bloco"
                      onClick={() => abrirEdicaoDoBloco(b)}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-[14px] font-black text-slate-600 bg-slate-950 size-7 flex items-center justify-center rounded-full border border-white/5">
                          {i + 1}
                        </span>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-black uppercase tracking-tighter">{label}</span>

                            <span
                              className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded font-black italic',
                                imported ? 'bg-yellow-500/10 text-yellow-500' : 'bg-emerald-500/10 text-emerald-500'
                              )}
                            >
                              {b.duracao_compassos} COMP
                            </span>

                            {imported && (
                              <span className="text-[10px] bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-yellow-500/15">
                                MEDLEY
                              </span>
                            )}
                          </div>

                          <p className="text-[20px] text-yellow-500/70 font-mono mt-1 truncate max-w-[220px]">
                            {b.acordes || 'S/ Acordes'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicaoDoBloco(b);
                          }}
                          className="p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Editar bloco"
                        >
                          <Pencil size={16} className="text-slate-600 hover:text-blue-400" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const n = [...timeline];
                            n.splice(i, 1);
                            setTimeline(n);
                          }}
                          className="p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remover da timeline"
                        >
                          <Trash2 size={16} className="text-slate-600 hover:text-red-500" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {timeline.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center opacity-20">
                    <Music size={48} className="mb-4" />
                    <p className="text-[14px] font-black uppercase tracking-widest italic">Timeline Vazia</p>
                  </div>
                )}
              </div>

              {/* DURAÇÃO ESTIMADA */}
              <div className="flex items-center justify-center gap-2 text-blue-400 font-mono text-[14px] font-black uppercase tracking-widest mt-4">
                <Timer size={12} /> Duração Estimada: {duracaoEstimada}
              </div>

              {/* BOTÃO FINALIZAR */}
              <button
                onClick={atualizarMusica}
                disabled={saving}
                className="w-full bg-blue-500/5 border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] tracking-widest active:scale-95 flex items-center justify-center gap-3 hover:border-blue-500/40 shadow-blue-500/10 hover:text-white transition-all border border-yellow-500/20 shadow-xl"
              >
                {saving ? (
                  <>
                    <Loader2 className="animate-spin" size={20} /> GRAVANDO...
                  </>
                ) : (
                  <>
                    <Save size={20} /> Gravar Arquitetura
                  </>
                )}
              </button>
            </section>
          </div>
        </main>
      </div>
    </SubscriptionGuard>
  );
}
