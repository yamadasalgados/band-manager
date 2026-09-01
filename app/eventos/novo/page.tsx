'use client';

import React, { useMemo, useState } from 'react';
import { Calendar, MapPin, ArrowLeft, Loader2, Save, Repeat, Users, Sparkles, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/contexts/OrgContext';
import Link from 'next/link';
import { getAuthAccessToken } from '@/lib/deviceIdentity';
import EventPalettePicker from '@/components/EventPalettePicker';

const DIAS = [
  { label: 'Dom', value: 0 },
  { label: 'Seg', value: 1 },
  { label: 'Ter', value: 2 },
  { label: 'Qua', value: 3 },
  { label: 'Qui', value: 4 },
  { label: 'Sex', value: 5 },
  { label: 'Sáb', value: 6 },
];

export default function CriarEvento() {
  const { org } = useOrg();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [recorrente, setRecorrente] = useState(false);
  const [diasSemana, setDiasSemana] = useState<number[]>([6, 0]);
  const [horaRecorrente, setHoraRecorrente] = useState('19:00');
  const [autoEscalar, setAutoEscalar] = useState(true);
  const [modoPreparacao, setModoPreparacao] = useState<'simples' | 'completo'>('simples');
  const [paletaEvento, setPaletaEvento] = useState('');

  const diasLabel = useMemo(() => {
    const map = new Map(DIAS.map(d => [d.value, d.label]));
    return diasSemana.slice().sort((a,b)=>a-b).map(v => map.get(v)).filter(Boolean).join(', ');
  }, [diasSemana]);

  if (!org) return null;

  function toggleDia(v: number) {
    setDiasSemana(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!org?.id) return alert('Erro de segurança: Organização não identificada.');

    const formData = new FormData(e.currentTarget);
    const local = String(formData.get('local') || '').trim();
    const dataHoraManual = String(formData.get('data') || '').trim();
    const paleta = String(formData.get('paleta') || paletaEvento || '').trim() || null;
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (!local) return alert('Informe o local.');

    // LOGICA DE PREPARAÇÃO DOS DADOS
    let payload: any = {
      orgId: org.id,
      titulo: local,
      local,
      paleta,
      recorrente,
      tz: userTimeZone,
      autoEscalar,
      modoPreparacao,
    };

    if (recorrente) {
      if (!diasSemana.length) return alert('Selecione pelo menos 1 dia.');

      // A primeira ocorrência é calculada no backend/PostgreSQL usando o fuso
      // enviado em `tz`. O browser não converte mais a recorrência para UTC.
      payload = {
        ...payload,
        diasSemana,
        hora: horaRecorrente,
      };
    } else {
      if (!dataHoraManual) return alert('Informe data e hora.');
      payload.data = dataHoraManual;
    }

    setLoading(true);
    try {
      const accessToken = await getAuthAccessToken();
      if (!accessToken) throw new Error('Este aparelho ainda não está autenticado. Entre novamente na banda.');

      const res = await fetch('/api/eventos/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Falha ao criar.');

      router.push('/');
      router.refresh();
    } catch (err: any) {
      console.error(err);
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 font-sans">
      <div className="w-full max-w-lg mx-auto">
        <header className="flex items-start justify-between mb-8">
          <div className="flex-1">
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org?.nome || 'Banda'}
            </h2>
            <Link href="/" className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white">
              agendar<br />evento
            </Link>
          </div>
          <button onClick={() => router.back()} className="mt-2 text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors">
            <ArrowLeft size={16} /> voltar
          </button>
        </header>

        <form onSubmit={handleSubmit} className="w-full bg-slate-900 border border-white/5 p-8 rounded-[2.5rem] space-y-6 shadow-2xl relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-blue-600/10 rounded-2xl border border-blue-500/20">
              <Calendar className="text-blue-500" size={24} />
            </div>
            <h2 className="text-xl font-black italic uppercase text-white tracking-tight">Novo Show / Ensaio</h2>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Modo de preparação</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setModoPreparacao('simples')}
                className={`rounded-2xl border p-4 text-left transition-all ${modoPreparacao === 'simples' ? 'border-emerald-500/30 bg-emerald-500/[0.08] shadow-lg shadow-emerald-950/20' : 'border-white/10 bg-slate-950/70 hover:border-white/20'}`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={17} className={modoPreparacao === 'simples' ? 'text-emerald-400' : 'text-slate-500'} />
                  <strong className="text-xs font-black uppercase text-white">Culto / evento simples</strong>
                </div>
                <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500">Setlist, escala, presença e Live. Ideal para igreja, culto semanal e eventos corriqueiros.</p>
              </button>

              <button
                type="button"
                onClick={() => setModoPreparacao('completo')}
                className={`rounded-2xl border p-4 text-left transition-all ${modoPreparacao === 'completo' ? 'border-blue-500/30 bg-blue-500/[0.08] shadow-lg shadow-blue-950/20' : 'border-white/10 bg-slate-950/70 hover:border-white/20'}`}
              >
                <div className="flex items-center gap-2">
                  <Settings2 size={17} className={modoPreparacao === 'completo' ? 'text-blue-400' : 'text-slate-500'} />
                  <strong className="text-xs font-black uppercase text-white">Produção completa</strong>
                </div>
                <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-500">Acrescenta chegada, passagem de som, endereço, contato e checklist operacional.</p>
              </button>
            </div>
            <p className="mt-2 ml-1 text-[9px] font-bold text-slate-600">Você pode trocar o modo depois sem perder os dados já preenchidos.</p>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Nome do Local</label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-slate-600" />
              <input name="local" placeholder="Ex: Bar do Rock / Casamento" className="w-full p-4 pl-12 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold" required />
            </div>
          </div>

          <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Repeat className="text-blue-500" size={18} />
                <div>
                  <p className="text-white font-black uppercase text-[12px]">Evento recorrente</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Apenas um registro que se renova</p>
                </div>
              </div>
              <button type="button" onClick={() => setRecorrente(v => !v)} className={`px-4 py-2 rounded-xl border font-black uppercase text-[10px] tracking-widest transition-all ${recorrente ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-900 text-slate-300 border-white/10'}`}>
                {recorrente ? 'Ativo' : 'Desativado'}
              </button>
            </div>

            {!recorrente ? (
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Data e Hora</label>
                <input name="data" type="datetime-local" className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold [color-scheme:dark]" required />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2">Dias da semana</p>
                  <div className="flex flex-wrap gap-2">
                    {DIAS.map(d => (
                      <button key={d.value} type="button" onClick={() => toggleDia(d.value)} className={`px-3 py-2 rounded-xl border font-black uppercase text-[10px] transition-all ${diasSemana.includes(d.value) ? 'bg-blue-500/10 text-blue-300 border-blue-500/20' : 'bg-slate-900 text-slate-400 border-white/10'}`}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Horário</label>
                  <input type="time" value={horaRecorrente} onChange={(e) => setHoraRecorrente(e.target.value)} className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 font-bold [color-scheme:dark]" required />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-3">
                <Users className="text-yellow-500" size={18} />
                <p className="text-white font-black uppercase text-[12px]">Auto Escalar</p>
              </div>
              <button type="button" onClick={() => setAutoEscalar(v => !v)} className={`px-4 py-2 rounded-xl border font-black uppercase text-[10px] ${autoEscalar ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' : 'bg-slate-900 text-slate-400 border-white/10'}`}>
                {autoEscalar ? 'Sim' : 'Não'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Paleta de cores / Dress Code</label>
            <EventPalettePicker value={paletaEvento} onChange={setPaletaEvento} name="paleta" />
            <p className="mt-2 ml-1 text-[9px] font-bold text-slate-600">Escolha uma combinação rápida ou escreva uma orientação personalizada para a equipe.</p>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-blue-500/5 border border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] active:scale-95 flex items-center justify-center gap-3 hover:text-white transition-all disabled:opacity-60">
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            {loading ? 'Criando...' : 'Salvar Evento'}
          </button>
        </form>
      </div>
    </div>
  );
}