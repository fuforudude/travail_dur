import { pushKeys } from '../../core/input';
import { formatPoints, getWallet, onWallet } from '../../net/points';
import { multiConfigured } from '../../net/supabase';
import { navigate } from '../../router';
import { h, hints } from '../../ui/dom';
import { openCrateStage } from '../../ui/crateOpening';
import { page } from '../../ui/layout';
import { spatialNav } from '../../ui/menu';
import { CRATES, ENEMY_FINISHES, heroOf, itemName, RARITY_NAMES, skinOf, TOWER_FINISHES, type CrateDef, type Rarity } from './catalog';
import { ENEMIES, HERO_MAX_LEVEL, HEROES, TOWERS } from './engine/data';
import { crateInfo, emptyMeta, equipSkin, loadMeta, openCrate, type CrateInfo, type Meta } from './net';
import { previewItem } from './render';
import './td.css';

const TIER_CLASS: Record<string, string> = { heroes: 'rar-gold' };

/** `#/td/caisses` : caisses du tower defense (héros, skins) et collection. */
export function tdCratesView(root: HTMLElement): () => void {
  const content = page(root, 'Caisses tower defense');
  content.classList.add('wide');
  const wrap = h('div', { class: 'crates td-crates' }, h('p', { class: 'muted' }, 'Chargement…'));
  content.append(wrap, hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'ouvrir / porter'], ['Retour arrière', 'boutique']));
  const balance = h('span', { class: 'pts-balance' });
  const status = h('p', { class: 'status' });
  const cratesEl = h('div', { class: 'cr-crates' });
  const collection = h('div', {});
  let meta: Meta = emptyMeta();
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

  /**
   * Contenu réel d'une caisse : celui du serveur (public.td_catalog) quand il est connu. Les boss du
   * chapitre 2 n'y sont pas : sans ce filtre, un joueur qui a tout voyait « 200 / 220 » et une caisse jamais complète.
   */
  const contents = (crate: CrateDef) => {
    const items = info.get(crate.id)?.items;
    return items?.size ? crate.contents.filter((id) => items.has(id)) : crate.contents;
  };
  /** Ce qu'on peut encore gagner : héros pas au niveau max, skins pas encore obtenus (comme public.td_crate_open). */
  const left = (crate: CrateDef) => contents(crate).filter((id) => (crate.kind === 'hero' ? heroLevel(id) < HERO_MAX_LEVEL : !meta.owned.has(id)));
  const complete = (crate: CrateDef) => !left(crate).length;
  /** Chances réelles : le serveur ne tire que parmi les raretés où il reste un skin à obtenir. */
  const liveOdds = (crate: CrateDef): [Rarity, number][] => {
    const rest = new Set(left(crate).map((id) => skinOf(id)?.finish.rarity));
    return (info.get(crate.id)?.odds ?? []).filter(([r]) => rest.has(r));
  };

  /** Objet tiré au hasard pour le bandeau, parmi ce qu'on peut encore gagner (selon les chances réelles). */
  const randomItem = (crate: CrateDef) => {
    const rest = left(crate);
    const pick = rest.length ? rest : contents(crate);
    const odds = liveOdds(crate);
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
      const pool = pick.filter((id) => skinOf(id)?.finish.rarity === rarity);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    }
    return pick[Math.floor(Math.random() * pick.length)];
  };

  const cell = (crate: CrateDef, item: string) => h('div', { class: `cr-cell ${rarityClass(crate, item)}` }, previewItem(item, 52), h('span', {}, itemName(item)));

  const open = (crate: CrateDef) => {
    if (busy) return;
    openCrateStage({
      title: crate.name,
      again: () => `Rouvrir · ◆ ${formatPoints(info.get(crate.id)?.price ?? 0)}`,
      filler: () => cell(crate, randomItem(crate)),
      onOpened: render,
      soldOut: () => (complete(crate) ? 'Caisse complète ✓' : ''),
      draw: async () => {
        const r = await openCrate(crate.id);
        const hero = heroOf(r.item);
        if (hero) meta.heroes.set(hero.id, r.level ?? heroLevel(r.item) + 1);
        else meta.owned.add(r.item);
        const skin = skinOf(r.item);
        if (skin && !meta.equipped.has(skin.slot)) meta.equipped.set(skin.slot, r.item);
        const rarity = rarityClass(crate, r.item);
        const name = hero ? `${hero.name}, ${hero.title}` : itemName(r.item);
        return {
          rarity,
          cell: cell(crate, r.item),
          jackpot: Boolean(skin && (skin.finish.rarity === 'mythic' || skin.finish.rarity === 'legendary')),
          chip: h('span', { class: rarity }, hero ? `${hero.name} niv. ${heroLevel(r.item)}` : itemName(r.item)),
          reveal: [
            h('span', { class: 'cr-rarity' }, skin ? RARITY_NAMES[skin.finish.rarity] : hero && heroLevel(r.item) > 1 ? `Niveau ${heroLevel(r.item)} !` : 'Nouveau héros !'),
            previewItem(r.item, 96),
            h('strong', {}, name),
            h(
              'span',
              { class: 'muted small' },
              skin
                ? meta.equipped.get(skin.slot) === r.item ? 'Ajouté à ta collection et porté.' : 'Ajouté à ta collection.'
                : hero ? `${hero.text(heroLevel(r.item))}. À choisir avant une partie.` : '',
            ),
          ],
        };
      },
    });
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
    const all = contents(c);
    const got = all.filter(has).length;
    const done = complete(c);
    const maxed = c.kind === 'hero' ? all.filter((id) => heroLevel(id) >= HERO_MAX_LEVEL).length : 0;
    const locked = (ci?.minWave ?? 0) > meta.best;
    const label = done ? 'Complète ✓' : locked ? `🔒 Vague ${ci?.minWave} à atteindre` : `Ouvrir · ◆ ${formatPoints(ci?.price ?? 0)}`;
    const b = h('button', { class: 'field rl-spin', type: 'button', disabled: done || locked || !ci, 'data-id': c.id }, label);
    b.addEventListener('click', () => open(c));
    // Chances par rareté, recalculées sur ce qui reste ; une rareté terminée est cochée au lieu d'un pourcentage.
    const live = liveOdds(c);
    const total = live.reduce((a, [, w]) => a + w, 0);
    const rows = (ci?.odds ?? []).map(([r]) => {
      const pool = all.filter((id) => skinOf(id)?.finish.rarity === r);
      const mine = pool.filter(has).length;
      const w = live.find(([lr]) => lr === r)?.[1];
      return h(
        'li',
        { class: `rar-${r}${w === undefined ? ' done' : ''}` },
        h('span', {}, RARITY_NAMES[r], h('span', { class: 'muted' }, ` ${mine}/${pool.length}`)),
        h('b', {}, w === undefined ? '✓' : percent(w, total)),
      );
    });
    return h(
      'div',
      { class: `card cr-crate td-crate ${TIER_CLASS[c.id] ?? ''}${done ? ' complete' : ''}` },
      h('h2', {}, c.name),
      h('p', { class: 'muted small' }, c.text),
      h(
        'p',
        { class: 'small' },
        done
          ? c.kind === 'hero' ? `✓ Tous tes héros sont au niveau ${HERO_MAX_LEVEL}.` : '✓ Tu as tout obtenu.'
          : `${got} / ${all.length} obtenus${maxed ? ` · ${maxed} au niveau ${HERO_MAX_LEVEL}` : ''}`,
      ),
      c.kind === 'skin' && rows.length && !done ? h('ul', { class: 'cr-odds' }, ...rows) : '',
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
      h('section', { class: 'home-section' }, h('h2', { class: 'home-h' }, 'Skins de tours'), ...TOWERS.filter((t) => !t.special).map((t) => skinRow('ts', t.id, t.name))),
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
    if (!multiConfigured) throw new Error('Les caisses ne sont pas disponibles en mode local.');
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
        h('div', {}, h('h1', {}, 'Tower defense')),
        h('div', { class: 'ap-actions' }, balance, play),
      ),
      status,
      cratesEl,
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
