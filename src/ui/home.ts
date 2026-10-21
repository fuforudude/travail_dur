import { pushKeys } from '../core/input';
import { getSettings, keyLabel, randomName } from '../core/settings';
import { getBest } from '../core/storage';
import { getAccount, setUsername } from '../net/auth';
import { games, type GameInfo } from '../games/registry';
import { isAdmin } from '../net/admin';
import { formatPoints, getWallet, onWallet } from '../net/points';
import { generateCode } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { toggleDrawer } from './drawer';
import { spatialNav } from './menu';
import './home.css';

/** Pastille, teinte et étiquettes de chaque jeu sur l'accueil. */
const LOOK: Record<string, { icon: string; tone: number; tags: string[] }> = {
  '2048': { icon: '2⁰', tone: 1, tags: ['Solo', 'Classé'] },
  tetris: { icon: '▚', tone: 5, tags: ['Solo', 'Classé'] },
  wordle: { icon: 'W', tone: 3, tags: ['Mot du jour', 'Classé'] },
  flappy: { icon: '➶', tone: 4, tags: ['Solo', 'Classé'] },
  td: { icon: '♜', tone: 2, tags: ['Campagne', 'Classé'] },
  connect4: { icon: '●', tone: 2, tags: ['Solo', 'Multi'] },
  tictactoe: { icon: '✕', tone: 3, tags: ['Solo', 'Multi'] },
  chess: { icon: '♞︎', tone: 5, tags: ['Solo', 'Multi'] },
  checkers: { icon: '◉', tone: 4, tags: ['Solo', 'Multi'] },
  quoridor: { icon: '▥', tone: 3, tags: ['Solo', 'Multi'] },
  quarto: { icon: '◧', tone: 1, tags: ['Solo', 'Multi'] },
};

let lastFocus = ''; // pour revenir sur la même carte en rentrant à l'accueil

/** Record personnel affiché sur la carte d'un jeu (meilleur score enregistré sur cet appareil). */
const RECORD: Record<string, [string, (n: number) => string]> = {
  '2048': ['2048', (n) => `Record : ${formatPoints(n)}`],
  tetris: ['tetris', (n) => `Record : ${formatPoints(n)}`],
  flappy: ['flappy', (n) => `Record : ${n} tuyau${n > 1 ? 'x' : ''}`],
  td: ['td2', (n) => `Infini : vague ${n}`],
};

