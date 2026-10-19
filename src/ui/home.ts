import { pushKeys } from '../core/input';
import { getSettings, keyLabel, randomName } from '../core/settings';
import { setUsername } from '../net/auth';
import { games } from '../games/registry';
import { generateCode } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { menu, type MenuItem } from './menu';

let lastIndex = 0;

export function homeView(root: HTMLElement): () => void {
  if (!getSettings().nameChosen) return namePrompt(root);

  const content = page(root, 'Accueil');
  const items: MenuItem[] = [];

  const icons: Record<string, [string, number]> = { '2048': ['2⁰', 1], tetris: ['▚', 5], connect4: ['●', 2], tictactoe: ['✕', 3], td: ['♜', 4], wordle: ['W', 1], flappy: ['➶', 4] };
  for (const g of games) {
    if (g.modes.includes('solo')) {
      const [icon, tone] = icons[g.id] ?? ['▸', 3];
      items.push({ label: g.name, detail: g.description, icon, tone, action: () => navigate(`/game/${g.id}`) });
    }
  }
  const off = multiConfigured ? undefined : 'multijoueur non configuré';
  items.push(
    { label: 'Créer un salon', icon: '+', tone: 3, detail: off ?? 'Multijoueur · code à partager', action: () => navigate(`/room/${generateCode()}`) },
    { label: 'Rejoindre un salon', icon: '→', tone: 3, detail: off ?? 'Saisir un code', action: () => navigate('/join') },
  );
  items.push({ label: 'Classements', icon: '★', tone: 4, detail: off ?? 'Tous les jeux', action: () => navigate('/scores') });
  items.push({ label: 'Réglages', icon: '⚙', tone: 5, detail: 'Pseudo, couleurs, touche panique', action: () => navigate('/settings') });

  const m = menu(items, lastIndex);
  content.append(h('h1', {}, `Salut ${getSettings().name}`), m.el, hints(['↑ ↓', 'choisir'], ['Entrée', 'ouvrir'], [keyLabel(getSettings().panicKey), 'masquer']));
  m.focus();

  const pop = pushKeys((e) => {
    m.onKey(e);
  });
  return () => {
    lastIndex = Math.max(0, [...m.el.children].indexOf(document.activeElement as Element));
    pop();
  };
}


function namePrompt(root: HTMLElement): () => void {
  const content = page(root, 'Bienvenue');
  const input = h('input', { class: 'field', maxlength: 16, value: getSettings().name, 'aria-label': 'Pseudo' });
  const form = h(
    'form',
    { class: 'card narrow' },
    h('h1', {}, 'Choisis un pseudo'),
    h('p', { class: 'muted' }, 'Il sera visible des autres joueurs dans les salons.'),
    input,
    hints(['Entrée', 'valider'], ['Tab', 'pseudo au hasard']),
  );
  const error = h('p', { class: 'muted small' });
  form.append(error);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = await setUsername(input.value.trim() || randomName());
    if (err) error.textContent = err;
    else navigate('/');
  });
  content.append(form);
  input.focus();
  input.select();
  return pushKeys((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      input.value = randomName();
      input.select();
    }
  });
}
