// Copie les moteurs de jeu dans les fonctions serveur qui les utilisent, pour que le serveur valide
// avec exactement le même code que le site :
//   src/games/towerdefense/engine → supabase/functions/td/engine     (rejeu des vagues)
//   src/games/four/engine         → supabase/functions/board4/engine (jeux à 4 joueurs)
// Lancé automatiquement par `npm run build` ; à relancer avant un déploiement à la main.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const PAIRS = [
  ['../src/games/towerdefense/engine/', '../supabase/functions/td/engine/', 'src/games/towerdefense/engine'],
  ['../src/games/four/engine/', '../supabase/functions/board4/engine/', 'src/games/four/engine'],
];
const unix = (s) => s.replace(/\r\n/g, '\n');

for (const [src, dst, label] of PAIRS) {
  const from = new URL(src, import.meta.url);
  const to = new URL(dst, import.meta.url);
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (!f.endsWith('.ts')) continue;
    const header = `// Copie de ${label}/${f} (scripts/td-sync.mjs) : ne pas modifier ici.\n`;
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
}
