'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  ListOrdered,
  CheckCircle2,
  Clock,
  Music,
  Timer,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ✅ Contexto e Segurança
import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';

export default function NovoRepertorioInteligente() {
  const router = useRouter();
  const { org } = useOrg(); // ✅ Pega a organização atual

  const [loading, setLoading] = useState(false);
  const [membros, setMembros] = useState<any[]>([]);

  const [dadosBase, setDadosBase] = useState({
    titulo: '',
    artista: '',
    tom: '',
    bpm: '',
    categoria: 'Rápida',
    lead_vocal_id: '',
    lead_vocal_custom: '',
  });

  const [blocosDisponiveis, setBlocosDisponiveis] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);

  const [blocoAtual, setBlocoAtual] = useState({
    tipo: 'Verso',
    letra: '',
    acordes: Array(4).fill(''),
    duracao_compassos: 4,
  });

  const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

  // --- DURAÇÃO ESTIMADA ---
  const duracaoEstimada = useMemo(() => {
    const bpm = parseInt(dadosBase.bpm) || 120;
    const totalCompassos = timeline.reduce((acc, b) => acc + (b.duracao_compassos || 0), 0);
    const segundosTotais = (totalCompassos * 4 / bpm) * 60;
    const minutos = Math.floor(segundosTotais / 60);
    const segundos = Math.round(segundosTotais % 60);
    return `${minutos}:${segundos < 10 ? '0' : ''}${segundos}`;
  }, [timeline, dadosBase.bpm]);

  // ✅ Carrega membros filtrando pela ORG
  useEffect(() => {
    async function carregarMembros() {
      if (!org?.id) return;
      
      const { data } = await supabase
        .from('membros')
        .select('id, nome')
        .eq('org_id', org.id) // 🔒 Segurança
        .order('nome');
        
      if (data) setMembros(data);
    }
    carregarMembros();
  }, [org?.id]);

  const handleCompassoChange = (valor: number) => {
    const novosAcordes = [...blocoAtual.acordes];
    if (valor > blocoAtual.duracao_compassos) {
      const diferenca = valor - blocoAtual.duracao_compassos;
      setBlocoAtual({
        ...blocoAtual,
        duracao_compassos: valor,
        acordes: [...novosAcordes, ...Array(diferenca).fill('')],
      });
    } else {
      setBlocoAtual({
        ...blocoAtual,
        duracao_compassos: valor,
        acordes: novosAcordes.slice(0, valor),
      });
    }
  };

