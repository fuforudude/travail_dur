// Heures de connexion (0050_annonce_connexions.sql) : un signe de vie à l'ouverture du site puis toutes les
// 5 minutes tant que l'onglet est visible. Le serveur prolonge la séance en cours, ou en commence une
// nouvelle après 15 minutes sans nouvelles. Seuls les admins lisent ces séances.

import { getSupabase } from './supabase';

const PING_MS = 5 * 60_000;

let timer: number | undefined;
let lastPing = 0;

async function ping(): Promise<void> {
  if (document.visibilityState !== 'visible' || Date.now() - lastPing < 60_000) return;
  lastPing = Date.now();
  const supabase = await getSupabase();
  await supabase?.rpc('connection_ping'); // erreur ignorée : ce n'est qu'un relevé
}

/** À lancer quand le compte est connu (une seule fois par chargement du site). */
export function startConnections(): void {
  if (timer !== undefined) return;
  void ping();
  timer = window.setInterval(() => void ping(), PING_MS);
  document.addEventListener('visibilitychange', () => void ping());
}
