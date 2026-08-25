import { supabase } from '@/lib/supabase';

export type DeviceIdentityMember = {
  id: string;
  nome: string;
  funcao?: string | null;
  subfuncao?: string[] | null;
  org_id?: string | null;
};

export type DeviceIdentityResult = {
  mode: 'auth' | 'legacy';
  userId?: string;
  warning?: string;
};

export type LoadedDeviceIdentity = {
  userId: string;
  orgId: string;
  member: DeviceIdentityMember;
};

function getDeviceLabel() {
  if (typeof navigator === 'undefined') return 'device';
  const ua = String(navigator.userAgent || '').toLowerCase();
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac';
  if (ua.includes('windows')) return 'Windows';
  return 'Browser';
}

export async function getAuthUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user || null;
}

export async function getAuthAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export async function ensureDeviceAuth() {
  const current = await getAuthUser();
  if (current) return { user: current, error: null as Error | null };

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    return {
      user: null,
      error: error || new Error('Não foi possível criar a identidade anônima deste aparelho.'),
    };
  }

  return { user: data.user, error: null as Error | null };
}

export async function getJoinOrgInfo(orgId: string, inviteToken: string) {
  const auth = await ensureDeviceAuth();
  if (!auth.user) throw auth.error || new Error('Auth indisponível.');

  const { data, error } = await supabase.rpc('get_org_join_info', {
    p_org_id: orgId,
    p_invite_token: inviteToken,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function listJoinableMembers(orgId: string, inviteToken: string): Promise<DeviceIdentityMember[]> {
  const auth = await ensureDeviceAuth();
  if (!auth.user) throw auth.error || new Error('Auth indisponível.');

  const { data, error } = await supabase.rpc('list_joinable_members', {
    p_org_id: orgId,
    p_invite_token: inviteToken,
  });
  if (error) throw error;
  return (data || []) as DeviceIdentityMember[];
}

export async function createAndBindMemberWithInvite(args: {
  orgId: string;
  inviteToken: string;
  nome: string;
  funcao: string;
  whatsapp?: string | null;
  subfuncao?: string[];
}): Promise<DeviceIdentityMember> {
  const auth = await ensureDeviceAuth();
  if (!auth.user) throw auth.error || new Error('Auth indisponível.');

  const { data, error } = await supabase.rpc('join_org_create_member', {
    p_org_id: args.orgId,
    p_invite_token: args.inviteToken,
    p_nome: args.nome,
    p_funcao: args.funcao,
    p_whatsapp: args.whatsapp || null,
    p_subfuncao: args.subfuncao || [],
    p_device_label: getDeviceLabel(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new Error('O membro foi criado, mas o vínculo não retornou um perfil válido.');
  return row as DeviceIdentityMember;
}

export async function bindDeviceIdentity(
  orgId: string,
  member: DeviceIdentityMember,
  inviteToken?: string | null
): Promise<DeviceIdentityResult> {
  const cleanOrgId = String(orgId || '').trim();
  const memberId = String(member?.id || '').trim();

  if (!cleanOrgId || !memberId) {
    return { mode: 'legacy', warning: 'Organização ou membro inválido.' };
  }

  const { user, error: authError } = await ensureDeviceAuth();
  if (!user) {
    return {
      mode: 'legacy',
      warning:
        authError?.message ||
        'Supabase Auth anônimo indisponível; mantendo identidade local compatível.',
    };
  }

  if (inviteToken) {
    const { error } = await supabase.rpc('join_org_as_member', {
      p_org_id: cleanOrgId,
      p_invite_token: inviteToken,
      p_membro_id: memberId,
      p_device_label: getDeviceLabel(),
    });

    if (error) {
      return {
        mode: 'legacy',
        userId: user.id,
        warning: `Convite inválido ou expirado: ${error.message}`,
      };
    }

    return { mode: 'auth', userId: user.id };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from('membro_dispositivos').upsert(
    {
      user_id: user.id,
      membro_id: memberId,
      org_id: cleanOrgId,
      device_label: getDeviceLabel(),
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    return {
      mode: 'legacy',
      userId: user.id,
      warning:
        `Este navegador ainda está no modo legado. Entre novamente com e-mail/PIN da banda ou use um convite protegido. (${error.message})`,
    };
  }

  return { mode: 'auth', userId: user.id };
}

export async function loadDeviceIdentity(): Promise<LoadedDeviceIdentity | null> {
  const user = await getAuthUser();
  if (!user) return null;

  const { data: binding, error: bindingError } = await supabase
    .from('membro_dispositivos')
    .select('user_id,membro_id,org_id,last_seen_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (bindingError || !binding?.membro_id || !binding?.org_id) return null;

  const { data: member, error: memberError } = await supabase
    .from('membros')
    .select('id,nome,funcao,subfuncao,org_id')
    .eq('id', binding.membro_id)
    .eq('org_id', binding.org_id)
    .eq('ativo', true)
    .maybeSingle();

  if (memberError || !member) return null;

  await supabase
    .from('membro_dispositivos')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return {
    userId: user.id,
    orgId: String(binding.org_id),
    member: member as DeviceIdentityMember,
  };
}

export async function clearDeviceBinding() {
  const user = await getAuthUser();
  if (!user) return;

  const { error } = await supabase
    .from('membro_dispositivos')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    console.warn('[identity] Não foi possível remover o vínculo do aparelho:', error.message);
  }
}
