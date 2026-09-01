'use client';

import { Copy, ListOrdered, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

export type HarmonyReuseSource = {
  id: string;
  label: string;
  duration: number;
  chords: string;
};

type HarmonyReusePickerProps = {
  sources: HarmonyReuseSource[];
  currentDuration: number;
  onRepeat: (source: HarmonyReuseSource) => void;
  onCopyHarmony: (source: HarmonyReuseSource) => void;
  onDuplicateAll: (source: HarmonyReuseSource) => void;
};

export default function HarmonyReusePicker({
  sources,
  currentDuration,
  onRepeat,
  onCopyHarmony,
  onDuplicateAll,
}: HarmonyReusePickerProps) {
  const [selectedId, setSelectedId] = useState('');

  const orderedSources = useMemo(
    () =>
      [...sources].sort((left, right) => {
        const leftMatch = left.duration === currentDuration ? 0 : 1;
        const rightMatch = right.duration === currentDuration ? 0 : 1;
        if (leftMatch !== rightMatch) return leftMatch - rightMatch;
        return left.label.localeCompare(right.label, 'pt-BR');
      }),
    [currentDuration, sources],
  );

  if (orderedSources.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-slate-950/30 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Reaproveitar arranjo</p>
        <p className="mt-1 text-xs text-slate-600">
          Depois do primeiro bloco, você poderá reutilizar acordes, posições e compassos sem digitar tudo novamente.
        </p>
      </div>
    );
  }

  const selected = orderedSources.find((source) => source.id === selectedId) || orderedSources[0];
  const compactChords = selected.chords
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('  |  ');

  return (
    <div className="rounded-2xl border border-violet-500/15 bg-violet-500/[0.04] p-4 space-y-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Reaproveitar arranjo</p>
        <p className="mt-1 text-xs text-slate-500">
          Reutilize inclusive as posições <span className="font-mono text-slate-400">@</span> dos acordes. Blocos com a mesma duração aparecem primeiro.
        </p>
      </div>

      <select
        value={selected.id}
        onChange={(event) => setSelectedId(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-3 text-sm font-bold text-slate-200 outline-none focus:border-violet-500/40"
      >
        {orderedSources.map((source) => (
          <option key={source.id} value={source.id} className="bg-slate-950">
            {source.label} · {source.duration} comp.
          </option>
        ))}
      </select>

      <div className="min-h-8 rounded-xl border border-white/5 bg-black/15 px-3 py-2 font-mono text-xs text-yellow-500/75 break-words">
        {compactChords || 'Sem acordes cadastrados'}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onRepeat(selected)}
          className="min-h-11 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 text-[10px] font-black uppercase tracking-wide text-emerald-300 transition hover:bg-emerald-500/10"
          title="Usa exatamente o mesmo bloco novamente na timeline. Alterações futuras nesse bloco aparecem em todas as repetições."
        >
          <span className="inline-flex items-center justify-center gap-2"><Plus size={14} /> Repetir bloco</span>
        </button>
        <button
          type="button"
          onClick={() => onCopyHarmony(selected)}
          className="min-h-11 rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 text-[10px] font-black uppercase tracking-wide text-blue-300 transition hover:bg-blue-500/10"
          title="Copia compassos, acordes e posições para o bloco que você está montando, preservando a letra e o nome atuais."
        >
          <span className="inline-flex items-center justify-center gap-2"><Copy size={14} /> Só harmonia</span>
        </button>
        <button
          type="button"
          onClick={() => onDuplicateAll(selected)}
          className="min-h-11 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 text-[10px] font-black uppercase tracking-wide text-violet-300 transition hover:bg-violet-500/10"
          title="Copia letra, acordes, posições e duração para um novo bloco independente."
        >
          <span className="inline-flex items-center justify-center gap-2"><ListOrdered size={14} /> Duplicar tudo</span>
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-600">
        <strong className="text-slate-500">Repetir bloco</strong> mantém vínculo com o mesmo bloco. <strong className="text-slate-500">Só harmonia</strong> e <strong className="text-slate-500">Duplicar tudo</strong> criam conteúdo independente para você alterar depois.
      </p>
    </div>
  );
}
