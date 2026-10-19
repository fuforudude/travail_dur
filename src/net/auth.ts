import type { User } from '@supabase/supabase-js';
import { getSettings, updateSettings } from '../core/settings';
import { errorMessage, getSupabase } from './supabase';

/** Mêmes règles que la contrainte de public.profiles.username. */
export const USERNAME_RE = /^[A-Za-z0-9_À-ÖØ-öø-ÿ-]{2,16}$/;

export interface Account {
  id: string;
  anonymous: boolean;
  email: string | null;
  /** Email en attente de confirmation. */
  pendingEmail: string | null;
  verified: boolean;
}

let session: Promise<Account | null> | null = null;
const listeners = new Set<(a: Account | null) => void>();
let current: Account | null = null;

function toAccount(u: User | null | undefined): Account | null {
  if (!u) return null;
  return {
    id: u.id,
    anonymous: Boolean(u.is_anonymous),
    email: u.email || null,
    pendingEmail: u.new_email || null,
    verified: Boolean(u.email_confirmed_at) && !u.is_anonymous,
  };
}

function set(a: Account | null): void {
  current = a;
  listeners.forEach((cb) => cb(a));
}

export function getAccount(): Account | null {
  return current;
}

export function onAccount(cb: (a: Account | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Session Supabase : réutilise celle enregistrée, sinon crée un compte anonyme.
 * Retourne null si le multijoueur n'est pas configuré ou si le réseau est indisponible.
 */
export function ensureAccount(): Promise<Account | null> {
  session ??= (async () => {
    const supabase = await getSupabase();
    if (!supabase) return null;
    supabase.auth.onAuthStateChange((_event, s) => {
      const a = toAccount(s?.user);
      if (a?.id !== current?.id) void syncName(a);
      set(a);
    });
    const { data } = await supabase.auth.getSession();
    let user = data.session?.user ?? null;
    if (!user) {
      const { data: signed, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      user = signed.user;
    }
    const a = toAccount(user);
    set(a);
    await syncName(a);
    return a;
  })().catch((err) => {
    console.warn('Connexion impossible :', errorMessage(err));
    session = null; // nouvel essai au prochain appel
    return null;
  });
  return session;
}

/** Le pseudo du serveur fait foi ; à la première connexion, on y envoie le pseudo local. */
async function syncName(a: Account | null): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase || !a) return;
  const { data } = await supabase.from('profiles').select('username').eq('id', a.id).maybeSingle();
  if (!data) return;
  const local = getSettings();
  if (/^Joueur\d{5}$/.test(data.username)) {
    // Pseudo par défaut du serveur : si l'utilisateur n'a pas encore choisi, l'invite s'en chargera.
    if (!local.nameChosen) return;
    if (USERNAME_RE.test(local.name)) {
      const { error } = await supabase.from('profiles').update({ username: local.name }).eq('id', a.id);
      if (!error) return;
    }
  }
  updateSettings({ name: data.username, nameChosen: true });
}

/** Change le pseudo (serveur si connecté, sinon local). Retourne un message d'erreur ou null. */
export async function setUsername(name: string): Promise<string | null> {
  if (!USERNAME_RE.test(name)) return 'Pseudo invalide : 2 à 16 caractères, lettres, chiffres, _ ou -.';
  const a = await ensureAccount();
  const supabase = await getSupabase();
  if (a && supabase) {
    const { error } = await supabase.from('profiles').update({ username: name }).eq('id', a.id);
    if (error) return errorMessage(error);
  }
  updateSettings({ name, nameChosen: true });
  return null;
}

function redirectUrl(): string {
  return location.origin + location.pathname;
}

/** Rattache un email au compte (anonyme) actuel : Supabase envoie un email de vérification. */
export async function linkEmail(email: string): Promise<string | null> {
  const supabase = await getSupabase();
  if (!supabase || !(await ensureAccount())) return 'Connexion au serveur impossible.';
  const { data, error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectUrl() });
  if (error) return errorMessage(error);
  set(toAccount(data.user));
  return null;
}

/** Envoie un lien de connexion vers un compte existant (autre appareil, navigateur réinitialisé). */
export async function sendLoginLink(email: string): Promise<string | null> {
  const supabase = await getSupabase();
  if (!supabase) return 'Connexion au serveur impossible.';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectUrl() },
  });
  // Même réponse que l'email ait un compte ou non : on ne révèle pas qui est inscrit.
  if (error && /signups not allowed|not found/i.test(error.message)) return null;
  return error ? errorMessage(error) : null;
}

/** Recharge l'état du compte depuis le serveur (après avoir cliqué le lien sur un autre appareil). */
export async function refreshAccount(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { data } = await supabase.auth.refreshSession();
  if (data.user) set(toAccount(data.user));
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  session = null;
  updateSettings({ nameChosen: false });
  await ensureAccount();
}

/** Le lien reçu par email ramène ici avec les jetons dans le hash : on laisse Supabase les lire. */
export async function consumeAuthRedirect(): Promise<void> {
  const h = location.hash;
  if (!/access_token=|error_description=/.test(h)) return;
  const supabase = await getSupabase();
  if (supabase) {
    await supabase.auth.getSession(); // déclenche la lecture du hash
  }
  history.replaceState(null, '', location.pathname + location.search + (/error_description=/.test(h) ? '#/account?erreur' : '#/account'));
}
