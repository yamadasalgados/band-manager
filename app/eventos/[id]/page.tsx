'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Gauge,
  ListMusic,
  Loader2,
  MapPin,
  Music2,
  PackageCheck,
  Palette,
  Phone,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  Volume2,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sendPush } from '@/lib/push/sendPush';
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';
import EventPalettePicker, { paletteColorsFor } from '@/components/EventPalettePicker';

type StageBlock = {
  duracao_compassos?: number | null;
  letra?: string | null;
  acordes?: string | null;
};

type StageStructure = {
  posicao?: number | null;
  bloco?: StageBlock | null;
};

type Song = {
  id: string;
  titulo?: string | null;
  artista?: string | null;
  tom?: string | null;
  bpm?: number | null;
  categoria?: string | null;
  estrutura?: StageStructure[] | null;
};

type SetlistItem = {
  id: string;
  ordem?: number | null;
  repertorio?: Song | null;
};

type ScaleMember = {
  id?: string | null;
  membro_id?: string | null;
  status?: string | null;
  membros?: {
    id?: string | null;
    nome?: string | null;
    funcao?: string | null;
    subfuncao?: string | string[] | null;
  } | null;
};

type EventPreparationMode = 'simples' | 'completo';

type EventInfo = {
  id: string;
  local?: string | null;
  data?: string | null;
  paleta_cores?: string | null;
  recorrencia_id?: string | null;
  finalizado?: boolean | null;
  modo_preparacao?: EventPreparationMode | null;
};


