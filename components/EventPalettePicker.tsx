'use client';

import { Palette } from 'lucide-react';

export const EVENT_PALETTE_PRESETS = [
  { label: 'Todo preto', colors: ['#0f172a'] },
  { label: 'Preto + branco', colors: ['#0f172a', '#f8fafc'] },
  { label: 'Azul-marinho + branco', colors: ['#172554', '#f8fafc'] },
  { label: 'Azul + dourado', colors: ['#1d4ed8', '#d4a017'] },
  { label: 'Vinho + preto', colors: ['#7f1d1d', '#111827'] },
  { label: 'Bege + branco', colors: ['#d6c7a1', '#fffdf7'] },
  { label: 'Tons terrosos', colors: ['#92400e', '#a16207', '#d6c7a1'] },
  { label: 'Livre', colors: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'] },
] as const;

type Props = {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  compact?: boolean;
};

export function paletteColorsFor(value: string | null | undefined): readonly string[] {
  const normalized = String(value || '').trim().toLocaleLowerCase('pt-BR');
  return EVENT_PALETTE_PRESETS.find((item) => item.label.toLocaleLowerCase('pt-BR') === normalized)?.colors || [];
}

export default function EventPalettePicker({ value, onChange, name = 'paleta', compact = false }: Props) {
  const current = String(value || '').trim();

  return (
    <div className="space-y-3">
      {name ? <input type="hidden" name={name} value={current} /> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {EVENT_PALETTE_PRESETS.map((preset) => {
          const selected = current.toLocaleLowerCase('pt-BR') === preset.label.toLocaleLowerCase('pt-BR');
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.label)}
              className={`rounded-xl border px-3 py-3 text-left transition-all ${selected ? 'border-blue-500/40 bg-blue-500/10 text-white' : 'border-white/10 bg-slate-950/70 text-slate-400 hover:border-white/20'}`}
            >
              <span className="flex items-center gap-1.5 mb-2">
                {preset.colors.map((color) => (
                  <span key={color} className="size-4 rounded-full border border-white/20 shadow-sm" style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-wider leading-tight">{preset.label}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Palette className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-slate-600" />
        <input
          value={current}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ou escreva uma combinação personalizada"
          className={`w-full pl-12 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold placeholder:text-slate-700 ${compact ? 'p-3 text-sm' : 'p-4'}`}
        />
      </div>
    </div>
  );
}
