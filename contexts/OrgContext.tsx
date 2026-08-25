"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";
import {
  bindDeviceIdentity,
  clearDeviceBinding,
  loadDeviceIdentity,
  getJoinOrgInfo,
  type DeviceIdentityMember,
} from "@/lib/deviceIdentity";

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
  user_id?: string | null;
};

export type ActiveMember = DeviceIdentityMember;
export type IdentityMode = 'auth' | 'legacy' | 'none';

type OrgContextValue = {
  org: Org | null;
  loadingOrg: boolean;
  orgIdAtivo: string | null;
  activeMember: ActiveMember | null;
  identityMode: IdentityMode;
  identityWarning: string | null;

  setOrg: (o: Org | null) => void;
  setOrgIdAtivo: (id: string | null) => void;
  bindActiveMember: (member: ActiveMember, inviteToken?: string | null) => Promise<IdentityMode>;
  clearActiveMember: () => Promise<void>;

  refreshOrg: () => Promise<Org | null>;
  refreshIdentity: () => Promise<ActiveMember | null>;
};

const OrgContext = createContext<OrgContextValue | null>(null);

const LS_ORG_ID = "org_id_ativo";
const LS_MEMBER = "usuario_ativo";

function readLocalMember(): ActiveMember | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_MEMBER);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id) return null;
    return parsed as ActiveMember;
  } catch {
    return null;
  }
}