const updateAcordeNoCompasso = (index: number, valor: string) => {
  const novosAcordes = [...blocoAtual.acordes];
  // Removido o .toUpperCase() daqui para aceitar a formatação do onChange
  novosAcordes[index] = valor; 
  setBlocoAtual({ ...blocoAtual, acordes: novosAcordes });
};

  const adicionarBlocoAoCatalogo = () => {
    if (!blocoAtual.letra && blocoAtual.acordes.every((a) => a === '')) return;

    const acordesString = blocoAtual.acordes.join(' | ');

    const novoBloco = {
      ...blocoAtual,
      acordes: acordesString,
      tempId: Math.random().toString(36).substr(2, 9),
    };

    setBlocosDisponiveis([...blocosDisponiveis, novoBloco]);
    setBlocoAtual({
      ...blocoAtual,
      letra: '',
      acordes: Array(blocoAtual.duracao_compassos).fill(''),
    });
  };

  const removerBlocoDoCatalogo = (tempId: string) => {
    setBlocosDisponiveis((prev) => prev.filter((b) => b.tempId !== tempId));
    setTimeline((prev) => prev.filter((b) => b.tempId !== tempId));
  };

  async function salvarMusicaCompleta() {
    if (!org?.id) return alert("Erro: Organização não identificada.");
    
    if (!dadosBase.titulo.trim() || timeline.length === 0) {
      alert('Defina o título e adicione blocos à Timeline!');
      return;
    }

    setLoading(true);
    try {
      // 1. Cria a Música (Repertório) vinculada à ORG
      const { data: musica, error: errMusica } = await supabase
        .from('repertorio')
        .insert([
          {
            titulo: dadosBase.titulo,
            artista: dadosBase.artista || null,
            tom: dadosBase.tom || null,
            bpm: dadosBase.bpm ? parseInt(dadosBase.bpm) : null,
            categoria: dadosBase.categoria,
            lead_vocal_id: dadosBase.lead_vocal_id === 'custom' || !dadosBase.lead_vocal_id ? null : dadosBase.lead_vocal_id,
            lead_vocal_custom: dadosBase.lead_vocal_id === 'custom' ? dadosBase.lead_vocal_custom : null,
            org_id: org.id // 🔒 VÍNCULO CRUCIAL
          },
        ])
        .select()
        .single();

      if (errMusica) throw new Error(`Erro na música: ${errMusica.message}`);

      // 2. Cria os Blocos (Filhos da música)
      const blocosPromessas = blocosDisponiveis.map(async (b) => {
        const { data, error } = await supabase
          .from('musica_blocos')
          .insert([
            {
              repertorio_id: musica.id,
              tipo: b.tipo,
              letra: b.letra,
              acordes: b.acordes,
              duracao_compassos: b.duracao_compassos,
              // org_id: org.id // Opcional se sua tabela pedir
            },
          ])
          .select()
          .single();
        if (error) throw error;
        return { ...data, tempId: b.tempId };
      });

      const blocosSalvosComReferencia = await Promise.all(blocosPromessas);

      // 3. Cria a Estrutura (Ordem da Timeline)
      const estruturaFinal = timeline.map((item, index) => {
        const blocoReal = blocosSalvosComReferencia.find((bs) => bs.tempId === item.tempId);
        return {
          repertorio_id: musica.id,
          bloco_id: blocoReal.id,
          posicao: index + 1,
          // org_id: org.id // Opcional se sua tabela pedir
        };
      });

      const { error: errEstrutura } = await supabase.from('musica_estrutura').insert(estruturaFinal);
      if (errEstrutura) throw new Error(`Erro na estrutura: ${errEstrutura.message}`);

      alert('Música salva com sucesso!');
      router.push('/repertorio');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  // Se não tem org, não renderiza nada (o Guard cuida disso, mas por segurança)
  if (!org) return null;

  return (
    <SubscriptionGuard>
      <div className="min-h-screen bg-slate-950 text-white p-6 pb-32 font-sans">
        
        {/* HEADER */}
        <header className="max-w-6xl mx-auto flex justify-between items-center mb-10 pt-4">
          <Link href="/" className="group block transition-transform active:scale-95">
            <div>
            <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
              {org.nome || 'Banda'}
            </h2>
              <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors">
                adicionar
                <br />
                música 
              </h1>
            </div>
          </Link>

          <button
            onClick={() => router.back()}
            className="text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Voltar
          </button>
        </header>

        <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          
          {/* COLUNA ESQUERDA - FORMULÁRIOS */}
          <div className="space-y-6">
            
            {/* 1. DADOS BÁSICOS */}
            <section className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 space-y-5 shadow-2xl">
              <h2 className="text-blue-500 text-[14px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                <CheckCircle2 size={14} /> 1. Propriedades
              </h2>

              <input
                value={dadosBase.titulo}
                placeholder="Título da Música"
                className="w-full bg-slate-950/50 p-5 rounded-2xl border border-white/5 focus:border-blue-500 outline-none font-bold text-lg"
                onChange={(e) => setDadosBase({ ...dadosBase, titulo: e.target.value })}
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-xs font-black text-slate-500 uppercase block mb-1">Tom</span>
                  <input
                    value={dadosBase.tom}
                    placeholder="Ex: Am"
                    className="bg-transparent w-full outline-none font-bold text-yellow-500 capitalize text-lg"
                    onChange={(e) => setDadosBase({ ...dadosBase, tom: e.target.value })}
                  />
                </div>

                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-xs font-black text-slate-500 uppercase block mb-1">BPM</span>
                  <input
                    value={dadosBase.bpm}
                    type="number"
                    placeholder="120"
                    className="bg-transparent w-full outline-none font-bold text-blue-400 text-lg"
                    onChange={(e) => setDadosBase({ ...dadosBase, bpm: e.target.value })}
                  />
                </div>
              </div>

              <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                <span className="text-xs font-black text-slate-500 uppercase block mb-2 tracking-widest">
                  Leading vocal
                </span>
                <select
                  value={dadosBase.lead_vocal_id}
                  className="w-full bg-transparent outline-none font-bold text-sm"
                  onChange={(e) => setDadosBase({ ...dadosBase, lead_vocal_id: e.target.value })}
                >
                  <option value="">Selecione um cantor</option>
                  {membros.map((m) => (
                    <option key={m.id} value={m.id} className="bg-slate-900">
                      {m.nome}
                    </option>
                  ))}
                  <option value="custom" className="bg-slate-900">
                    Personalizado
                  </option>
                </select>

                {dadosBase.lead_vocal_id === 'custom' && (
                  <input
                    value={dadosBase.lead_vocal_custom}
                    placeholder="Nome do cantor..."
                    className="w-full bg-slate-900 p-3 rounded-xl outline-none border border-blue-500/30 mt-3 text-sm"
                    onChange={(e) => setDadosBase({ ...dadosBase, lead_vocal_custom: e.target.value })}
                  />
                )}
              </div>
            </section>

            {/* 2. DESIGN DE BLOCOS */}
            <section className="bg-slate-900 p-8 rounded-[2.5rem] border border-white/5 space-y-6 shadow-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-blue-500 text-[14px] font-black uppercase tracking-[0.3em]">
                  2. Design de Novos Blocos
                </h2>
              </div>
<div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar relative">
  {['Intro', 'Verso', 'Pré-Refrão', 'Refrão', 'Ponte', '+ Idioma'].map((t) => {
    const isActive = blocoAtual.tipo === t;
    return (
      <button
        key={t}
        onClick={() => setBlocoAtual({ ...blocoAtual, tipo: t })}
        className={cn(
          'px-5 py-2.5 rounded-xl text-[12px] font-black uppercase flex-shrink-0 transition-all relative group',
          isActive
            ? 'bg-blue-500/10 text-blue-400 scale-105'
            : 'bg-slate-800 text-slate-500 hover:text-white'
        )}
      >
        {t}
        {/* Barra de Indicação */}
        {isActive && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]" />
        )}
      </button>
    );
  })}
</div>

              <div className="space-y-3 bg-slate-950/30 p-4 rounded-2xl border border-white/5">
                <div className="flex justify-between text-[14px] font-black uppercase text-slate-500">
                  <span className="flex items-center gap-2">
                    <Clock size={12} /> Extensão
                  </span>
                  <span className="text-yellow-500">{blocoAtual.duracao_compassos} Compassos</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="16"
                  step="1"
                  value={blocoAtual.duracao_compassos}
                  onChange={(e) => handleCompassoChange(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {blocoAtual.acordes.map((acorde, idx) => (
<div key={idx} className="relative group overflow-hidden rounded-xl">
  {/* Linha de luz amarela para indicar o foco no acorde */}
  <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-yellow-500/40 to-transparent opacity-0 group-focus-within:opacity-100 transition-opacity" />

  <input
    value={acorde || ''}
    onChange={(e) => {
      const val = e.target.value;
      // Capitalize Inteligente: Primeira letra Grande, resto mantém (ex: Dm7, Bb)
      const formatted = val ? val.charAt(0).toUpperCase() + val.slice(1) : '';
      updateAcordeNoCompasso(idx, formatted);
    }}
    className="w-full bg-slate-950 p-3 rounded-xl outline-none text-center font-mono font-black text-yellow-500 border border-white/5 focus:border-yellow-500/50 text-xs transition-all focus:bg-slate-900"
    placeholder="-"
  />
  <span className="absolute -top-1.5 left-2 text-[10px] font-black text-slate-600 bg-slate-900 px-1 rounded tracking-tighter uppercase">
    C.{idx + 1}
  </span>
</div>
                ))}
              </div>

              <textarea
                value={blocoAtual.letra}
                placeholder="Letra do bloco..."
                className="w-full bg-slate-950/50 p-5 rounded-2xl outline-none toUpperCase border border-white/5 h-20 text-sm focus:border-yellow-500/30 transition-all"
                onChange={(e) => setBlocoAtual({ ...blocoAtual, letra: e.target.value })}
              />

              <button
                onClick={adicionarBlocoAoCatalogo}
                className="w-full bg-blue-500/5 border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-widest hover:border-blue-500/40 shadow-blue-500/10 hover:text-white transition-all border border-yellow-500/20 shadow-xl"
              >
                + adicionar bloco
              </button>
            </section>
          </div>

          {/* COLUNA DIREITA - TIMELINE */}
          <div className="space-y-6">
            <section className="bg-slate-900 p-8 rounded-[2.5rem] min-h-[600px] flex flex-col border border-white/5 space-y-5 shadow-2xl">
              <h2 className="text-blue-500 text-[14px] font-black uppercase tracking-[0.3em] mb-8 flex items-center gap-2">
                <ListOrdered size={16} /> 3. Estrutura (Timeline)
              </h2>

              {/* CATÁLOGO + REMOVER */}
              <div className="flex flex-wrap gap-2 mb-10">
                {blocosDisponiveis.map((b: any, i: number) => (
                  <div key={b.tempId || i} className="group relative">
                    <button
                      onClick={() => setTimeline([...timeline, b])}
                      className="px-4 py-2.5 rounded-xl text-[14px] font-black border transition-all pr-8 truncate max-w-[160px]
                                 bg-blue-500/5 border-blue-500/20 hover:border-blue-500/40 shadow-blue-500/10"
                      title="Adicionar na timeline"
                    >
                      + {b.tipo}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removerBlocoDoCatalogo(b.tempId);
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-red-500 hover:text-red-500 opacity-70 group-hover:opacity-100 transition-all"
                      title="Remover do catálogo"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {/* LISTA TIMELINE */}
              <div className="space-y-3 flex-1 overflow-y-auto pr-2">
                {timeline.map((b: any, i: number) => (
                  <div
                    key={`${b.tempId || i}-${i}`}
                    className="flex justify-between items-center p-5 rounded-[1.5rem] border group transition-all shadow-lg
                               bg-green-500/5 border-green-500/20 hover:border-green-500/40 shadow-green-500/10 animate-in slide-in-from-right-4 duration-300"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-[14px] font-black text-slate-600 bg-slate-950 size-7 flex items-center justify-center rounded-full border border-white/5">
                        {i + 1}
                      </span>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-black uppercase tracking-tighter">{b.tipo}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded font-black italic bg-blue-500/10 text-blue-500">
                            {b.duracao_compassos} COMP.
                          </span>
                        </div>

                        <p className="text-[20px] text-yellow-500/70 font-mono mt-1 truncate max-w-[220px]">
                          {b.acordes || 'S/ Acordes'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        const n = [...timeline];
                        n.splice(i, 1);
                        setTimeline(n);
                      }}
                      className="p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remover da timeline"
                    >
                      <Trash2 size={16} className="text-slate-600 hover:text-red-500" />
                    </button>
                  </div>
                ))}

                {timeline.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center opacity-20">
                    <Music size={48} className="mb-4" />
                    <p className="text-[14px] font-black uppercase tracking-widest italic">Timeline Vazia</p>
                  </div>
                )}
              </div>

              {/* DURAÇÃO ESTIMADA */}
              <div className="flex items-center justify-center gap-2 text-blue-400 font-mono text-[14px] font-black uppercase tracking-widest mt-4">
                <Timer size={12} /> Duração Estimada: {duracaoEstimada}
              </div>

              {/* BOTÃO FINALIZAR */}
              <button
                onClick={salvarMusicaCompleta}
                disabled={loading}
                className="w-full bg-blue-500/5 border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] tracking-widest active:scale-95 flex items-center justify-center gap-3 hover:border-blue-500/40 shadow-blue-500/10 hover:text-white transition-all border border-yellow-500/20 shadow-xl"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" size={20} /> GRAVANDO...
                  </>
                ) : (
                  <>
                    <Save size={20} /> Gravar Arquitetura
                  </>
                )}
              </button>
            </section>
          </div>
        </main>
      </div>
    </SubscriptionGuard>
  );
}