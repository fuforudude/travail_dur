import { pushKeys } from '../core/input';
import { getSettings, keyLabel, randomName } from '../core/settings';
import { setUsername } from '../net/auth';
import { games, type GameInfo } from '../games/registry';
import { isAdmin } from '../net/admin';
import { formatPoints, getWallet } from '../net/points';
import { generateCode } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { toggleDrawer } from './drawer';
import { spatialNav } from './menu';

/** Pastille, teinte et étiquettes de chaque jeu sur l'accueil. */
const LOOK: Record<string, { icon: string; tone: number; tags: string[] }> = {
  '2048': { icon: '2⁰', tone: 1, tags: ['Solo', 'Classé'] },
  tetris: { icon: '▚', tone: 5, tags: ['Solo', 'Classé'] },
  wordle: { icon: 'W', tone: 3, tags: ['Mot du jour', 'Classé'] },
  flappy: { icon: '➶', tone: 4, tags: ['Solo', 'Classé'] },
  td: { icon: '♜', tone: 2, tags: ['Solo', 'Classé'] },
  connect4: { icon: '●', tone: 2, tags: ['Solo', 'Multi'] },
  tictactoe: { icon: '✕', tone: 3, tags: ['Solo', 'Multi'] },
  chess: { icon: '♞︎', tone: 5, tags: ['Solo', 'Multi'] },
  checkers: { icon: '◉', tone: 4, tags: ['Solo', 'Multi'] },
  quoridor: { icon: '▥', tone: 3, tags: ['Solo', 'Multi'] },
  quarto: { icon: '◧', tone: 1, tags: ['Solo', 'Multi'] },
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

  const gameCard = (g: GameInfo) => {
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
      h('p', { class: 'muted' }, 'Choisis un jeu aux flèches puis Entrée, ou clique. Le menu ☰ en haut à gauche donne accès aux réglages et au compte.'),
    ),
    section('Jeux', ...solo.map(gameCard)),
    section(
      'Multijoueur',
      ...duel.map(gameCard),
      card('room', 'Créer un salon', off ? 'Multijoueur non configuré' : 'Un code à partager', '+', 1, () => navigate(`/room/${generateCode()}`), { disabled: off }),
      card('join', 'Rejoindre un salon', off ? 'Multijoueur non configuré' : 'Avec le code d’un ami', '→', 1, () => navigate('/join'), { disabled: off }),
    ),
    section(
      'Points et casino',
      card('points', 'Mes points', off ? 'Serveur non configuré' : getWallet() ? `◆ ${formatPoints(getWallet()!.balance)}` : 'Chaque partie en rapporte', '◆', 4, () => navigate('/points'), { disabled: off }),
      card('roulette', 'Roulette', 'Rouge, noir ou vert : mise tes points', '◎', 2, () => navigate('/roulette'), { tags: ['Casino'], disabled: off }),
      card('shop', 'Boutique', 'Couleurs de pseudo, effets, skins', '✦', 3, () => navigate('/shop'), { disabled: off }),
      card('slots', 'Machine à sous', 'Trois rouleaux, jusqu’à ×400', '7', 5, () => navigate('/slots'), { tags: ['Casino'], disabled: off }),
    ),
    hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'ouvrir'], ['M', 'menu (réglages, classements, compte)'], [keyLabel(getSettings().panicKey), 'masquer l’écran']),
  );
  content.classList.add('wide');
  content.append(wrap);

  // L'appart est ouvert à tous ; l'administration, aux admins seulement.
  wrap.lastElementChild!.before(
    section(
      'Appart',
      card('appart', 'Mon appart', off ? 'Serveur non configuré' : 'Meubles, cadres, revenus, et ton lien à partager', '⌂', 3, () => navigate('/appart'), { disabled: off }),
      card('caisses', 'Meubles et caisses', 'Finitions rares et photos à gagner', '▣', 5, () => navigate('/caisses'), { tags: ['Caisses'], disabled: off }),
      card('amis', 'Amis', off ? 'Serveur non configuré' : 'Ajouter des amis, voir leur appart, les inviter', '♥', 2, () => navigate('/amis'), { disabled: off }),
    ),
  );
  void isAdmin().then((admin) => {
    if (!admin || !wrap.isConnected) return;
    wrap.lastElementChild!.before(section('Admin', card('admin', 'Administration', 'Joueurs, points, malédictions, photos', '⚑', 2, () => navigate('/admin'))));
  });

  const start = wrap.querySelector<HTMLElement>(`[data-id="${lastFocus}"]:not(:disabled)`) ?? wrap.querySelector<HTMLElement>('.tile');
  start?.focus();

  const nav = spatialNav(wrap);
  return pushKeys((e) => {
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      return toggleDrawer();
    }
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
