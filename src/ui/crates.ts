import { pushKeys } from '../core/input';
import { artworks, BASES, buyFurniture, crateInfo, CRATES, finishOf, itemName, itemsOfRarity, openCrate, ownedPhotos, PHOTO_CHANCE, RARITY_NAMES, type Rarity } from '../net/apartment';
import { ensureAccount } from '../net/auth';
import { formatPoints, getWallet, onWallet, refreshWallet } from '../net/points';
import { navigate } from '../router';
import { furnitureEl } from './apartment';
import { openCrateStage } from './crateOpening';
import { h, hints } from './dom';
import { page } from './layout';
import { spatialNav } from './menu';

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
  let photos = { got: 0, total: 0 }; // caisse souvenirs : une fois toutes les photos débloquées, plus que des meubles
  const photoInfo = h('p', { class: 'small' });
  const showPhotos = () => {
    photoInfo.textContent =
      photos.got >= photos.total ? `✓ Toutes les photos débloquées (${photos.total}) : elle ne donne plus que des meubles.` : `📷 Photos : ${photos.got} / ${photos.total} débloquées`;
  };

  const showBalance = () => {
    const w = getWallet();
    balance.textContent = w ? `◆ ${formatPoints(w.balance)}` : '';
  };

  // Bandeau qui défile (façon caisse de CS:GO) : objets tirés au hasard selon les chances.
  const randomItem = (crate: string) => {
    if (crate === 'photos' && photos.got < photos.total && Math.random() < PHOTO_CHANCE) return 'photo';
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

  const open = (crate: string) => {
    if (busy) return;
    const def = CRATES.find((c) => c.id === crate);
    openCrateStage({
      title: def?.name ?? 'Caisse',
      again: () => `Rouvrir · ◆ ${formatPoints(prices.get(crate) ?? 0)}`,
      filler: () => cell(randomItem(crate)),
      draw: async () => {
        const r = await openCrate(crate);
        if (r.photo) {
          photos.got++;
          showPhotos();
        }
        const rarity = r.photo ? 'rar-photo' : `rar-${r.rarity}`;
        return {
          rarity,
          cell: cell(r.photo ? 'photo' : r.item),
          jackpot: Boolean(r.photo) || r.rarity === 'divine' || r.rarity === 'mythic' || r.rarity === 'legendary',
          chip: h('span', { class: rarity }, r.photo ? `📷 ${r.photo.title}` : itemName(r.item)),
          reveal: r.photo
            ? [
                h('span', { class: 'cr-rarity' }, 'Photo débloquée !'),
                h('img', { class: 'cr-photo', src: r.photo.url, alt: r.photo.title }),
                h('strong', {}, r.photo.title),
                h('span', { class: 'muted small' }, 'Tu peux l’accrocher dans un cadre de ton appart.'),
              ]
            : [
                h('span', { class: 'cr-rarity' }, RARITY_NAMES[r.rarity]),
                furnitureEl(r.item),
                h('strong', {}, itemName(r.item)),
                h('span', { class: 'muted small' }, 'Ajouté à tes meubles.'),
              ],
        };
      },
    });
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
    const account = await ensureAccount();
    if (!account) {
      wrap.replaceChildren(h('div', { class: 'card narrow' }, h('h1', {}, 'Connexion impossible'), h('p', { class: 'muted' }, 'Le serveur ne répond pas : réessaie dans un instant.')));
      return;
    }
    const [info, all, mine] = await Promise.all([crateInfo(), artworks(), ownedPhotos(account.id)]);
    if (disposed) return;
    ({ prices, odds } = info);
    photos = { got: all.filter((a) => mine.has(a.id)).length, total: all.length };
    showPhotos();
    const crates = CRATES.map((c) => {
      const table = odds.get(c.id) ?? [];
      const total = table.reduce((a, [, w]) => a + w, 0);
      const b = h('button', { class: 'field rl-spin', type: 'button' }, `Ouvrir · ◆ ${formatPoints(prices.get(c.id) ?? 0)}`);
      b.addEventListener('click', () => open(c.id));
      return h(
        'div',
        { class: 'card cr-crate' },
        h('h2', {}, c.name),
        h('p', { class: 'muted small' }, c.text),
        c.id === 'photos' && photos.total ? photoInfo : '',
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
      h('div', { class: 'shop-head' }, h('div', {}, h('h1', {}, 'Meubles et caisses')), h('div', { class: 'ap-actions' }, balance, toAppart)),
      status,
      h('div', { class: 'cr-crates' }, ...crates),
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
