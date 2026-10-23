// Compte suspendu par un admin (0045_suspension.sql) : le serveur refuse déjà tout à ce compte ;
// ici on recouvre le site d'un écran qui dit jusqu'à quand et pourquoi, au lieu d'erreurs partout.
// Retenu dans le navigateur : quand la session du compte suspendu tombe, le site repartirait sinon
// sur un compte invité tout neuf, comme si de rien n'était.

import { onAccount } from '../net/auth';
import { getSupabase, multiConfigured } from '../net/supabase';
import { h } from '../ui/dom';
import { load, remove, save } from './storage';

const KEY = 'suspension';
const RECHECK_MS = 2 * 60_000;

interface Stored {
  uid: string;
  until: string | null; // null : sans fin
  reason: string | null;
}

let screen: HTMLElement | null = null;
let endTimer: number | undefined;

const active = (s: Stored) => !s.until || Date.parse(s.until) > Date.now();

function show(s: Stored): void {
  const check = h('button', { class: 'field', type: 'button' }, 'Vérifier à nouveau');
  check.addEventListener('click', () => {
    remove(KEY);
    location.reload();
  });
  const card = h(
    'div',
    { class: 'card narrow' },
    h('h1', {}, 'Compte suspendu'),
    h(
      'p',
      {},
      s.until
        ? `Un admin a suspendu ton compte jusqu’au ${new Date(s.until).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })}.`
        : 'Un admin a suspendu ton compte, sans date de fin.',
    ),
    s.reason ? h('p', {}, h('b', {}, 'Raison : '), s.reason) : '',
    h('p', { class: 'muted small' }, 'Tu ne peux ni jouer, ni discuter, ni utiliser tes points pendant ce temps. Si c’est une erreur, contacte un admin.'),
    check,
  );
  if (!screen) {
    screen = h('div', { class: 'suspended', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Compte suspendu' });
    document.body.append(screen);
    document.body.classList.add('is-suspended');
  }
  screen.replaceChildren(card);
  clearTimeout(endTimer);
  // Fin de la suspension : le site repart normalement (setTimeout ne dépasse pas ~24 jours).
  if (s.until) endTimer = window.setTimeout(() => hide(true), Math.min(Date.parse(s.until) - Date.now() + 2000, 2 ** 31 - 1));
}

function hide(reload = false): void {
  remove(KEY);
  clearTimeout(endTimer);
  if (!screen) return;
  screen.remove();
  screen = null;
  document.body.classList.remove('is-suspended');
  if (reload) location.reload();
}

async function check(uid: string): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { data, error } = await supabase.rpc('account_status');
  if (error) return; // migration pas encore passée, réseau coupé : on réessaiera
  const st = data as { suspended: boolean; until?: string | null; reason?: string | null };
  if (st.suspended) {
    const s = { uid, until: st.until ?? null, reason: st.reason ?? null };
    save(KEY, s);
    show(s);
  } else if (load<Stored | null>(KEY, null)?.uid === uid || !screen) {
    hide(Boolean(screen)); // suspension levée : on recharge pour repartir proprement
  }
}

export function initSuspension(): void {
  if (!multiConfigured) return;
  const stored = load<Stored | null>(KEY, null);
  if (stored && active(stored)) show(stored);
  else if (stored) remove(KEY);
  let current = '';
  onAccount((a) => {
    if (!a) return;
    current = a.id;
    void check(a.id);
  });
  window.setInterval(() => current && !document.hidden && void check(current), RECHECK_MS);
}
