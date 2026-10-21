// Double authentification (codes TOTP d'une appli comme Google Authenticator), exigée pour les
// actions d'admin (public.admin_check, 0037_securite.sql). S'appuie sur celle de Supabase.

import { errorMessage, getSupabase } from './supabase';

export interface MfaState {
  verified: boolean; // la session actuelle a été validée par un code (aal2)
  factorId: string | null; // appli déjà enregistrée (il suffit alors d'entrer un code)
}

async function client() {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  return supabase;
}

export async function mfaState(): Promise<MfaState> {
  const supabase = await client();
  const [{ data: aal, error: e1 }, { data: factors, error: e2 }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (e1 || e2) throw new Error(errorMessage((e1 ?? e2)!));
  return { verified: aal?.currentLevel === 'aal2', factorId: factors?.totp?.[0]?.id ?? null };
}

/** Enregistre une nouvelle appli : QR code (image SVG) à scanner, et la clé à recopier à la main. */
export async function enrollTotp(): Promise<{ factorId: string; qr: string; secret: string }> {
  const supabase = await client();
  // Les essais abandonnés (QR jamais validé) sont retirés d'abord.
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Admin ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) throw new Error(errorMessage(error ?? { message: 'enregistrement impossible' }));
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Valide un code à 6 chiffres : la session passe au niveau aal2. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const supabase = await client();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'code incorrect ou expiré' : errorMessage(error));
}