export function homeView(root: HTMLElement): () => void {
  if (!getSettings().nameChosen) return namePrompt(root);

  const content = page(root, 'Accueil');
  const off = !multiConfigured;

  // Résumé : solde (en direct), revenus de l'appart, progression du tower defense.
  const balanceChip = h('span', { class: 'home-stat' });
  const appartChip = h('span', { class: 'home-stat', hidden: true });
  const tdChip = h('span', { class: 'home-stat', hidden: true });
  const summary = h('div', { class: 'home-stats', hidden: off }, balanceChip, appartChip, tdChip);
  const showBalance = () => {
    const w = getWallet();
    balanceChip.replaceChildren('◆ ', h('b', {}, w ? formatPoints(w.balance) : '…'), ' points');
  };
  showBalance();
  const offWallet = onWallet(showBalance);
  const account = getAccount();
  if (!off && account) {
    void import('../net/apartment')
      .then(({ loadApartment }) => loadApartment(account.id))
      .then((a) => {
        if (a.rate <= 0) return;
        appartChip.replaceChildren('⌂ Appart ', h('b', {}, `+${formatPoints(Math.round(a.rate))}`), ' par heure');
        appartChip.hidden = false;
      })
      .catch(() => {});
    void import('../games/towerdefense/net')
      .then(({ loadMeta }) => loadMeta())
      .then((m) => {
        if (!m.cleared && !m.best) return;
        let stars = 0;
        for (const n of m.stars.values()) stars += n;
        tdChip.replaceChildren('♜ Campagne ', h('b', {}, `${m.cleared}/20`), stars ? ` · ★ ${stars}` : '', m.best ? ` · infini vague ${m.best}` : '');
        tdChip.hidden = false;
      })
      .catch(() => {});
  }

  const card = (id: string, title: string, sub: string, icon: string, tone: number, action: () => void, opts: { tags?: string[]; disabled?: boolean; record?: string } = {}) => {
    const b = h(
      'button',
      { class: 'tile', type: 'button', 'data-id': id, disabled: opts.disabled },
      h('span', { class: `tile-icon tone${tone}`, 'aria-hidden': 'true' }, icon),
      h('span', { class: 'tile-title' }, title),
      sub ? h('span', { class: 'tile-sub' }, sub) : null,
      opts.record ? h('span', { class: 'tile-record' }, opts.record) : null,
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
    const rec = RECORD[g.id];
    const best = rec ? getBest(rec[0]) : 0;
    return card(g.id, g.name, '', look.icon, look.tone, () => navigate(`/game/${g.id}`), { tags: look.tags, record: best > 0 ? rec[1](best) : undefined });
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
    ),
    summary,
    section('Jeux', ...solo.map(gameCard)),
    section(
      'Multijoueur',
      ...duel.map(gameCard),
      card('room', 'Créer un salon', off ? 'Multijoueur non configuré' : '', '+', 1, () => navigate(`/room/${generateCode()}`), { disabled: off }),
      card('join', 'Rejoindre un salon', off ? 'Multijoueur non configuré' : '', '→', 1, () => navigate('/join'), { disabled: off }),
    ),
    section(
      'Points et casino',
      card('points', 'Mes points', off ? 'Serveur non configuré' : getWallet() ? `◆ ${formatPoints(getWallet()!.balance)}` : '', '◆', 4, () => navigate('/points'), { disabled: off }),
      card('roulette', 'Roulette', '', '◎', 2, () => navigate('/roulette'), { tags: ['Casino'], disabled: off }),
      card('shop', 'Boutique', '', '✦', 3, () => navigate('/shop'), { disabled: off }),
      card('slots', 'Machine à sous', '', '7', 5, () => navigate('/slots'), { tags: ['Casino'], disabled: off }),
    ),
    hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'ouvrir'], ['M', 'menu (réglages, classements, compte)'], [keyLabel(getSettings().panicKey), 'masquer l’écran']),
  );
  content.classList.add('wide');
  content.append(wrap);

  // L'appart est ouvert à tous ; l'administration, aux admins seulement.
  wrap.lastElementChild!.before(
    section(
      'Appart',
      card('appart', 'Mon appart', off ? 'Serveur non configuré' : '', '⌂', 3, () => navigate('/appart'), { disabled: off }),
      card('caisses', 'Meubles et caisses', '', '▣', 5, () => navigate('/caisses'), { tags: ['Caisses'], disabled: off }),
      card('amis', 'Amis', off ? 'Serveur non configuré' : '', '♥', 2, () => navigate('/amis'), { disabled: off }),
    ),
  );
  void isAdmin().then((admin) => {
    if (!admin || !wrap.isConnected) return;
    wrap.lastElementChild!.before(section('Admin', card('admin', 'Administration', '', '⚑', 2, () => navigate('/admin'))));
  });

  const start = wrap.querySelector<HTMLElement>(`[data-id="${lastFocus}"]:not(:disabled)`) ?? wrap.querySelector<HTMLElement>('.tile');
  start?.focus();

  const nav = spatialNav(wrap);
  const offKeys = pushKeys((e) => {
    if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      return toggleDrawer();
    }
    nav(e);
  });
  return () => {
    offKeys();
    offWallet();
  };
}

function namePrompt(root: HTMLElement): () => void {
  const content = page(root, 'Bienvenue');
  const input = h('input', { class: 'field', maxlength: 16, value: getSettings().name, 'aria-label': 'Pseudo' });
  const form = h(
    'form',
    { class: 'card narrow' },
    h('h1', {}, 'Choisis un pseudo'),
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
