import { pushKeys } from '../core/input';
import { getSettings } from '../core/settings';
import { ensureAccount } from '../net/auth';
import { cosmeticOf, invalidate, onCosmetics, type Cosmetic } from '../net/cosmetics';
import { formatPoints, getWallet, onWallet, refreshWallet } from '../net/points';
import { buy, equip, ITEMS, loadShop, SKIN_GAMES, TITLES, type Item, type Slot } from '../net/shop';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { spatialNav } from './menu';

/** Objet porté dans un emplacement, d'après l'apparence enregistrée. */
function equipped(c: Cosmetic, slot: Slot): string | null {
  if (slot === 'name_color') return c.name_color;
  if (slot === 'name_effect') return c.name_effect;
  if (slot === 'title') return c.title;
  return c.skins[slot.slice(5) as keyof Cosmetic['skins']] ?? null;
}

/** Aperçu d'un objet : le pseudo du joueur ainsi décoré, ou une pièce du jeu avec le skin. */
function preview(item: Item, name: string): HTMLElement {
  if (item.slot === 'name_color' || item.slot === 'name_effect' || item.slot === 'title') {
    const el = h('span', { class: `pseudo ${item.slot === 'title' ? '' : item.id}` }, h('span', { class: 'pseudo-text', 'data-text': name }, name));
    if (item.slot === 'title') el.append(h('span', { class: 'title-tag' }, item.name));
    return h('span', { class: 'shop-preview' }, el);
  }
  const box = h('span', { class: 'shop-preview skin' });
  const vars = { ...item.vars?.(1), ...item.vars?.(2) };
  for (const [k, v] of Object.entries(vars)) box.style.setProperty(k, v);
  const game = item.slot.slice(5);
  if (game === 'connect4') box.append(h('span', { class: 'disc p1 big' }), h('span', { class: 'disc p2 big' }));
  else if (game === 'tictactoe') box.append(h('span', { class: 'mark p1 big' }, item.glyph ?? '✕'));
  else if (game === 'chess') box.append(h('span', { class: 'ch-mark ch-w big' }, '♞︎'), h('span', { class: 'ch-mark ch-b big' }, '♞︎'));
  else if (game === 'checkers') box.append(h('span', { class: 'dm-mark p1 big' }), h('span', { class: 'dm-mark p2 big' }));
  else if (game === 'quoridor') box.append(h('span', { class: 'qd-mark p1 big' }));
  return box;
}

