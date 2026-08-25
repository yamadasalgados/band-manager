import { supabase } from '@/lib/supabase';

export async function getCurrentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function createOrgInviteLink(orgId: string): Promise<string> {
  const token = await getCurrentAccessToken();
  if (!token) throw new Error('Este aparelho ainda não possui uma sessão Auth ativa.');

  const res = await fetch('/api/org/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orgId }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.inviteToken) {
    throw new Error(json?.error || 'Não foi possível gerar o convite.');
  }

  return `${window.location.origin}/membros?org=${encodeURIComponent(orgId)}&invite=${encodeURIComponent(json.inviteToken)}`;
}
