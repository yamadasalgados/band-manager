'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';
import { sendPush } from '@/lib/push/sendPush';

import {
  Calendar,
  Users,
  Palette,
  ChevronRight,
  XCircle,
  ListMusic,
  CheckCircle2,
  PlayCircle,
  Bell,
  Repeat,
  BellRing,
  AlertCircle,
  Loader2,
  Music2,
  Gauge,
  Music,
} from 'lucide-react';


// --- HELPERS DE LÓGICA ---
function isEventToday(evData: string) {
  const today = new Date().toLocaleDateString('pt-BR');
  const eventDate = new Date(evData).toLocaleDateString('pt-BR');
  return today === eventDate;
}

function logSupabaseError(prefix: string, err: any) {
  if (!err) return;
  // O err.message geralmente contém o texto que você precisa
  console.error(prefix, err.message || err.details || err); 
}

function norm(v: any) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

type RangeKey = 'all' | 'week' | 'month' | 'year';

function getRange(key: RangeKey) {
  const now = new Date();

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };

  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (key === 'all') return { start: null as Date | null, end: null as Date | null };

  if (key === 'week') {
    const startWeek = new Date(now);
    startWeek.setDate(now.getDate() - now.getDay());
    const endWeek = new Date(startWeek);
    endWeek.setDate(startWeek.getDate() + 6); // semana até sábado
    return { start: startOfDay(startWeek), end: endOfDay(endWeek) };
  }

  if (key === 'month') {
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: startOfDay(startMonth), end: endOfDay(endMonth) };
  }

  const startYear = new Date(now.getFullYear(), 0, 1);
  const endYear = new Date(now.getFullYear(), 11, 31);
  return { start: startOfDay(startYear), end: endOfDay(endYear) };
}


