'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Rocket,
  ArrowRight,
  Loader2,
  Sparkles,
  ArrowLeft,
  LogIn,
  ShieldAlert,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOrg } from '@/contexts/OrgContext';

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

export default function RegistrarBanda() {
  const router = useRouter();
  const { setOrgIdAtivo } = useOrg();

  const [loading, setLoading] = useState(false);
  const [modo, setModo] = useState<'registro' | 'login'>('registro');
  const [nomeBanda, setNomeBanda] = useState('');
  const [emailLider, setEmailLider] = useState('');
  const [pinLider, setPinLider] = useState('');

  // ✅ Segurança
  const [tentativas, setTentativas] = useState(0);
  const [bloqueadoAte, setBloqueadoAte] = useState<number | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  // ✅ Timer do bloqueio
  useEffect(() => {
    if (!bloqueadoAte) return;

    const tick = () => {
      const restante = Math.ceil((bloqueadoAte - Date.now()) / 100000);
      if (restante <= 0) {
        setBloqueadoAte(null);
        setTentativas(0);
        setSegundosRestantes(0);
      } else {
        setSegundosRestantes(restante);
      }
    };

    tick();
    const interval = setInterval(tick, 100000);
    return () => clearInterval(interval);
  }, [bloqueadoAte]);

  async function handleAcesso(e: React.FormEvent) {
    e.preventDefault();
    if (bloqueadoAte) return;

    if (!emailLider.trim()) return;
    if (modo === 'registro' && !nomeBanda.trim()) return;
    if (modo === 'login' && pinLider.replace(/\D/g, '').length !== 6) {
      alert('Digite um PIN de 6 números.');
      return;
    }

    setLoading(true);

    try {
      if (modo === 'registro') {
        const slug = slugify(nomeBanda);

        const { data: org, error } = await supabase
          .from('organizacoes')
          .insert([
            {
              nome: nomeBanda.trim(),
              slug,
              email_admin: emailLider.trim(),
              status_assinatura: 'trial',
              pin_acesso: pinLider.trim(),
              // pin_acesso: ... (opcional) -> se o banco tem default, não precisa setar
            },
          ])
          .select('id')
          .single();

        if (error) throw error;

        setOrgIdAtivo(org.id);
        router.push(`/registrar-banda/analise`);
        return;
      }

      // ✅ LOGIN COM PROTEÇÃO (3 tentativas -> bloqueia 30s)
      const pinLimpo = pinLider.replace(/\D/g, '').slice(0, 6);

      const { data: org, error } = await supabase
        .from('organizacoes')
        .select('id')
        .eq('email_admin', emailLider.trim())
        .eq('pin_acesso', pinLimpo)
        .maybeSingle();

      if (error) throw error;

      if (!org) {
        const novasTentativas = tentativas + 1;
        setTentativas(novasTentativas);

        if (novasTentativas >= 3) {
          const tempoBloqueio = Date.now() + 300_000;
          setBloqueadoAte(tempoBloqueio);
          setSegundosRestantes(30000);
          alert('Muitas tentativas incorretas. Aguarde 30000 segundos.');
        } else {
          alert(`E-mail ou PIN incorretos. Tentativa ${novasTentativas} de 3.`);
        }
        return;
      }

      // ✅ Sucesso
      setTentativas(0);
      setBloqueadoAte(null);
      setSegundosRestantes(0);

      setOrgIdAtivo(org.id);
      router.push(`/`);
    } catch (err: any) {
      console.error(err);
      alert('Erro: ' + (err?.message || 'Verifique sua conexão.'));
    } finally {
      setLoading(false);
    }
  }

  const estaBloqueado = !!bloqueadoAte;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-10 relative">
          <button
            onClick={() => router.back()}
            className="absolute left-0 top-1 text-slate-600 hover:text-white transition-colors"
          >
            <ArrowLeft size={24} />
          </button>

          <div className="inline-block p-4 bg-blue-600/10 rounded-3xl mb-4 border border-blue-500/20 shadow-[0_0_40px_rgba(37,99,235,0.15)]">
            {estaBloqueado ? (
              <ShieldAlert className="text-red-500 animate-pulse" size={40} />
            ) : modo === 'registro' ? (
              <Rocket className="text-blue-500" size={40} />
            ) : (
              <LogIn className="text-blue-500" size={40} />
            )}
          </div>

          <h1 className="text-4xl font-black italic uppercase tracking-tighter">Backstage</h1>

          <p
            className={`${
              estaBloqueado ? 'text-red-500' : 'text-slate-500'
            } font-bold uppercase text-[10px] tracking-[0.3em]`}
          >
            {estaBloqueado
              ? `Acesso Bloqueado (${segundosRestantes}s)`
              : modo === 'registro'
              ? 'Solicitar Acesso'
              : 'Entrar na Conta'}
          </p>
        </div>

        <form
          onSubmit={handleAcesso}
          className={`bg-slate-900 border border-white/5 p-8 rounded-[2.5rem] space-y-6 shadow-2xl relative overflow-hidden transition-all ${
            estaBloqueado ? 'opacity-50 grayscale' : ''
          }`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

          <h2 className="text-xl font-black italic uppercase tracking-tight mb-1 flex items-center gap-2 relative z-10">
            {modo === 'registro' ? (
              <>
                <Sparkles size={20} className="text-yellow-500" /> Criar Organização
              </>
            ) : (
              <>
                <LogIn size={20} className="text-blue-500" /> Acessar Minha Banda
              </>
            )}
          </h2>

          <div className="space-y-4 relative z-10">
            {/* Nome (somente no registro) */}
            {modo === 'registro' && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-[10px] font-black uppercase text-slate-500 ml-2 mb-2 block tracking-widest">
                  Nome do Grupo / Igreja
                </label>
                <input
                  required
                  disabled={estaBloqueado}
                  type="text"
                  value={nomeBanda}
                  onChange={(e) => setNomeBanda(e.target.value)}
                  className="w-full bg-slate-950 border border-white/5 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold transition-all placeholder:text-slate-700 disabled:opacity-60"
                  placeholder="Ex: Ministério de Louvor"
                />
              </div>
            )}

            {/* Email */}
            <div>
              <label className="text-[10px] font-black uppercase text-slate-500 ml-2 mb-2 block tracking-widest">
                E-mail do Líder
              </label>
              <input
                required
                disabled={estaBloqueado}
                type="email"
                value={emailLider}
                onChange={(e) => setEmailLider(e.target.value)}
                className="w-full bg-slate-950 border border-white/5 p-4 rounded-2xl outline-none focus:border-blue-500 font-bold transition-all placeholder:text-slate-700 disabled:opacity-60"
                placeholder="lider@email.com"
              />
            </div>

              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-[10px] font-black uppercase text-slate-500 ml-2 mb-2 block tracking-widest">
                  Pin do Líder
                </label>
                <input
                  required
                  disabled={estaBloqueado}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pinLider}
                  onChange={(e) => setPinLider(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-slate-950 border border-white/5 p-4 rounded-2xl outline-none focus:border-blue-500 font-black text-center text-2xl tracking-[0.5em] transition-all placeholder:text-slate-800 placeholder:tracking-normal disabled:opacity-60"
                  placeholder="000000"
                />
              </div>
          </div>

          <button
            type="submit"
            disabled={loading || estaBloqueado}
            className={`w-full ${
              estaBloqueado ? 'bg-slate-800' : 'bg-blue-600 hover:bg-blue-500'
            } disabled:opacity-50 py-5 rounded-2xl font-black uppercase italic tracking-widest flex items-center justify-center gap-3 transition-all shadow-lg shadow-blue-900/20 active:scale-95 relative z-10`}
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : estaBloqueado ? (
              `Aguarde ${segundosRestantes}s`
            ) : modo === 'registro' ? (
              <>
                Começar a testar <ArrowRight size={20} />
              </>
            ) : (
              <>
                Entrar Agora <LogIn size={20} />
              </>
            )}
          </button>

          {/* Alternar modo (desabilita quando bloqueado) */}
          {!estaBloqueado && (
            <button
              type="button"
              onClick={() => {
                setModo(modo === 'registro' ? 'login' : 'registro');
                setTentativas(0);
                // opcional: limpar pin quando troca
                setPinLider('');
              }}
              className="w-full text-center text-xs font-bold text-slate-500 hover:text-blue-400 transition-colors uppercase tracking-widest"
            >
              {modo === 'registro' ? 'Já tenho uma banda cadastrada' : 'Quero registrar uma nova banda'}
            </button>
          )}
        </form>

        <p className="text-center mt-8 text-[10px] text-slate-600 font-bold uppercase tracking-widest">
          Versão Beta • {modo === 'registro' ? 'Liberação Manual' : 'Acesso via E-mail'}
        </p>
      </div>
    </div>
  );
}
