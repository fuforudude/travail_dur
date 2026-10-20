import { pushKeys } from '../../core/input';
import { blip } from '../../core/sound';
import { formatPoints, getWallet, holdWallet, onWallet, refreshWallet } from '../../net/points';
import { multiConfigured } from '../../net/supabase';
import { navigate } from '../../router';
import { h, hints } from '../../ui/dom';
import { page } from '../../ui/layout';
import { spatialNav } from '../../ui/menu';
import { CRATES, ENEMY_FINISHES, heroOf, itemName, RARITY_NAMES, skinOf, TOWER_FINISHES, type CrateDef, type Rarity } from './catalog';
import { ENEMIES, HERO_MAX_LEVEL, HEROES, TOWERS } from './engine/data';
import { crateInfo, equipSkin, loadMeta, openCrate, type CrateInfo, type Meta } from './net';
import { previewItem } from './render';
import './td.css';

const REEL_LENGTH = 48;
const WIN_INDEX = 42; // case qui s'arrête sous le repère
const TIER_CLASS: Record<string, string> = { heroes: 'rar-gold' };

/** `#/td/caisses` : caisses du tower defense (héros, skins) et collection. */
export function tdCratesView(root: HTMLElement): () => void {
  const content = page(root, 'Caisses tower defense');
  content.classList.add('wide');
  const wrap = h('div', { class: 'crates td-crates' }, h('p', { class: 'muted' }, 'Chargement…'));
  content.append(wrap, hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'ouvrir / porter'], ['Retour arrière', 'boutique']));
  const balance = h('span', { class: 'pts-balance' });
  const status = h('p', { class: 'status' });
  const reelTrack = h('div', { class: 'cr-track' });
  const reel = h('div', { class: 'cr-reel', hidden: true }, h('div', { class: 'cr-marker' }), reelTrack);
  const reveal = h('div', { class: 'cr-reveal', hidden: true });
  const cratesEl = h('div', { class: 'cr-crates' });
  const collection = h('div', {});
  let meta: Meta = { owned: new Set(), equipped: new Map(), heroes: new Map(), cleared: 0, best: 0, online: false };
  let info = new Map<string, CrateInfo>();
  let busy = false;
  let disposed = false;

  const showBalance = () => {
    const w = getWallet();
    balance.textContent = w ? `◆ ${formatPoints(w.balance)}` : '';
  };
  const heroLevel = (id: string) => meta.heroes.get(heroOf(id)?.id ?? '') ?? 0;
  const has = (id: string) => (heroOf(id) ? heroLevel(id) > 0 : meta.owned.has(id));
  const rarityClass = (crate: CrateDef, item: string) => {
    const skin = skinOf(item);
    return skin ? `rar-${skin.finish.rarity}` : TIER_CLASS[crate.id] ?? '';
  };

  /** Objet tiré au hasard pour le bandeau (selon les chances affichées). */
  const randomItem = (crate: CrateDef) => {
    const odds = info.get(crate.id)?.odds ?? [];
    if (crate.kind === 'skin' && odds.length) {
      let r = Math.random() * odds.reduce((a, [, w]) => a + w, 0);
      let rarity: Rarity = odds[0][0];
      for (const [rar, w] of odds) {
        r -= w;
        if (r < 0) {
          rarity = rar;
          break;
        }
      }
      const pool = crate.contents.filter((id) => skinOf(id)?.finish.rarity === rarity);
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return crate.contents[Math.floor(Math.random() * crate.contents.length)];
  };

  const cell = (crate: CrateDef, item: string) => h('div', { class: `cr-cell ${rarityClass(crate, item)}` }, previewItem(item, 52), h('span', {}, itemName(item)));

  const open = async (crate: CrateDef) => {
    if (busy) return;
    busy = true;
    reveal.hidden = true;
    const release = holdWallet();
    status.textContent = 'Ouverture…';
    try {
      const r = await openCrate(crate.id);
      const hero = heroOf(r.item);
      if (hero) meta.heroes.set(hero.id, r.level ?? heroLevel(r.item) + 1);
      else meta.owned.add(r.item);
      const skin = skinOf(r.item);
      if (skin && !meta.equipped.has(skin.slot)) meta.equipped.set(skin.slot, r.item);
      const items = Array.from({ length: REEL_LENGTH }, (_, i) => (i === WIN_INDEX ? r.item : randomItem(crate)));
      reelTrack.replaceChildren(...items.map((it) => cell(crate, it)));
      reel.hidden = false;
      reel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      reelTrack.style.transition = 'none';
      reelTrack.style.transform = 'translateX(0)';
      void reelTrack.offsetWidth;
      const cellWidth = (reelTrack.firstElementChild as HTMLElement).offsetWidth + 6;
      const jitter = (Math.random() - 0.5) * cellWidth * 0.7;
      const target = WIN_INDEX * cellWidth + cellWidth / 2 - reel.clientWidth / 2 + jitter;
      reelTrack.style.transition = 'transform 5.5s cubic-bezier(0.08, 0.6, 0.12, 1)';
      reelTrack.style.transform = `translateX(${-target}px)`;
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
      reveal.className = `cr-reveal ${rarityClass(crate, r.item)}`;
      reveal.replaceChildren(
        h('span', { class: 'cr-rarity' }, skin ? RARITY_NAMES[skin.finish.rarity] : hero && heroLevel(r.item) > 1 ? `Niveau ${heroLevel(r.item)} !` : 'Nouveau héros !'),
        previewItem(r.item, 96),
        h('strong', {}, hero ? `${hero.name}, ${hero.title}` : itemName(r.item)),
        h(
          'span',
          { class: 'muted small' },
          skin
            ? meta.equipped.get(skin.slot) === r.item ? 'Ajouté à ta collection et porté.' : 'Ajouté à ta collection.'
            : hero ? `${hero.text(heroLevel(r.item))}. À choisir avant une partie.` : '',
        ),
      );
      blip(skin && (skin.finish.rarity === 'mythic' || skin.finish.rarity === 'legendary') ? 1320 : 660);
      void refreshWallet();
      status.textContent = '';
      render();
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      release();
      busy = false;
    }
  };

  const equip = async (slot: string, item: string | null) => {
    if (busy) return;
    busy = true;
    try {
      await equipSkin(slot, item);
      if (item) meta.equipped.set(slot, item);
      else meta.equipped.delete(slot);
      status.textContent = item ? `${itemName(item)} porté.` : 'Skin retiré.';
      render();
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

  const crateCard = (c: CrateDef) => {
    const ci = info.get(c.id);
    const got = c.contents.filter(has).length;
    const complete = c.kind === 'hero' ? c.contents.every((id) => heroLevel(id) >= HERO_MAX_LEVEL) : got === c.contents.length;
    const locked = (ci?.minWave ?? 0) > meta.best;
    const label = complete ? 'Complète' : locked ? `🔒 Vague ${ci?.minWave} à atteindre` : `Ouvrir · ◆ ${formatPoints(ci?.price ?? 0)}`;
    const b = h('button', { class: 'field rl-spin', type: 'button', disabled: complete || locked || !ci, 'data-id': c.id }, label);
    b.addEventListener('click', () => void open(c));
    const total = ci?.odds.reduce((a, [, w]) => a + w, 0) ?? 0;
    return h(
      'div',
      { class: `card cr-crate td-crate ${TIER_CLASS[c.id] ?? ''}` },
      h('h2', {}, c.name),
      h('p', { class: 'muted small' }, c.text),
      h('p', { class: 'small' }, `${got} / ${c.contents.length} obtenus`),
      c.kind === 'skin' && total
        ? h('ul', { class: 'cr-odds' }, ...ci!.odds.map(([r, w]) => h('li', { class: `rar-${r}` }, h('span', {}, RARITY_NAMES[r]), h('b', {}, percent(w, total)))))
        : h('p', { class: 'muted small' }, 'Chaque héros a les mêmes chances. Un doublon fait monter le héros d’un niveau.'),
      b,
    );
  };

  const skinRow = (target: 'ts' | 'es', subject: string, name: string) => {
    const slot = `${target}:${subject}`;
    const finishes = target === 'ts' ? TOWER_FINISHES : ENEMY_FINISHES;
    const owned = finishes.filter((f) => meta.owned.has(`${slot}:${f.id}`));
    const current = meta.equipped.get(slot) ?? null;
    const btn = (item: string | null, label: string, rarity: string) => {
      const b = h(
        'button',
        { class: `shop-item td-skin ${rarity}${current === item ? ' on' : ''}`, type: 'button', 'data-id': `${slot}:${item ?? 'default'}` },
        h('span', { class: 'shop-preview' }, previewItem(item ?? subject, 40)),
        h('span', { class: 'small' }, label),
      );
      b.addEventListener('click', () => void equip(slot, item));
      return b;
    };
    return h(
      'div',
      { class: 'td-skin-row' },
      h('span', { class: 'td-skin-name' }, name, h('span', { class: 'muted small' }, ` ${owned.length}/${finishes.length}`)),
      h('div', { class: 'td-skin-list' }, btn(null, 'Normal', ''), ...owned.map((f) => btn(`${slot}:${f.id}`, f.name, `rar-${f.rarity}`))),
    );
  };

  const render = () => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset.id;
    cratesEl.replaceChildren(...CRATES.map(crateCard));
    const heroes = HEROES.map((hr) => {
      const lvl = meta.heroes.get(hr.id) ?? 0;
      return h(
        'div',
        { class: `shop-item td-card${lvl ? '' : ' locked'}` },
        h('span', { class: 'shop-preview' }, previewItem(`hero:${hr.id}`, 44)),
        h('span', { class: 'shop-name' }, hr.name),
        h('span', { class: 'small muted' }, hr.title),
        h('span', { class: 'small' }, lvl ? `Niveau ${lvl}/${HERO_MAX_LEVEL} · ${hr.text(lvl)}` : `🔒 ${hr.text(1)} au niveau 1`),
      );
    });
    const enemyRows = ENEMIES.filter((e) => ENEMY_FINISHES.some((f) => meta.owned.has(`es:${e.id}:${f.id}`))).map((e) => skinRow('es', e.id, e.name));
    collection.replaceChildren(
      h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, 'Héros'), h('div', { class: 'shop-grid td-deck-grid' }, ...heroes)),
      h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, 'Skins de tours'), ...TOWERS.map((t) => skinRow('ts', t.id, t.name))),
      h(
        'section',
        { class: 'home-section' },
        h('h2', { class: 'home-h' }, 'Skins d’ennemis'),
        ...(enemyRows.length ? enemyRows : [h('p', { class: 'muted small' }, 'Aucun pour l’instant : ouvre une caisse de skins d’ennemis.')]),
      ),
    );
    showBalance();
    if (focused) wrap.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
  };

  (async () => {
    if (!multiConfigured) throw new Error('Le serveur n’est pas configuré : pas de caisses.');
    const [m, ci] = await Promise.all([loadMeta(), crateInfo()]);
    if (disposed) return;
    meta = m;
    info = ci;
    const play = h('button', { class: 'field', type: 'button' }, 'Jouer');
    play.addEventListener('click', () => navigate('/game/td'));
    wrap.replaceChildren(
      h(
        'div',
        { class: 'shop-head' },
        h('div', {}, h('h1', {}, 'Tower defense'), h('p', { class: 'muted small' }, `Campagne : ${meta.cleared}/20 niveaux · record du mode infini : vague ${meta.best}. Les tours et leurs améliorations se débloquent dans la campagne.`)),
        h('div', { class: 'ap-actions' }, balance, play),
      ),
      status,
      cratesEl,
      reel,
      reveal,
      collection,
    );
    render();
    wrap.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  })().catch((e: Error) => !disposed && wrap.replaceChildren(h('p', { class: 'notice' }, e.message)));

  const offWallet = onWallet(showBalance);
  const nav = spatialNav(wrap);
  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      return navigate('/shop');
    }
    nav(e);
  });
  return () => {
    disposed = true;
    offWallet();
    offKeys();
  };
}
