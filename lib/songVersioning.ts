import { supabase } from '@/lib/supabase';

export type SongSnapshotBlock = {
  client_id: string;
  tipo: string;
  nome_personalizado: string | null;
  letra: string | null;
  acordes: string | null;
  duracao_compassos: number;
};

export type SongSnapshotV1 = {
  schema: 1;
  musica: {
    titulo: string;
    artista: string;
    tom: string;
    bpm: string;
    categoria: string;
    lead_vocal_id: string;
    lead_vocal_custom: string;
  };
  blocos: SongSnapshotBlock[];
  timeline_client_ids: string[];
};

export type ActiveMemberIdentity = {
  id: string | null;
  nome: string | null;
};

function makeClientId() {
  return `cid_${Date.now()}_${Math.random().toString(16).slice(2)}_${Math.random().toString(16).slice(2)}`;
}

export function readActiveMemberIdentity(): ActiveMemberIdentity {
  if (typeof window === 'undefined') return { id: null, nome: null };
  try {
    const raw = window.localStorage.getItem('usuario_ativo');
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      id: parsed?.id ? String(parsed.id) : null,
      nome: parsed?.nome ? String(parsed.nome) : null,
    };
  } catch {
    return { id: null, nome: null };
  }
}

export function snapshotFingerprint(snapshot: SongSnapshotV1) {
  return JSON.stringify(snapshot);
}

export async function fetchRepertoireSnapshot(orgId: string, songId: string): Promise<SongSnapshotV1> {
  const [musicaRes, blocosRes, estruturaRes] = await Promise.all([
    supabase
      .from('repertorio')
      .select('id,titulo,artista,tom,bpm,categoria,lead_vocal_id,lead_vocal_custom')
      .eq('id', songId)
      .eq('org_id', orgId)
      .single(),
    supabase
      .from('musica_blocos')
      .select('id,client_id,tipo,nome_personalizado,letra,acordes,duracao_compassos')
      .eq('repertorio_id', songId),
    supabase
      .from('musica_estrutura')
      .select('bloco_id,posicao')
      .eq('repertorio_id', songId)
      .order('posicao'),
  ]);

  if (musicaRes.error) throw musicaRes.error;
  if (blocosRes.error) throw blocosRes.error;
  if (estruturaRes.error) throw estruturaRes.error;

  const musica: any = musicaRes.data || {};
  const rawBlocks = (blocosRes.data || []) as any[];

  const clientIdByRealId = new Map<string, string>();
  const blocks: SongSnapshotBlock[] = rawBlocks.map((block) => {
    const clientId = String(block?.client_id || makeClientId());
    if (block?.id) clientIdByRealId.set(String(block.id), clientId);
    return {
      client_id: clientId,
      tipo: String(block?.tipo || 'Verso'),
      nome_personalizado: block?.nome_personalizado ? String(block.nome_personalizado) : null,
      letra: block?.letra ? String(block.letra) : null,
      acordes: block?.acordes ? String(block.acordes) : null,
      duracao_compassos: Math.max(1, Number(block?.duracao_compassos || 4) || 4),
    };
  });

  const timelineClientIds = ((estruturaRes.data || []) as any[])
    .map((row) => clientIdByRealId.get(String(row?.bloco_id || '')) || '')
    .filter(Boolean);

  return {
    schema: 1,
    musica: {
      titulo: String(musica?.titulo || ''),
      artista: String(musica?.artista || ''),
      tom: String(musica?.tom || ''),
      bpm: musica?.bpm == null ? '' : String(musica.bpm),
      categoria: String(musica?.categoria || 'Moderada'),
      lead_vocal_id: musica?.lead_vocal_id ? String(musica.lead_vocal_id) : musica?.lead_vocal_custom ? 'custom' : '',
      lead_vocal_custom: String(musica?.lead_vocal_custom || ''),
    },
    blocos: blocks,
    timeline_client_ids: timelineClientIds,
  };
}

export async function archiveCurrentRepertoireVersion(args: {
  orgId: string;
  songId: string;
  reason?: string;
}) {
  const snapshot = await fetchRepertoireSnapshot(args.orgId, args.songId);
  const actor = readActiveMemberIdentity();

  const { error } = await supabase.from('repertorio_versoes').insert({
    org_id: args.orgId,
    repertorio_id: args.songId,
    motivo: args.reason || 'before_save',
    membro_id: actor.id,
    membro_nome: actor.nome,
    snapshot,
  });

  if (error) throw error;

  // Retenção simples: as 30 versões mais recentes por música são suficientes
  // para recuperação prática e evitam crescimento infinito durante testes.
  const { data: rows, error: listError } = await supabase
    .from('repertorio_versoes')
    .select('id')
    .eq('org_id', args.orgId)
    .eq('repertorio_id', args.songId)
    .order('created_at', { ascending: false })
    .limit(60);

  if (!listError && rows && rows.length > 30) {
    const oldIds = rows.slice(30).map((row: any) => row.id).filter(Boolean);
    if (oldIds.length) {
      await supabase.from('repertorio_versoes').delete().in('id', oldIds);
    }
  }

  return snapshot;
}
