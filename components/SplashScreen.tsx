'use client';

import { useEffect, useRef, useState } from 'react';
import { Rocket, Loader2 } from 'lucide-react';

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [loadingText, setLoadingText] = useState('Iniciando Sistema');
  const [progress, setProgress] = useState(10); // Começa com um pouco de barra
  const [isExiting, setIsExiting] = useState(false); // Controle da animação de saída

  const finishedRef = useRef(false);

  useEffect(() => {
    const texts = ['Carregando Scripts', 'Sincronizando Banda', 'Verificando Chaves', 'Backstage Pronto'];
    let i = 0;

    const interval = setInterval(() => {
      if (i < texts.length) {
        setLoadingText(texts[i]);
        // Incrementa progresso
        setProgress((prev) => Math.min(100, prev + 25));
        i++;
      } else {
        clearInterval(interval);

        // ✅ Inicia animação de saída suave
        if (!finishedRef.current) {
          finishedRef.current = true;
          setIsExiting(true); 

          // Espera a animação CSS (500ms) terminar antes de desmontar o componente
          setTimeout(() => {
            onFinish();
          }, 600);
        }
      }
    }, 500); // Tempo um pouco maior para leitura confortável

    return () => clearInterval(interval);
  }, [onFinish]);

  return (
    <div 
      className={`fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-6 overflow-hidden transition-opacity duration-500 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Glow de fundo para profundidade */}
      <div className="absolute size-[300px] bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />

      <div className="relative flex flex-col items-center z-10">
        {/* Logo Animado */}
        <div className="mb-8 p-5 bg-blue-600/10 border border-blue-500/20 rounded-[2.5rem] shadow-[0_0_30px_rgba(37,99,235,0.2)] animate-bounce">
          <Rocket className="text-blue-500" size={48} />
        </div>

        {/* Texto da Marca */}
        <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.5em] mb-2">
          Backstage Control
        </h2>
        <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none text-white mb-10">
          Sincronizando
        </h1>

        {/* Barra de Progresso Estilizada */}
        <div className="w-56 h-1.5 bg-slate-900 rounded-full overflow-hidden mb-6 border border-white/5 relative">
          <div
            className="h-full bg-blue-600 transition-all duration-500 ease-out relative"
            style={{ width: `${progress}%` }}
          >
            {/* Brilho na ponta da barra */}
            <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/50 blur-[2px]" />
          </div>
        </div>

        <div className="h-6 flex items-center justify-center">
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest animate-in fade-in zoom-in duration-300 key={loadingText}">
            {loadingText}...
            </p>
        </div>
      </div>

      {/* Footer da Splash */}
      <div className="absolute bottom-10 opacity-50">
        <p className="text-[8px] font-black text-slate-700 uppercase tracking-[0.3em]">
          v1.0.0 Stable Release
        </p>
      </div>
    </div>
  );
}