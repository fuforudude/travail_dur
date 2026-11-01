// Heures de connexion (0050_annonce_connexions.sql) : un signe de vie à l'ouverture du site puis toutes les
// 5 minutes tant que l'onglet est visible. Le serveur prolonge la séance en cours, ou en commence une
// nouvelle après 15 minutes sans nouvelles. Seuls les admins lisent ces séances.

import { getSupabase } from './supabase';

const PING_MS = 5 * 60_000;

let timer: number | undefined;
let lastPing = 0;
let account = '';

async function ping(): Promise<void> {
  if (document.visibilityState !== 'visible' || Date.now() - lastPing < 60_000) return;
  lastPing = Date.now();
  const supabase = await getSupabase();
  await supabase?.rpc('connection_ping'); // erreur ignorée : ce n'est qu'un relevé
}

/** À lancer quand le compte est connu, et à chaque changement de compte (invité qui se connecte). */
export function startConnections(accountId: string): void {
  if (accountId !== account) {
    account = accountId;
    lastPing = 0; // le nouveau compte a son signe de vie tout de suite
    void ping();
  }
  if (timer !== undefined) return;
  timer = window.setInterval(() => void ping(), PING_MS);
  document.addEventListener('visibilitychange', () => void ping());
}
