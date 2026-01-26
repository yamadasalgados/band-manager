'use client';

import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverLight?: boolean;
}

export default function GlassCard({ children, className = "", onClick, hoverLight = true }: GlassCardProps) {
  return (
    <div 
      onClick={onClick}
      className={`
        relative overflow-hidden group 
        bg-slate-900 border border-white/5 
        rounded-[2.5rem] transition-all duration-500 
        hover:border-blue-500/20 shadow-2xl
        ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}
        ${className}
      `}
    >
      {/* Linha de Luz (Beam) */}
      <div className={`
        absolute top-0 left-0 w-full h-[1px] 
        bg-gradient-to-r from-transparent via-blue-500/40 to-transparent 
        transition-all duration-500
        ${hoverLight ? 'opacity-40 group-hover:via-blue-400 group-hover:opacity-100' : 'opacity-60'}
      `} />

      {children}
    </div>
  );
}