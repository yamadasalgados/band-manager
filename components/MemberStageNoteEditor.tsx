'use client';

import { useEffect, useMemo, useState } from 'react';
import { StickyNote, Save, Loader2, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Props = {
  orgId: string;
  songId: string;
};

type ActiveMember = {
  id: string;
  nome?: string;
  funcao?: string;
};

export default function MemberStageNoteEditor({ orgId, songId }: Props) {
  const [member, setMember] = useState<ActiveMember | null>(null);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('usuario_ativo');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.id) {
        setMember({
          id: String(parsed.id),
          nome: parsed?.nome ? String(parsed.nome) : undefined,
          funcao: parsed?.funcao ? String(parsed.funcao) : undefined,
        });
      } else {
        setMember(null);
        setLoading(false);
      }
    } catch {
      setMember(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!orgId || !songId || !member?.id) return;
    let alive = true;
    setLoading(true);

    void supabase
      .from('repertorio_notas_membro')
      .select('nota')
      .eq('org_id', String(orgId))
      .eq('repertorio_id', String(songId))
      .eq('membro_id', String(member.id))
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) {
          console.warn('[Notas de palco] tabela indisponível:', error.message);
          setMessage('Execute a migration v8 para ativar notas pessoais.');
          setLoading(false);
          return;
        }
        const value = String(data?.nota || '');
        setNote(value);
        setSavedNote(value);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [member?.id, orgId, songId]);

  const dirty = useMemo(() => note !== savedNote, [note, savedNote]);

  async function saveNote() {
    if (!member?.id || !orgId || !songId || saving) return;
    setSaving(true);
    setMessage(null);
    const normalized = note.trim();

    const { error } = await supabase
      .from('repertorio_notas_membro')
      .upsert(
        {
          org_id: String(orgId),
          repertorio_id: String(songId),
          membro_id: String(member.id),
          nota: normalized,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,repertorio_id,membro_id' }
      );

    if (error) {
      console.error('Erro ao salvar nota de palco:', error);
      setMessage('Não foi possível salvar. Confirme se a migration v8 foi executada.');
    } else {
      setSavedNote(normalized);
      setNote(normalized);
      setMessage('Nota salva. Ela aparecerá no seu Live.');
    }
    setSaving(false);
  }

  return (
    <div className="rounded-[2rem] border border-violet-500/20 bg-violet-500/[0.045] p-5 sm:p-6 shadow-xl shadow-violet-950/10">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-10 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
            <StickyNote size={18} className="text-violet-300" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Minha nota de palco</p>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Anotação pessoal deste integrante. Só aparece no Live do perfil ativo neste aparelho.
            </p>
          </div>
        </div>
        {member && (
          <div className="shrink-0 hidden sm:flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <UserRound size={13} className="text-slate-500" />
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">{member.nome || 'Integrante'}</span>
          </div>
        )}
      </div>

      {!member ? (
        <div className="rounded-2xl border border-yellow-500/15 bg-yellow-500/5 px-4 py-4 text-[10px] font-bold text-yellow-200/80">
          Selecione seu perfil em Membros para criar uma anotação pessoal desta música.
        </div>
      ) : loading ? (
        <div className="min-h-28 flex items-center justify-center text-slate-600">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value.slice(0, 700));
              setMessage(null);
            }}
            placeholder="Ex.: Capotraste 2; segunda voz só no último refrão; entrar depois do vocal..."
            className="w-full min-h-28 resize-y rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm font-semibold text-slate-100 placeholder:text-slate-700 outline-none focus:border-violet-500/40"
          />
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-600">{note.length}/700 caracteres</p>
              {message && <p className="mt-1 text-[10px] font-bold text-violet-300">{message}</p>}
            </div>
            <button
              type="button"
              onClick={() => void saveNote()}
              disabled={!dirty || saving}
              className="min-h-11 px-5 rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-200 text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[0.98]"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Salvando…' : dirty ? 'Salvar minha nota' : 'Nota salva'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
