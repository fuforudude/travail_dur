import { pushKeys } from '../core/input';
import { getSettings, keyLabel, randomName } from '../core/settings';
import { setUsername } from '../net/auth';
import { games } from '../games/registry';
import type { Game } from '../games/types';
import { generateCode } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { spatialNav } from './menu';

/** Pastille, teinte et étiquettes de chaque jeu sur l'accueil. */
const LOOK: Record<string, { icon: string; tone: number; tags: string[] }> = {
  '2048': { icon: '2⁰', tone: 1, tags: ['Solo', 'Classé'] },
  tetris: { icon: '▚', tone: 5, tags: ['Solo', 'Classé'] },
  wordle: { icon: 'W', tone: 3, tags: ['Mot du jour', 'Classé'] },
  flappy: { icon: '➶', tone: 4, tags: ['Solo', 'Classé'] },
  td: { icon: '♜', tone: 2, tags: ['Solo', 'Classé'] },
  connect4: { icon: '●', tone: 2, tags: ['Solo', 'À deux'] },
  tictactoe: { icon: '✕', tone: 3, tags: ['Solo', 'À deux'] },
};

let lastFocus = ''; // pour revenir sur la même carte en rentrant à l'accueil

export function homeView(root: HTMLElement): () => void {
  if (!getSettings().nameChosen) return namePrompt(root);

  const content = page(root, 'Accueil');
  const off = !multiConfigured;

  const card = (id: string, title: string, sub: string, icon: string, tone: number, action: () => void, opts: { tags?: string[]; disabled?: boolean } = {}) => {
    const b = h(
      'button',
      { class: 'tile', type: 'button', 'data-id': id, disabled: opts.disabled },
      h('span', { class: `tile-icon tone${tone}`, 'aria-hidden': 'true' }, icon),
      h('span', { class: 'tile-title' }, title),
      h('span', { class: 'tile-sub' }, sub),
      opts.tags?.length ? h('span', { class: 'tile-tags' }, ...opts.tags.map((t) => h('span', { class: 'tile-tag' }, t))) : null,
    );
    b.addEventListener('click', () => {
      lastFocus = id;
      action();
    });
    return b;
  };

  const gameCard = (g: Game) => {
    const look = LOOK[g.id] ?? { icon: '▸', tone: 3, tags: [] };
    return card(g.id, g.name, g.description ?? '', look.icon, look.tone, () => navigate(`/game/${g.id}`), { tags: look.tags });
  };

  const solo = games.filter((g) => g.modes.includes('solo') && !g.modes.includes('multi'));
  const duel = games.filter((g) => g.modes.includes('multi'));

  const section = (title: string, ...cards: HTMLElement[]) =>
    h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, title), h('div', { class: 'tiles' }, ...cards));

  const wrap = h(
    'div',
    { class: 'home' },
    h(
      'div',
      { class: 'home-hello' },
      h('h1', {}, `Salut ${getSettings().name}`),
      h('p', { class: 'muted' }, 'Choisis un jeu aux flèches puis Entrée, ou clique.'),
    ),
    section('Jeux', ...solo.map(gameCard)),
    section(
      'À deux',
      ...duel.map(gameCard),
      card('room', 'Créer un salon', off ? 'Multijoueur non configuré' : 'Un code à partager', '+', 1, () => navigate(`/room/${generateCode()}`), { disabled: off }),
      card('join', 'Rejoindre un salon', off ? 'Multijoueur non configuré' : 'Avec le code d’un ami', '→', 1, () => navigate('/join'), { disabled: off }),
    ),
    section(
      'Plus',
      card('scores', 'Classements', off ? 'Serveur non configuré' : 'Tous les jeux', '★', 4, () => navigate('/scores'), { disabled: off }),
      card('settings', 'Réglages', 'Pseudo, couleurs, compte, touche panique', '⚙', 5, () => navigate('/settings')),
    ),
    hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'ouvrir'], [keyLabel(getSettings().panicKey), 'masquer l’écran']),
  );
  content.classList.add('wide');
  content.append(wrap);

  const start = wrap.querySelector<HTMLElement>(`[data-id="${lastFocus}"]:not(:disabled)`) ?? wrap.querySelector<HTMLElement>('.tile');
  start?.focus();

  const nav = spatialNav(wrap);
  return pushKeys((e) => {
    nav(e);
  });
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
