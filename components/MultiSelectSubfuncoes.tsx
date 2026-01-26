'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X, Check } from 'lucide-react';

export default function MultiSelectSubfuncoes({
  disponiveis,
  selecionadas,
  onChange,
  placeholder = 'Selecione as subfunções...',
}: {
  disponiveis: string[];
  selecionadas: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (option: string) => {
    const newSelection = selecionadas.includes(option)
      ? selecionadas.filter((item) => item !== option)
      : [...selecionadas, option];

    onChange(newSelection);
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Caixa Principal */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 flex items-center justify-between cursor-pointer hover:border-blue-500/30 transition-all min-h-[60px]"
      >
        <div className="flex flex-wrap gap-2">
          {selecionadas.length === 0 ? (
            <span className="text-slate-500 font-bold">{placeholder}</span>
          ) : (
            selecionadas.map((val) => (
              <span
                key={val}
                className="bg-blue-600 text-[10px] font-black uppercase px-2 py-1 rounded-md flex items-center gap-1 animate-in zoom-in-95 duration-200"
              >
                {val}
                <X
                  size={12}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleOption(val);
                  }}
                  className="hover:text-red-300"
                />
              </span>
            ))
          )}
        </div>

        <div className="flex items-center gap-3">
          {selecionadas.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
              title="Limpar"
            >
              Limpar
            </button>
          )}
          {/* Mudei o ícone para reagir melhor visualmente */}
          {isOpen ? <ChevronUp size={20} className="text-slate-500" /> : <ChevronDown size={20} className="text-slate-500" />}
        </div>
      </div>

      {/* DROPDOWN (Agora abrindo para CIMA) */}
      {isOpen && (
        <div className="absolute z-50 w-full bottom-full mb-2 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-100 overflow-y-auto no-scrollbar animate-in fade-in slide-in-from-bottom-2">
          {disponiveis.map((op) => {
            const isSelected = selecionadas.includes(op);
            return (
              <div
                key={op}
                onClick={() => toggleOption(op)}
                className={`p-4 flex items-center justify-between cursor-pointer transition-colors border-b border-white/5 last:border-0 ${
                  isSelected ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-white/5 text-slate-300'
                }`}
              >
                <span className="font-bold text-sm uppercase tracking-wide">{op}</span>
                {isSelected && <Check size={16} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}