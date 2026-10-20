// Copie le moteur du tower defense (src/games/towerdefense/engine) dans la fonction serveur
// supabase/functions/td/engine : le serveur rejoue les vagues avec exactement le même code.
// Lancé automatiquement par `npm run build` ; à relancer avant `supabase functions deploy td`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const from = new URL('../src/games/towerdefense/engine/', import.meta.url);
const to = new URL('../supabase/functions/td/engine/', import.meta.url);
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) {
  if (!f.endsWith('.ts')) continue;
  const header = `// Copie de src/games/towerdefense/engine/${f} (scripts/td-sync.mjs) : ne pas modifier ici.\n`;
  writeFileSync(new URL(f, to), header + readFileSync(new URL(f, from), 'utf8'));
}
