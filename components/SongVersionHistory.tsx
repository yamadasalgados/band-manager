'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Clock3, History, Loader2, RefreshCw, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SongSnapshotV1 } from '@/lib/songVersioning';

type Props = {
  orgId: string;
  songId: string;
  dirty?: boolean;
  onRestore: (snapshot: SongSnapshotV1) => void;
};

type VersionRow = {
  id: number | string;
  created_at: string;
  motivo?: string | null;
  membro_nome?: string | null;
  snapshot: SongSnapshotV1;
};

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data desconhecida';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function SongVersionHistory({ orgId, songId, dirty = false, onRestore }: Props) {
  const [rows, setRows] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !songId) return;
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase
      .from('repertorio_versoes')
      .select('id,created_at,motivo,membro_nome,snapshot')
      .eq('org_id', orgId)
      .eq('repertorio_id', songId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.warn('[Histórico da música] indisponível:', error.message);
      setAvailable(false);
      setRows([]);
    } else {
      setAvailable(true);
      setRows((data || []) as VersionRow[]);
    }
    setLoading(false);
  }, [orgId, songId]);

  useEffect(() => {
    void load();
  }, [load]);

  function restore(row: VersionRow) {
    const title = String(row?.snapshot?.musica?.titulo || 'esta versão');
    const warning = dirty
      ? `Você possui alterações não salvas. Carregar “${title}” substituirá o conteúdo atual do editor, mas nada será gravado no banco até você clicar em Gravar Arquitetura. Continuar?`
      : `Carregar “${title}” no editor? Nada será gravado no banco até você clicar em Gravar Arquitetura.`;

    if (!window.confirm(warning)) return;
    onRestore(row.snapshot);
    setMessage('Versão carregada no editor. Revise no Preview e salve quando estiver certo.');
  }

  return (
    <div className="rounded-[2rem] border border-cyan-500/20 bg-cyan-500/[0.04] p-5 sm:p-6 shadow-xl shadow-cyan-950/10">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-10 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 flex items-center justify-center shrink-0">
            <History size={18} className="text-cyan-300" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Histórico e recuperação</p>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Antes de cada gravação, a versão anterior é arquivada. Carregar uma versão nunca sobrescreve o banco imediatamente.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="size-10 rounded-xl border border-white/10 bg-black/20 flex items-center justify-center text-slate-400 hover:text-white disabled:opacity-40"
          title="Atualizar histórico"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {!available ? (
        <div className="rounded-2xl border border-yellow-500/15 bg-yellow-500/5 px-4 py-4 text-[10px] font-bold text-yellow-200/80 leading-relaxed">
          Histórico ainda não está ativo. Execute a migration v10 no Supabase; a edição da música continua funcionando normalmente enquanto isso.
        </div>
      ) : loading ? (
        <div className="min-h-24 flex items-center justify-center text-slate-600">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-black/15 px-4 py-5 text-center text-[10px] font-bold text-slate-600">
          Nenhuma versão anterior ainda. A primeira será criada automaticamente antes da próxima gravação.
        </div>
      ) : (
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
          {rows.map((row, index) => {
            const snapshot = row.snapshot;
            const blockCount = snapshot?.blocos?.length || 0;
            const timelineCount = snapshot?.timeline_client_ids?.length || 0;
            return (
              <div key={String(row.id)} className="rounded-2xl border border-white/7 bg-slate-950/55 px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-wider text-cyan-300/80">Versão anterior #{rows.length - index}</span>
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-600">
                      <Clock3 size={11} /> {formatWhen(row.created_at)}
                    </span>
                    {row.membro_nome && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-600">
                        <UserRound size={11} /> {row.membro_nome}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-black text-slate-100 break-words">{snapshot?.musica?.titulo || 'Música sem título'}</p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">
                    {snapshot?.musica?.tom || 'Sem tom'} • {snapshot?.musica?.bpm || '—'} BPM • {blockCount} blocos • {timelineCount} posições
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => restore(row)}
                  className="shrink-0 min-h-11 px-4 rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-cyan-200 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  <ArchiveRestore size={14} /> Carregar
                </button>
              </div>
            );
          })}
        </div>
      )}

      {message && <p className="mt-3 text-[10px] font-bold text-cyan-300">{message}</p>}
    </div>
  );
}
