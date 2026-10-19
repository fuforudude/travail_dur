import { pushKeys } from '../core/input';
import { getSettings, keyLabel, randomName, updateSettings } from '../core/settings';
import { games } from '../games/registry';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { menu, type MenuItem } from './menu';

let lastIndex = 0;

export function homeView(root: HTMLElement): () => void {
  if (!getSettings().nameChosen) return namePrompt(root);

  const content = page(root, 'Accueil');
  const items: MenuItem[] = [];

  for (const g of games) {
    if (g.modes.includes('solo')) {
      items.push({ label: g.name, detail: g.description, action: () => navigate(`/game/${g.id}`) });
    }
  }
  items.push({ label: 'Réglages', detail: 'Pseudo, thème, son, touche panique', action: () => navigate('/settings') });

  const m = menu(items, lastIndex);
  content.append(h('h1', {}, 'Accueil'), m.el, hints(['↑ ↓', 'choisir'], ['Entrée', 'ouvrir'], [keyLabel(getSettings().panicKey), 'masquer']));
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
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    updateSettings({ name: input.value.trim() || randomName(), nameChosen: true });
    navigate('/');
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