/** `#/shop` : la boutique. Le prix, la possession et l'équipement viennent du serveur. */
export function shopView(root: HTMLElement): () => void {
  const content = page(root, 'Boutique');
  content.classList.add('wide');
  const body = h('div', { class: 'shop' }, h('p', { class: 'muted' }, 'Chargement…'));
  const balance = h('span', { class: 'pts-balance' });
  const notice = h('p', { class: 'status' });
  content.append(
    h('div', { class: 'shop-head' }, h('div', {}, h('h1', {}, 'Boutique'), h('p', { class: 'muted small' }, 'Les skins se voient par ton adversaire, les pseudos par tout le monde.')), balance),
    notice,
    body,
    hints(['← ↑ → ↓', 'objet'], ['Entrée', 'acheter / porter'], ['Retour arrière', 'retour']),
  );

  let prices = new Map<string, number>();
  let owned = new Set<string>();
  let confirming: string | null = null;
  let busy = false;
  let me: string | null = null;
  let focusId: string | null = null;

  const showBalance = () => {
    const w = getWallet();
    balance.textContent = w ? `◆ ${formatPoints(w.balance)}` : '';
  };

  const act = async (item: Item, price: number) => {
    if (busy || !me) return;
    const mine = cosmeticOf(me);
    const on = equipped(mine, item.slot) === item.id;
    focusId = item.id;
    busy = true;
    try {
      if (!owned.has(item.id)) {
        if (confirming !== item.id) {
          confirming = item.id;
          notice.textContent = `${item.name} : ${formatPoints(price)} points. Entrée à nouveau pour confirmer l’achat.`;
          return;
        }
        await buy(item.id);
        owned.add(item.id);
        await equip(item.slot, item.id);
        notice.textContent = `${item.name} acheté et porté.`;
        void refreshWallet();
      } else {
        await equip(item.slot, on ? null : item.id);
        notice.textContent = on ? `${item.name} retiré.` : `${item.name} porté.`;
      }
      confirming = null;
      invalidate(me);
    } catch (e) {
      notice.textContent = (e as Error).message;
      confirming = null;
    } finally {
      busy = false;
      render();
    }
  };

  const card = (item: Item) => {
    const price = prices.get(item.id);
    if (price === undefined) return null; // pas (ou plus) en vente
    const mine = me ? cosmeticOf(me) : cosmeticOf(null);
    const has = owned.has(item.id);
    const on = equipped(mine, item.slot) === item.id;
    const affordable = (getWallet()?.balance ?? 0) >= price;
    const state = on ? 'Porté · retirer' : has ? 'Porter' : confirming === item.id ? 'Confirmer ?' : `◆ ${formatPoints(price)}`;
    const b = h(
      'button',
      { class: 'shop-item' + (on ? ' on' : '') + (has ? ' owned' : '') + (!has && !affordable ? ' poor' : ''), type: 'button', 'data-id': item.id },
      preview(item, getSettings().name),
      h('span', { class: 'shop-name' }, item.name),
      h('span', { class: 'shop-price' }, state),
    );
    b.addEventListener('click', () => void act(item, price));
    return b;
  };

  const section = (title: string, items: Item[]) => {
    const cards = items.map(card).filter((c): c is HTMLButtonElement => c !== null);
    return cards.length ? h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, title), h('div', { class: 'shop-grid' }, ...cards)) : null;
  };

  /** Lien vers les caisses du tower defense (tours, améliorations, skins). */
  const tdCrates = () => {
    const b = h(
      'button',
      { class: 'shop-item', type: 'button', 'data-id': 'td-crates' },
      h('span', { class: 'shop-preview' }, '♜'),
      h('span', { class: 'shop-name' }, 'Caisses tower defense'),
      h('span', { class: 'muted small' }, 'Tours, améliorations, skins de tours et d’ennemis'),
      h('span', { class: 'shop-price' }, 'Voir les caisses'),
    );
    b.addEventListener('click', () => navigate('/td/caisses'));
    return h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, 'Caisses'), h('div', { class: 'shop-grid' }, b));
  };

  const render = () => {
    showBalance();
    body.replaceChildren(
      ...[
        tdCrates(),
        section('Couleur du pseudo', ITEMS.filter((i) => i.slot === 'name_color')),
        section('Effet du pseudo', ITEMS.filter((i) => i.slot === 'name_effect')),
        // Titres : rien ne s'affiche tant que la liste TITLES (src/net/shop.ts) est vide
        // et qu'aucun titre n'est en vente côté serveur.
        section('Titres', TITLES),
        ...SKIN_GAMES.map(([game, label]) => section(`Skin · ${label}`, ITEMS.filter((i) => i.slot === `skin:${game}`))),
      ].filter((x): x is HTMLElement => x !== null),
    );
    const target = focusId ? body.querySelector<HTMLElement>(`[data-id="${focusId}"]`) : null;
    target?.focus();
  };

  if (!multiConfigured) {
    body.replaceChildren(h('p', { class: 'notice' }, 'Le serveur n’est pas configuré : pas de boutique.'));
  } else {
    ensureAccount()
      .then((a) => {
        if (!a) throw new Error('Connexion au serveur impossible.');
        me = a.id;
        return loadShop();
      })
      .then(
      (r) => {
        prices = r.prices;
        owned = r.owned;
        render();
        body.querySelector<HTMLElement>('.shop-item')?.focus();
      },
      (e: Error) => body.replaceChildren(h('p', { class: 'notice' }, e.message)),
    );
  }

  const offWallet = onWallet(() => (prices.size ? render() : showBalance()));
  const offCosmetics = onCosmetics(() => prices.size && render());
  const nav = spatialNav(body);
  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      return navigate('/points');
    }
    if (nav(e)) {
      confirming = null;
      focusId = (document.activeElement as HTMLElement | null)?.dataset.id ?? focusId;
    }
  });
  showBalance();
  return () => {
    offWallet();
    offCosmetics();
    offKeys();
  };
}
