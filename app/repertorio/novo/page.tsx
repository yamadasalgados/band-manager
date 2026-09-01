'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  ListOrdered,
  CheckCircle2,
  Music,
  Timer,
  Loader2,
  Eye,
  Pencil,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useOrg } from '@/contexts/OrgContext';
import SubscriptionGuard from '@/components/SubscriptionGuard';
import SongPreviewModal from '@/components/SongPreviewModal';
import SongTimingEditor from '@/components/SongTimingEditor';
import HarmonyReusePicker, { type HarmonyReuseSource } from '@/components/HarmonyReusePicker';

type LocalBlock = {
  tempId: string;
  tipo: string;
  nome_personalizado: string;
  letra: string;
  acordes: string;
  duracao_compassos: number;
};

type BlockDraft = {
  tipo: string;
  nome_personalizado: string;
  letra: string;
  acordes: string[];
  duracao_compassos: number;
};

const BLOCK_TYPES = ['Intro', 'Verso', 'Pré-Refrão', 'Refrão', 'Ponte', 'Solo', 'Idioma', 'Break', 'Final'];

function newBlockDraft(): BlockDraft {
  return {
    tipo: 'Verso',
    nome_personalizado: '',
    letra: '',
    acordes: Array(4).fill(''),
    duracao_compassos: 4,
  };
}

function parseChords(raw: string, duration: number) {
  const parts = String(raw || '').split('|').map((item) => item.trim());
  return Array.from({ length: Math.max(1, duration) }, (_, index) => parts[index] || '');
}

function blockLabel(block: Pick<LocalBlock, 'tipo' | 'nome_personalizado'>) {
  return block.nome_personalizado?.trim() || block.tipo;
}

