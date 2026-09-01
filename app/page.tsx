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
  const [eventoParaCancelar, setEventoParaCancelar] = useState<any | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  const rangeLabel = useMemo(() => {
    if (rangeKey === 'all') return 'Todos';
    if (rangeKey === 'week') return 'Esta semana';
    if (rangeKey === 'month') return 'Este mês';
    return 'Este ano';
  }, [rangeKey]);


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

  const resumoDoEvento = useCallback(
    (evento: any) => {
      const eventoId = String(evento?.id || '');
      const participantes = escalasPorEvento.get(eventoId) || [];
      const minhaEscala = minhaEscalaPorEvento.get(eventoId);
      const setlist = Array.isArray(evento?.evento_repertorio) ? evento.evento_repertorio : [];
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
        { key: 'setlist', ok: musicas.length > 0 },
        { key: 'lineup', ok: participantes.length > 0 },
        {
          key: 'bpm',
          ok: musicas.length > 0 && musicas.every((musica: any) => Number(musica?.bpm) > 0),
        },
        {
          key: 'tom',
          ok:
            musicas.length > 0 &&
            musicas.every((musica: any) => String(musica?.tom || '').trim().length > 0),
        },
      ];

      if (evento?.modo_preparacao === 'completo') {
        checks.push({ key: 'operacao', ok: operacaoOk });
        checks.push({ key: 'checklist', ok: checklistOk });
      }

      if (perfilAtivo) {
        checks.push({ key: 'presenca', ok: minhaEscala?.status === 'confirmado' });
      }

      const completed = checks.filter((check) => check.ok).length;
      const readiness = checks.length > 0 ? Math.round((completed / checks.length) * 100) : 0;

      return {
        readiness,
        completed,
        total: checks.length,
        pending: Math.max(0, checks.length - completed),
      };
    },
    [
      checklistPorEvento,
      escalasPorEvento,
      minhaEscalaPorEvento,
      operacaoPorEvento,
      perfilAtivo,
    ]
  );

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
        .select(`id, local, data, paleta_cores, recorrencia_id, modo_preparacao, finalizado, cancelado, cancelado_em, motivo_cancelamento, evento_repertorio(id, repertorio(id, titulo, categoria, bpm, tom))`)
        .eq('org_id', org.id)
        .or('finalizado.eq.false,cancelado.eq.true')
        .order('data', { ascending: true });

      if (start) q = q.gte('data', start.toISOString());
      if (end) q = q.lte('data', end.toISOString());

      const { data: evs, error: evErr } = await q;
      if (evErr) {
        logSupabaseError('Erro ao buscar eventos:', evErr);
        return;
      }

      const eventosVisiveis = (evs || []).filter((evento: any) => {
        if (!evento?.cancelado || rangeKey !== 'all') return true;
        const fimDoDiaDoEvento = new Date(evento.data);
        if (Number.isNaN(fimDoDiaDoEvento.getTime())) return true;
        fimDoDiaDoEvento.setHours(23, 59, 59, 999);
        return fimDoDiaDoEvento.getTime() >= Date.now();
      });

      setEventos(eventosVisiveis);

      if (eventosVisiveis.length === 0) {
        setMinhasEscalas([]);
        setTodasEscalas([]);
        setOperacoes([]);
        setChecklistOperacional([]);
        return;
      }

      const ids = eventosVisiveis.map((e: any) => e.id);

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


  async function cancelarEvento() {
    if (!eventoParaCancelar?.id || !org?.id) return;

    const eventoId = String(eventoParaCancelar.id);
    try {
      setCancelandoId(eventoId);
      const { data: authData } = await supabase.auth.getSession();
      const token = authData.session?.access_token;
      if (!token) throw new Error('Sessão não encontrada. Entre novamente no Band Manager.');

      const response = await fetch('/api/eventos/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId: eventoId,
          reason: motivoCancelamento.trim() || null,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível cancelar o evento.');

      const motivo = motivoCancelamento.trim();
      setEventos((prev) =>
        prev.map((evento) =>
          String(evento?.id) === eventoId
            ? {
                ...evento,
                cancelado: true,
                finalizado: true,
                cancelado_em: payload?.cancelledAt || new Date().toISOString(),
                motivo_cancelamento: motivo || null,
              }
            : evento
        )
      );

      const membrosIds = todasEscalas
        .filter((item: any) => String(item?.evento_id) === eventoId)
        .map((item: any) => String(item?.membro_id || '').trim())
        .filter(Boolean);

      if (membrosIds.length > 0) {
        void sendPush({
          title: 'Evento cancelado',
          message: `${eventoParaCancelar.local || 'Evento'} foi cancelado${motivo ? `: ${motivo}` : '.'}`,
          url: '/',
          externalUserIds: membrosIds,
          data: { type: 'event_cancelled', eventoId, reason: motivo || null },
        }).catch((err) => console.error('Erro ao enviar push de cancelamento:', err));
      }

      setEventoParaCancelar(null);
      setMotivoCancelamento('');
    } catch (err: any) {
      alert(err?.message || 'Não foi possível cancelar o evento.');
    } finally {
      setCancelandoId(null);
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

          <section className="mb-5 rounded-[1.6rem] border border-blue-500/20 bg-blue-500/[0.055] p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Link
                href="/repertorio"
                className="group flex min-w-0 flex-1 items-center justify-between gap-4 rounded-2xl px-3 py-2.5 transition-all hover:bg-blue-500/10"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                    <Music2 size={22} />
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[11px] sm:text-xs font-black uppercase tracking-[0.15em] text-white">
                      Repertório
                    </span>
                    <span className="block truncate text-[9px] font-bold uppercase tracking-widest text-blue-400">
                      Ver, editar e organizar músicas
                    </span>
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-blue-400 transition-transform group-hover:translate-x-1" />
              </Link>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                <Link
                  href="/eventos/setlists"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-500/25 bg-blue-500/[0.07] px-4 text-[10px] font-black uppercase tracking-[0.14em] text-blue-300 transition-all hover:bg-blue-500/12 hover:text-white active:scale-[0.98]"
                >
                  <ListMusic size={16} /> Setlists
                </Link>
                <Link
                  href="/repertorio/novo"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-[10px] font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 active:scale-[0.98]"
                >
                  + Nova música
                </Link>
              </div>
            </div>
          </section>

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
                const resumo = resumoDoEvento(ev);
                const isCancelled = Boolean(ev?.cancelado);
                const isReady = !isCancelled && resumo.readiness === 100;

                return (
                  <section
                    key={ev.id}
                    className={cn(
                      'relative p-6 rounded-[2.5rem] border transition-all duration-500 overflow-hidden bg-slate-900',
                      isCancelled
                        ? 'border-red-500/30 opacity-50 grayscale-[0.45] shadow-none'
                        : isReady
                        ? 'border-blue-500/45 shadow-[0_0_30px_rgba(59,130,246,0.12)]'
                        : 'border-yellow-400/55 shadow-[0_0_28px_rgba(250,204,21,0.10)]',
                      isToday && !isCancelled && 'scale-[1.02] z-10 border-transparent',
                      isFalta && !isCancelled && 'opacity-75'
                    )}
                  >
                    <div className={cn(
                      "absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent to-transparent opacity-70",
                      isCancelled ? "via-red-500" : isReady ? "via-blue-500" : "via-yellow-400"
                    )} />

                    {isToday && !isCancelled && (
                      <>
                        <div
                          className={cn(
                            "absolute inset-[-1000%] animate-spin-slow",
                            isReady
                              ? "[background:conic-gradient(from_90deg_at_50%_50%,#0ea5e9_0%,#3b82f6_50%,#0ea5e9_100%)]"
                              : "[background:conic-gradient(from_90deg_at_50%_50%,#f59e0b_0%,#fde047_50%,#f59e0b_100%)]"
                          )}
                        />
                        <div className="absolute inset-[2px] bg-slate-900 rounded-[2.4rem] z-0" />
                      </>
                    )}

                    <div className="relative z-10">
                      {isToday && !isCancelled && (
                        <div className={cn(
                          "absolute -top-5 justify-self-center px-4 py-1.5 rounded-full shadow-lg animate-bounce",
                          isReady
                            ? "bg-blue-600 shadow-blue-600/40"
                            : "bg-yellow-400 text-slate-950 shadow-yellow-400/30"
                        )}>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">
                            Evento Hoje
                          </span>
                        </div>
                      )}

                      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar flex-wrap">
                        {isCancelled ? (
                          <span className="text-[8px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap border bg-red-500/10 border-red-500/30 text-red-300">
                            ✕ EVENTO CANCELADO
                          </span>
                        ) : (
                          <span
                            className={cn(
                              'text-[8px] font-black px-2 py-1 rounded-md uppercase tracking-widest whitespace-nowrap border',
                              isReady
                                ? 'bg-blue-500/10 border-blue-500/25 text-blue-300'
                                : 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300'
                            )}
                          >
                            {isReady
                              ? '✓ 100% PRONTO'
                              : `⚠ ${resumo.readiness}% • ${resumo.pending} pendência${resumo.pending === 1 ? '' : 's'}`}
                          </span>
                        )}
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
                          {isCancelled && (
                            <p className="mt-3 max-w-xl text-[10px] font-bold uppercase tracking-wide text-red-300">
                              Cancelado{ev?.motivo_cancelamento ? ` • ${ev.motivo_cancelamento}` : ''}
                            </p>
                          )}
                        </div>

                        <Link
                          href={`/eventos/${ev.id}`}
                          className={cn(
                            'size-14 rounded-2xl flex flex-col items-center justify-center border active:scale-95 transition-all',
                            isCancelled
                              ? 'bg-slate-800 border-white/5 text-slate-500 hover:text-slate-300'
                              : isReady
                              ? 'bg-slate-800 border-blue-500/20 text-blue-400 hover:text-blue-300 hover:border-blue-500/50'
                              : 'bg-yellow-400/10 border-yellow-400/35 text-yellow-300 hover:bg-yellow-400/15 hover:border-yellow-300/60 animate-pulse'
                          )}
                          title={isCancelled ? 'Ver evento cancelado' : isReady ? 'Abrir central do evento' : 'Averiguar pendências do evento'}
                        >
                          {isCancelled ? <XCircle size={20} /> : isReady ? <Gauge size={20} /> : <AlertCircle size={22} />}
                        </Link>

                        {!isCancelled && (
                        <button
                          type="button"
                          onClick={() => {
                            setEventoParaCancelar(ev);
                            setMotivoCancelamento('');
                          }}
                          className="size-12 sm:size-14 rounded-2xl border border-red-500/20 bg-red-500/[0.07] flex items-center justify-center text-red-400 transition-all hover:bg-red-500/15 hover:border-red-500/40 active:scale-95"
                          title="Cancelar evento"
                        >
                          <XCircle size={21} />
                        </button>
                        )}

                        {ev.recorrencia_id && (
                          <Link
                            href="/configuracoes/recorrencias"
                            className="size-12 sm:size-14 bg-slate-800 border border-white/5 rounded-2xl flex items-center justify-center text-blue-400 hover:text-blue-300 hover:border-blue-500/50 active:scale-95 transition-all"
                            title="Ver regra de recorrência"
                          >
                            <Repeat size={20} />
                          </Link>
                        )}

                        <button
                          onClick={() => alternarPresenca(ev.id, escalaPropria?.status)}
                          disabled={!perfilAtivo || isProcessando || isCancelled}
                          className={cn(
                            'p-4 rounded-2xl transition-all relative flex items-center justify-center shrink-0',
                            isConfirmado
                              ? 'bg-blue-600 text-white'
                              : isFalta
                              ? 'bg-red-600 text-white'
                              : 'bg-slate-800 text-slate-500',
                            (!perfilAtivo || isProcessando || isCancelled) && 'opacity-40 cursor-not-allowed'
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

                      {isCancelled ? (
                        <div className="w-full border border-red-500/20 bg-red-500/[0.06] py-5 rounded-3xl flex items-center justify-center gap-3 text-[11px] font-black uppercase tracking-[0.2em] text-red-300">
                          <XCircle size={20} /> Evento cancelado
                        </div>
                      ) : (
                        <Link
                          href={`/live/${ev.id}`}
                          className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-3xl flex items-center justify-center gap-3 text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-600/30 transition-all active:scale-95"
                        >
                          <PlayCircle size={20} /> Abrir Show Non-Stop
                        </Link>
                      )}
                    </div>
                  </section>
                );
              })
            )}
          </div>


          {eventoParaCancelar && (
            <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 p-3 sm:p-6 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-[2rem] border border-red-500/25 bg-slate-950 p-5 sm:p-6 shadow-2xl shadow-black/50">
                <div className="flex items-start gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
                    <XCircle size={24} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-400">Cancelar evento</p>
                    <h3 className="mt-1 break-words text-xl font-black uppercase tracking-tight text-white">
                      {eventoParaCancelar.local || 'Evento'}
                    </h3>
                    <p className="mt-2 text-xs font-bold leading-relaxed text-slate-400">
                      O evento será retirado da agenda ativa e mantido no histórico como cancelado.
                      {eventoParaCancelar.recorrencia_id
                        ? ' Esta ação cancela somente esta ocorrência; a recorrência continua ativa.'
                        : ''}
                    </p>
                  </div>
                </div>

                <label className="mt-5 block">
                  <span className="mb-2 block text-[9px] font-black uppercase tracking-widest text-slate-500">
                    Motivo opcional
                  </span>
                  <textarea
                    value={motivoCancelamento}
                    onChange={(event) => setMotivoCancelamento(event.target.value)}
                    maxLength={280}
                    rows={3}
                    placeholder="Ex.: imprevisto no local, ausência, mudança de agenda..."
                    className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-bold text-white outline-none transition focus:border-red-500/40"
                  />
                </label>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (cancelandoId) return;
                      setEventoParaCancelar(null);
                      setMotivoCancelamento('');
                    }}
                    disabled={Boolean(cancelandoId)}
                    className="min-h-12 rounded-2xl border border-white/10 bg-white/[0.04] text-[10px] font-black uppercase tracking-widest text-slate-300 disabled:opacity-50"
                  >
                    Manter evento
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelarEvento()}
                    disabled={Boolean(cancelandoId)}
                    className="min-h-12 rounded-2xl bg-red-600 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-red-500 disabled:opacity-60"
                  >
                    {cancelandoId ? 'Cancelando...' : 'Confirmar cancelamento'}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </SubscriptionGuard>
  );
}
