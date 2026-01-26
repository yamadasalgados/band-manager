'use client';

import React, { useMemo, useState } from 'react';
import { Calendar, MapPin, Palette, ArrowLeft, Loader2, Save, Repeat, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/contexts/OrgContext';
import Link from 'next/link';

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
  const [diasSemana, setDiasSemana] = useState<number[]>([6, 0]); // padrão: sáb/dom
  const [horaRecorrente, setHoraRecorrente] = useState('19:00');
  const [autoEscalar, setAutoEscalar] = useState(true);
  if (!org) return null; // Ou um loader customizado

  const diasLabel = useMemo(() => {
    const map = new Map(DIAS.map(d => [d.value, d.label]));
    return diasSemana.slice().sort((a,b)=>a-b).map(v => map.get(v)).filter(Boolean).join(', ');
  }, [diasSemana]);

  function toggleDia(v: number) {
    setDiasSemana(prev => {
      if (prev.includes(v)) return prev.filter(x => x !== v);
      return [...prev, v];
    });
  }

async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();

  if (!org?.id) {
    alert('Erro de segurança: Nenhuma organização identificada.');
    return;
  }

  const formData = new FormData(e.currentTarget);
  const local = String(formData.get('local') || '').trim();
  const dataHora = String(formData.get('data') || '').trim(); 
  const paleta = String(formData.get('paleta') || '').trim() || null;

  // ✅ Captura automática do Timezone do dispositivo (ex: 'America/Sao_Paulo' ou 'Asia/Tokyo')
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!local) return alert('Informe o local.');

  if (!recorrente && !dataHora) {
    return alert('Informe data e hora.');
  }

  if (recorrente) {
    if (!diasSemana.length) return alert('Selecione pelo menos 1 dia da semana.');
    if (!horaRecorrente) return alert('Informe o horário da recorrência.');
  }

  setLoading(true);
  try {
    const res = await fetch('/api/eventos/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId: org.id,
        titulo: local,
        local,
        paleta,
        recorrente,
        tz: userTimeZone, // 👈 Fix: Enviando o fuso horário para o cálculo global
        data: recorrente ? undefined : dataHora,
        dataInicio: recorrente ? new Date().toISOString().split('T')[0] : undefined,
        diasSemana: recorrente ? diasSemana : undefined,
        hora: recorrente ? horaRecorrente : undefined,
        autoEscalar,
      }),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || 'Falha ao criar evento.');
    }

    router.push('/');
  } catch (err: any) {
    console.error(err);
    alert('Erro ao criar evento: ' + (err?.message || 'Erro desconhecido'));
  } finally {
    setLoading(false);
  }
}

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 font-sans">
      <div className="w-full max-w-lg mx-auto">
        {/* HEADER */}
        <header className="flex items-start justify-between mb-8">
          <div className="flex-1">
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org?.nome || 'Banda'}
            </h2>
            <Link href="/" className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white">
              agendar
              <br />
              evento
            </Link>
          </div>

          <button
            onClick={() => router.back()}
            className="mt-2 text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> voltar
          </button>
        </header>

        {/* FORM */}
        <form
          onSubmit={handleSubmit}
          className="w-full bg-slate-900 border border-white/5 relative overflow-hidden p-8 rounded-[2.5rem] space-y-6 shadow-2xl relative"
        >
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />

          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-blue-600/10 rounded-2xl border border-blue-500/20">
              <Calendar className="text-blue-500" size={24} />
            </div>
            <h2 className="text-xl font-black italic uppercase text-white tracking-tight">Novo Show / Ensaio</h2>
          </div>

          {/* Local */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
              Nome do Local
            </label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-slate-600" />
              <input
                name="local"
                placeholder="Ex: Bar do Rock / Casamento"
                className="w-full p-4 pl-12 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold placeholder:text-slate-700 transition-all"
                required
              />
            </div>
          </div>

          {/* Recorrência toggle */}
          <div className="bg-slate-950/60 border border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Repeat className="text-blue-500" size={18} />
                <div>
                  <p className="text-white font-black uppercase text-[12px]">Evento recorrente</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                    Cria automaticamente toda semana
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setRecorrente(v => !v)}
                className={`px-4 py-2 rounded-xl border font-black uppercase text-[10px] tracking-widest transition-all ${
                  recorrente
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-slate-900 text-slate-300 border-white/10'
                }`}
              >
                {recorrente ? 'Ativo' : 'Desativado'}
              </button>
            </div>

            {/* Data/hora ou regra */}
            {!recorrente ? (
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
                  Data e Hora
                </label>
                <input
                  name="data"
                  type="datetime-local"
                  className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold transition-all [color-scheme:dark]"
                  required
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2">
                    Dias da semana
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {DIAS.map(d => {
                      const on = diasSemana.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => toggleDia(d.value)}
                          className={`px-3 py-2 rounded-xl border font-black uppercase text-[10px] tracking-widest transition-all ${
                            on
                              ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                              : 'bg-slate-900 text-slate-400 border-white/10'
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    Selecionado: <span className="text-slate-300">{diasLabel || '—'}</span>
                  </p>
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
                    Horário (toda semana)
                  </label>
                  <input
                    type="time"
                    value={horaRecorrente}
                    onChange={(e) => setHoraRecorrente(e.target.value)}
                    className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold transition-all [color-scheme:dark]"
                    required
                  />
                </div>
              </div>
            )}

            {/* Auto escalar */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-3">
                <Users className="text-yellow-500" size={18} />
                <div>
                  <p className="text-white font-black uppercase text-[12px]">Escalar todos os membros</p>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                    Se desligar, cria só o evento (sem escala)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAutoEscalar(v => !v)}
                className={`px-4 py-2 rounded-xl border font-black uppercase text-[10px] tracking-widest transition-all ${
                  autoEscalar
                    ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20'
                    : 'bg-slate-900 text-slate-400 border-white/10'
                }`}
              >
                {autoEscalar ? 'Sim' : 'Não'}
              </button>
            </div>
          </div>

          {/* Paleta */}
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
              Paleta de Cores (Dress Code)
            </label>
            <div className="relative">
              <Palette className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-slate-600" />
              <input
                name="paleta"
                placeholder="Ex: Todo preto / Branco e Azul"
                className="w-full p-4 pl-12 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold placeholder:text-slate-700 transition-all"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500/5 border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] active:scale-95 flex items-center justify-center gap-3 hover:border-blue-500/40 shadow-blue-500/10 hover:text-white transition-all border border-yellow-500/20 shadow-xl disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            {loading ? 'Criando...' : recorrente ? 'Salvar Recorrência' : 'Salvar e Escalar Banda'}
          </button>

          {recorrente && (
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
              * Após salvar, o sistema já tenta gerar os eventos da próxima semana.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