function writeLocalMember(member: ActiveMember | null) {
  if (typeof window === 'undefined') return;
  try {
    if (member) localStorage.setItem(LS_MEMBER, JSON.stringify(member));
    else localStorage.removeItem(LS_MEMBER);
  } catch {}
}

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const orgFromUrl = searchParams?.get("org") || "";
  const inviteFromUrl = searchParams?.get("invite") || "";

  const [org, setOrgState] = useState<Org | null>(null);
  const [orgIdAtivo, setOrgIdAtivoState] = useState<string | null>(null);
  const [activeMember, setActiveMemberState] = useState<ActiveMember | null>(null);
  const [identityMode, setIdentityMode] = useState<IdentityMode>('none');
  const [identityWarning, setIdentityWarning] = useState<string | null>(null);
  const [loadingOrg, setLoadingOrg] = useState(true);

  const persistOrgId = useCallback((id: string | null) => {
    const clean = id ? String(id).trim() : null;
    setOrgIdAtivoState(clean);
    try {
      if (clean) localStorage.setItem(LS_ORG_ID, clean);
      else localStorage.removeItem(LS_ORG_ID);
    } catch {}
  }, []);

  const fetchOrg = useCallback(async (id: string | null, inviteToken?: string | null): Promise<Org | null> => {
    const clean = id ? String(id).trim() : '';
    if (!clean) return null;

    const { data, error } = await supabase
      .from("organizacoes")
      .select("id,nome,slug,status_assinatura,data_expiracao,user_id")
      .eq("id", clean)
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        nome: (data as any).nome || "",
        slug: (data as any).slug || "",
        status_assinatura: (data as any).status_assinatura ?? null,
        data_expiracao: (data as any).data_expiracao ?? null,
        user_id: (data as any).user_id ?? null,
      };
    }

    const cleanInvite = String(inviteToken || '').trim();
    if (cleanInvite) {
      const joinInfo = await getJoinOrgInfo(clean, cleanInvite);
      if (joinInfo) {
        return {
          id: String((joinInfo as any).id),
          nome: String((joinInfo as any).nome || ''),
          slug: String((joinInfo as any).slug || ''),
          status_assinatura: (joinInfo as any).status_assinatura ?? null,
          data_expiracao: (joinInfo as any).data_expiracao ?? null,
          user_id: null,
        };
      }
    }

    if (error) throw error;
    return null;
  }, []);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      setLoadingOrg(true);
      setIdentityWarning(null);

      try {
        const cleanFromUrl = String(orgFromUrl || '').trim();
        const linked = await loadDeviceIdentity().catch(() => null);
        let resolvedOrgId: string | null = null;
        let resolvedMember: ActiveMember | null = null;
        let resolvedMode: IdentityMode = 'none';

        if (cleanFromUrl) {
          resolvedOrgId = cleanFromUrl;
          if (linked && linked.orgId === cleanFromUrl) {
            resolvedMember = linked.member;
            resolvedMode = 'auth';
          } else {
            const local = readLocalMember();
            if (local && String(local.org_id || '') === cleanFromUrl) {
              resolvedMember = local;
              resolvedMode = 'legacy';
            }
          }
        } else if (linked) {
          resolvedOrgId = linked.orgId;
          resolvedMember = linked.member;
          resolvedMode = 'auth';
        } else {
          try {
            const savedOrg = localStorage.getItem(LS_ORG_ID);
            resolvedOrgId = savedOrg?.trim() || null;
          } catch {}
          resolvedMember = readLocalMember();
          if (resolvedMember) resolvedMode = 'legacy';
        }

        if (
          resolvedOrgId &&
          resolvedMember &&
          resolvedMode === 'legacy'
        ) {
          const normalizedLegacy = {
            ...resolvedMember,
            org_id: resolvedMember.org_id || resolvedOrgId,
          };
          const migration = await bindDeviceIdentity(resolvedOrgId, normalizedLegacy, inviteFromUrl || null).catch(() => null);
          if (migration?.mode === 'auth') {
            resolvedMember = normalizedLegacy;
            resolvedMode = 'auth';
            setIdentityWarning(null);
          } else if (migration?.warning) {
            setIdentityWarning(migration.warning);
          }
        }

        if (!alive) return;

        persistOrgId(resolvedOrgId);
        setActiveMemberState(resolvedMember);
        setIdentityMode(resolvedMode);
        writeLocalMember(resolvedMember);

        if (!resolvedOrgId) {
          setOrgState(null);
          return;
        }

        const loadedOrg = await fetchOrg(resolvedOrgId, inviteFromUrl);
        if (!alive) return;
        setOrgState(loadedOrg);
      } catch (e) {
        console.error('Org bootstrap error:', e);
        if (alive) setOrgState(null);
      } finally {
        if (alive) setLoadingOrg(false);
      }
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, [fetchOrg, inviteFromUrl, orgFromUrl, persistOrgId]);

  const setOrgIdAtivo = useCallback(
    (id: string | null) => {
      persistOrgId(id);
    },
    [persistOrgId]
  );

  const setOrg = useCallback(
    (o: Org | null) => {
      setOrgState(o);
      persistOrgId(o?.id || null);
    },
    [persistOrgId]
  );

  const refreshOrg = useCallback(async (): Promise<Org | null> => {
    setLoadingOrg(true);
    try {
      let id = orgIdAtivo;
      if (!id) {
        try {
          id = localStorage.getItem(LS_ORG_ID)?.trim() || null;
        } catch {}
      }

      const loaded = await fetchOrg(id, inviteFromUrl);
      setOrgState(loaded);
      return loaded;
    } catch (e) {
      console.error("refreshOrg error:", e);
      setOrgState(null);
      return null;
    } finally {
      setLoadingOrg(false);
    }
  }, [fetchOrg, inviteFromUrl, orgIdAtivo]);

  const refreshIdentity = useCallback(async (): Promise<ActiveMember | null> => {
    const linked = await loadDeviceIdentity().catch(() => null);
    if (linked) {
      setActiveMemberState(linked.member);
      setIdentityMode('auth');
      setIdentityWarning(null);
      writeLocalMember(linked.member);
      persistOrgId(linked.orgId);
      return linked.member;
    }

    const local = readLocalMember();
    setActiveMemberState(local);
    setIdentityMode(local ? 'legacy' : 'none');
    writeLocalMember(local);
    return local;
  }, [persistOrgId]);

  const bindActiveMember = useCallback(
    async (member: ActiveMember, inviteToken?: string | null): Promise<IdentityMode> => {
      const cleanOrgId = String(member?.org_id || orgIdAtivo || '').trim();
      const normalized: ActiveMember = { ...member, org_id: cleanOrgId || null };

      setActiveMemberState(normalized);
      writeLocalMember(normalized);
      setIdentityWarning(null);

      if (!cleanOrgId) {
        setIdentityMode('legacy');
        setIdentityWarning('Perfil salvo localmente, mas a organização não foi identificada para o vínculo Auth.');
        return 'legacy';
      }

      const result = await bindDeviceIdentity(cleanOrgId, normalized, inviteToken);
      setIdentityMode(result.mode);
      setIdentityWarning(result.warning || null);
      return result.mode;
    },
    [orgIdAtivo]
  );

  const clearActiveMember = useCallback(async () => {
    await clearDeviceBinding().catch(() => undefined);
    setActiveMemberState(null);
    setIdentityMode('none');
    setIdentityWarning(null);
    writeLocalMember(null);
    try {
      localStorage.removeItem('usuario_ativo_id');
      localStorage.removeItem('perfil_id');
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (orgIdAtivo) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push((OneSignal: any) => {
        try {
          OneSignal.User.addTag("org_id", orgIdAtivo);
        } catch {}
      });
    }
  }, [orgIdAtivo]);

  useEffect(() => {
    if (typeof window === 'undefined' || !activeMember?.id) return;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        await OneSignal.login(String(activeMember.id));
      } catch {}
    });
  }, [activeMember?.id]);

  const value = useMemo<OrgContextValue>(
    () => ({
      org,
      loadingOrg,
      orgIdAtivo,
      activeMember,
      identityMode,
      identityWarning,
      setOrg,
      setOrgIdAtivo,
      bindActiveMember,
      clearActiveMember,
      refreshOrg,
      refreshIdentity,
    }),
    [
      org,
      loadingOrg,
      orgIdAtivo,
      activeMember,
      identityMode,
      identityWarning,
      setOrg,
      setOrgIdAtivo,
      bindActiveMember,
      clearActiveMember,
      refreshOrg,
      refreshIdentity,
    ]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg deve ser usado dentro de <OrgProvider />");
  return ctx;
}