function formatEventDate(evData: string) {
  if (!evData) return 'Data não definida';
  const date = new Date(evData);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

function formatEventDateLong(evData: string) {
  if (!evData) return 'Data não definida';
  const date = new Date(evData);
  if (Number.isNaN(date.getTime())) return 'Data não definida';
  return date.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function formatCountdown(evData: string, nowMs: number) {
  const target = new Date(evData).getTime();
  if (!Number.isFinite(target)) return 'Data pendente';

  const diff = target - nowMs;
  const eventDate = new Date(target);
  const now = new Date(nowMs);
  const sameDay =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  if (sameDay) return 'Hoje';
  if (diff <= 0) return 'Data passada';

  const totalMinutes = Math.max(1, Math.floor(diff / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function pickOneCandidate(cands: any[]) {
  return [...(cands || [])].sort((a, b) => {
    const na = String(a?.membros?.nome || '').localeCompare(String(b?.membros?.nome || ''), 'pt-BR', {
      sensitivity: 'base',
    });
    if (na !== 0) return na;
    return String(a?.membro_id || '').localeCompare(String(b?.membro_id || ''));
  })[0];
}

function buildPapeisDoEvento(participantes: any[]) {
  const papelPorMembro = new Map<string, string>();

  for (const p of participantes || []) {
    const id = String(p?.membro_id || '').trim();
    if (!id) continue;
    const funcaoOriginal = String(p?.membros?.funcao || 'Músico').trim();
    papelPorMembro.set(id, funcaoOriginal);
  }

  const funcoesOriginaisPresentes = new Set((participantes || []).map((p: any) => norm(p?.membros?.funcao)));
  const temTeclado = funcoesOriginaisPresentes.has(norm('Teclado'));
  const temBateria = funcoesOriginaisPresentes.has(norm('Bateria'));

  const getSubs = (p: any) => {
    const sfRaw = p?.membros?.subfuncao;
    const subfuncoes: string[] = Array.isArray(sfRaw)
      ? sfRaw.map((x: any) => String(x || '').trim()).filter(Boolean)
      : String(sfRaw || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);

    const podeTeclado = subfuncoes.some((s) => norm(s) === norm('Teclado'));
    const podeBateria = subfuncoes.some((s) => norm(s) === norm('Bateria'));
    return { podeTeclado, podeBateria };
  };

  if (!temTeclado) {
    const candidatosTeclado = (participantes || []).filter((p: any) => {
      const id = String(p?.membro_id || '').trim();
      if (!id) return false;
      const funcaoOriginal = String(p?.membros?.funcao || '').trim();
      if (norm(funcaoOriginal) === norm('Teclado')) return false;
      const { podeTeclado } = getSubs(p);
      return podeTeclado;
    });

    const escolhido = pickOneCandidate(candidatosTeclado);
    if (escolhido) papelPorMembro.set(String(escolhido.membro_id), 'Teclado (Sub)');
  }

  if (!temBateria) {
    const tecladoSubId =
      [...papelPorMembro.entries()].find(([, papel]) => papel === 'Teclado (Sub)')?.[0] || null;

    const candidatosBateria = (participantes || []).filter((p: any) => {
      const id = String(p?.membro_id || '').trim();
      if (!id) return false;
      const funcaoOriginal = String(p?.membros?.funcao || '').trim();
      if (norm(funcaoOriginal) === norm('Bateria')) return false;
      const { podeBateria } = getSubs(p);
      return podeBateria;
    });

    let escolhido = pickOneCandidate(candidatosBateria.filter((p: any) => String(p?.membro_id) !== tecladoSubId));
    if (!escolhido) escolhido = pickOneCandidate(candidatosBateria);

    if (escolhido) papelPorMembro.set(String(escolhido.membro_id), 'Bateria (Sub)');
  }

  return papelPorMembro;
}

export default function HomeMembro() {
  const { org, loadingOrg } = useOrg();

  const [eventos, setEventos] = useState<any[]>([]);
  const [minhasEscalas, setMinhasEscalas] = useState<any[]>([]);
  const [todasEscalas, setTodasEscalas] = useState<any[]>([]);
  const [operacoes, setOperacoes] = useState<any[]>([]);
  const [checklistOperacional, setChecklistOperacional] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [perfilAtivo, setPerfilAtivo] = useState<any>(null);
  const [pushStatus, setPushStatus] = useState<'default' | 'granted' | 'denied'>('default');
  const [rangeKey, setRangeKey] = useState<RangeKey>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  const rangeLabel = useMemo(() => {
    if (rangeKey === 'all') return 'Todos';
    if (rangeKey === 'week') return 'Esta semana';
    if (rangeKey === 'month') return 'Este mês';
    return 'Este ano';
  }, [rangeKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const escalasPorEvento = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const escala of todasEscalas) {
      const key = String(escala?.evento_id || '');
      if (!key) continue;
      const atual = grouped.get(key);
      if (atual) atual.push(escala);
      else grouped.set(key, [escala]);
    }
    return grouped;
  }, [todasEscalas]);

  const minhaEscalaPorEvento = useMemo(() => {
    const grouped = new Map<string, any>();
    for (const escala of minhasEscalas) {
      const key = String(escala?.evento_id || '');
      if (key) grouped.set(key, escala);
    }
    return grouped;
  }, [minhasEscalas]);

  const operacaoPorEvento = useMemo(() => {
    const grouped = new Map<string, any>();
    for (const item of operacoes) {
      const key = String(item?.evento_id || '');
      if (key) grouped.set(key, item);
    }
    return grouped;
  }, [operacoes]);

  const checklistPorEvento = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const item of checklistOperacional) {
      const key = String(item?.evento_id || '');
      if (!key) continue;
      const current = grouped.get(key);
      if (current) current.push(item);
      else grouped.set(key, [item]);
    }
    return grouped;
  }, [checklistOperacional]);

  const eventoEmFoco = useMemo(() => {
    if (eventos.length === 0) return null;

    const startOfToday = new Date(nowMs);
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();

    return (
      eventos.find((evento) => {
        const timestamp = new Date(evento?.data || '').getTime();
        return Number.isFinite(timestamp) && timestamp >= startMs;
      }) || eventos[0]
    );
  }, [eventos, nowMs]);

  const resumoEventoEmFoco = useMemo(() => {
    if (!eventoEmFoco) return null;

    const eventoId = String(eventoEmFoco.id);
    const participantes = escalasPorEvento.get(eventoId) || [];
    const minhaEscala = minhaEscalaPorEvento.get(eventoId);
    const setlist = Array.isArray(eventoEmFoco.evento_repertorio) ? eventoEmFoco.evento_repertorio : [];
    const musicas = setlist.map((item: any) => item?.repertorio).filter(Boolean);

    const operacao = operacaoPorEvento.get(eventoId);
    const checklist = checklistPorEvento.get(eventoId) || [];
    const checklistConcluido = checklist.filter((item: any) => item?.concluido).length;
    const operacaoOk = Boolean(
      operacao?.chegada_em &&
        operacao?.passagem_som_em &&
        (String(operacao?.endereco || '').trim() || String(operacao?.mapa_url || '').trim())
    );
    const checklistOk = checklist.length > 0 && checklistConcluido === checklist.length;

    const checks = [
      { key: 'setlist', label: 'Setlist', ok: musicas.length > 0, detail: `${musicas.length} músicas` },
      {
        key: 'lineup',
        label: 'Lineup',
        ok: participantes.length > 0,
        detail: `${participantes.length} confirmados`,
      },
      {
        key: 'bpm',
        label: 'BPM',
        ok: musicas.length > 0 && musicas.every((musica: any) => Number(musica?.bpm) > 0),
        detail:
          musicas.length === 0
            ? 'aguardando setlist'
            : `${musicas.filter((musica: any) => !Number(musica?.bpm)).length} pendentes`,
      },
      {
        key: 'tom',
        label: 'Tons',
        ok:
          musicas.length > 0 &&
          musicas.every((musica: any) => String(musica?.tom || '').trim().length > 0),
        detail:
          musicas.length === 0
            ? 'aguardando setlist'
            : `${musicas.filter((musica: any) => !String(musica?.tom || '').trim()).length} pendentes`,
      },
    ];

    const isCompleteEvent = eventoEmFoco?.modo_preparacao === 'completo';

    if (isCompleteEvent) {
      checks.push({
        key: 'operacao',
        label: 'Operação',
        ok: operacaoOk,
        detail: operacaoOk ? 'logística definida' : 'chegada / passagem / endereço pendentes',
      });

      checks.push({
        key: 'checklist',
        label: 'Checklist',
        ok: checklistOk,
        detail: checklist.length === 0 ? 'nenhum item' : `${checklistConcluido}/${checklist.length} concluídos`,
      });
    }

    if (perfilAtivo) {
      checks.push({
        key: 'presenca',
        label: 'Minha presença',
        ok: minhaEscala?.status === 'confirmado',
        detail:
          minhaEscala?.status === 'confirmado'
            ? 'confirmada'
            : minhaEscala?.status === 'falta'
            ? 'marcada como falta'
            : 'não respondida',
      });
    }

    const completed = checks.filter((check) => check.ok).length;
    const readiness = checks.length > 0 ? Math.round((completed / checks.length) * 100) : 0;
    const status = readiness === 100 ? 'Pronto para o palco' : readiness >= 60 ? 'Quase pronto' : 'Precisa de atenção';

    return {
      participantes,
      musicas,
      checks,
      completed,
      readiness,
      status,
      countdown: formatCountdown(eventoEmFoco.data, nowMs),
      isCompleteEvent,
    };
  }, [
    checklistPorEvento,
    escalasPorEvento,
    eventoEmFoco,
    minhaEscalaPorEvento,
    nowMs,
    operacaoPorEvento,
    perfilAtivo,
  ]);

  const carregarDashboard = useCallback(async () => {
    if (!org?.id) return;

    setLoading(true);
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPushStatus(Notification.permission as any);
      }

      const salvo = typeof window !== 'undefined' ? localStorage.getItem('usuario_ativo') : null;
      let user: any = null;

      if (salvo) {
        try {
          user = JSON.parse(salvo);
          setPerfilAtivo(user);
        } catch {
          setPerfilAtivo(null);
        }
      } else {
        setPerfilAtivo(null);
      }

      const { start, end } = getRange(rangeKey);

      let q = supabase
        .from('eventos')
        .select(`id, local, data, paleta_cores, recorrencia_id, modo_preparacao, evento_repertorio(id, repertorio(id, titulo, categoria, bpm, tom))`)
        .eq('org_id', org.id)
        .eq('finalizado', false)
        .order('data', { ascending: true });

      if (start) q = q.gte('data', start.toISOString());
      if (end) q = q.lte('data', end.toISOString());

      const { data: evs, error: evErr } = await q;
      if (evErr) {
        logSupabaseError('Erro ao buscar eventos:', evErr);
        return;
      }

      setEventos(evs || []);

      if (!evs || evs.length === 0) {
        setMinhasEscalas([]);
        setTodasEscalas([]);
        setOperacoes([]);
        setChecklistOperacional([]);
        return;
      }

      const ids = evs.map((e: any) => e.id);

      const geralPromise = supabase
        .from('escalas')
        .select(`evento_id, status, membro_id, membros!membro_id(nome, funcao, subfuncao)`)
        .in('evento_id', ids)
        .eq('org_id', org.id)
        .eq('status', 'confirmado');

      const minhasPromise = user
        ? supabase
            .from('escalas')
            .select('evento_id,status,membro_id')
            .in('evento_id', ids)
            .eq('membro_id', user.id)
        : Promise.resolve({ data: [], error: null });

      const operacoesPromise = supabase
        .from('evento_operacao')
        .select('evento_id,chegada_em,passagem_som_em,endereco,mapa_url')
        .in('evento_id', ids)
        .eq('org_id', org.id);

      const checklistPromise = supabase
        .from('evento_checklist')
        .select('evento_id,concluido')
        .in('evento_id', ids)
        .eq('org_id', org.id);

      const [geralRes, minhasRes, operacoesRes, checklistRes] = await Promise.all([
        geralPromise,
        minhasPromise,
        operacoesPromise,
        checklistPromise,
      ]);

      setTodasEscalas(geralRes.error ? [] : geralRes.data || []);
      setMinhasEscalas(minhasRes.error ? [] : minhasRes.data || []);
      // Compatibilidade: se a migration v13 ainda não foi aplicada, o Dashboard
      // continua funcionando e apenas considera a parte operacional pendente.
      setOperacoes(operacoesRes.error ? [] : operacoesRes.data || []);
      setChecklistOperacional(checklistRes.error ? [] : checklistRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rangeKey, org?.id]);

  useEffect(() => {
    if (org?.id) carregarDashboard();
    else setLoading(false);
  }, [carregarDashboard, org?.id]);

  async function ativarNotificacoes() {
    if (typeof window === 'undefined' || !('Notification' in window)) return alert('Não suportado.');
    try {
      const permission = await Notification.requestPermission();
      setPushStatus(permission as any);
    } catch (err) {
      console.error(err);
    }
  }

async function alternarPresenca(eventoId: string, statusAtual?: string) {
  if (!perfilAtivo) return alert('Selecione um perfil na engrenagem superior!');

  if (org?.status_assinatura !== 'ativo' && org?.status_assinatura !== 'trial') {
    return alert('Assinatura da banda pendente. Fale com o líder.');
  }

  // Sem escala anterior, o primeiro clique deve confirmar presença.
  const atual = statusAtual || 'falta';
  const novoStatus = atual === 'falta' ? 'confirmado' : 'falta';
  if (novoStatus === 'falta' && !confirm('Confirmar ausência neste evento?')) return;

  try {
    setConfirmandoId(eventoId);

    const { error } = await supabase.from('escalas').upsert(
      {
        evento_id: eventoId,
        membro_id: perfilAtivo.id,
        status: novoStatus,
        org_id: org.id,
      },
      { onConflict: 'evento_id,membro_id' }
    );

    if (error) {
      logSupabaseError('Erro:', error);
      return;
    }

    // Atualização otimista: evita recarregar todos os eventos/escalas após cada clique.
    setMinhasEscalas((prev) => {
      const semAtual = prev.filter((e) => String(e.evento_id) !== String(eventoId));
      return [...semAtual, { evento_id: eventoId, membro_id: perfilAtivo.id, status: novoStatus }];
    });

    setTodasEscalas((prev) => {
      const semAtual = prev.filter(
        (e) => !(String(e.evento_id) === String(eventoId) && String(e.membro_id) === String(perfilAtivo.id))
      );

      if (novoStatus !== 'confirmado') return semAtual;

      return [
        ...semAtual,
        {
          evento_id: eventoId,
          membro_id: perfilAtivo.id,
          status: 'confirmado',
          membros: {
            nome: perfilAtivo.nome,
            funcao: perfilAtivo.funcao,
            subfuncao: perfilAtivo.subfuncao,
          },
        },
      ];
    });

    // Push não precisa bloquear a resposta visual do botão.
    const membrosIds = todasEscalas
      .filter((x: any) => String(x?.evento_id) === String(eventoId))
      .map((x: any) => String(x?.membro_id || '').trim())
      .filter(Boolean)
      .filter((memberId: string) => memberId !== String(perfilAtivo.id));

    if (membrosIds.length > 0) {
      void sendPush({
        title: 'Presença atualizada',
        message: `${perfilAtivo.nome} marcou ${novoStatus === 'falta' ? 'falta' : 'presença'} no evento.`,
        url: `/`,
        externalUserIds: membrosIds,
        data: {
          type: 'presence_update',
          eventoId,
          membroId: perfilAtivo.id,
          status: novoStatus,
        },
      }).catch((err) => console.error('Erro ao enviar push de presença:', err));
    }
  } finally {
    setConfirmandoId(null);
  }
}


  const FilterPill = ({ k, label }: { k: RangeKey; label: string }) => {
    const isActive = rangeKey === k;
    return (
      <button
        onClick={() => setRangeKey(k)}
        className={cn(
          'px-5 py-2.5 rounded-xl text-[12px] relative font-black uppercase flex-shrink-0 transition-all relative group border',
          isActive
            ? 'bg-blue-500/10 text-blue-400 scale-105 border-blue-500/20'
            : 'bg-slate-900 border-white/5 text-slate-500 hover:text-white'
        )}
      >                                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

        {label}
        {isActive && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6] animate-in fade-in zoom-in duration-300" />
        )}
      </button>
    );
  };

  if (loadingOrg) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white font-sans w-full max-w-[100vw] overflow-x-hidden pt-[env(safe-area-inset-top)]">
        <div className="max-w-md w-full text-center">
          <h1 className="text-4xl font-black italic uppercase tracking-tighter mb-4">Backstage</h1>
          <p className="text-slate-400 mb-8 font-bold text-sm">Você não está conectado a nenhuma organização.</p>
          <div className="space-y-4">
            <Link
              href="/registrar-banda"
              className="block w-full bg-blue-600 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-500"
            >
              Criar Nova Banda (Sou Líder)
            </Link>
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-white/10"></span>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-950 px-2 text-slate-500 font-black">Ou</span>
              </div>
            </div>
            <Link
              href="/membros"
              className="block w-full bg-slate-900 border border-white/10 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-800"
            >
              Entrar com Convite
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
<SubscriptionGuard>
        <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-slate-950 text-white px-4 sm:px-6 lg:px-8 pb-24 font-sans">
        <div className="pt-6 w-full max-w-[1600px] mx-auto">
          {!perfilAtivo && (
            <div className="mb-6 p-4 bg-orange-500/10 border border-orange-500/20 rounded-2xl flex items-center gap-3 animate-pulse">
              <AlertCircle className="text-orange-500 flex-shrink-0" size={20} />
              <p className="text-[10px] font-black uppercase text-orange-200">
                Modo Leitura: Identifique-se no ícone de perfil para confirmar sua escala.
              </p> 
            </div>
          )}

          <header className="flex justify-between items-start mb-4">
            <div className="min-w-0">
              <Link href="/" className="group block transition-transform active:scale-95">
                <div className="flex flex-col min-w-0">
                  <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] group-hover:text-blue-400 transition-colors">
                    Backstage Control
                  </h2>
                  <h1 className="text-3xl sm:text-4xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors break-words">
                    {org.nome || 'Minha Banda'}
                  </h1>
                </div>
              </Link>
            </div>

            <div className="flex gap-3">
              <div className="flex gap-3">
                <button
                  onClick={ativarNotificacoes}
                  className={cn(
                    'size-12 rounded-2xl flex items-center justify-center border transition-all',
                    pushStatus === 'granted'
                      ? 'bg-green-500/10 border-green-500/20 text-green-500'
                      : 'bg-slate-900 border-white/5 text-blue-500'
                  )}
                >
                  {pushStatus === 'granted' ? <BellRing size={20} /> : <Bell size={20} />}
                </button>

                <Link
                  href="/eventos/novo"
                  className="size-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 active:scale-95 transition-all"
                  title="Novo Evento"
                >
                  <Calendar size={20} />
                </Link>

                <Link href="/membros" className="group">
                  <div className="size-12 bg-slate-900 border border-white/5 rounded-2xl flex items-center justify-center text-blue-500 hover:border-blue-500/50 transition-all">
                    {perfilAtivo ? (
                      <div className="size-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black text-sm">
                        {String(perfilAtivo?.nome || '?').trim().charAt(0).toUpperCase()}
                      </div>
                    ) : (
                      <Users size={22} />
                    )}
                  </div>
                </Link>
              </div>
            </div>
          </header>

          {eventoEmFoco && resumoEventoEmFoco && (
            <section className="relative overflow-hidden mb-6 rounded-[2rem] border border-blue-500/20 bg-gradient-to-br from-blue-500/[0.09] via-slate-900/90 to-slate-950 shadow-2xl shadow-blue-950/20">
              <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-70" />

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
                <div className="p-5 sm:p-7 lg:p-8 xl:border-r xl:border-white/5">
                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-blue-300">
                      Central do show
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-300">
                      {resumoEventoEmFoco.countdown}
                    </span>
                  </div>

                  <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.22em] text-blue-400 mb-2">
                    {formatEventDateLong(eventoEmFoco.data)}
                  </p>
                  <h2 className="max-w-4xl text-3xl sm:text-4xl lg:text-5xl font-black italic uppercase tracking-tighter leading-[0.95] break-words">
                    {eventoEmFoco.local || 'Próximo evento'}
                  </h2>

                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold text-slate-400">
                    <span className="flex items-center gap-2">
                      <ListMusic size={15} className="text-blue-400" />
                      {resumoEventoEmFoco.musicas.length} músicas
                    </span>
                    <span className="flex items-center gap-2">
                      <Users size={15} className="text-emerald-400" />
                      {resumoEventoEmFoco.participantes.length} confirmados
                    </span>
                  </div>

                  <div className="mt-7 flex flex-col sm:flex-row gap-3">
                    <Link
                      href={`/live/${eventoEmFoco.id}`}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 active:scale-[0.98]"
                    >
                      <PlayCircle size={18} /> Abrir Live
                    </Link>
                    <Link
                      href={`/eventos/${eventoEmFoco.id}`}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-200 transition-all hover:border-blue-500/30 hover:bg-blue-500/10 active:scale-[0.98]"
                    >
                      <Gauge size={18} /> Preparar show
                    </Link>
                  </div>
                </div>

                <div className="p-5 sm:p-7 lg:p-8 bg-black/10">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Preparação</p>
                      <h3 className={cn(
                        'text-lg sm:text-xl font-black uppercase tracking-tight',
                        resumoEventoEmFoco.readiness === 100
                          ? 'text-emerald-300'
                          : resumoEventoEmFoco.readiness >= 60
                          ? 'text-yellow-300'
                          : 'text-orange-300'
                      )}>
                        {resumoEventoEmFoco.status}
                      </h3>
                    </div>
                    <div className="text-right">
                      <strong className="block text-3xl font-black tabular-nums">{resumoEventoEmFoco.readiness}%</strong>
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                        {resumoEventoEmFoco.completed}/{resumoEventoEmFoco.checks.length}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        resumoEventoEmFoco.readiness === 100
                          ? 'bg-emerald-500'
                          : resumoEventoEmFoco.readiness >= 60
                          ? 'bg-yellow-400'
                          : 'bg-orange-500'
                      )}
                      style={{ width: `${resumoEventoEmFoco.readiness}%` }}
                    />
                  </div>

                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-2">
                    {resumoEventoEmFoco.checks.map((check) => (
                      <div
                        key={check.key}
                        className={cn(
                          'rounded-xl border px-3 py-2.5 flex items-center gap-3 min-w-0',
                          check.ok
                            ? 'border-emerald-500/15 bg-emerald-500/[0.06]'
                            : 'border-orange-500/15 bg-orange-500/[0.06]'
                        )}
                      >
                        {check.ok ? (
                          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                        ) : (
                          <AlertCircle size={16} className="shrink-0 text-orange-400" />
                        )}
                        <div className="min-w-0">
                          <span className="block text-[10px] font-black uppercase text-slate-200">{check.label}</span>
                          <span className="block text-[9px] font-bold text-slate-500 truncate">{check.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 bg-black/15 px-3 sm:px-5 py-3 overflow-x-auto no-scrollbar">
                <div className="min-w-max flex items-center gap-2">
                  <Link href="/repertorio" className="inline-flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.035] px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white hover:border-blue-500/20">
                    <Music size={14} className="text-blue-400" /> Repertório
                  </Link>
                  <Link href="/eventos/setlists" className="inline-flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.035] px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white hover:border-blue-500/20">
                    <ListMusic size={14} className="text-blue-400" /> Setlists
                  </Link>
                  <Link href="/membros" className="inline-flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.035] px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white hover:border-blue-500/20">
                    <Users size={14} className="text-blue-400" /> Membros
                  </Link>
                  <Link href="/eventos/novo" className="inline-flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.035] px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-300 hover:text-white hover:border-blue-500/20">
                    <Calendar size={14} className="text-blue-400" /> Novo evento
                  </Link>
                </div>
              </div>
            </section>
          )}

          <div className="mt-4 flex items-center gap-2 overflow-x-auto no-scrollbar pb-4">
            <FilterPill k="all" label="Todos" />
            <FilterPill k="week" label="Esta semana" />
            <FilterPill k="month" label="Este mês" />
            <FilterPill k="year" label="Este ano" />

            <Link
              href="/eventos/antigos"
              className="px-5 py-2.5 rounded-xl text-[12px] font-black uppercase flex-shrink-0 transition-all border bg-slate-900 border-white/5 text-slate-500 hover:text-white hover:border-blue-500/20 active:scale-95"
            >
              Passados
            </Link>
          </div>

          <div className="space-y-8 mb-12">
            {loading ? (
              <div className="p-10 text-center">
                <Loader2 className="animate-spin mx-auto text-blue-500" />
              </div>
            ) : eventos.length === 0 ? (
              <div className="w-full bg-blue-500/5 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] flex flex-col items-center gap-3 shadow-xl">
                <Calendar className="mx-auto mb-4" size={40} />
                <p className="font-black uppercase text-xs tracking-widest">
                  Nenhum evento encontrado ({rangeLabel})
                </p>
                <Link
                  href="/eventos/novo"
                  className="mt-4 inline-block text-xl font-bold text-blue-500 uppercase hover:underline"
                >
                  + Criar Evento
                </Link>
              </div>
            ) : (
              eventos.map((ev) => {
                const escalaPropria = minhaEscalaPorEvento.get(String(ev.id));
                const isFalta = escalaPropria?.status === 'falta';
                const isConfirmado = escalaPropria?.status === 'confirmado';
                const participantes = escalasPorEvento.get(String(ev.id)) || [];
                const papelMap = buildPapeisDoEvento(participantes);
                const isProcessando = confirmandoId === ev.id;
                const paletaShow = String(ev?.paleta_cores || '').trim() || 'Look Padrão';
                const isToday = isEventToday(ev.data);

                return (
                  <section
                    key={ev.id}
                    className={cn(
                      'relative p-6 rounded-[2.5rem] border transition-all duration-500 overflow-hidden',
                      isToday
                        ? 'scale-[1.02] z-10 border-transparent shadow-[0_0_30px_rgba(59,130,246,0.2)]'
                        : isFalta
                        ? 'bg-slate-950 border-red-900/20 opacity-40 scale-95'
                        : 'bg-slate-900 border-white/5 shadow-2xl'
                    )}
                  >
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                    {isToday && (
                      <>
                        <div className="absolute inset-[-1000%] animate-spin-slow [background:conic-gradient(from_90deg_at_50%_50%,#0ea5e9_0%,#3b82f6_50%,#0ea5e9_100%)]" />
                        <div className="absolute inset-[2px] bg-slate-900 rounded-[2.4rem] z-0" />
                      </>
                    )}

                    <div className="relative z-10">
                      {isToday && (
                        <div className="absolute -top-5 justify-self-center bg-blue-600 px-4 py-1.5 rounded-full shadow-lg shadow-blue-600/40 animate-bounce">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">
                            Evento Hoje
                          </span>
                        </div>
                      )}

                      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar flex-wrap">
                        {participantes.length === 0 && (
                          <span className="bg-red-500/10 border border-red-500/20 text-red-500 text-[8px] font-black px-2 py-1 rounded-md uppercase tracking-widest animate-pulse whitespace-nowrap">
                            ⚠️ SEM CONFIRMADOS
                          </span>
                        )}
                        {ev.evento_repertorio?.length > 0 ? (
                          <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[8px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap">
                            ✓ SETLIST DEFINIDA
                          </span>
                        ) : (
                          <span className="bg-orange-500/10 border border-orange-500/20 text-orange-500 text-[8px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap">
                            ⏳ AGUARDANDO REPERTÓRIO
                          </span>
                        )}
                      </div>

                      <div className="flex justify-between items-start mb-6 gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-1">
                            {formatEventDate(ev.data)}
                          </h3>
                          <h2 className="text-2xl font-black tracking-tighter uppercase italic leading-none break-words">
                            {ev.local}
                          </h2>
                          <div className="mt-3 flex items-center gap-2 text-[9px] font-black text-blue-500 bg-blue-500/10 w-fit px-3 py-1.5 rounded-full border border-blue-500/20 uppercase">
                            <Palette size={12} /> {paletaShow}
                          </div>
                        </div>

                        <Link
                          href={`/eventos/${ev.id}`}
                          className="size-14 bg-slate-800 border border-white/5 rounded-2xl flex flex-col items-center justify-center text-blue-400 hover:text-blue-300 hover:border-blue-500/50 active:scale-95 transition-all"
                          title="Abrir central do evento"
                        >
                          <Gauge size={20} />
                        </Link>

                        {ev.recorrencia_id && (
                          <Link
                            href="/configuracoes/recorrencias"
                            className="size-14 bg-slate-800 border border-white/5 rounded-2xl flex items-center justify-center text-blue-400 hover:text-blue-300 hover:border-blue-500/50 active:scale-95 transition-all"
                            title="Ver regra de recorrência"
                          >
                            <Repeat size={20} />
                          </Link>
                        )}

                        <button
                          onClick={() => alternarPresenca(ev.id, escalaPropria?.status)}
                          disabled={!perfilAtivo || isProcessando}
                          className={cn(
                            'p-4 rounded-2xl transition-all relative flex items-center justify-center shrink-0',
                            isConfirmado
                              ? 'bg-blue-600 text-white'
                              : isFalta
                              ? 'bg-red-600 text-white'
                              : 'bg-slate-800 text-slate-500',
                            (!perfilAtivo || isProcessando) && 'opacity-60'
                          )}
                        >                                    

                          {isProcessando ? (
                            <Loader2 className="animate-spin" size={24} />
                          ) : isFalta ? (
                            <XCircle size={24} />
                          ) : (
                            <CheckCircle2 size={24} />
                          )}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                        {/* Lineup */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Users size={12} /> Lineup Confirmado
                          </h4>

                          <div className="space-y-2">
                            {participantes.length > 0 ? (
                              participantes.map((p: any, idx: number) => {
                                const funcaoAtiva =
                                  papelMap.get(String(p?.membro_id || '')) ||
                                  String(p?.membros?.funcao || 'Músico');

                                const ehSubAssumindo = String(funcaoAtiva).includes('(Sub)');

                                return (
                                  <div
                                    key={`${p.membro_id || 'm'}-${idx}`}
                                    className={cn(
                                      'flex items-center justify-between p-3 relative rounded-2xl border transition-all gap-3',
                                      ehSubAssumindo
                                        ? 'bg-yellow-500/10 border-yellow-500/30'
                                        : 'bg-green-500/10 border-green-500/20 text-white'
                                    )}
                                  >                                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                                    <div className="flex items-center gap-3 min-w-0">
                                      <div
                                        className={cn(
                                          'size-8 rounded-full flex items-center relative justify-center font-black text-xs shrink-0',
                                          ehSubAssumindo
                                            ? 'bg-yellow-500 text-black'
                                            : 'bg-green-600/20 text-blue-400'
                                        )}
                                      >                                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                                        {String(p?.membros?.nome || '?').trim().charAt(0).toUpperCase()}
                                      </div>

                                      <span className="text-xs font-bold uppercase tracking-tight truncate">
                                        {p.membros?.nome}
                                      </span>
                                    </div>

                                    {/* ✅ AQUI ESTAVA QUEBRADO — ARRUMADO */}
                                    <span
                                      className={cn(
                                        'text-[9px] font-black uppercase relative  px-2 py-1 rounded-lg shrink-0',
                                        ehSubAssumindo
                                          ? 'bg-yellow-500/20 text-yellow-50'
                                          : 'bg-slate-800 text-white'
                                      )}
                                    >                                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                                      {funcaoAtiva}
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-[12px] text-yellow-600 italic px-1">Ninguém confirmado ainda...</p>
                            )}
                          </div>
                        </div>

                        {/* Setlist */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <ListMusic size={12} /> Setlist do dia
                          </h4>

                          <div className="grid grid-cols-1 gap-2">
                            {ev.evento_repertorio?.length > 0 ? (
                              ev.evento_repertorio.map((r: any, idx: number) => (
                                <div
                                  key={r.id || idx}
                                  className="flex items-center relative justify-between p-5 relative rounded-2xl border transition-all gap-3 bg-green-500/10 border-green-500/20 text-white"
                                >
                                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                                  <div className="flex items-center relative  gap-3 min-w-0">
                                    
                                    <div
                                      className={cn(
                                        'size-2 rounded-full shrink-0',
                                        r?.repertorio?.categoria === 'Rápida'
                                          ? 'bg-red-500'
                                          : r?.repertorio?.categoria === 'Moderada'
                                          ? 'bg-yellow-400'
                                          : r?.repertorio?.categoria === 'Lenta'
                                          ? 'bg-emerald-400'
                                          : 'bg-slate-600'
                                      )}
                                      
                                    /> <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

                                    <span className="text-[11px] font-black uppercase tracking-tight truncate">
                                      {r?.repertorio?.titulo}
                                    </span>
                                  </div>

                                  <span className="text-[10px] font-bold text-slate-400 uppercase shrink-0">
                                    {r?.repertorio?.categoria || '—'}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <p className="text-[12px] text-yellow-600 italic px-1">Nenhuma música definida...</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <Link
                        href={`/live/${ev.id}`}
                        className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-3xl flex items-center justify-center gap-3 text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-600/30 transition-all active:scale-95"
                      >
                        <PlayCircle size={20} /> Abrir Show Non-Stop
                      </Link>
                    </div>
                  </section>
                );
              })
            )}
          </div>

          {/* Card extra: Gerenciar repertórios */}
          <div className="relative overflow-hidden gap-4">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

            <Link
              href="/eventos/setlists"
              className="col-span-2 flex items-center justify-between p-7 bg-blue-600/5 border border-blue-500/20 rounded-[2.5rem] hover:bg-blue-600/10 transition-all gap-4"
            >
              <div className="flex items-center gap-5 min-w-0 relative overflow-hidden">

                <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-600/40 shrink-0">
                  <Music2 size={28} />
                </div>

                <div className="min-w-0">
                  <span className="block font-black uppercase text-[14px] tracking-[0.2em] text-white">
                    Gerenciar repertórios
                  </span>
                  <span className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">
                    Acesso geral a todas as músicas
                  </span>
                </div>
              </div>

              <ChevronRight size={20} className="text-blue-500 shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    </SubscriptionGuard>
  );
}
