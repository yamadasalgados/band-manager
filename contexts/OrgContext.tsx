"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

// ✅ Tipagem para o OneSignal (caso não esteja num d.ts global)
declare global {
  interface Window {
    OneSignalDeferred?: any[];
  }
}

export type Org = {
  id: string;
  nome: string;
  slug: string;
  status_assinatura?: string | null;
  data_expiracao?: string | null;
};

type OrgContextValue = {
  org: Org | null;
  loadingOrg: boolean;
  orgIdAtivo: string | null;

  setOrg: (o: Org | null) => void;
  setOrgIdAtivo: (id: string | null) => void;

  refreshOrg: () => Promise<Org | null>;
};

const OrgContext = createContext<OrgContextValue | null>(null);

const LS_ORG_ID = "org_id_ativo";

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const orgFromUrl = searchParams?.get("org") || ""; 

  const [org, setOrgState] = useState<Org | null>(null);
  const [orgIdAtivo, setOrgIdAtivoState] = useState<string | null>(null);
  const [loadingOrg, setLoadingOrg] = useState(true);

  const setOrgIdAtivo = useCallback((id: string | null) => {
    const clean = id ? String(id).trim() : null;
    setOrgIdAtivoState(clean);

    try {
      if (clean) localStorage.setItem(LS_ORG_ID, clean);
      else localStorage.removeItem(LS_ORG_ID);
    } catch {}
  }, []);

  const setOrg = useCallback(
    (o: Org | null) => {
      setOrgState(o);
      setOrgIdAtivo(o?.id || null);
    },
    [setOrgIdAtivo]
  );

  // 1) URL (?org=) -> localStorage -> state
  useEffect(() => {
    const cleanFromUrl = String(orgFromUrl || "").trim();

    if (cleanFromUrl) {
      setOrgIdAtivo(cleanFromUrl);
      return;
    }

    try {
      const saved = localStorage.getItem(LS_ORG_ID);
      if (saved && saved.trim()) {
        setOrgIdAtivoState(saved.trim());
      } else {
        setOrgIdAtivoState(null);
      }
    } catch {
      setOrgIdAtivoState(null);
    }
  }, [orgFromUrl, setOrgIdAtivo]);

  // 2) Fetch de dados da Organização
  const refreshOrg = useCallback(async (): Promise<Org | null> => {
    setLoadingOrg(true);
    try {
      let id = orgIdAtivo;

      if (!id) {
        try {
          const saved = localStorage.getItem(LS_ORG_ID);
          if (saved && saved.trim()) id = saved.trim();
        } catch {}
      }

      if (!id) {
        setOrgState(null);
        return null;
      }

      const { data, error } = await supabase
        .from("organizacoes")
        .select("id,nome,slug,status_assinatura,data_expiracao")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setOrgState(null);
        return null;
      }

      const o: Org = {
        id: data.id,
        nome: (data as any).nome || "",
        slug: (data as any).slug || "",
        status_assinatura: (data as any).status_assinatura ?? null,
        data_expiracao: (data as any).data_expiracao ?? null,
      };

      setOrgState(o);
      return o;
    } catch (e) {
      console.error("refreshOrg error:", e);
      setOrgState(null);
      return null;
    } finally {
      setLoadingOrg(false);
    }
  }, [orgIdAtivo]);

  useEffect(() => {
    refreshOrg();
  }, [refreshOrg, orgIdAtivo]);

  // ✅ 3) INTEGRAÇÃO ONESIGNAL: Etiquetar usuário com o ID da Banda
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (orgIdAtivo) {
      // Se entrou na banda, adiciona a Tag
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push((OneSignal: any) => {
        // console.log("🔔 OneSignal: Etiquetando usuário na banda", orgIdAtivo);
        OneSignal.User.addTag("org_id", orgIdAtivo);
      });
    } else {
      // (Opcional) Se saiu, remove a Tag para parar de receber notificações
      /* window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push((OneSignal: any) => {
        OneSignal.User.removeTag("org_id");
      });
      */
    }
  }, [orgIdAtivo]);

  const value = useMemo<OrgContextValue>(
    () => ({ org, loadingOrg, orgIdAtivo, setOrg, setOrgIdAtivo, refreshOrg }),
    [org, loadingOrg, orgIdAtivo, setOrg, setOrgIdAtivo, refreshOrg]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg deve ser usado dentro de <OrgProvider />");
  return ctx;
}