type EventOperation = {
  org_id: string;
  evento_id: string;
  chegada_em?: string | null;
  passagem_som_em?: string | null;
  endereco?: string | null;
  mapa_url?: string | null;
  contato_nome?: string | null;
  contato_telefone?: string | null;
  observacoes?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

type OperationDraft = {
  chegada_em: string;
  passagem_som_em: string;
  endereco: string;
  mapa_url: string;
  contato_nome: string;
  contato_telefone: string;
  observacoes: string;
};

type ChecklistCategory = 'equipamento' | 'palco' | 'logistica' | 'outro';

type ChecklistItem = {
  id: number | string;
  org_id: string;
  evento_id: string;
  titulo: string;
  categoria: ChecklistCategory;
  concluido?: boolean | null;
  ordem?: number | null;
  responsavel_membro_id?: string | null;
  concluido_por?: string | null;
  concluido_em?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const EMPTY_OPERATION_DRAFT: OperationDraft = {
  chegada_em: '',
  passagem_som_em: '',
  endereco: '',
  mapa_url: '',
  contato_nome: '',
  contato_telefone: '',
  observacoes: '',
};

const BASE_CHECKLIST: Array<{ titulo: string; categoria: ChecklistCategory }> = [
  { titulo: 'Instrumentos principais', categoria: 'equipamento' },
  { titulo: 'Cabos, fontes e extensões', categoria: 'equipamento' },
  { titulo: 'Pedais, cases e suportes', categoria: 'equipamento' },
  { titulo: 'Microfones e pedestais', categoria: 'palco' },
  { titulo: 'Retornos / in-ear', categoria: 'palco' },
  { titulo: 'Água, toalhas e apoio de palco', categoria: 'logistica' },
  { titulo: 'Contato / pagamento / documentos do local', categoria: 'logistica' },
];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function norm(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function eventDateLabel(value?: string | null) {
  if (!value) return 'Data não definida';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não definida';
  return date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function eventTimeLabel(value?: string | null) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function countdownLabel(value: string | null | undefined, nowMs: number) {
  if (!value) return 'Data pendente';
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return 'Data pendente';

  const diff = target - nowMs;
  const now = new Date(nowMs);
  const targetDate = new Date(target);
  const sameDay =
    now.getFullYear() === targetDate.getFullYear() &&
    now.getMonth() === targetDate.getMonth() &&
    now.getDate() === targetDate.getDate();

  if (sameDay) return diff > 0 ? `Hoje • ${eventTimeLabel(value)}` : 'Hoje • horário iniciado';
  if (diff <= 0) return 'Data passada';

  const totalMinutes = Math.max(1, Math.floor(diff / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function durationForSong(song?: Song | null) {
  const bpm = Number(song?.bpm || 0);
  if (!Number.isFinite(bpm) || bpm <= 0) return null;

  const structures = Array.isArray(song?.estrutura) ? song!.estrutura! : [];
  const measures = structures.reduce((sum, entry) => {
    const raw = Number(entry?.bloco?.duracao_compassos || 0);
    return sum + (Number.isFinite(raw) && raw > 0 ? raw : 0);
  }, 0);

  if (measures <= 0) return null;
  return (measures * 4 * 60) / bpm;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours > 0) return `${hours}h ${String(restMinutes).padStart(2, '0')}min`;
  return `${Math.max(1, minutes)}min`;
}


function toDateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateTimeShort(value?: string | null) {
  if (!value) return 'Não definido';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não definido';
  return date.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function operationToDraft(operation?: EventOperation | null): OperationDraft {
  return {
    chegada_em: toDateTimeInput(operation?.chegada_em),
    passagem_som_em: toDateTimeInput(operation?.passagem_som_em),
    endereco: String(operation?.endereco || ''),
    mapa_url: String(operation?.mapa_url || ''),
    contato_nome: String(operation?.contato_nome || ''),
    contato_telefone: String(operation?.contato_telefone || ''),
    observacoes: String(operation?.observacoes || ''),
  };
}

function categoryLabel(value?: string | null) {
  if (value === 'equipamento') return 'Equipamento';
  if (value === 'palco') return 'Palco';
  if (value === 'logistica') return 'Logística';
  return 'Outro';
}

function energyFor(song?: Song | null): 'Rápida' | 'Moderada' | 'Lenta' | 'Outra' {
  const category = norm(song?.categoria);
  if (category === 'rapida') return 'Rápida';
  if (category === 'moderada') return 'Moderada';
  if (category === 'lenta') return 'Lenta';

  const bpm = Number(song?.bpm || 0);
  if (bpm >= 126) return 'Rápida';
  if (bpm > 0 && bpm <= 90) return 'Lenta';
  if (bpm > 0) return 'Moderada';
  return 'Outra';
}

function lyricsAreSynced(song?: Song | null) {
  const structures = Array.isArray(song?.estrutura) ? song!.estrutura! : [];
  if (structures.length === 0) return false;

  return structures.every((entry) => {
    const block = entry?.bloco;
    if (!block) return false;
    const duration = Math.max(1, Number(block.duracao_compassos) || 1);
    const lyric = String(block.letra || '').replace(/\r\n/g, '\n');
    if (!lyric.trim()) return true;
    return lyric.split('\n').length === duration;
  });
}

export default function EventoPreparationHub() {
  const params = useParams() as { id: string };
  const router = useRouter();
  const { org, loadingOrg } = useOrg();
  const eventId = String(params?.id || '');

  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [setlist, setSetlist] = useState<SetlistItem[]>([]);
  const [scales, setScales] = useState<ScaleMember[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [errorMessage, setErrorMessage] = useState('');
  const [operation, setOperation] = useState<EventOperation | null>(null);
  const [operationDraft, setOperationDraft] = useState<OperationDraft>(EMPTY_OPERATION_DRAFT);
  const [operationEditing, setOperationEditing] = useState(false);
  const [operationSaving, setOperationSaving] = useState(false);
  const [operationalTablesReady, setOperationalTablesReady] = useState(true);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistBusyId, setChecklistBusyId] = useState<string | null>(null);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [newChecklistCategory, setNewChecklistCategory] = useState<ChecklistCategory>('equipamento');
  const [newChecklistResponsible, setNewChecklistResponsible] = useState('');
  const [modeSaving, setModeSaving] = useState(false);
  const [paletteEditing, setPaletteEditing] = useState(false);
  const [paletteSaving, setPaletteSaving] = useState(false);
  const [paletteDraft, setPaletteDraft] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!org?.id || !eventId) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setErrorMessage('');

      try {
        const rawProfile = window.localStorage.getItem('usuario_ativo');
        if (rawProfile) {
          try {
            setProfile(JSON.parse(rawProfile));
          } catch {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }

        const [eventRes, scaleRes, setlistRes, operationRes, checklistRes] = await Promise.all([
          supabase
            .from('eventos')
            .select('id,local,data,paleta_cores,recorrencia_id,finalizado,modo_preparacao')
            .eq('org_id', org.id)
            .eq('id', eventId)
            .single(),
          supabase
            .from('escalas')
            .select('id,membro_id,status,membros!membro_id(id,nome,funcao,subfuncao)')
            .eq('org_id', org.id)
            .eq('evento_id', eventId),
          supabase
            .from('evento_repertorio')
            .select(`
              id,
              ordem,
              repertorio:repertorio (
                id,
                titulo,
                artista,
                tom,
                bpm,
                categoria,
                estrutura:musica_estrutura (
                  posicao,
                  bloco:musica_blocos (duracao_compassos, letra, acordes)
                )
              )
            `)
            .eq('evento_id', eventId)
            .order('ordem', { ascending: true }),
          supabase
            .from('evento_operacao')
            .select('org_id,evento_id,chegada_em,passagem_som_em,endereco,mapa_url,contato_nome,contato_telefone,observacoes,updated_by,updated_at')
            .eq('org_id', org.id)
            .eq('evento_id', eventId)
            .maybeSingle(),
          supabase
            .from('evento_checklist')
            .select('id,org_id,evento_id,titulo,categoria,concluido,ordem,responsavel_membro_id,concluido_por,concluido_em,created_at,updated_at')
            .eq('org_id', org.id)
            .eq('evento_id', eventId)
            .order('ordem', { ascending: true })
            .order('id', { ascending: true }),
        ]);

        if (eventRes.error) throw eventRes.error;
        if (scaleRes.error) throw scaleRes.error;
        if (setlistRes.error) throw setlistRes.error;

        const operationalError = operationRes.error || checklistRes.error;
        setOperationalTablesReady(!operationalError);
        if (operationalError) {
          console.warn('Tabelas operacionais ainda não disponíveis. Execute a migration v13.', operationalError);
        }

        setEventInfo(eventRes.data as EventInfo);
        setPaletteDraft(String((eventRes.data as EventInfo)?.paleta_cores || ''));
        setScales((scaleRes.data as unknown as ScaleMember[]) || []);
        setSetlist((setlistRes.data as unknown as SetlistItem[]) || []);

        if (!operationalError) {
          const nextOperation = (operationRes.data as EventOperation | null) || null;
          setOperation(nextOperation);
          if (!operationEditing) setOperationDraft(operationToDraft(nextOperation));
          setChecklist((checklistRes.data as unknown as ChecklistItem[]) || []);
        }
      } catch (error: any) {
        console.error('Erro ao carregar central do evento:', error);
        setErrorMessage(error?.message || 'Não foi possível carregar os dados do evento.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId, operationEditing, org?.id]
  );

  useEffect(() => {
    if (org?.id && eventId) void load();
  }, [eventId, load, org?.id]);

  const confirmed = useMemo(() => scales.filter((item) => norm(item.status) === 'confirmado'), [scales]);
  const absent = useMemo(() => scales.filter((item) => norm(item.status) === 'falta'), [scales]);
  const unanswered = useMemo(
    () => scales.filter((item) => !['confirmado', 'falta'].includes(norm(item.status))),
    [scales]
  );

  const myScale = useMemo(() => {
    if (!profile?.id) return null;
    return scales.find((item) => String(item?.membro_id || '') === String(profile.id)) || null;
  }, [profile?.id, scales]);

  const songs = useMemo(() => setlist.map((item) => item.repertorio).filter(Boolean) as Song[], [setlist]);
  const isCompleteEvent = eventInfo?.modo_preparacao === 'completo';

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    scales.forEach((item) => {
      const id = String(item?.membro_id || '');
      if (id) map.set(id, String(item?.membros?.nome || 'Integrante'));
    });
    if (profile?.id) map.set(String(profile.id), String(profile?.nome || 'Integrante ativo'));
    return map;
  }, [profile?.id, profile?.nome, scales]);

  const checklistDone = useMemo(() => checklist.filter((item) => item.concluido).length, [checklist]);
  const checklistReady = checklist.length > 0 && checklistDone === checklist.length;
  const operationReady = Boolean(
    operation?.chegada_em &&
      operation?.passagem_som_em &&
      (String(operation?.endereco || '').trim() || String(operation?.mapa_url || '').trim())
  );

  const summary = useMemo(() => {
    const totalDuration = songs.reduce((sum, song) => sum + (durationForSong(song) || 0), 0);
    const withoutDuration = songs.filter((song) => durationForSong(song) === null).length;
    const withoutBpm = songs.filter((song) => !Number(song?.bpm)).length;
    const withoutKey = songs.filter((song) => !String(song?.tom || '').trim()).length;
    const withoutStructure = songs.filter((song) => !Array.isArray(song?.estrutura) || song.estrutura.length === 0).length;
    const freeLyrics = songs.filter((song) => !lyricsAreSynced(song)).length;

    const energy = songs.reduce(
      (acc, song) => {
        const bucket = energyFor(song);
        acc[bucket] += 1;
        return acc;
      },
      { Rápida: 0, Moderada: 0, Lenta: 0, Outra: 0 } as Record<'Rápida' | 'Moderada' | 'Lenta' | 'Outra', number>
    );

    const checks: Array<{ key: string; label: string; ok: boolean; detail: string; href: string }> = [
      {
        key: 'setlist',
        label: 'Setlist',
        ok: songs.length > 0,
        detail: songs.length > 0 ? `${songs.length} músicas` : 'nenhuma música definida',
        href: `/eventos/setlists/${eventId}`,
      },
      {
        key: 'lineup',
        label: 'Lineup',
        ok: confirmed.length > 0,
        detail: confirmed.length > 0 ? `${confirmed.length} confirmados` : 'ninguém confirmado',
        href: '/membros',
      },
    ];

    if (isCompleteEvent) {
      checks.push(
        {
          key: 'bpm',
          label: 'BPM',
          ok: songs.length > 0 && withoutBpm === 0,
          detail: songs.length === 0 ? 'aguardando setlist' : `${withoutBpm} pendentes`,
          href: '/repertorio',
        },
        {
          key: 'keys',
          label: 'Tons',
          ok: songs.length > 0 && withoutKey === 0,
          detail: songs.length === 0 ? 'aguardando setlist' : `${withoutKey} pendentes`,
          href: '/repertorio',
        },
        {
          key: 'structure',
          label: 'Estruturas',
          ok: songs.length > 0 && withoutStructure === 0,
          detail: songs.length === 0 ? 'aguardando setlist' : `${withoutStructure} pendentes`,
          href: '/repertorio',
        },
        {
          key: 'lyrics',
          label: 'Letra sincronizada',
          ok: songs.length > 0 && freeLyrics === 0,
          detail: songs.length === 0 ? 'aguardando setlist' : `${freeLyrics} em modo livre`,
          href: '/repertorio',
        },
        {
          key: 'operation',
          label: 'Operação',
          ok: operationalTablesReady && operationReady,
          detail: !operationalTablesReady
            ? 'estrutura operacional indisponível'
            : operationReady
            ? 'chegada, passagem e endereço definidos'
            : 'logística ainda incompleta',
          href: '#operation',
        },
        {
          key: 'operational-checklist',
          label: 'Checklist operacional',
          ok: operationalTablesReady && checklistReady,
          detail: !operationalTablesReady
            ? 'estrutura operacional indisponível'
            : checklist.length === 0
            ? 'nenhum item criado'
            : `${checklistDone}/${checklist.length} concluídos`,
          href: '#checklist',
        }
      );
    } else {
      const pendingEssential = [withoutBpm, withoutKey, withoutStructure].reduce((sum, value) => sum + value, 0);
      checks.push({
        key: 'songs-ready',
        label: 'Músicas prontas',
        ok: songs.length > 0 && pendingEssential === 0,
        detail: songs.length === 0 ? 'aguardando setlist' : pendingEssential === 0 ? 'BPM, tom e estrutura OK' : `${pendingEssential} ajustes essenciais`,
        href: '/repertorio',
      });
    }

    if (profile?.id) {
      checks.push({
        key: 'presence',
        label: 'Minha presença',
        ok: norm(myScale?.status) === 'confirmado',
        detail:
          norm(myScale?.status) === 'confirmado'
            ? 'confirmada'
            : norm(myScale?.status) === 'falta'
            ? 'marcada como falta'
            : 'não respondida',
        href: '#presence',
      });
    }

    const done = checks.filter((item) => item.ok).length;
    const readiness = checks.length > 0 ? Math.round((done / checks.length) * 100) : 0;

    return {
      totalDuration,
      withoutDuration,
      energy,
      checks,
      done,
      readiness,
    };
  }, [
    checklist.length,
    checklistDone,
    checklistReady,
    confirmed.length,
    eventId,
    isCompleteEvent,
    myScale?.status,
    operationReady,
    operationalTablesReady,
    profile?.id,
    songs,
  ]);

  function beginOperationEdit() {
    setOperationDraft(operationToDraft(operation));
    setOperationEditing(true);
  }

  async function saveOperation() {
    if (!org?.id || !eventId || operationSaving || !operationalTablesReady) return;
    setOperationSaving(true);
    try {
      const payload = {
        org_id: String(org.id),
        evento_id: eventId,
        chegada_em: toIsoOrNull(operationDraft.chegada_em),
        passagem_som_em: toIsoOrNull(operationDraft.passagem_som_em),
        endereco: operationDraft.endereco.trim() || null,
        mapa_url: operationDraft.mapa_url.trim() || null,
        contato_nome: operationDraft.contato_nome.trim() || null,
        contato_telefone: operationDraft.contato_telefone.trim() || null,
        observacoes: operationDraft.observacoes.trim() || null,
        updated_by: profile?.id ? String(profile.id) : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('evento_operacao').upsert(payload, { onConflict: 'org_id,evento_id' });
      if (error) throw error;
      setOperationEditing(false);
      await load(true);
    } catch (error: any) {
      console.error('Erro ao salvar operação do evento:', error);
      window.alert(error?.message || 'Não foi possível salvar a operação do show.');
    } finally {
      setOperationSaving(false);
    }
  }

  async function addChecklistItem() {
    const title = newChecklistTitle.trim();
    if (!title || !org?.id || !eventId || !operationalTablesReady) return;
    setChecklistBusyId('new');
    try {
      const nextOrder = checklist.reduce((max, item) => Math.max(max, Number(item.ordem || 0)), 0) + 10;
      const { error } = await supabase.from('evento_checklist').insert({
        org_id: String(org.id),
        evento_id: eventId,
        titulo: title,
        categoria: newChecklistCategory,
        concluido: false,
        ordem: nextOrder,
        responsavel_membro_id: newChecklistResponsible || null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setNewChecklistTitle('');
      setNewChecklistResponsible('');
      await load(true);
    } catch (error: any) {
      console.error('Erro ao adicionar item do checklist:', error);
      window.alert(error?.message || 'Não foi possível adicionar o item.');
    } finally {
      setChecklistBusyId(null);
    }
  }

  async function createBaseChecklist() {
    if (!org?.id || !eventId || !operationalTablesReady || checklist.length > 0) return;
    setChecklistBusyId('base');
    try {
      const rows = BASE_CHECKLIST.map((item, index) => ({
        org_id: String(org.id),
        evento_id: eventId,
        titulo: item.titulo,
        categoria: item.categoria,
        concluido: false,
        ordem: (index + 1) * 10,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('evento_checklist').insert(rows);
      if (error) throw error;
      await load(true);
    } catch (error: any) {
      console.error('Erro ao criar checklist base:', error);
      window.alert(error?.message || 'Não foi possível criar o checklist base.');
    } finally {
      setChecklistBusyId(null);
    }
  }

  async function toggleChecklistItem(item: ChecklistItem) {
    if (!operationalTablesReady) return;
    const id = String(item.id);
    const nextDone = !item.concluido;
    setChecklistBusyId(id);
    setChecklist((current) =>
      current.map((entry) =>
        String(entry.id) === id
          ? {
              ...entry,
              concluido: nextDone,
              concluido_por: nextDone && profile?.id ? String(profile.id) : null,
              concluido_em: nextDone ? new Date().toISOString() : null,
            }
          : entry
      )
    );

    try {
      const { error } = await supabase
        .from('evento_checklist')
        .update({
          concluido: nextDone,
          concluido_por: nextDone && profile?.id ? String(profile.id) : null,
          concluido_em: nextDone ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) throw error;
    } catch (error: any) {
      console.error('Erro ao atualizar checklist:', error);
      await load(true);
      window.alert(error?.message || 'Não foi possível atualizar o item.');
    } finally {
      setChecklistBusyId(null);
    }
  }

  async function deleteChecklistItem(item: ChecklistItem) {
    if (!operationalTablesReady) return;
    if (!window.confirm(`Remover “${item.titulo}” do checklist?`)) return;
    const id = String(item.id);
    setChecklistBusyId(id);
    try {
      const { error } = await supabase.from('evento_checklist').delete().eq('id', item.id);
      if (error) throw error;
      setChecklist((current) => current.filter((entry) => String(entry.id) !== id));
    } catch (error: any) {
      console.error('Erro ao remover item do checklist:', error);
      window.alert(error?.message || 'Não foi possível remover o item.');
    } finally {
      setChecklistBusyId(null);
    }
  }

  async function saveEventPalette() {
    if (!eventInfo || !org?.id || paletteSaving) return;
    setPaletteSaving(true);
    try {
      const nextPalette = paletteDraft.trim() || null;
      const { error } = await supabase
        .from('eventos')
        .update({ paleta_cores: nextPalette })
        .eq('org_id', org.id)
        .eq('id', eventId);
      if (error) throw error;

      setEventInfo((current) => (current ? { ...current, paleta_cores: nextPalette } : current));
      setPaletteEditing(false);
    } catch (error: any) {
      console.error('Erro ao atualizar paleta do evento:', error);
      window.alert(error?.message || 'Não foi possível atualizar a paleta de cores.');
    } finally {
      setPaletteSaving(false);
    }
  }

  async function setEventPreparationMode(nextMode: EventPreparationMode) {
    if (!eventInfo || !org?.id || modeSaving) return;
    if (eventInfo.modo_preparacao === nextMode) return;

    setModeSaving(true);
    try {
      const { error } = await supabase
        .from('eventos')
        .update({ modo_preparacao: nextMode })
        .eq('org_id', org.id)
        .eq('id', eventId);
      if (error) throw error;

      setEventInfo((current) => (current ? { ...current, modo_preparacao: nextMode } : current));
    } catch (error: any) {
      console.error('Erro ao alterar modo do evento:', error);
      window.alert(error?.message || 'Não foi possível alterar o modo de preparação.');
    } finally {
      setModeSaving(false);
    }
  }

  async function setPresence(status: 'confirmado' | 'falta') {
    if (!profile?.id || !org?.id || !eventId || presenceBusy) return;
    if (status === 'falta' && !window.confirm('Confirmar ausência neste evento?')) return;

    setPresenceBusy(true);
    try {
      const { error } = await supabase.from('escalas').upsert(
        {
          org_id: org.id,
          evento_id: eventId,
          membro_id: profile.id,
          status,
        },
        { onConflict: 'evento_id,membro_id' }
      );
      if (error) throw error;

      // O webhook antigo do banco continha uma credencial privilegiada hardcoded.
      // A v14 centraliza a notificação de presença no backend Next.js/OneSignal.
      const recipients = scales
        .map((item) => String(item?.membro_id || '').trim())
        .filter(Boolean)
        .filter((memberId) => memberId !== String(profile.id));

      if (recipients.length > 0) {
        void sendPush({
          title: 'Presença atualizada',
          message: `${profile?.nome || 'Integrante'} marcou ${status === 'falta' ? 'falta' : 'presença'} no evento.`,
          url: `/eventos/${eventId}`,
          externalUserIds: Array.from(new Set(recipients)),
          data: {
            type: 'presence_update',
            eventoId: eventId,
            membroId: profile.id,
            status,
          },
        }).catch((pushError) => console.error('Erro ao enviar push de presença:', pushError));
      }

      await load(true);
    } catch (error) {
      console.error('Erro ao atualizar presença:', error);
    } finally {
      setPresenceBusy(false);
    }
  }

  if (loadingOrg || loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-blue-500">
        <Loader2 size={36} className="animate-spin" />
      </div>
    );
  }

  if (!org) return null;

  if (!eventInfo || errorMessage) {
    return (
      <SubscriptionGuard>
        <div className="min-h-screen bg-slate-950 text-white px-4 py-10">
          <div className="max-w-xl mx-auto rounded-[2rem] border border-red-500/20 bg-red-500/[0.06] p-7">
            <AlertCircle className="text-red-400 mb-4" size={30} />
            <h1 className="text-2xl font-black uppercase italic">Evento indisponível</h1>
            <p className="mt-2 text-sm text-slate-400">{errorMessage || 'Não foi possível localizar este evento.'}</p>
            <button onClick={() => router.back()} className="mt-6 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-xs font-black uppercase">
              Voltar
            </button>
          </div>
        </div>


    </SubscriptionGuard>
    );
  }

  const readinessStatus =
    summary.readiness === 100 ? 'Pronto para o palco' : summary.readiness >= 70 ? 'Quase pronto' : 'Precisa de atenção';

  return (
    <SubscriptionGuard>
      <div className="min-h-screen bg-slate-950 text-white px-4 sm:px-6 lg:px-8 pb-24 font-sans">
        <div className="w-full max-w-[1600px] mx-auto pt-6">
          <header className="flex items-start justify-between gap-4 mb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-blue-500">Central do evento</p>
              <h1 className="mt-1 text-3xl sm:text-4xl lg:text-5xl font-black uppercase italic tracking-tighter leading-none break-words">
                {eventInfo.local || 'Evento'}
              </h1>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] sm:text-xs font-bold text-slate-400">
                <span className="inline-flex items-center gap-2"><Calendar size={14} className="text-blue-400" /> {eventDateLabel(eventInfo.data)}</span>
                <span className="inline-flex items-center gap-2"><Clock3 size={14} className="text-blue-400" /> {eventTimeLabel(eventInfo.data)}</span>
                <span className="inline-flex items-center gap-2"><MapPin size={14} className="text-blue-400" /> {eventInfo.local || 'Local pendente'}</span>
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => void load(true)}
                disabled={refreshing}
                className="size-11 sm:size-12 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center text-slate-300 hover:text-white disabled:opacity-50"
                title="Atualizar dados"
              >
                <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => router.back()}
                className="size-11 sm:size-12 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center text-slate-300 hover:text-white"
                title="Voltar"
              >
                <ArrowLeft size={18} />
              </button>
            </div>
          </header>

          <section className="mb-6 rounded-[1.5rem] border border-white/5 bg-slate-900/55 p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Modo de preparação</p>
              <p className="mt-1 text-xs font-bold text-slate-300">
                {isCompleteEvent
                  ? 'Produção completa: logística, contato e checklist entram na preparação.'
                  : 'Modo simples: foco em setlist, escala, presença e Live para cultos e eventos corriqueiros.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/20 p-1 shrink-0">
              <button
                disabled={modeSaving}
                onClick={() => void setEventPreparationMode('simples')}
                className={cn(
                  'min-h-10 rounded-lg px-3 text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50',
                  !isCompleteEvent ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
                )}
              >
                Simples
              </button>
              <button
                disabled={modeSaving}
                onClick={() => void setEventPreparationMode('completo')}
                className={cn(
                  'min-h-10 rounded-lg px-3 text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50',
                  isCompleteEvent ? 'bg-blue-500/15 text-blue-300' : 'text-slate-500 hover:text-slate-300'
                )}
              >
                Produção completa
              </button>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[2rem] border border-blue-500/20 bg-gradient-to-br from-blue-500/[0.08] via-slate-900 to-slate-950 shadow-2xl mb-6">
            <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-70" />
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
              <div className="p-5 sm:p-7 lg:p-8 xl:border-r xl:border-white/5">
                <div className="flex flex-wrap items-center gap-2 mb-5">
                  <span className="px-3 py-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 text-[9px] font-black uppercase tracking-[0.18em] text-blue-300">
                    {countdownLabel(eventInfo.data, nowMs)}
                  </span>
                  <span className={cn(
                    'px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-[0.16em]',
                    isCompleteEvent ? 'border-blue-500/20 bg-blue-500/10 text-blue-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  )}>
                    {isCompleteEvent ? 'Produção completa' : 'Evento simples'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPaletteDraft(String(eventInfo.paleta_cores || ''));
                      setPaletteEditing(true);
                    }}
                    className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-300 inline-flex items-center gap-1.5 hover:border-blue-500/30 hover:text-white transition-colors"
                    title="Editar paleta de cores do evento"
                  >
                    <Palette size={12} />
                    {paletteColorsFor(eventInfo.paleta_cores).length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        {paletteColorsFor(eventInfo.paleta_cores).map((color) => (
                          <span key={color} className="size-2.5 rounded-full border border-white/20" style={{ backgroundColor: color }} />
                        ))}
                      </span>
                    )}
                    {eventInfo.paleta_cores || 'Definir paleta'}
                  </button>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                    <ListMusic className="text-blue-400" size={18} />
                    <strong className="block mt-3 text-2xl font-black tabular-nums">{songs.length}</strong>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">músicas</span>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                    <Users className="text-emerald-400" size={18} />
                    <strong className="block mt-3 text-2xl font-black tabular-nums">{confirmed.length}</strong>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">confirmados</span>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                    <Clock3 className="text-yellow-400" size={18} />
                    <strong className="block mt-3 text-xl sm:text-2xl font-black tabular-nums">{summary.totalDuration > 0 ? formatDuration(summary.totalDuration) : '—'}</strong>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      estimado{summary.withoutDuration > 0 ? ` • ${summary.withoutDuration} sem cálculo` : ''}
                    </span>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-black/20 p-4">
                    <Gauge className="text-purple-400" size={18} />
                    <strong className="block mt-3 text-2xl font-black tabular-nums">{summary.readiness}%</strong>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">prontidão</span>
                  </div>
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <Link href={`/live/${eventId}`} className="min-h-13 flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-[10px] font-black uppercase tracking-[0.18em] shadow-lg shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.98]">
                    <PlayCircle size={19} /> Entrar no Live
                  </Link>
                  <Link href={`/eventos/setlists/${eventId}`} className="min-h-13 flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 hover:border-blue-500/30 hover:bg-blue-500/10 active:scale-[0.98]">
                    <ListMusic size={19} /> Editar setlist
                  </Link>
                </div>
              </div>

              <div className="p-5 sm:p-7 lg:p-8 bg-black/10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Checklist pré-show</p>
                    <h2 className={cn(
                      'mt-1 text-xl font-black uppercase',
                      summary.readiness === 100 ? 'text-emerald-300' : summary.readiness >= 70 ? 'text-yellow-300' : 'text-orange-300'
                    )}>
                      {readinessStatus}
                    </h2>
                  </div>
                  <Sparkles className={summary.readiness === 100 ? 'text-emerald-400' : 'text-blue-400'} size={22} />
                </div>

                <div className="mt-4 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', summary.readiness === 100 ? 'bg-emerald-500' : summary.readiness >= 70 ? 'bg-yellow-400' : 'bg-orange-500')}
                    style={{ width: `${summary.readiness}%` }}
                  />
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-2">
                  {summary.checks.map((check) => (
                    <Link
                      key={check.key}
                      href={check.href}
                      className={cn(
                        'rounded-xl border px-3 py-3 flex items-center gap-3 min-w-0 transition-colors',
                        check.ok
                          ? 'border-emerald-500/15 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.09]'
                          : 'border-orange-500/15 bg-orange-500/[0.06] hover:bg-orange-500/[0.09]'
                      )}
                    >
                      {check.ok ? <CheckCircle2 size={16} className="shrink-0 text-emerald-400" /> : <AlertCircle size={16} className="shrink-0 text-orange-400" />}
                      <div className="min-w-0">
                        <span className="block text-[10px] font-black uppercase text-slate-200">{check.label}</span>
                        <span className="block text-[9px] font-bold text-slate-500 truncate">{check.detail}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {profile?.id && (
            <section id="presence" className="mb-6 rounded-[1.75rem] border border-white/5 bg-slate-900/60 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  'size-11 rounded-2xl flex items-center justify-center border shrink-0',
                  norm(myScale?.status) === 'confirmado'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : norm(myScale?.status) === 'falta'
                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                    : 'bg-white/5 border-white/10 text-slate-400'
                )}>
                  {norm(myScale?.status) === 'falta' ? <XCircle size={20} /> : <CheckCircle2 size={20} />}
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Minha escala</p>
                  <p className="text-sm font-black uppercase truncate">{profile?.nome || 'Integrante ativo'}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">
                    {norm(myScale?.status) === 'confirmado' ? 'Presença confirmada' : norm(myScale?.status) === 'falta' ? 'Ausência marcada' : 'Aguardando resposta'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={presenceBusy}
                  onClick={() => void setPresence('confirmado')}
                  className="flex-1 lg:flex-none min-h-11 px-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-[9px] font-black uppercase tracking-widest disabled:opacity-50"
                >
                  Confirmar presença
                </button>
                <button
                  disabled={presenceBusy}
                  onClick={() => void setPresence('falta')}
                  className="flex-1 lg:flex-none min-h-11 px-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-[9px] font-black uppercase tracking-widest disabled:opacity-50"
                >
                  Marcar falta
                </button>
              </div>
            </section>
          )}

          {isCompleteEvent ? (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6 mb-6">
            <section id="operation" className="rounded-[2rem] border border-white/5 bg-slate-900/55 overflow-hidden scroll-mt-6">
              <div className="p-5 sm:p-6 border-b border-white/5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Logística</p>
                  <h2 className="text-xl font-black uppercase italic tracking-tight">Operação do show</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Settings2 size={20} className="text-blue-400" />
                  {operationalTablesReady && !operationEditing && (
                    <button
                      onClick={beginOperationEdit}
                      className="min-h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-[8px] font-black uppercase tracking-widest text-slate-300 hover:text-white"
                    >
                      Editar
                    </button>
                  )}
                </div>
              </div>

              {!operationalTablesReady ? (
                <div className="p-5 sm:p-6">
                  <div className="rounded-2xl border border-orange-500/20 bg-orange-500/[0.06] p-4 flex gap-3 text-orange-200">
                    <AlertCircle size={19} className="shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-black uppercase">Migration v13 pendente</p>
                      <p className="mt-1 text-[10px] font-bold text-orange-300/70">Execute o SQL da v13 no Supabase para ativar logística e checklist compartilhado.</p>
                    </div>
                  </div>
                </div>
              ) : operationEditing ? (
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Chegada da banda</span>
                      <input
                        type="datetime-local"
                        value={operationDraft.chegada_em}
                        onChange={(event) => setOperationDraft((draft) => ({ ...draft, chegada_em: event.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 [color-scheme:dark]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Passagem de som</span>
                      <input
                        type="datetime-local"
                        value={operationDraft.passagem_som_em}
                        onChange={(event) => setOperationDraft((draft) => ({ ...draft, passagem_som_em: event.target.value }))}
                        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 [color-scheme:dark]"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Endereço</span>
                    <input
                      value={operationDraft.endereco}
                      onChange={(event) => setOperationDraft((draft) => ({ ...draft, endereco: event.target.value }))}
                      placeholder="Rua, número, cidade..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 placeholder:text-slate-700"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Link do mapa</span>
                    <input
                      value={operationDraft.mapa_url}
                      onChange={(event) => setOperationDraft((draft) => ({ ...draft, mapa_url: event.target.value }))}
                      placeholder="https://maps.google.com/..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 placeholder:text-slate-700"
                    />
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Contato do local</span>
                      <input
                        value={operationDraft.contato_nome}
                        onChange={(event) => setOperationDraft((draft) => ({ ...draft, contato_nome: event.target.value }))}
                        placeholder="Nome / responsável"
                        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 placeholder:text-slate-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Telefone</span>
                      <input
                        value={operationDraft.contato_telefone}
                        onChange={(event) => setOperationDraft((draft) => ({ ...draft, contato_telefone: event.target.value }))}
                        placeholder="Telefone / WhatsApp"
                        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 placeholder:text-slate-700"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Observações gerais</span>
                    <textarea
                      rows={4}
                      value={operationDraft.observacoes}
                      onChange={(event) => setOperationDraft((draft) => ({ ...draft, observacoes: event.target.value }))}
                      placeholder="Entrada de carga, estacionamento, palco, alimentação, pagamento, restrições..."
                      className="w-full resize-y rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-sm font-bold text-white outline-none focus:border-blue-500/40 placeholder:text-slate-700"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={operationSaving}
                      onClick={() => {
                        setOperationDraft(operationToDraft(operation));
                        setOperationEditing(false);
                      }}
                      className="min-h-11 rounded-xl border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-400 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={operationSaving}
                      onClick={() => void saveOperation()}
                      className="min-h-11 rounded-xl bg-blue-600 text-[9px] font-black uppercase tracking-widest text-white inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {operationSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Salvar operação
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 sm:p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-blue-400"><Users size={16} /><span className="text-[9px] font-black uppercase tracking-widest">Chegada da banda</span></div>
                      <strong className="mt-2 block text-sm font-black uppercase">{dateTimeShort(operation?.chegada_em)}</strong>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-purple-400"><Volume2 size={16} /><span className="text-[9px] font-black uppercase tracking-widest">Passagem de som</span></div>
                      <strong className="mt-2 block text-sm font-black uppercase">{dateTimeShort(operation?.passagem_som_em)}</strong>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
                    <div className="flex items-start gap-3">
                      <MapPin size={17} className="mt-0.5 shrink-0 text-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Endereço / acesso</p>
                        <p className="mt-1 text-xs font-bold text-slate-200 break-words">{operation?.endereco || 'Endereço ainda não informado.'}</p>
                      </div>
                    </div>
                    {(operation?.mapa_url || operation?.endereco) && (
                      <a
                        href={operation?.mapa_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(operation?.endereco || ''))}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 min-h-10 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 inline-flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-emerald-300"
                      >
                        <ExternalLink size={13} /> Abrir mapa
                      </a>
                    )}
                  </div>

                  {(operation?.contato_nome || operation?.contato_telefone) && (
                    <div className="rounded-2xl border border-white/5 bg-black/15 p-4 flex items-start gap-3">
                      <UserRound size={17} className="mt-0.5 shrink-0 text-yellow-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Contato do local</p>
                        <p className="mt-1 text-xs font-black text-slate-200">{operation?.contato_nome || 'Contato'}</p>
                        {operation?.contato_telefone && (
                          <a href={`tel:${operation.contato_telefone}`} className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-bold text-blue-300">
                            <Phone size={12} /> {operation.contato_telefone}
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/5 bg-black/15 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Observações gerais</p>
                    <p className="mt-2 whitespace-pre-wrap text-xs font-semibold leading-relaxed text-slate-300">{operation?.observacoes || 'Nenhuma observação operacional cadastrada.'}</p>
                  </div>

                  {!operation && (
                    <button
                      onClick={beginOperationEdit}
                      className="w-full min-h-11 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] text-[9px] font-black uppercase tracking-widest text-blue-300"
                    >
                      Configurar operação do show
                    </button>
                  )}
                </div>
              )}
            </section>

            <section id="checklist" className="rounded-[2rem] border border-white/5 bg-slate-900/55 overflow-hidden scroll-mt-6">
              <div className="p-5 sm:p-6 border-b border-white/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Compartilhado</p>
                    <h2 className="text-xl font-black uppercase italic tracking-tight">Checklist operacional</h2>
                  </div>
                  <div className="text-right shrink-0">
                    <ClipboardCheck size={20} className={checklistReady ? 'ml-auto text-emerald-400' : 'ml-auto text-blue-400'} />
                    <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-500">{checklistDone}/{checklist.length}</p>
                  </div>
                </div>
                <div className="mt-4 h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', checklistReady ? 'bg-emerald-500' : 'bg-blue-500')}
                    style={{ width: `${checklist.length > 0 ? Math.round((checklistDone / checklist.length) * 100) : 0}%` }}
                  />
                </div>
              </div>

              {!operationalTablesReady ? (
                <div className="p-5 text-xs font-bold text-slate-500">Execute a migration v13 para ativar o checklist compartilhado.</div>
              ) : (
                <div className="p-4 sm:p-5">
                  {checklist.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 py-8 px-4 text-center">
                      <PackageCheck size={30} className="mx-auto text-slate-600" />
                      <p className="mt-3 text-xs font-black uppercase text-slate-400">Checklist vazio</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-600">Crie os itens manualmente ou use uma base genérica para começar.</p>
                      <button
                        disabled={checklistBusyId !== null}
                        onClick={() => void createBaseChecklist()}
                        className="mt-4 min-h-10 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 text-[8px] font-black uppercase tracking-widest text-blue-300 disabled:opacity-50"
                      >
                        {checklistBusyId === 'base' ? 'Criando...' : 'Criar checklist base'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[430px] overflow-y-auto no-scrollbar pr-1">
                      {checklist.map((item) => {
                        const busy = checklistBusyId === String(item.id);
                        const responsible = item.responsavel_membro_id ? memberNameById.get(String(item.responsavel_membro_id)) : '';
                        const completedBy = item.concluido_por ? memberNameById.get(String(item.concluido_por)) : '';
                        return (
                          <div
                            key={String(item.id)}
                            className={cn(
                              'rounded-2xl border px-3 py-3 flex items-start gap-3 transition-all',
                              item.concluido ? 'border-emerald-500/15 bg-emerald-500/[0.055]' : 'border-white/5 bg-black/15'
                            )}
                          >
                            <button
                              disabled={busy}
                              onClick={() => void toggleChecklistItem(item)}
                              className={cn(
                                'mt-0.5 size-7 rounded-lg border flex items-center justify-center shrink-0 transition-all disabled:opacity-50',
                                item.concluido ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-600'
                              )}
                              title={item.concluido ? 'Marcar como pendente' : 'Concluir item'}
                            >
                              {item.concluido && <CheckCircle2 size={15} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={cn('text-xs font-black break-words', item.concluido ? 'text-slate-500 line-through' : 'text-slate-100')}>{item.titulo}</p>
                                <span className="rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-slate-500">{categoryLabel(item.categoria)}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-bold uppercase tracking-wider text-slate-600">
                                {responsible && <span>Responsável: {responsible}</span>}
                                {item.concluido && completedBy && <span>Concluído por {completedBy}</span>}
                              </div>
                            </div>
                            <button
                              disabled={busy}
                              onClick={() => void deleteChecklistItem(item)}
                              className="size-8 rounded-lg border border-red-500/10 bg-red-500/[0.05] flex items-center justify-center text-red-400/60 hover:text-red-300 disabled:opacity-50 shrink-0"
                              title="Remover item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 rounded-2xl border border-white/5 bg-black/15 p-3 sm:p-4 space-y-3">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Plus size={15} />
                      <span className="text-[9px] font-black uppercase tracking-widest">Adicionar item</span>
                    </div>
                    <input
                      value={newChecklistTitle}
                      onChange={(event) => setNewChecklistTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addChecklistItem();
                        }
                      }}
                      placeholder="Ex: Levar cabo XLR reserva"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-3 text-xs font-bold text-white outline-none focus:border-blue-500/40 placeholder:text-slate-700"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] gap-2">
                      <select
                        value={newChecklistCategory}
                        onChange={(event) => setNewChecklistCategory(event.target.value as ChecklistCategory)}
                        className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 outline-none [color-scheme:dark]"
                      >
                        <option value="equipamento">Equipamento</option>
                        <option value="palco">Palco</option>
                        <option value="logistica">Logística</option>
                        <option value="outro">Outro</option>
                      </select>
                      <select
                        value={newChecklistResponsible}
                        onChange={(event) => setNewChecklistResponsible(event.target.value)}
                        className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 outline-none [color-scheme:dark]"
                      >
                        <option value="">Sem responsável</option>
                        {scales.map((item) => (
                          <option key={String(item.membro_id || item.id)} value={String(item.membro_id || '')}>
                            {item?.membros?.nome || 'Integrante'}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!newChecklistTitle.trim() || checklistBusyId !== null}
                        onClick={() => void addChecklistItem()}
                        className="min-h-11 rounded-xl bg-blue-600 px-4 text-[8px] font-black uppercase tracking-widest text-white inline-flex items-center justify-center gap-2 disabled:opacity-40"
                      >
                        <Plus size={14} /> Adicionar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          ) : (
            <section className="mb-6 rounded-[2rem] border border-emerald-500/15 bg-emerald-500/[0.045] p-5 sm:p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="size-11 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 flex items-center justify-center shrink-0">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-500/70">Preparação essencial</p>
                    <h2 className="mt-1 text-lg font-black uppercase italic">Sem burocracia para o evento do dia a dia</h2>
                    <p className="mt-2 max-w-3xl text-xs font-semibold leading-relaxed text-slate-400">
                      Logística, contato e checklist operacional ficam ocultos neste modo. Se este culto ou evento crescer e exigir produção, mude para Produção completa; qualquer informação já cadastrada continua preservada.
                    </p>
                  </div>
                </div>
                <button
                  disabled={modeSaving}
                  onClick={() => void setEventPreparationMode('completo')}
                  className="min-h-11 rounded-xl border border-blue-500/20 bg-blue-500/[0.08] px-4 text-[9px] font-black uppercase tracking-widest text-blue-300 disabled:opacity-50 shrink-0"
                >
                  Ativar produção completa
                </button>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6">
            <section className="rounded-[2rem] border border-white/5 bg-slate-900/55 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-white/5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Pessoas</p>
                  <h2 className="text-xl font-black uppercase italic tracking-tight">Lineup do evento</h2>
                </div>
                <Users size={20} className="text-emerald-400" />
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-emerald-500/[0.07] border border-emerald-500/15 px-3 py-3 text-center">
                    <strong className="block text-xl font-black text-emerald-300">{confirmed.length}</strong>
                    <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500/70">Confirmados</span>
                  </div>
                  <div className="rounded-xl bg-yellow-500/[0.07] border border-yellow-500/15 px-3 py-3 text-center">
                    <strong className="block text-xl font-black text-yellow-300">{unanswered.length}</strong>
                    <span className="text-[8px] font-black uppercase tracking-widest text-yellow-500/70">Pendentes</span>
                  </div>
                  <div className="rounded-xl bg-red-500/[0.07] border border-red-500/15 px-3 py-3 text-center">
                    <strong className="block text-xl font-black text-red-300">{absent.length}</strong>
                    <span className="text-[8px] font-black uppercase tracking-widest text-red-500/70">Faltas</span>
                  </div>
                </div>

                {scales.length === 0 ? (
                  <div className="py-10 text-center text-sm font-bold text-slate-600">Nenhuma escala criada para este evento.</div>
                ) : (
                  <div className="space-y-2">
                    {[...scales]
                      .sort((a, b) => {
                        const rank = (value?: string | null) => (norm(value) === 'confirmado' ? 0 : norm(value) === 'falta' ? 2 : 1);
                        const diff = rank(a.status) - rank(b.status);
                        if (diff !== 0) return diff;
                        return String(a?.membros?.nome || '').localeCompare(String(b?.membros?.nome || ''), 'pt-BR');
                      })
                      .map((item, index) => {
                        const status = norm(item.status);
                        const isConfirmed = status === 'confirmado';
                        const isAbsent = status === 'falta';
                        return (
                          <div key={`${item.membro_id || 'm'}-${index}`} className="rounded-2xl border border-white/5 bg-black/15 px-4 py-3 flex items-center gap-3">
                            <div className={cn(
                              'size-9 rounded-full flex items-center justify-center font-black text-xs shrink-0',
                              isConfirmed ? 'bg-emerald-500/15 text-emerald-300' : isAbsent ? 'bg-red-500/15 text-red-300' : 'bg-yellow-500/15 text-yellow-300'
                            )}>
                              {String(item?.membros?.nome || '?').trim().charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-black uppercase truncate">{item?.membros?.nome || 'Integrante'}</p>
                              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 truncate">{item?.membros?.funcao || 'Músico'}</p>
                            </div>
                            <span className={cn(
                              'shrink-0 rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-widest',
                              isConfirmed
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                : isAbsent
                                ? 'border-red-500/20 bg-red-500/10 text-red-300'
                                : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
                            )}>
                              {isConfirmed ? 'Confirmado' : isAbsent ? 'Falta' : 'Pendente'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}

                <Link href="/membros" className="w-full min-h-11 rounded-xl border border-white/10 bg-white/5 inline-flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white">
                  <Users size={15} /> Gerenciar membros
                </Link>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/5 bg-slate-900/55 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-white/5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Música</p>
                  <h2 className="text-xl font-black uppercase italic tracking-tight">Setlist preparado</h2>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['Rápida', 'Moderada', 'Lenta'] as const).map((key) => (
                    <span key={key} className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wider text-slate-400">
                      {key} {summary.energy[key]}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-4 sm:p-5">
                {setlist.length === 0 ? (
                  <div className="py-12 text-center">
                    <Music2 size={34} className="mx-auto text-slate-700 mb-3" />
                    <p className="text-sm font-black uppercase text-slate-500">Setlist ainda vazio</p>
                    <Link href={`/eventos/setlists/${eventId}`} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[9px] font-black uppercase tracking-widest">
                      Montar setlist
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[760px] overflow-y-auto no-scrollbar pr-1">
                    {setlist.map((item, index) => {
                      const song = item.repertorio;
                      const duration = durationForSong(song);
                      const energy = energyFor(song);
                      return (
                        <div key={item.id || index} className="group rounded-2xl border border-white/5 bg-black/15 px-4 py-3 flex items-center gap-3 hover:border-blue-500/15 transition-colors">
                          <div className="size-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-[10px] font-black tabular-nums text-slate-400 shrink-0">{index + 1}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-black uppercase break-words">{song?.titulo || 'Música'}</p>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                              <span>{song?.tom || 'Tom —'}</span>
                              <span>{song?.bpm ? `${song.bpm} BPM` : 'BPM —'}</span>
                              <span>{energy}</span>
                              {duration !== null && <span>~{formatDuration(duration)}</span>}
                            </div>
                          </div>
                          <span className={cn(
                            'size-2.5 rounded-full shrink-0',
                            energy === 'Rápida' ? 'bg-red-400' : energy === 'Moderada' ? 'bg-yellow-400' : energy === 'Lenta' ? 'bg-emerald-400' : 'bg-slate-600'
                          )} />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link href={`/eventos/setlists/${eventId}`} className="min-h-11 rounded-xl border border-white/10 bg-white/5 inline-flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white">
                    <ListMusic size={15} /> Editar ordem
                  </Link>
                  <Link href="/repertorio" className="min-h-11 rounded-xl border border-white/10 bg-white/5 inline-flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white">
                    <Music2 size={15} /> Repertório
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
        {paletteEditing && (
        <div className="fixed inset-0 z-[220] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-6" onClick={() => setPaletteEditing(false)}>
          <div className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-slate-950 p-5 sm:p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-400">Evento</p>
                <h3 className="mt-1 text-xl font-black uppercase text-white">Paleta de cores</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">A orientação fica visível para a equipe e pode ser alterada a qualquer momento.</p>
              </div>
              <button type="button" onClick={() => setPaletteEditing(false)} className="p-2 rounded-xl bg-white/5 text-slate-400"><XCircle size={20} /></button>
            </div>

            <EventPalettePicker value={paletteDraft} onChange={setPaletteDraft} name="" compact />

            <div className="mt-5 flex gap-2 justify-end">
              <button type="button" onClick={() => setPaletteEditing(false)} className="min-h-11 px-4 rounded-xl border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-wider text-slate-400">Cancelar</button>
              <button type="button" disabled={paletteSaving} onClick={() => void saveEventPalette()} className="min-h-11 px-5 rounded-xl border border-blue-500/30 bg-blue-500/15 text-[10px] font-black uppercase tracking-wider text-blue-200 disabled:opacity-50">
                {paletteSaving ? 'Salvando...' : 'Salvar paleta'}
              </button>
            </div>
          </div>
        </div>
      )}

    </SubscriptionGuard>
  );
}