export default function NovoRepertorioInteligente() {
  const router = useRouter();
  const { org } = useOrg();

  const [loading, setLoading] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [membros, setMembros] = useState<any[]>([]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);

  const [dadosBase, setDadosBase] = useState({
    titulo: '',
    artista: '',
    tom: '',
    bpm: '',
    categoria: 'Rápida',
    lead_vocal_id: '',
    lead_vocal_custom: '',
  });

  const [blocosDisponiveis, setBlocosDisponiveis] = useState<LocalBlock[]>([]);
  const [timeline, setTimeline] = useState<LocalBlock[]>([]);
  const [blocoAtual, setBlocoAtual] = useState<BlockDraft>(newBlockDraft);

  const isEditing = !!editingBlockId;

  const duracaoEstimada = useMemo(() => {
    const bpm = parseInt(dadosBase.bpm) || 120;
    const totalCompassos = timeline.reduce((acc, block) => acc + (block.duracao_compassos || 0), 0);
    const segundosTotais = (totalCompassos * 4 / bpm) * 60;
    const minutos = Math.floor(segundosTotais / 60);
    const segundos = Math.round(segundosTotais % 60);
    return `${minutos}:${segundos < 10 ? '0' : ''}${segundos}`;
  }, [timeline, dadosBase.bpm]);

  useEffect(() => {
    async function carregarMembros() {
      if (!org?.id) return;
      const { data } = await supabase
        .from('membros')
        .select('id, nome')
        .eq('org_id', org.id)
        .order('nome');
      if (data) setMembros(data);
    }
    carregarMembros();
  }, [org?.id]);

  const resetEditor = () => {
    setEditingBlockId(null);
    setBlocoAtual(newBlockDraft());
  };

  const abrirEdicao = (block: LocalBlock) => {
    setEditingBlockId(block.tempId);
    setBlocoAtual({
      tipo: block.tipo,
      nome_personalizado: block.nome_personalizado || '',
      letra: block.letra || '',
      duracao_compassos: block.duracao_compassos || 4,
      acordes: parseChords(block.acordes, block.duracao_compassos || 4),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCompassoChange = (value: number) => {
    const nextDuration = Math.max(1, Math.min(16, Number(value) || 1));
    const nextChords = Array.from(
      { length: nextDuration },
      (_, index) => blocoAtual.acordes[index] || '',
    );
    setBlocoAtual((prev) => ({ ...prev, duracao_compassos: nextDuration, acordes: nextChords }));
  };

  const updateAcordeNoCompasso = (index: number, value: string) => {
    setBlocoAtual((prev) => {
      const next = [...prev.acordes];
      next[index] = value;
      return { ...prev, acordes: next };
    });
  };

  const adicionarOuSalvarBloco = () => {
    const hasContent =
      !!blocoAtual.letra.trim() ||
      !!blocoAtual.nome_personalizado.trim() ||
      blocoAtual.acordes.some((item) => String(item || '').trim());
    if (!hasContent) return;

    const payload = {
      tipo: blocoAtual.tipo,
      nome_personalizado: blocoAtual.nome_personalizado,
      letra: blocoAtual.letra,
      acordes: blocoAtual.acordes.map((item) => String(item || '').trim()).join(' | '),
      duracao_compassos: blocoAtual.duracao_compassos,
    };

    if (editingBlockId) {
      setBlocosDisponiveis((prev) =>
        prev.map((block) => block.tempId === editingBlockId ? { ...block, ...payload } : block),
      );
      setTimeline((prev) =>
        prev.map((block) => block.tempId === editingBlockId ? { ...block, ...payload } : block),
      );
      resetEditor();
      return;
    }

    const novo: LocalBlock = {
      tempId: `block-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ...payload,
    };
    setBlocosDisponiveis((prev) => [...prev, novo]);
    resetEditor();
  };

  const fontesReaproveitamento = useMemo<HarmonyReuseSource[]>(
    () =>
      blocosDisponiveis.map((block) => ({
        id: block.tempId,
        label: blockLabel(block),
        duration: Math.max(1, Number(block.duracao_compassos || 4) || 4),
        chords: String(block.acordes || ''),
      })),
    [blocosDisponiveis],
  );

  const repetirBlocoNaTimeline = (source: HarmonyReuseSource) => {
    const block = blocosDisponiveis.find((item) => item.tempId === source.id);
    if (!block) return;
    setTimeline((prev) => [...prev, block]);
  };

  const copiarSomenteHarmonia = (source: HarmonyReuseSource) => {
    const block = blocosDisponiveis.find((item) => item.tempId === source.id);
    if (!block) return;
    const duration = Math.max(1, Number(block.duracao_compassos || 4) || 4);
    setBlocoAtual((prev) => ({
      ...prev,
      duracao_compassos: duration,
      acordes: parseChords(block.acordes, duration),
    }));
  };

  const duplicarBlocoParaNovo = (source: HarmonyReuseSource) => {
    const block = blocosDisponiveis.find((item) => item.tempId === source.id);
    if (!block) return;
    const duration = Math.max(1, Number(block.duracao_compassos || 4) || 4);
    setEditingBlockId(null);
    setBlocoAtual({
      tipo: block.tipo || 'Verso',
      nome_personalizado: `${blockLabel(block)} cópia`,
      letra: block.letra || '',
      duracao_compassos: duration,
      acordes: parseChords(block.acordes, duration),
    });
  };

  const removerBlocoDoCatalogo = (tempId: string) => {
    if (editingBlockId === tempId) resetEditor();
    setBlocosDisponiveis((prev) => prev.filter((block) => block.tempId !== tempId));
    setTimeline((prev) => prev.filter((block) => block.tempId !== tempId));
  };

  async function salvarMusicaCompleta() {
    if (!org?.id) return alert('Erro: Organização não identificada.');
    if (!dadosBase.titulo.trim() || timeline.length === 0) {
      alert('Defina o título e adicione blocos à Timeline!');
      return;
    }

    setLoading(true);
    try {
      const { data: musica, error: errMusica } = await supabase
        .from('repertorio')
        .insert([
          {
            titulo: dadosBase.titulo.trim(),
            artista: dadosBase.artista.trim() || null,
            tom: dadosBase.tom.trim() || null,
            bpm: dadosBase.bpm ? parseInt(dadosBase.bpm) : null,
            categoria: dadosBase.categoria || null,
            lead_vocal_id:
              dadosBase.lead_vocal_id === 'custom' || !dadosBase.lead_vocal_id
                ? null
                : dadosBase.lead_vocal_id,
            lead_vocal_custom:
              dadosBase.lead_vocal_id === 'custom' ? dadosBase.lead_vocal_custom.trim() || null : null,
            org_id: org.id,
          },
        ])
        .select()
        .single();

      if (errMusica) throw new Error(`Erro na música: ${errMusica.message}`);

      const clientIdPorTemp = new Map<string, string>();
      const blocosPayload = blocosDisponiveis.map((block) => {
        const clientId = `new-${Date.now()}-${Math.random().toString(36).slice(2)}-${block.tempId}`;
        clientIdPorTemp.set(block.tempId, clientId);
        return {
          repertorio_id: musica.id,
          tipo: block.tipo,
          nome_personalizado: block.nome_personalizado.trim() || null,
          letra: block.letra || null,
          acordes: block.acordes,
          duracao_compassos: block.duracao_compassos,
          client_id: clientId,
        };
      });

      const { data: blocosSalvos, error: errBlocos } = await supabase
        .from('musica_blocos')
        .insert(blocosPayload)
        .select('id,client_id');

      if (errBlocos) throw new Error(`Erro nos blocos: ${errBlocos.message}`);

      const idRealPorClient = new Map<string, string>();
      for (const block of blocosSalvos || []) {
        if (block?.id && block?.client_id) {
          idRealPorClient.set(String(block.client_id), String(block.id));
        }
      }

      const estruturaFinal = timeline.map((item, index) => {
        const clientId = clientIdPorTemp.get(item.tempId);
        const blocoId = clientId ? idRealPorClient.get(clientId) : undefined;
        if (!blocoId) throw new Error('Não foi possível mapear um bloco salvo para a timeline.');
        return {
          repertorio_id: musica.id,
          bloco_id: blocoId,
          posicao: index + 1,
          org_id: org.id,
        };
      });

      const { error: errEstrutura } = await supabase.from('musica_estrutura').insert(estruturaFinal);
      if (errEstrutura) throw new Error(`Erro na estrutura: ${errEstrutura.message}`);

      router.push('/repertorio');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  if (!org) return null;

  return (
    <SubscriptionGuard>
      <div className="min-h-screen bg-slate-950 text-white px-4 sm:px-6 lg:px-8 pb-32 font-sans">
        <header className="max-w-[1680px] mx-auto flex justify-between items-center mb-8 sm:mb-10 pt-6">
          <Link href="/" className="group block transition-transform active:scale-95">
            <div>
              <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">
                {org.nome || 'Banda'}
              </h2>
              <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-none text-white group-hover:text-slate-200 transition-colors">
                adicionar<br />música
              </h1>
            </div>
          </Link>

          <button
            onClick={() => router.back()}
            className="text-blue-500 flex items-center gap-2 font-bold uppercase text-sm tracking-widest hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Voltar
          </button>
        </header>

        <main className="max-w-[1680px] mx-auto grid grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 lg:gap-8">
          <div className="space-y-6 min-w-0">
            <section className="bg-slate-900 p-5 sm:p-7 rounded-[2rem] border border-white/5 space-y-5 shadow-2xl">
              <h2 className="text-blue-500 text-xs font-black uppercase tracking-[0.25em] flex items-center gap-2">
                <CheckCircle2 size={14} /> 1. Propriedades
              </h2>

              <input
                value={dadosBase.titulo}
                placeholder="Título da música"
                className="w-full bg-slate-950/50 p-4 sm:p-5 rounded-2xl border border-white/5 focus:border-blue-500 outline-none font-bold text-lg"
                onChange={(event) => setDadosBase({ ...dadosBase, titulo: event.target.value })}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5 sm:col-span-2">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Artista</span>
                  <input
                    value={dadosBase.artista}
                    placeholder="Ex: Aline Barros"
                    className="bg-transparent w-full outline-none font-bold text-base"
                    onChange={(event) => setDadosBase({ ...dadosBase, artista: event.target.value })}
                  />
                </div>

                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Tom</span>
                  <input
                    value={dadosBase.tom}
                    placeholder="Ex: Am"
                    className="bg-transparent w-full outline-none font-bold text-yellow-500 capitalize text-lg"
                    onChange={(event) => setDadosBase({ ...dadosBase, tom: event.target.value })}
                  />
                </div>

                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">BPM</span>
                  <input
                    value={dadosBase.bpm}
                    type="number"
                    min="30"
                    max="300"
                    placeholder="120"
                    className="bg-transparent w-full outline-none font-bold text-blue-400 text-lg"
                    onChange={(event) => setDadosBase({ ...dadosBase, bpm: event.target.value })}
                  />
                </div>

                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Categoria</span>
                  <select
                    value={dadosBase.categoria}
                    className="w-full bg-transparent outline-none font-bold text-sm"
                    onChange={(event) => setDadosBase({ ...dadosBase, categoria: event.target.value })}
                  >
                    <option value="Rápida" className="bg-slate-900">Rápida</option>
                    <option value="Moderada" className="bg-slate-900">Moderada</option>
                    <option value="Lenta" className="bg-slate-900">Lenta</option>
                  </select>
                </div>

                <div className="bg-slate-950/50 p-4 rounded-2xl border border-white/5">
                  <span className="text-[10px] font-black text-slate-500 uppercase block mb-1 tracking-widest">Leading vocal</span>
                  <select
                    value={dadosBase.lead_vocal_id}
                    className="w-full bg-transparent outline-none font-bold text-sm"
                    onChange={(event) => setDadosBase({ ...dadosBase, lead_vocal_id: event.target.value })}
                  >
                    <option value="">Selecione um cantor</option>
                    {membros.map((member) => (
                      <option key={member.id} value={member.id} className="bg-slate-900">{member.nome}</option>
                    ))}
                    <option value="custom" className="bg-slate-900">Personalizado</option>
                  </select>
                </div>
              </div>

              {dadosBase.lead_vocal_id === 'custom' && (
                <input
                  value={dadosBase.lead_vocal_custom}
                  placeholder="Nome do cantor…"
                  className="w-full bg-slate-950/50 p-4 rounded-2xl outline-none border border-blue-500/30 text-sm"
                  onChange={(event) => setDadosBase({ ...dadosBase, lead_vocal_custom: event.target.value })}
                />
              )}
            </section>

            <section className="bg-slate-900 p-5 sm:p-7 rounded-[2rem] border border-white/5 space-y-5 shadow-2xl">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-blue-500 text-xs font-black uppercase tracking-[0.25em]">
                    2. {isEditing ? 'Editar bloco' : 'Novo bloco'}
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Cadastre acorde e letra juntos para validar a música no preview.
                  </p>
                </div>
                {isEditing && (
                  <button
                    type="button"
                    onClick={resetEditor}
                    className="min-h-10 px-3 rounded-xl bg-slate-950/50 border border-white/10 text-slate-400 hover:text-white text-[10px] font-black uppercase flex items-center gap-2"
                  >
                    <X size={14} /> Cancelar edição
                  </button>
                )}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {BLOCK_TYPES.map((type) => {
                  const active = blocoAtual.tipo === type;
                  return (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setBlocoAtual({ ...blocoAtual, tipo: type })}
                      className={`px-4 py-2.5 rounded-xl text-[11px] font-black uppercase shrink-0 transition-all ${
                        active ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-800 text-slate-500 hover:text-white'
                      }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>

              <input
                value={blocoAtual.nome_personalizado}
                placeholder="Nome opcional do bloco: Ex. Refrão 2 / Inglês / Final baixo"
                className="w-full bg-slate-950/50 p-4 rounded-2xl border border-white/5 focus:border-blue-500/40 outline-none font-bold text-sm"
                onChange={(event) => setBlocoAtual({ ...blocoAtual, nome_personalizado: event.target.value })}
              />

              <HarmonyReusePicker
                sources={fontesReaproveitamento}
                currentDuration={blocoAtual.duracao_compassos}
                onRepeat={repetirBlocoNaTimeline}
                onCopyHarmony={copiarSomenteHarmonia}
                onDuplicateAll={duplicarBlocoParaNovo}
              />

              <SongTimingEditor
                duration={blocoAtual.duracao_compassos}
                chords={blocoAtual.acordes}
                lyrics={blocoAtual.letra}
                keySignature={dadosBase.tom}
                onDurationChange={handleCompassoChange}
                onChordChange={updateAcordeNoCompasso}
                onLyricsChange={(value) => setBlocoAtual((prev) => ({ ...prev, letra: value }))}
              />

              <button
                type="button"
                onClick={adicionarOuSalvarBloco}
                className={`w-full py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all border flex items-center justify-center gap-2 ${
                  isEditing
                    ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:text-yellow-300'
                    : 'bg-blue-500/10 border-blue-500/25 text-blue-400 hover:text-blue-300'
                }`}
              >
                {isEditing ? <Save size={17} /> : <Plus size={17} />}
                {isEditing ? 'Salvar edição do bloco' : 'Adicionar bloco'}
              </button>
            </section>
          </div>

          <div className="space-y-6 min-w-0">
            <section className="bg-slate-900 p-5 sm:p-7 rounded-[2rem] min-h-[600px] flex flex-col border border-white/5 space-y-5 shadow-2xl xl:sticky xl:top-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-blue-500 text-xs font-black uppercase tracking-[0.25em] flex items-center gap-2">
                  <ListOrdered size={16} /> 3. Estrutura da música
                </h2>
                <span className="text-[10px] font-black uppercase text-slate-600">
                  {timeline.length} blocos · {duracaoEstimada}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {blocosDisponiveis.map((block) => (
                  <div key={block.tempId} className="group relative flex items-stretch">
                    <button
                      type="button"
                      onClick={() => setTimeline((prev) => [...prev, block])}
                      className="pl-4 pr-20 py-2.5 rounded-xl text-[11px] font-black border bg-emerald-500/5 border-emerald-500/20 text-emerald-400 hover:border-emerald-500/40 max-w-[260px] text-left break-words"
                      title="Adicionar na timeline"
                    >
                      + {blockLabel(block)}
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirEdicao(block)}
                      className="absolute right-9 top-1/2 -translate-y-1/2 p-2 text-blue-400/70 hover:text-blue-300"
                      aria-label={`Editar ${blockLabel(block)}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removerBlocoDoCatalogo(block.tempId)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-red-400/60 hover:text-red-400"
                      aria-label={`Remover ${blockLabel(block)}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-3 flex-1 overflow-y-auto pr-1 max-h-[65vh] xl:max-h-[calc(100vh-330px)]">
                {timeline.map((block, index) => (
                  <div
                    key={`${block.tempId}-${index}`}
                    className="flex justify-between items-center gap-3 p-4 rounded-2xl border bg-green-500/5 border-green-500/20 hover:border-green-500/40 transition-all cursor-pointer"
                    onClick={() => abrirEdicao(block)}
                    title="Editar este bloco"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-black text-slate-600 bg-slate-950 size-7 shrink-0 flex items-center justify-center rounded-full border border-white/5">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black uppercase break-words">{blockLabel(block)}</span>
                          <span className="text-[9px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 font-black uppercase">
                            {block.duracao_compassos} comp.
                          </span>
                        </div>
                        <p className="text-sm sm:text-base text-yellow-500/70 font-mono mt-1 break-words">
                          {block.acordes || 'S/ Acordes'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          abrirEdicao(block);
                        }}
                        className="p-2 text-slate-600 hover:text-blue-400"
                        aria-label="Editar bloco"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setTimeline((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
                        }}
                        className="p-2 text-slate-600 hover:text-red-500"
                        aria-label="Remover da timeline"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}

                {timeline.length === 0 && (
                  <div className="min-h-64 flex flex-col items-center justify-center opacity-20">
                    <Music size={48} className="mb-4" />
                    <p className="text-xs font-black uppercase tracking-widest italic">Timeline vazia</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 text-blue-400 font-mono text-xs font-black uppercase tracking-widest">
                <Timer size={14} /> Duração estimada: {duracaoEstimada}
              </div>

              <button
                type="button"
                onClick={() => setPreviewAberto(true)}
                disabled={timeline.length === 0}
                className="w-full bg-yellow-500/5 border border-yellow-500/20 text-yellow-400 py-4 rounded-2xl font-black uppercase text-xs tracking-[0.14em] active:scale-95 flex items-center justify-center gap-3 hover:border-yellow-500/50 hover:text-yellow-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Eye size={18} /> Preview de andamento
              </button>

              <button
                type="button"
                onClick={salvarMusicaCompleta}
                disabled={loading}
                className="w-full bg-blue-500/10 border border-blue-500/25 text-blue-400 py-5 rounded-2xl font-black uppercase text-xs tracking-[0.18em] active:scale-95 flex items-center justify-center gap-3 hover:border-blue-500/50 hover:text-white transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                {loading ? 'Gravando…' : 'Gravar arquitetura'}
              </button>
            </section>
          </div>
        </main>

        <SongPreviewModal
          open={previewAberto}
          onClose={() => setPreviewAberto(false)}
          titulo={dadosBase.titulo || 'Música sem título'}
          bpm={parseInt(dadosBase.bpm) || 120}
          timeline={timeline}
        />
      </div>
    </SubscriptionGuard>
  );
}
