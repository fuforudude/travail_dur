import { pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { BASES, buyFurniture, crateInfo, CRATES, finishOf, itemName, itemsOfRarity, openCrate, PHOTO_CHANCE, RARITY_NAMES, type Rarity } from '../net/apartment';
import { ensureAccount } from '../net/auth';
import { formatPoints, getWallet, holdWallet, onWallet, refreshWallet } from '../net/points';
import { navigate } from '../router';
import { furnitureEl } from './apartment';
import { h, hints } from './dom';
import { page } from './layout';
import { spatialNav } from './menu';

const REEL_LENGTH = 48;
const WIN_INDEX = 42; // case qui s'arrête sous le repère

/** `#/caisses` : meubles de base à acheter, et caisses à ouvrir (finitions rares). Admins seulement pour l'instant. */
export function cratesView(root: HTMLElement): () => void {
  const content = page(root, 'Meubles et caisses');
  content.classList.add('wide');
  const wrap = h('div', { class: 'crates' }, h('p', { class: 'muted' }, 'Chargement…'));
  const balance = h('span', { class: 'pts-balance' });
  const status = h('p', { class: 'status' });
  content.append(wrap, hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'acheter / ouvrir'], ['Retour arrière', 'appart']));
  let disposed = false;
  let busy = false;
  let prices = new Map<string, number>();
  let odds = new Map<string, [Rarity, number][]>();

  const showBalance = () => {
    const w = getWallet();
    balance.textContent = w ? `◆ ${formatPoints(w.balance)}` : '';
  };

  // Bandeau qui défile (façon caisse de CS:GO) : objets tirés au hasard selon les chances, le gain à WIN_INDEX.
  const reelTrack = h('div', { class: 'cr-track' });
  const reel = h('div', { class: 'cr-reel', hidden: true }, h('div', { class: 'cr-marker' }), reelTrack);
  const reveal = h('div', { class: 'cr-reveal', hidden: true });

  const randomItem = (crate: string) => {
    if (crate === 'photos' && Math.random() < PHOTO_CHANCE) return 'photo';
    const table = odds.get(crate) ?? [];
    const total = table.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [rarity, w] of table) {
      r -= w;
      if (r < 0) {
        const items = itemsOfRarity(rarity);
        return items[Math.floor(Math.random() * items.length)];
      }
    }
    return itemsOfRarity('common')[0];
  };

  const cell = (item: string) =>
    item === 'photo'
      ? h('div', { class: 'cr-cell rar-photo' }, h('span', { class: 'cr-photo-icon' }, '📷'), h('span', {}, 'Photo'))
      : h('div', { class: `cr-cell rar-${finishOf(item).rarity}` }, furnitureEl(item), h('span', {}, itemName(item)));

  const open = async (crate: string) => {
    if (busy) return;
    busy = true;
    reveal.hidden = true;
    const release = holdWallet();
    status.textContent = 'Ouverture…';
    try {
      const r = await openCrate(crate);
      const items = Array.from({ length: REEL_LENGTH }, (_, i) => (i === WIN_INDEX ? (r.photo ? 'photo' : r.item) : randomItem(crate)));
      reelTrack.replaceChildren(...items.map(cell));
      reel.hidden = false;
      reelTrack.style.transition = 'none';
      reelTrack.style.transform = 'translateX(0)';
      void reelTrack.offsetWidth; // repart de zéro
      const cellWidth = (reelTrack.firstElementChild as HTMLElement).offsetWidth + 6;
      const jitter = (Math.random() - 0.5) * cellWidth * 0.7; // ne s'arrête pas toujours pile au milieu
      const target = WIN_INDEX * cellWidth + cellWidth / 2 - reel.clientWidth / 2 + jitter;
      reelTrack.style.transition = 'transform 5.5s cubic-bezier(0.08, 0.6, 0.12, 1)';
      reelTrack.style.transform = `translateX(${-target}px)`;
      // Petit « tic » à chaque case qui passe sous le repère.
      let last = -1;
      const tick = window.setInterval(() => {
        const x = -new DOMMatrix(getComputedStyle(reelTrack).transform).m41 + reel.clientWidth / 2;
        const i = Math.floor(x / cellWidth);
        if (i !== last) {
          last = i;
          blip(900);
        }
      }, 30);
      await new Promise((ok) => setTimeout(ok, 5700));
      clearInterval(tick);
      if (disposed) return;
      reveal.hidden = false;
      reveal.className = `cr-reveal rar-${r.rarity}`;
      if (r.photo) {
        reveal.replaceChildren(
          h('span', { class: 'cr-rarity' }, 'Photo débloquée !'),
          h('img', { class: 'cr-photo', src: r.photo.url, alt: r.photo.title }),
          h('strong', {}, r.photo.title),
          h('span', { class: 'muted small' }, 'Tu peux l’accrocher dans un cadre de ton appart.'),
        );
        blip(1320);
      } else {
        reveal.replaceChildren(
          h('span', { class: 'cr-rarity' }, RARITY_NAMES[r.rarity]),
          furnitureEl(r.item),
          h('strong', {}, itemName(r.item)),
          h('span', { class: 'muted small' }, 'Ajouté à tes meubles.'),
        );
        blip(r.rarity === 'mythic' || r.rarity === 'legendary' ? 1320 : 660);
      }
      void refreshWallet();
      status.textContent = '';
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      release();
      busy = false;
    }
  };

  const buy = async (base: string) => {
    if (busy) return;
    busy = true;
    try {
      const r = await buyFurniture(base);
      status.textContent = `${itemName(r.item)} acheté : il t’attend dans ton appart.`;
      void refreshWallet();
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      busy = false;
    }
  };

  const percent = (w: number, total: number) => {
    const p = (w / total) * 100;
    return `${p < 1 ? p.toFixed(1) : Math.round(p)} %`;
  };

  (async () => {
    if (!(await ensureAccount())) {
      wrap.replaceChildren(h('div', { class: 'card narrow' }, h('h1', {}, 'Connexion impossible'), h('p', { class: 'muted' }, 'Le serveur ne répond pas : réessaie dans un instant.')));
      return;
    }
    ({ prices, odds } = await crateInfo());
    if (disposed) return;
    const crates = CRATES.map((c) => {
      const table = odds.get(c.id) ?? [];
      const total = table.reduce((a, [, w]) => a + w, 0);
      const b = h('button', { class: 'field rl-spin', type: 'button' }, `Ouvrir · ◆ ${formatPoints(prices.get(c.id) ?? 0)}`);
      b.addEventListener('click', () => void open(c.id));
      return h(
        'div',
        { class: 'card cr-crate' },
        h('h2', {}, c.name),
        h('p', { class: 'muted small' }, c.text),
        h('ul', { class: 'cr-odds' }, ...table.map(([r, w]) => h('li', { class: `rar-${r}` }, h('span', {}, RARITY_NAMES[r]), h('b', {}, percent(w, total))))),
        b,
      );
    });
    const shop = BASES.map((base) => {
      const b = h(
        'button',
        { class: 'shop-item', type: 'button' },
        h('span', { class: 'shop-preview' }, furnitureEl(`${base.id}:standard`)),
        h('span', { class: 'shop-name' }, base.name),
        h('span', { class: 'shop-price' }, `◆ ${formatPoints(base.price)}`),
        h('span', { class: 'muted small' }, base.place === 'wall' ? (base.w > 1 ? `mur, ${base.w} emplacements` : 'mur') : `${base.w} × ${base.h}`),
      );
      b.addEventListener('click', () => void buy(base.id));
      return b;
    });
    const toAppart = h('button', { class: 'field', type: 'button' }, 'Mon appart');
    toAppart.addEventListener('click', () => navigate('/appart'));
    wrap.replaceChildren(
      h('div', { class: 'shop-head' }, h('div', {}, h('h1', {}, 'Meubles et caisses'), h('p', { class: 'muted small' }, 'Les finitions rares ne s’obtiennent que dans les caisses.')), h('div', { class: 'ap-actions' }, balance, toAppart)),
      status,
      h('div', { class: 'cr-crates' }, ...crates),
      reel,
      reveal,
      h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, 'Meubles standard'), h('div', { class: 'shop-grid' }, ...shop)),
    );
    showBalance();
  })().catch((e: Error) => !disposed && wrap.replaceChildren(h('p', { class: 'notice' }, e.message)));

  const offWallet = onWallet(showBalance);
  const nav = spatialNav(wrap);
  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      return navigate('/appart');
    }
    nav(e);
  });
  return () => {
    disposed = true;
    offWallet();
    offKeys();
  };
}
