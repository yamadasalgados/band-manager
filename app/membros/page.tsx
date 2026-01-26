'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  UserPlus,
  ArrowLeft,
  ChevronRight,
  LogOut,
  Edit3,
  Save,
  X,
  Plus,
  AlertTriangle,
  Loader2,
  Building2,
  Users,
  Copy,
  Check,
  CreditCard,
  Trash2,
  Key,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import OneSignal from 'react-onesignal'; // ✅ Importação necessária

import { useOrg } from '@/contexts/OrgContext';
import MultiSelectSubfuncoes from '@/components/MultiSelectSubfuncoes';
import SplashScreen from '@/components/SplashScreen';

const PIN_MESTRE_DEFAULT = '123456';

const OPCOES_INSTRUMENTOS = [
  'Voz',
  'Guitarra',
  'Violão',
  'Baixo',
  'Teclado',
  'Bateria',
  'Percussão',
  'Mesa de Som',
];

type Fase = 'cadastro' | 'identidade' | 'admin';

function slugify(input: string) {
  return (
    String(input || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'org'
  );
}

function norm(v: any) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toArraySubfuncoes(sf: any): string[] {
  if (!sf) return [];
  if (Array.isArray(sf)) return sf.filter(Boolean).map(String);
  const s = String(sf).trim();
  if (!s) return [];
  if (s.includes(',')) return s.split(',').map((x) => x.trim()).filter(Boolean);
  return [s];
}

export default function PerfilAdmin() {
  const router = useRouter();
  const { orgIdAtivo, loadingOrg, org } = useOrg() as any;

  const [showSplash, setShowSplash] = useState(true);
  const [loading, setLoading] = useState(false);
  const [membros, setMembros] = useState<any[]>([]);
  const [userAtivo, setUserAtivo] = useState<any>(null);
  const [sucesso, setSucesso] = useState(false);
  const [fase, setFase] = useState<Fase>('cadastro');

  const [pinInput, setPinInput] = useState('');
  const [adminAutenticado, setAdminAutenticado] = useState(false);
  const [nomeBandaEdit, setNomeBandaEdit] = useState('');
  const [slugBandaEdit, setSlugBandaEdit] = useState('');
  const [copiadoLink, setCopiadoLink] = useState(false);

  const [subfuncoesSelecionadas, setSubfuncoesSelecionadas] = useState<string[]>([]);
  const [cadUsarFuncaoCustom, setCadUsarFuncaoCustom] = useState(false);
  const [cadFuncaoCustom, setCadFuncaoCustom] = useState('');

  const [editandoAtivo, setEditandoAtivo] = useState(false);
  const [editFuncao, setEditFuncao] = useState<string>('');
  const [editSubfuncoes, setEditSubfuncoes] = useState<string[]>([]);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [editUsarFuncaoCustom, setEditUsarFuncaoCustom] = useState(false);
  const [editFuncaoCustom, setEditFuncaoCustom] = useState('');

  const [alterarPin, setAlterarPin] = useState(false);
  const [novoPinEdit, setNovoPinEdit] = useState('');

  const USE_MULTISELECT_SUBFUNCOES = false;

  const pinMestreNoBanco = useMemo(() => {
    const raw = String(org?.pin_acesso || PIN_MESTRE_DEFAULT);
    const digits = raw.replace(/\D/g, '');
    return digits.length === 6 ? digits : PIN_MESTRE_DEFAULT;
  }, [org?.pin_acesso]);

  // ✅ Função de Sincronização OneSignal
  const syncOneSignalLogin = useCallback((membroId: string) => {
    if (typeof window !== 'undefined' && membroId) {
      localStorage.setItem('usuario_ativo_id', membroId);
      localStorage.setItem('perfil_id', membroId);
      try {
        OneSignal.login(membroId);
      } catch (e) {
        console.error('Erro OneSignal Login:', e);
      }
    }
  }, []);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem('usuario_ativo');
      if (salvo) {
        const user = JSON.parse(salvo);
        setUserAtivo(user);
        setFase('identidade');
        if (user?.id) syncOneSignalLogin(user.id);
      } else {
        setFase('cadastro');
      }
    } catch {
      setFase('cadastro');
    }
  }, [syncOneSignalLogin]);

  useEffect(() => {
    if (!org) return;
    setNomeBandaEdit(String(org?.nome || ''));
    setSlugBandaEdit(String(org?.slug || ''));
    setAlterarPin(false);
    setNovoPinEdit('');
  }, [org]);

  const carregarMembros = useCallback(async () => {
    if (loadingOrg) return;
    if (!orgIdAtivo) {
      setMembros([]);
      return;
    }
    const { data, error } = await supabase
      .from('membros')
      .select('*')
      .eq('org_id', orgIdAtivo)
      .order('nome');
    if (error) return;
    setMembros(data || []);
  }, [orgIdAtivo, loadingOrg]);

  useEffect(() => {
    if (!loadingOrg) {
      carregarMembros().finally(() => {
        setTimeout(() => setShowSplash(false), 500);
      });
    }
  }, [loadingOrg, carregarMembros]);

  const handleSelecionar = (id: string) => {
    if (!id) return;
    const usuario = membros.find((m) => m.id === id);
    if (!usuario) return;

    setUserAtivo(usuario);
    localStorage.setItem('usuario_ativo', JSON.stringify(usuario));
    syncOneSignalLogin(usuario.id); // ✅ Sincroniza OneSignal

    setEditandoAtivo(false);
    setEditFuncao('');
    setEditSubfuncoes([]);
    setEditUsarFuncaoCustom(false);
    setEditFuncaoCustom('');

    setSucesso(true);
    setTimeout(() => {
      setSucesso(false);
      router.push('/');
    }, 1500);
  };

  async function handleCadastro(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    if (!orgIdAtivo) {
      alert('Erro: Nenhuma organização identificada.');
      setLoading(false);
      return;
    }

    const formData = new FormData(e.currentTarget);
    const funcaoSelect = String(formData.get('funcao') || '').trim();
    const funcaoFinal = cadUsarFuncaoCustom ? String(cadFuncaoCustom || '').trim() : funcaoSelect;

    if (!funcaoFinal) {
      alert('Selecione a função principal.');
      setLoading(false);
      return;
    }

    const dados = {
      nome: String(formData.get('nome') || '').trim(),
      funcao: funcaoFinal,
      whatsapp: String(formData.get('whatsapp') || '').trim() || null,
      subfuncao: subfuncoesSelecionadas,
      ativo: true,
      org_id: orgIdAtivo,
    };

    const { data, error } = await supabase.from('membros').insert([dados]).select().single();

    if (error) {
      console.error('Erro ao cadastrar:', error);
      alert('Erro ao cadastrar.');
      setLoading(false);
      return;
    }

    setUserAtivo(data);
    localStorage.setItem('usuario_ativo', JSON.stringify(data));
    syncOneSignalLogin(data.id); // ✅ Sincroniza OneSignal no Cadastro

    await carregarMembros();
    setSubfuncoesSelecionadas([]);
    setCadUsarFuncaoCustom(false);
    setCadFuncaoCustom('');

    setSucesso(true);
    setTimeout(() => {
      setSucesso(false);
      router.push('/');
    }, 1500);

    setLoading(false);
  }

  const handleLogout = () => {
    localStorage.removeItem('usuario_ativo');
    localStorage.removeItem('usuario_ativo_id');
    localStorage.removeItem('perfil_id');
    try { OneSignal.logout(); } catch (e) {}
    setUserAtivo(null);
    setEditandoAtivo(false);
    setFase('cadastro');
    router.refresh();
  };

  const formatSubfuncoes = (u: any) => {
    const sf = u?.subfuncao;
    if (!sf) return '';
    if (Array.isArray(sf)) return sf.filter(Boolean).join(', ');
    return String(sf);
  };

  const funcoesDisponiveis = useMemo(() => {
    const base = [...OPCOES_INSTRUMENTOS];
    const doBanco = (membros || []).map((m) => String(m?.funcao || '').trim()).filter(Boolean);
    const all = Array.from(new Set([...base, ...doBanco]));
    all.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    return all;
  }, [membros]);

  const subfuncoesDisponiveis = useMemo(() => {
    const base = [...OPCOES_INSTRUMENTOS];
    const funcoesDoBanco = (membros || []).map((m) => String(m?.funcao || '').trim()).filter(Boolean);
    const subfuncoesDoBanco = (membros || []).flatMap((m) => toArraySubfuncoes(m?.subfuncao)).map((s) => String(s || '').trim()).filter(Boolean);
    return Array.from(new Set([...base, ...funcoesDoBanco, ...subfuncoesDoBanco])).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [membros]);

  const abrirEdicaoAtivo = () => {
    if (!userAtivo) return;
    setEditandoAtivo(true);
    const atualFuncao = String(userAtivo?.funcao || '').trim();
    const existeNaLista = funcoesDisponiveis.some((f) => norm(f) === norm(atualFuncao));
    if (existeNaLista) {
      setEditUsarFuncaoCustom(false);
      setEditFuncao(atualFuncao);
      setEditFuncaoCustom('');
    } else {
      setEditUsarFuncaoCustom(true);
      setEditFuncao('');
      setEditFuncaoCustom(atualFuncao);
    }
    setEditSubfuncoes(toArraySubfuncoes(userAtivo?.subfuncao));
  };

  const cancelarEdicaoAtivo = () => {
    setEditandoAtivo(false);
    setEditFuncao('');
    setEditSubfuncoes([]);
    setEditUsarFuncaoCustom(false);
    setEditFuncaoCustom('');
  };

  const salvarEdicaoAtivo = async () => {
    if (!userAtivo?.id) return;
    const funcaoFinal = editUsarFuncaoCustom ? String(editFuncaoCustom || '').trim() : String(editFuncao || '').trim();
    if (!funcaoFinal) { alert('Selecione a função principal.'); return; }
    setSalvandoEdicao(true);
    try {
      const payload = { funcao: funcaoFinal, subfuncao: editSubfuncoes };
      const { data, error } = await supabase.from('membros').update(payload).eq('id', userAtivo.id).select('*');
      if (error) throw error;
      const membroAtualizado = data?.[0];
      if (!membroAtualizado) throw new Error('Não foi possível atualizar o membro.');
      setUserAtivo(membroAtualizado);
      localStorage.setItem('usuario_ativo', JSON.stringify(membroAtualizado));
      setMembros((prev) => prev.map((m) => (m.id === membroAtualizado.id ? membroAtualizado : m)));
      cancelarEdicaoAtivo();
      setSucesso(true);
      setTimeout(() => setSucesso(false), 1200);
    } catch (e: any) {
      alert(`Erro ao salvar: ${e?.message}`);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const readMultiSelectValues = (el: HTMLSelectElement): string[] => Array.from(el.selectedOptions).map((o) => o.value).filter(Boolean);

  const handlePinChange = async (val: string) => {
    const onlyDigits = String(val || '').replace(/\D/g, '').slice(0, 6);
    setPinInput(onlyDigits);
    if (onlyDigits.length !== 6) return;
    try {
      setLoading(true);
      const res = await fetch('/api/org/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: orgIdAtivo, pin: onlyDigits }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setAdminAutenticado(true);
        setPinInput('');
      } else {
        setTimeout(() => setPinInput(''), 500);
      }
    } finally {
      setLoading(false);
    }
  };

  const salvarConfigsBanda = async () => {
    if (!org?.id) return alert('Erro: Organização não identificada.');
    let pinParaSalvar: string | undefined = undefined;
    if (alterarPin) {
      const pinDigits = String(novoPinEdit || '').replace(/\D/g, '');
      if (pinDigits.length !== 6) return alert('O novo PIN deve ter exatamente 6 números.');
      pinParaSalvar = pinDigits;
    }
    setLoading(true);
    try {
      const novoSlug = slugify(slugBandaEdit || nomeBandaEdit);
      const payload: any = { nome: String(nomeBandaEdit || '').trim(), slug: novoSlug };
      if (pinParaSalvar) payload.pin_acesso = pinParaSalvar;
      const { error } = await supabase.from('organizacoes').update(payload).eq('id', org.id);
      if (error) throw error;
      setSucesso(true);
      setAlterarPin(false);
      setNovoPinEdit('');
      setTimeout(() => { setSucesso(false); router.refresh(); }, 1200);
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err?.message || 'Verifique sua conexão.'));
    } finally {
      setLoading(false);
    }
  };

  const deletarMembro = async (membroId: string, nome: string) => {
    if (!confirm(`Deseja remover ${nome} permanentemente?`)) return;
    try {
      const { error } = await supabase.from('membros').delete().eq('id', membroId);
      if (error) throw error;
      if (userAtivo?.id === membroId) {
        localStorage.removeItem('usuario_ativo');
        setUserAtivo(null);
        setEditandoAtivo(false);
      }
      await carregarMembros();
    } catch {
      alert('Erro ao deletar');
    }
  };

  const copiarLinkConvite = () => {
    try {
      const link = `${window.location.origin}/perfil?org=${orgIdAtivo}`;
      navigator.clipboard.writeText(link);
      setCopiadoLink(true);
      setTimeout(() => setCopiadoLink(false), 2000);
    } catch {
      alert('Não foi possível copiar automaticamente.');
    }
  };

  const statusAssinatura = String(org?.status_assinatura || 'pendente');
  const isAtivo = statusAssinatura === 'ativo' || statusAssinatura === 'trial';

  return (
    <>
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}

      <div className="min-h-screen bg-slate-950 p-6 pb-32 flex flex-col items-center gap-6 font-sans">
        {!loadingOrg && !orgIdAtivo && (
          <div className="w-full max-w-md p-6 bg-yellow-500/10 border border-yellow-500/20 rounded-[2rem] text-center space-y-4">
            <AlertTriangle className="mx-auto text-yellow-500" size={40} />
            <div>
              <h2 className="text-lg font-black text-yellow-500 uppercase italic">Link Inválido</h2>
              <p className="text-xs font-bold text-slate-400 mt-2">Você acessou esta página sem um convite de banda.</p>
            </div>
            <Link href="/" className="inline-block bg-slate-900 text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-slate-800 transition-colors">Voltar ao Início</Link>
          </div>
        )}

        {!loadingOrg && orgIdAtivo && (
          <>
            <div className="w-full max-w-md px-4">
              <header className="w-full mx-w-md flex items-center justify-between mb-8 pt-4">
                <Link href="/" className="group block transition-transform active:scale-95">
                  <div className="text-left">
                    <h2 className="text-blue-500 text-[10px] font-black uppercase tracking-[0.4em] mb-1">{org?.nome || 'Banda'}</h2>
                    <h1 className="text-3xl font-black italic tracking-tighter uppercase leading-[0.8] text-white group-hover:text-slate-200 transition-colors">
                      {fase === 'admin' && <>Área do<br />Líder</>}
                      {fase === 'cadastro' && <>Criar<br />Usuário</>}
                      {fase === 'identidade' && <>Selecionar<br />Usuário</>}
                    </h1>
                  </div>
                </Link>
                <button onClick={() => router.back()} className="text-blue-500 flex items-center gap-2 font-bold uppercase text-[16px] tracking-widest hover:text-white transition-colors">
                  <ArrowLeft size={16} /> Voltar
                </button>
              </header>
            </div>

            {fase === 'admin' && (
              <div className="w-full max-w-md space-y-6 animate-in fade-in zoom-in duration-300">
                {!adminAutenticado ? (
                  <div className="bg-slate-900 border relative overflow-hidden border-white/5 p-10 rounded-[2.5rem] shadow-2xl text-center space-y-6">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                    <div className="size-16 bg-blue-600/10 rounded-2xl flex items-center justify-center text-blue-500 mx-auto border border-blue-500/20">
                      <ShieldCheck size={32} />
                    </div>
                    <p className="text-[12px] font-black text-white-500 uppercase tracking-[0.3em]">Digite o PIN de acesso</p>
                    <input type="password" maxLength={6} inputMode="numeric" value={pinInput} onChange={(e) => handlePinChange(e.target.value)} className="w-full bg-slate-950 border border-white/10 p-5 rounded-2xl text-center text-3xl font-black tracking-[0.5em] text-blue-500 outline-none focus:border-blue-600" autoFocus />
                    <button onClick={() => { setAdminAutenticado(false); setPinInput(''); setFase('identidade'); }} className="text-[12px] font-black text-white-600 uppercase">Cancelar</button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <section className="bg-slate-900 border relative overfow-hidden border-white/5 p-8 rounded-[3rem] shadow-xl space-y-5">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                      <div className="flex items-center gap-3 text-blue-500 mb-2"><Building2 size={20} /><h2 className="text-sm font-black uppercase italic tracking-widest">Banda & Segurança</h2></div>
                      <input value={nomeBandaEdit} onChange={(e) => setNomeBandaEdit(e.target.value)} className="w-full bg-slate-950 p-4 rounded-xl border border-white/5 font-bold outline-none focus:border-blue-500" placeholder="Nome da Banda" />
                      <div className="flex items-center bg-slate-950 p-4 rounded-xl border border-white/5"><span className="text-yellow-600 text-m font-mono">slug/</span><input value={slugBandaEdit} onChange={(e) => setSlugBandaEdit(slugify(e.target.value))} className="w-full bg-transparent outline-none font-bold ml-1" placeholder="minha-banda" /></div>
                      <div className="bg-slate-950 p-4 rounded-xl border border-white/5 space-y-3">
                        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Key size={14} className="text-slate-600" /><span className="text-[12px] font-mono text-yellow-600 uppercase">PIN de acesso</span></div>{!alterarPin && <button type="button" onClick={() => setAlterarPin(true)} className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-yellow-400">Alterar PIN</button>}</div>
                        {!alterarPin ? <p className="text-[11px] font-mono text-slate-400">PIN configurado ••••••</p> : <input value={novoPinEdit} maxLength={6} inputMode="numeric" onChange={(e) => setNovoPinEdit(e.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full bg-transparent outline-none font-bold text-white tracking-[0.3em]" placeholder="Digite o novo PIN (6 números)" />}
                      </div>
                      <button onClick={salvarConfigsBanda} disabled={loading} className="w-full bg-blue-500/5 border border-blue-500/20 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-[0.2em] active:scale-95 flex items-center justify-center gap-3 hover:border-blue-500/40 shadow-blue-500/10 hover:text-white transition-all shadow-xl disabled:opacity-60">{loading ? <><Loader2 className="animate-spin" size={16} /> GRAVANDO...</> : <><Save size={16} /> Salvar Alterações</>}</button>
                    </section>
                    <section className="bg-slate-900 border relative overflow-hidden border-white/5 p-8 rounded-[3rem] shadow-xl">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                      <div className="flex items-center gap-3 text-blue-500 mb-4"><Users size={20} /><h2 className="text-sm font-black uppercase italic tracking-widest">Gerenciar Time</h2><div className="ml-auto"><h3 className="text-sm font-black text-green-500 uppercase italic tracking-widest">Convite</h3></div></div>
                      <div className="bg-slate-950 p-4 rounded-xl flex items-center justify-between gap-3 border border-white/5"><code className="text-l font-mono text-gray-300 truncate italic">.../perfil?org={String(orgIdAtivo).slice(0, 8)}</code><button onClick={copiarLinkConvite} className="p-2 bg-slate-900 rounded-lg border border-white/10">{copiadoLink ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} className="text-slate-400" />}</button></div>
                      <div className="space-y-3 max-h-[320px] overflow-y-auto no-scrollbar mt-4">
                        {membros.map((m) => (<div key={m.id} className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-white/5"><div className="min-w-0"><p className="text-l font-black uppercase truncate">{m.nome}</p><p className="text-[14px] text-slate-500 uppercase truncate">{m.funcao}</p></div><button onClick={() => deletarMembro(m.id, m.nome)} className="p-2 text-red-500/50 hover:text-red-500 transition-colors"><Trash2 size={16} /></button></div>))}
                        {membros.length === 0 && <div className="p-4 bg-slate-950 rounded-2xl border border-dashed border-white/10 text-center"><p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Sem membros</p></div>}
                      </div>
                    </section>
                    <section className="bg-slate-900 border relative overflow-hidden border-white/5 p-8 rounded-[3rem] shadow-xl space-y-4">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                      <div className="flex items-center gap-3 text-yellow-500 mb-2"><CreditCard size={20} /><h2 className="text-sm font-black uppercase italic tracking-widest">Plano</h2></div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center bg-slate-950 p-4 rounded-xl border border-white/5"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</span><span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${isAtivo ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>{statusAssinatura}</span></div>
                        <div className="flex justify-between items-center bg-slate-950 p-4 rounded-xl border border-white/5"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Expira em</span><span className="text-[12px] font-mono font-bold text-white uppercase">{org?.data_expiracao ? new Date(org.data_expiracao).toLocaleDateString('pt-BR') : '—'}</span></div>
                      </div>
                      {!isAtivo && <Link href="/checkout" className="block w-full bg-red-600 hover:bg-red-500 transition-colors py-4 rounded-xl font-black uppercase text-[10px] text-center shadow-lg shadow-red-900/20">Regularizar Agora</Link>}
                    </section>
                    <button onClick={() => { setAdminAutenticado(false); setPinInput(''); setFase('identidade'); }} className="w-full py-4 text-[14px] font-black uppercase relative hover:text-blue-500 text-white-600 tracking-widest"><div className="absolute top-0 left-0 w-full  h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />Sair do Modo Admin</button>
                  </div>
                )}
              </div>
            )}

            {fase === 'cadastro' && (
              <form onSubmit={handleCadastro} className="w-full max-w-md bg-slate-900/50 border overflow-hidden border-white/5 p-8 rounded-[2.5rem] space-y-6 relative shadow-2xl">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                <div className="flex items-center gap-4 mb-2"><div className="size-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 border border-emerald-500/20"><UserPlus size={24} /></div><h2 className="text-lg font-black uppercase italic tracking-tighter">Novo Integrante</h2></div>
                <div className="space-y-4">
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Nome</label><input name="nome" placeholder="Ex: Lucas Teclas" className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-emerald-500/50 transition-all font-bold placeholder:text-slate-700" required /></div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Função Principal</label>
                    {!cadUsarFuncaoCustom ? (
                      <><select name="funcao" className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-emerald-500/50 font-bold appearance-none" required defaultValue=""><option value="">Selecione...</option>{funcoesDisponiveis.map((op) => (<option key={op} value={op}>{op}</option>))}</select><button type="button" onClick={() => { setCadUsarFuncaoCustom(true); setCadFuncaoCustom(''); }} className="mt-3 inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-yellow-400 transition-colors"><Plus size={14} /> Adicionar minha função</button></>
                    ) : (
                      <><input value={cadFuncaoCustom} onChange={(e) => setCadFuncaoCustom(e.target.value)} placeholder="Digite sua função..." className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 transition-all font-bold placeholder:text-slate-700" required /><button type="button" onClick={() => { setCadUsarFuncaoCustom(false); setCadFuncaoCustom(''); }} className="mt-3 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors">Voltar para lista</button></>
                    )}
                  </div>
                  <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-3 block">Sub-funções</label><MultiSelectSubfuncoes disponiveis={subfuncoesDisponiveis} selecionadas={subfuncoesSelecionadas} onChange={setSubfuncoesSelecionadas} />{subfuncoesSelecionadas.length > 0 && <button type="button" onClick={() => setSubfuncoesSelecionadas([])} className="mt-3 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors">Limpar subfunções</button>}</div>
                </div>
                <div className="pt-4 space-y-3"><button type="submit" disabled={loading} className="w-full bg-blue-500/5 text-blue-500 py-5  relative overflow-hidden rounded-2xl font-black uppercase text-[14px] tracking-widest active:scale-95 flex items-center justify-center gap-3 shadow-blue-500/10 hover:text-white transition-all shadow-xl border border-blue-500/20 hover:border-blue-500/40 disabled:opacity-50"><div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />{loading ? <div className="flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={16} /> Sincronizando...</div> : 'Cadastrar e Ativar Perfil'}</button></div>
              </form>
            )}

            {fase === 'identidade' && (
              <div className="w-full max-w-md bg-slate-900 border overflow-hidden border-white/5 p-8 rounded-[2.5rem] shadow-2xl relative">
                {sucesso && <div className="absolute inset-0 bg-blue-600 flex flex-col items-center justify-center z-10 animate-in fade-in duration-300 rounded-[2.5rem]"><ShieldCheck size={48} className="text-white animate-bounce" /><span className="text-white font-black uppercase text-xs tracking-[0.3em] mt-4">Perfil Ativado!</span></div>}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                <div className="space-y-6">
                  <div className="relative group"><label className="text-[12px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1 mb-2 block">Membro da Banda</label><select onChange={(e) => handleSelecionar(e.target.value)} value={userAtivo?.id || ''} className="w-full p-5 rounded-2xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 transition-all font-bold appearance-none cursor-pointer"><option value="" disabled>Selecione seu nome...</option>{membros.map((m) => (<option key={m.id} value={m.id}>{m.nome} ({m.funcao})</option>))}</select><ChevronRight className="absolute right-4 bottom-5 text-slate-600 rotate-90 pointer-events-none" size={18} /></div>
                  {userAtivo ? (
                    <div className="p-5 bg-blue-600/5 border border-blue-500/10 rounded-2xl space-y-4">
                      <div className="flex items-center justify-between">
                        <div><p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-1">Acesso Liberado</p><p className="text-white font-black uppercase italic tracking-tight text-lg">{userAtivo.nome}</p>{!editandoAtivo && <p className="text-[10px] text-slate-400 font-bold uppercase">{userAtivo.funcao}{formatSubfuncoes(userAtivo) ? ` + ${formatSubfuncoes(userAtivo)}` : ''}</p>}</div>
                        <div className="flex items-center gap-2">
                          {!editandoAtivo ? (<button onClick={abrirEdicaoAtivo} className="p-3 bg-slate-950 rounded-xl border border-white/5 text-slate-500 hover:text-blue-400 hover:border-blue-500/30 transition-all"><Edit3 size={18} /></button>) : (<><button onClick={salvarEdicaoAtivo} disabled={salvandoEdicao} className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400 hover:border-emerald-500/40 transition-all disabled:opacity-50"><Save size={18} /></button><button onClick={cancelarEdicaoAtivo} disabled={salvandoEdicao} className="p-3 bg-slate-950 rounded-xl border border-white/5 text-slate-500 hover:text-white transition-all disabled:opacity-50"><X size={18} /></button></>)}
                          <button onClick={handleLogout} className="p-3 bg-slate-950 rounded-xl border border-white/5 text-slate-600 hover:text-red-500 hover:border-red-500/30 transition-all"><LogOut size={18} /></button>
                        </div>
                      </div>
                      {editandoAtivo && (
                        <div className="space-y-4">
                          <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Função Principal</label>
                            {!editUsarFuncaoCustom ? (
                              <><select value={editFuncao} onChange={(e) => setEditFuncao(e.target.value)} disabled={salvandoEdicao} className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold appearance-none disabled:opacity-50"><option value="">Selecione...</option>{funcoesDisponiveis.map((op) => (<option key={op} value={op}>{op}</option>))}</select><button type="button" onClick={() => { setEditUsarFuncaoCustom(true); setEditFuncaoCustom(editFuncao || ''); setEditFuncao(''); }} disabled={salvandoEdicao} className="mt-3 inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-500 hover:text-yellow-400 transition-colors disabled:opacity-50"><Plus size={14} /> Adicionar nova função</button></>
                            ) : (
                              <><input value={editFuncaoCustom} onChange={(e) => setEditFuncaoCustom(e.target.value)} disabled={salvandoEdicao} placeholder="Digite sua função..." className="w-full p-4 rounded-xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 transition-all font-bold placeholder:text-slate-700 disabled:opacity-50" /><button type="button" onClick={() => { setEditUsarFuncaoCustom(false); setEditFuncao(''); setEditFuncaoCustom(''); }} disabled={salvandoEdicao} className="mt-3 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors disabled:opacity-50">Voltar para lista</button></>
                            )}
                          </div>
                          <div><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-3 block">Sub-funções</label>
                            {!USE_MULTISELECT_SUBFUNCOES ? (<MultiSelectSubfuncoes disponiveis={subfuncoesDisponiveis} selecionadas={editSubfuncoes} onChange={setEditSubfuncoes} />) : (<select multiple value={editSubfuncoes} onChange={(e) => setEditSubfuncoes(readMultiSelectValues(e.currentTarget))} disabled={salvandoEdicao} className="w-full h-48 p-4 rounded-2xl bg-slate-950 text-white border border-white/5 outline-none focus:border-blue-500/50 font-bold disabled:opacity-50">{subfuncoesDisponiveis.map((op) => (<option key={op} value={op}>{op}</option>))}</select>)}
                            {editSubfuncoes.length > 0 && <button type="button" onClick={() => setEditSubfuncoes([])} disabled={salvandoEdicao} className="mt-3 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors disabled:opacity-50">Limpar subfunções</button>}
                          </div>
                          <div className="pt-1"><p className="text-[9px] font-black uppercase tracking-widest text-slate-600">{salvandoEdicao ? 'Salvando...' : 'Edite e clique em salvar.'}</p></div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-5 bg-slate-950 border border-dashed border-white/10 rounded-2xl text-center"><p className="text-[12px] font-black text-slate-600 uppercase tracking-widest">Nenhum perfil ativo</p></div>
                  )}
                </div>
              </div>
            )}

            {fase !== 'admin' && (
              <div className="w-full max-w-md relative overflow-hidden text-center pt-2">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                <button type="button" onClick={() => setFase(fase === 'cadastro' ? 'identidade' : 'cadastro')} className="w-full bg-blue-500/5 text-blue-500 py-5 rounded-2xl font-black uppercase text-[14px] tracking-widest active:scale-95 flex items-center justify-center gap-3 shadow-blue-500/10 hover:text-white transition-all shadow-xl">
                  {fase === 'cadastro' ? 'Já é um integrante?\nSelecione seu perfil aqui' : 'É novo por aqui?\nCrie seu perfil agora'}
                </button>
              </div>
            )}

            {fase !== 'admin' && (
              <div className="w-full max-w-md text-center pt-8 opacity-70 hover:opacity-100 transition-opacity">
                <button onClick={() => { setFase('admin'); setAdminAutenticado(false); setPinInput(''); }} className="w-full bg-blue-500/5 text-white py-5 relative overflow-hidden rounded-2xl font-black uppercase text-[16px] tracking-widest active:scale-95 flex items-center justify-center gap-3 shadow-blue-500/10 hover:text-white transition-all shadow-xl">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
                  <ShieldCheck size={16} /> Painel do Líder
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}