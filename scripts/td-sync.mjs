// Copie le moteur du tower defense (src/games/towerdefense/engine) dans la fonction serveur
// supabase/functions/td/engine : le serveur rejoue les vagues avec exactement le même code.
// Lancé automatiquement par `npm run build` ; à relancer avant `supabase functions deploy td`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const from = new URL('../src/games/towerdefense/engine/', import.meta.url);
const to = new URL('../supabase/functions/td/engine/', import.meta.url);
const unix = (s) => s.replace(/\r\n/g, '\n');
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) {
  if (!f.endsWith('.ts')) continue;
  const header = `// Copie de src/games/towerdefense/engine/${f} (scripts/td-sync.mjs) : ne pas modifier ici.\n`;
  const next = unix(header + readFileSync(new URL(f, from), 'utf8'));
  let current = '';
  try {
    current = readFileSync(new URL(f, to), 'utf8');
  } catch {
    // pas encore de copie
  }
  // On ne réécrit que si le code a changé : sous Windows, réécrire un fichier identique avec
  // d'autres fins de ligne suffit à le faire apparaître comme modifié dans git.
  if (unix(current) !== next) writeFileSync(new URL(f, to), next);
}
