import { isTyping, pushKeys } from '../../core/input';
import { isPanicked } from '../../core/panic';
import { blip } from '../../core/sound';
import { load, remove, save, setBest } from '../../core/storage';
import { GAIN_MULT } from '../../net/points';
import { multiConfigured } from '../../net/supabase';
import { navigate } from '../../router';
import { h, hints } from '../../ui/dom';
import { spatialNav } from '../../ui/menu';
import type { Game, GameContext } from '../types';
import {
  BONUS, bonusLevel, ENEMIES, FINAL_WAVE, HEROES, LEVEL_COUNT, levelBoss, levelWaves, mapOf, MAX_LEVEL, MAX_STARS, maxTier,
  PERK_MAX, perkCost, PERKS, TIER_UNLOCK, TOWER_UNLOCK, TOWERS, towersFor, towerStats, type TowerStats,
} from './engine/data';
import {
  applyAction, isBuildable, newRun, planLevelWave, planWave, priceOf, sellValue, specialPrice, starsOf, startWave, TICK, upgradeOf,
  type Enemy, type Fx, type Mode, type Running, type RunState,
} from './engine/sim';
import {
  buyPerk, emptyMeta, equippedFinish, loadMeta, perksOf, recordStars, resetPerks, starBalance, startRun, tdServerUp, type Meta,
} from './net';
import { enqueue, onUpload, pendingFor, startUploads } from './uploads';
import { drawEnemy, drawTower, enemyLook, enemyRadius, previewItem, readPalette, towerLook, type Palette } from './render';
import { ACTS, actOf, BONUS_ACT, bossName, levelStory, PROLOGUE, type Line } from './story';
import './td.css';

interface Saved {
  s: RunState;
  actions: string[]; // constructions depuis la dernière vague (envoyées à la fin de la suivante)
  session: string | null;
  victory?: boolean; // message de la vague 50 déjà montré (mode infini)
}

const SAVE_KEY = 'state:td4'; // td4 : cartes à plusieurs routes (les parties en cours d'avant sont oubliées)
const HERO_KEY = 'hero:td';
const TICK_MS = TICK * 1000;
const DAMAGE = { physical: 'physique', magic: 'magique', pure: 'pur' } as const;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 && !/[sx]$/.test(word) ? 's' : ''}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
const towerName = (id: string) => TOWERS.find((t) => t.id === id)?.name ?? id;
/** Points d'un niveau réussi (voir 0032_td_campagne.sql, gains × GAIN_MULT depuis 0034_gains.sql). */
const levelPoints = (L: number, first: boolean) => GAIN_MULT * (first ? 100 + 40 * L : 5 * L);
const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** Ce qui rend la carte du niveau L particulière (entrées, sorties, taille, tour spéciale). */
function mapTraits(L: number): string[] {
  const m = mapOf(L);
  const ins = new Set(m.routes.map((r) => String(r[0]))).size;
  const outs = new Set(m.routes.map((r) => String(r[r.length - 1]))).size;
  const out: string[] = [];
  if (ins > 1) out.push(`${ins} entrées`);
  if (outs > 1) out.push(`${outs} sorties`);
  if (m.w * m.h > 200) out.push('grande carte');
  if (m.special) out.push(TOWERS.find((t) => t.id === m.special!.tower)?.name ?? 'tour spéciale');
  return out;
}

function statsLine(st: TowerStats): string {
  if (st.income) return `+${st.income} or par vague${st.interest ? `, + ${Math.round(st.interest * 100)} % de l’or (${st.interestCap} max)` : ''}${st.aura ? ', aura de cadence et de portée' : ''}`;
  const parts: string[] = [];
  if (st.holePct) parts.push(`trou noir ${Math.round(st.holePct * 100)} % PV max/s toutes les ${st.holeEvery} s`);
  else if (st.beam) parts.push(`rayon ${st.beam}/s ×${st.beams}`);
  else if (st.dot) parts.push(`poison ${st.dot}/s × ${st.maxStacks} cumuls`);
  else parts.push(`${st.fireRate ? st.damage : `${st.damage}/s`} ${DAMAGE[st.damageType ?? 'physical']}`);
  if (st.fireRate) parts.push(`${fmt(st.fireRate)} tir/s`);
  parts.push(`portée ${st.range >= 50 ? 'carte' : fmt(st.range)}`);
  if (st.hitsAir) parts.push('air');
  if (st.detectsCamo) parts.push('détecte');
  return parts.join(' · ');
}

/** Ce que débloque le passage de `from` à `to` niveaux terminés. */
function unlocksBetween(from: number, to: number): string[] {
  const out: string[] = [];
  for (const id of towersFor(to)) if (!towersFor(from).includes(id)) out.push(`la tour ${towerName(id)}`);
  const names = ['', 'la 1re amélioration', 'la 2e amélioration', 'le choix d’une voie (3e amélioration)', 'la dernière amélioration de chaque voie'];
  for (let t = maxTier(from) + 1; t <= maxTier(to); t++) out.push(names[t]);
  return out;
}

/** Prochain déblocage de la campagne, pour donner envie. */
function nextUnlock(cleared: number): string | null {
  let best: { at: number; what: string } | null = null;
  for (const [id, at] of Object.entries(TOWER_UNLOCK)) if (at > cleared && (!best || at < best.at)) best = { at, what: `la tour ${towerName(id)}` };
  TIER_UNLOCK.forEach((at, t) => {
    if (at > cleared && (!best || at < best.at)) best = { at, what: t === 3 ? 'le choix des voies' : `l’amélioration ${t}` };
  });
  return best ? `${best.what} après le niveau ${best.at}` : null;
}

function mount(ctx: GameContext): () => void {
  let meta: Meta = emptyMeta();
  let leave: () => void = () => {};
  let disposed = false;
  const metaReady = loadMeta().then((m) => (meta = m));

  const show = (screen: () => () => void) => {
    leave();
    ctx.root.querySelector('.game')?.remove();
    leave = screen();
  };

  const chosenHero = () => {
    const id = load<string | null>(HERO_KEY, null);
    const level = id ? meta.heroes.get(id) ?? 0 : 0;
    return id && level ? { id, level } : null;
  };

  // =============================================================================================
  // Carte de la campagne
  // =============================================================================================
  let focusLevel = 0;

  const menuScreen = () => {
    const wrap = h('div', { class: 'game td-deck td-menu' }, h('p', { class: 'muted' }, 'Chargement…'));
    ctx.root.append(wrap);
    let note = '';
    let starting = false;

    const levelButton = (L: number, open: boolean, lockText: string) => {
      const stars = meta.stars.get(L) ?? 0;
      const boss = levelBoss(L);
      const bonus = bonusLevel(L);
      const traits = [...(bonus ? [bonus.rule] : []), ...mapTraits(L)];
      const b = h(
        'button',
        { class: `td-level${stars ? ' done' : ''}${open && !stars ? ' next' : ''}${bonus ? ' td-bonus' : ''}`, type: 'button', disabled: !open, 'data-id': `level:${L}` },
        h('b', {}, bonus ? `B${L - LEVEL_COUNT}` : String(L)),
        h('span', { class: 'td-level-name' }, open ? levelStory(L).name : '???'),
        h('span', { class: 'td-stars' + (stars ? '' : ' muted') }, open ? starText(stars) : `🔒 ${lockText || ''}`.trim()),
        h('span', { class: 'small muted' }, `${levelWaves(L)} vagues${boss ? ' · boss' : ''}${open && traits.length ? ` · ${traits.join(' · ')}` : ''}`),
      );
      b.addEventListener('click', () => play('campaign', L));
      return b;
    };

    // Message de la boutique à étoiles, affiché juste sous elle (la page est longue).
    let shopNote = '';
    const shopAction = async (run: () => Promise<void>, ok: string) => {
      try {
        await run();
        shopNote = ok;
        blip(660);
      } catch (e) {
        const msg = (e as Error).message;
        shopNote = msg.includes('étoiles') && serverDown ? `${msg} : le serveur du tower defense est injoignable, tes niveaux réussis n’ont pas été enregistrés.` : msg;
      }
      if (!disposed) render();
    };

    // Serveur du tower defense joignable ? Sans lui, rien n'est enregistré : on le dit clairement.
    let serverDown = false;
    void tdServerUp().then((up) => {
      serverDown = !up;
      if (serverDown && !disposed) render();
    });

    const render = () => {
      // Garde le bouton cliqué et la position dans la page (choisir un héros ne remonte plus en haut).
      const kept = (document.activeElement as HTMLElement | null)?.dataset?.id;
      const scrollY = window.scrollY;
      const cleared = meta.cleared;
      const hero = chosenHero();
      const heroBtn = (id: string | null) => {
        const def = id ? HEROES.find((x) => x.id === id)! : null;
        const lvl = id ? meta.heroes.get(id) ?? 0 : 0;
        const b = h(
          'button',
          { class: `shop-item td-hero${(hero?.id ?? null) === id ? ' on' : ''}`, type: 'button', 'data-id': `hero:${id ?? 'none'}` },
          id ? h('span', { class: 'shop-preview' }, previewItem(`hero:${id}`, 36)) : h('span', { class: 'td-hero-none' }, '∅'),
          h('span', { class: 'shop-name' }, def ? `${def.name} · niv. ${lvl}` : 'Sans héros'),
          h('span', { class: 'small muted' }, def ? def.text(lvl) : 'Aucun bonus'),
        );
        b.addEventListener('click', () => {
          save(HERO_KEY, id);
          blip(520);
          render();
        });
        return b;
      };
      const owned = HEROES.filter((x) => meta.heroes.has(x.id)).map((x) => x.id);

      const acts = ACTS.map((act, k) => {
        const to = (ACTS[k + 1]?.from ?? LEVEL_COUNT + 1) - 1;
        const buttons: HTMLElement[] = [];
        for (let L = act.from; L <= to; L++) buttons.push(levelButton(L, L <= cleared + 1, ''));
        return h('section', { class: 'td-act' }, h('h3', {}, act.name), h('div', { class: 'td-levels' }, ...buttons));
      });
      const bonusButtons = BONUS.map((b, k) => levelButton(LEVEL_COUNT + 1 + k, cleared >= b.unlock, `après le niveau ${b.unlock}`));

      // Boutique à étoiles
      const balance = starBalance(meta);
      const perkRows = PERKS.map((p) => {
        const rank = meta.perks.get(p.id) ?? 0;
        const cost = perkCost(rank + 1);
        const maxed = rank >= PERK_MAX;
        const b = h(
          'button',
          { class: `shop-item td-perk${maxed ? ' on' : ''}`, type: 'button', disabled: maxed || balance.left < cost, 'data-id': `perk:${p.id}` },
          h('span', { class: 'shop-name' }, `${p.name} · ${'●'.repeat(rank)}${'○'.repeat(PERK_MAX - rank)}`),
          h('span', { class: 'small' }, rank ? p.text(rank) : 'Pas encore acheté'),
          h('span', { class: 'small muted' }, maxed ? 'Rang maximum' : `Rang ${rank + 1} : ${p.text(rank + 1)} · ★ ${cost}`),
        );
        b.addEventListener('click', () => void shopAction(() => buyPerk(meta, p.id), `${p.name} : rang ${rank + 1} !`));
        return b;
      });
      const reset = h('button', { class: 'field', type: 'button', disabled: !balance.spent }, 'Récupérer mes étoiles');
      reset.addEventListener('click', () => void shopAction(() => resetPerks(meta), 'Étoiles récupérées : tu peux tout redépenser.'));

      const infinite = h(
        'button',
        { class: 'td-level td-infinite', type: 'button', 'data-id': 'infinite' },
        h('b', {}, '∞'),
        h('span', { class: 'td-level-name' }, 'Mode infini'),
        h('span', { class: 'small muted' }, `Classé · record : vague ${meta.best} · avec tes ${towersFor(cleared).length} tours`),
      );
      infinite.addEventListener('click', () => play('infinite', 0));
      const crates = h('button', { class: 'field', type: 'button' }, 'Caisses (héros, skins)');
      crates.addEventListener('click', () => navigate('/td/caisses'));
      const up = nextUnlock(cleared);

      wrap.replaceChildren(
        serverDown
          ? h('p', { class: 'notice td-server-down' }, '⚠ Le serveur du tower defense est injoignable : tes parties ne sont pas enregistrées (niveaux réussis, étoiles, classement). Il faut déployer la fonction serveur « td » sur Supabase.')
          : '',
        h(
          'div',
          { class: 'td-deck-head' },
          h(
            'div',
            {},
            h('h2', {}, 'L’expédition'),
            h('p', { class: 'muted small' }, `${cleared} / ${LEVEL_COUNT} niveaux · ★ ${balance.earned} / ${MAX_STARS} · ${towersFor(cleared).length} tours débloquées${up ? ` · prochain déblocage : ${up}` : ' · tout est débloqué'}`),
          ),
          h('div', { class: 'td-deck-actions' }, crates),
        ),
        ...acts,
        h('section', { class: 'td-act' }, h('h3', {}, BONUS_ACT.name), h('p', { class: 'muted small' }, 'Tonton Jean-Mi a préparé des défis. Ils piquent.'), h('div', { class: 'td-levels' }, ...bonusButtons)),
        h('section', { class: 'td-act' }, h('h3', {}, 'Après l’expédition'), h('div', { class: 'td-levels' }, infinite)),
        h(
          'section',
          { class: 'td-act' },
          h('h3', {}, `Boutique à étoiles · ★ ${balance.left} à dépenser`),
          h('p', { class: 'muted small' }, '1 étoile par niveau réussi, 2 en gardant au moins la moitié de tes vies, 3 sans en perdre une seule. Les améliorations valent pour toutes tes parties.'),
          h('div', { class: 'td-heroes' }, ...perkRows),
          h('div', { class: 'td-deck-actions' }, reset),
          shopNote ? h('p', { class: 'status td-shop-note' }, shopNote) : '',
        ),
        h(
          'section',
          { class: 'td-act' },
          h('h3', {}, 'Héros'),
          h('div', { class: 'td-heroes' }, heroBtn(null), ...owned.map(heroBtn)),
          owned.length ? '' : h('p', { class: 'muted small' }, 'Pas encore de héros : ils sortent de la caisse de héros (C), et un doublon les fait monter de niveau.'),
        ),
        h('p', { class: 'status' }, starting ? 'Lancement…' : note),
        hints(['← ↑ → ↓', 'choisir'], ['Entrée', 'jouer'], ['I', 'mode infini'], ['C', 'caisses'], ['Retour arrière', 'quitter']),
      );
      const again = kept ? wrap.querySelector<HTMLElement>(`[data-id="${kept}"]`) : null;
      if (again && !(again as HTMLButtonElement).disabled) {
        again.focus({ preventScroll: true });
        window.scrollTo(0, scrollY);
        return;
      }
      if (kept) return window.scrollTo(0, scrollY);
      const target = focusLevel ? `level:${focusLevel}` : `level:${Math.min(LEVEL_COUNT, cleared + 1)}`;
      (wrap.querySelector<HTMLElement>(`[data-id="${target}"]`) ?? wrap.querySelector<HTMLElement>('.td-level'))?.focus();
    };

    const play = (mode: Mode, L: number) => {
      if (starting) return;
      focusLevel = L;
      if (mode === 'infinite') return void begin(mode, 0);
      const lines = [...(L === 1 ? PROLOGUE : []), ...levelStory(L).intro];
      show(() => storyScreen(`${levelTitle(L)} · ${levelStory(L).name}`, actOf(L).name, lines, () => void begin(mode, L), () => show(menuScreen)));
    };

    void metaReady.then(() => !disposed && render());
    const nav = spatialNav(wrap);
    const offKeys = pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        return ctx.onExit();
      }
      const key = e.key.toLowerCase();
      if (key === 'i') return play('infinite', 0);
      if (key === 'c') return navigate('/td/caisses');
      nav(e);
    });
    return offKeys;
  };

  const levelTitle = (L: number) => (L > LEVEL_COUNT ? `Défi ${L - LEVEL_COUNT}` : `Niveau ${L}`);

  /** Lance une partie : classée si le serveur répond, sinon jouée sur place. */
  let launching = false;
  const begin = async (mode: Mode, L: number) => {
    if (launching) return;
    launching = true;
    try {
      await beginRun(mode, L);
    } finally {
      launching = false;
    }
  };
  const beginRun = async (mode: Mode, L: number) => {
    const hero = chosenHero();
    let saved: Saved;
    let msg = '';
    try {
      if (!multiConfigured) throw new Error('');
      const r = await startRun(mode, L, hero?.id ?? null);
      saved = { s: r.state, actions: [], session: r.id };
    } catch (e) {
      msg = (e as Error).message;
      saved = { s: newRun((Math.random() * 2 ** 32) >>> 0, { mode, level: L, cleared: meta.cleared, hero, perks: perksOf(meta) }), actions: [], session: null };
    }
    if (disposed) return;
    runNote = msg ? `⚠ Serveur injoignable (${msg}) : cette partie ne sera pas enregistrée.` : '';
    save(SAVE_KEY, saved);
    show(() => runScreen(saved));
  };

  // =============================================================================================
  // Dialogues de l'histoire
  // =============================================================================================
  const storyScreen = (title: string, act: string, lines: Line[], onDone: () => void, back: () => void) => {
    // Une seule fois : Entrée et clic peuvent arriver ensemble (sinon deux parties lancées).
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onDone();
    };
    let i = 0;
    const box = h('div', { class: 'td-story-box' });
    const wrap = h(
      'div',
      { class: 'game td-story' },
      h('p', { class: 'muted small' }, act),
      h('h2', {}, title),
      box,
      hints(['Entrée', 'suite'], ['Tab', 'passer'], ['Retour arrière', 'carte']),
    );
    ctx.root.append(wrap);
    const render = () => {
      const shown = lines.slice(0, i + 1);
      box.replaceChildren(
        ...shown.map((l, k) => h('p', { class: `td-line${k === i ? ' now' : ''}` }, h('b', {}, `${l.who} : `), l.text)),
        h('p', { class: 'muted small' }, i < lines.length - 1 ? `${i + 1} / ${lines.length}` : 'Entrée pour continuer'),
      );
      box.lastElementChild?.scrollIntoView({ block: 'nearest' });
    };
    const next = () => {
      if (i < lines.length - 1) {
        i++;
        blip(440, 0.02);
        render();
      } else done();
    };
    wrap.addEventListener('click', next);
    render();
    return pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        done();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        back();
      }
    });
  };

  // =============================================================================================
  // La partie
  // =============================================================================================
  let runNote = '';

  const runScreen = (saved: Saved) => {
    let s = saved.s;
    let actions = saved.actions;
    let session = saved.session;
    let victorySeen = Boolean(saved.victory);
    const campaign = s.mode === 'campaign';
    const map = mapOf(s.map);
    const COLS = map.w;
    const ROWS = map.h;
    const clearedBefore = meta.cleared;
    const starsBefore = meta.stars.get(s.level) ?? 0;
    let cx = 6;
    let cy = 4;
    let speed = 1;
    let paused = false;
    let running: Running | null = null;
    let snapshot: { s: RunState; actions: string[] } | null = null;
    let prev = new Map<number, [number, number]>();
    let fx: Fx[] = [];
    let acc = 0;
    let last = 0;
    let raf = 0;
    let note = runNote;
    let confirmAbandon = false;
    let showVictory = false;
    let choosing = false; // choix de la voie d'amélioration de la tour sous le curseur
    let gone = false;
    let pal: Palette = readPalette();
    runNote = '';

    const canvas = h('canvas', { class: 'td-canvas' });
    const g = canvas.getContext('2d')!;
    const stats = h('div', { class: 'game-bar td-bar' });
    const info = h('div', { class: 'td-info' });
    const overlay = h('div', { class: 'overlay', hidden: true });
    const noteEl = h('p', { class: 'status small' });
    ctx.root.append(
      h(
        'div',
        { class: 'game' },
        stats,
        h('div', { class: 'overlay-wrap' }, canvas, overlay),
        info,
        noteEl,
        hints(
          ['← ↑ → ↓', 'case'], ['1 – 0', 'construire'], ['U', map.special ? 'améliorer / débloquer' : 'améliorer'], ['S', 'vendre'], ['Espace', 'lancer la vague'],
          ['F', 'vitesse'], ['P', 'pause'], ['R', 'abandonner'], ['Retour arrière', 'quitter'],
        ),
      ),
    );

    const persist = () => {
      if (s.over) remove(SAVE_KEY);
      else save(SAVE_KEY, { s, actions, session, victory: victorySeen } satisfies Saved);
      if (!campaign) setBest('td2', s.wave);
    };

    let cell = 32;
    const resize = () => {
      const cs = getComputedStyle(ctx.root);
      const inner = ctx.root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = Math.min(COLS * 45, inner > 0 ? inner : 640);
      cell = Math.floor(w / COLS);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = cell * COLS * ratio;
      canvas.height = cell * ROWS * ratio;
      canvas.style.width = `${cell * COLS}px`;
      canvas.style.height = `${cell * ROWS}px`;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      pal = readPalette();
    };

    const towerAt = (x: number, y: number) => s.towers.find((t) => t.x === x && t.y === y);
    const towerFinish = (kind: number) => equippedFinish(meta, 'ts', TOWERS[kind].id);

    // --- Dessin
    const draw = (frac: number) => {
      const now = performance.now() / 1000;
      const W = cell * COLS;
      const H = cell * ROWS;
      g.fillStyle = pal.bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = pal.path;
      for (const route of map.routes) for (const [x, y] of route) g.fillRect(x * cell, y * cell, cell, cell);
      g.strokeStyle = pal.grid;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= COLS; x++) {
        g.moveTo(x * cell + 0.5, 0);
        g.lineTo(x * cell + 0.5, H);
      }
      for (let y = 0; y <= ROWS; y++) {
        g.moveTo(0, y * cell + 0.5);
        g.lineTo(W, y * cell + 0.5);
      }
      g.stroke();
      // entrée et sortie
      g.fillStyle = pal.muted;
      g.font = `${Math.round(cell * 0.5)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const route of map.routes) {
        g.fillText('›', route[0][0] * cell + cell / 2, route[0][1] * cell + cell / 2);
        g.fillText('⚑', route[route.length - 1][0] * cell + cell / 2, route[route.length - 1][1] * cell + cell / 2);
      }

      if (running) {
        for (const p of running.patches()) {
          g.fillStyle = pal.tones[1] + '40';
          g.beginPath();
          g.arc(p.x * cell, p.y * cell, p.r * cell, 0, Math.PI * 2);
          g.fill();
        }
        for (const hl of running.holes()) {
          const grad = g.createRadialGradient(hl.x * cell, hl.y * cell, 0, hl.x * cell, hl.y * cell, hl.r * cell);
          grad.addColorStop(0, '#000000cc');
          grad.addColorStop(0.6, pal.tones[4] + '55');
          grad.addColorStop(1, pal.tones[4] + '00');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(hl.x * cell, hl.y * cell, hl.r * cell, 0, Math.PI * 2);
          g.fill();
        }
        // tunnels de Bagou : entrée et sortie reliées en pointillés
        for (const tn of running.tunnels()) {
          g.strokeStyle = pal.muted;
          g.setLineDash([cell * 0.15, cell * 0.15]);
          g.beginPath();
          g.moveTo(tn.fx * cell, tn.fy * cell);
          g.lineTo(tn.tx * cell, tn.ty * cell);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = '#000000b0';
          for (const [x, y] of [[tn.fx, tn.fy], [tn.tx, tn.ty]]) {
            g.beginPath();
            g.ellipse(x * cell, y * cell, cell * 0.38, cell * 0.22, 0, 0, Math.PI * 2);
            g.fill();
          }
        }
      }

      // portée de la tour sous le curseur
      const hover = towerAt(cx, cy);
      if (hover) {
        const st = towerStats(TOWERS[hover.kind], hover.level, hover.path);
        const r = (st.aura ?? (st.range >= 50 ? 0 : st.range)) * cell;
        if (r > 0) {
          g.beginPath();
          g.arc((cx + 0.5) * cell, (cy + 0.5) * cell, r, 0, Math.PI * 2);
          g.fillStyle = pal.accent + '18';
          g.fill();
          g.strokeStyle = pal.accent;
          g.stroke();
        }
      }

      // tours
      const lives = running ? new Map(running.towers().map((l) => [l.t.id, l])) : null;
      for (const t of s.towers) {
        const l = lives?.get(t.id);
        const def = TOWERS[t.kind];
        const id = def.as ?? def.id;
        const look = def.special ? { ...towerLook(id, null, pal, now), body: '#e6b422', edge: '#8a6a10' } : towerLook(id, towerFinish(t.kind), pal, now);
        drawTower(g, id, def.special ? MAX_LEVEL : t.level, (t.x + 0.5) * cell, (t.y + 0.5) * cell, cell, l?.angle ?? -Math.PI / 2, look, now, { disabled: t.locked || (l?.disabledT ?? 0) > 0 });
        if (def.special) {
          g.fillStyle = t.locked ? pal.muted : '#e6b422';
          g.font = `${Math.round(cell * 0.38)}px system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(t.locked ? '🔒' : '★', (t.x + 0.82) * cell, (t.y + 0.18) * cell);
        }
      }

      if (running) {
        // ennemis
        for (const e of running.enemies()) {
          if (!e.alive) continue;
          const p = prev.get(e.uid);
          const x = (p ? p[0] + (e.x - p[0]) * frac : e.x) * cell;
          const y = (p ? p[1] + (e.y - p[1]) * frac : e.y) * cell;
          drawFoe(e, x, y, now);
        }
        // tirs
        for (const f of fx) drawFx(f);
      }

      g.strokeStyle = pal.accent;
      g.lineWidth = 2;
      g.strokeRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
    };

    const drawFoe = (e: Enemy, x: number, y: number, now: number) => {
      const d = ENEMIES[e.def];
      const r = enemyRadius(d.id, cell, e.mini);
      g.save();
      if (e.burrowed) g.globalAlpha = 0.25;
      else if (!e.revealed) g.globalAlpha = 0.35;
      drawEnemy(g, d.id, x, y, r, enemyLook(d.id, equippedFinish(meta, 'es', d.id), pal, now), now);
      g.restore();
      // états
      const ring = (color: string) => {
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, r + 3, 0, Math.PI * 2);
        g.stroke();
      };
      if (e.frozen && e.stunT > 0) ring('#7fd3ff');
      else if (e.stunT > 0) ring(pal.tones[3]);
      else if (e.slowT > 0) ring('#7fd3ff88');
      if (e.burnT > 0) ring(pal.tones[1] + 'aa');
      if (e.dots.length) {
        g.fillStyle = '#6cc04a';
        for (let k = 0; k < e.dots.length; k++) g.fillRect(x - r + k * 4, y + r + 2, 3, 3);
      }
      if (e.burrowed) return;
      // vie et bouclier
      const boss = d.tier === 'boss';
      const bw = boss ? cell * 1.4 : Math.max(r * 2, cell * 0.5);
      const by = y - r - (boss ? 9 : 6);
      g.fillStyle = pal.grid;
      g.fillRect(x - bw / 2, by, bw, boss ? 4 : 3);
      g.fillStyle = boss ? pal.tones[1] : pal.text;
      g.fillRect(x - bw / 2, by, (bw * Math.max(0, e.hp)) / e.maxHp, boss ? 4 : 3);
      if (e.shield > 0 && e.maxShield > 0) {
        g.fillStyle = '#5fb4ff';
        g.fillRect(x - bw / 2, by - 3, (bw * e.shield) / e.maxShield, 2);
      }
    };

    const towerCenter = (id: number): [number, number] | null => {
      const t = s.towers.find((o) => o.id === id);
      return t ? [(t.x + 0.5) * cell, (t.y + 0.5) * cell] : null;
    };
    const drawFx = (f: Fx) => {
      g.save();
      g.globalAlpha = 0.7;
      if (f.k === 'shot' || f.k === 'beam') {
        const c = towerCenter(f.tower);
        if (c) {
          g.strokeStyle = f.k === 'beam' ? pal.tones[4] : pal.text;
          g.lineWidth = f.k === 'beam' ? 3 * f.w : 1.2;
          g.beginPath();
          g.moveTo(c[0], c[1]);
          g.lineTo(f.x * cell, f.y * cell);
          g.stroke();
        }
      } else if (f.k === 'chain') {
        g.strokeStyle = pal.tones[4];
        g.lineWidth = 2;
        g.beginPath();
        f.pts.forEach(([x, y], i) => (i ? g.lineTo(x * cell, y * cell) : g.moveTo(x * cell, y * cell)));
        g.stroke();
      } else if (f.k === 'boom') {
        g.strokeStyle = pal.tones[3];
        g.lineWidth = 2;
        g.beginPath();
        g.arc(f.x * cell, f.y * cell, f.r * cell, 0, Math.PI * 2);
        g.stroke();
      } else if (f.k === 'cone') {
        const c = towerCenter(f.tower);
        if (c) {
          const a = Math.atan2(f.y * cell - c[1], f.x * cell - c[0]);
          g.fillStyle = pal.tones[1] + '55';
          g.beginPath();
          g.moveTo(c[0], c[1]);
          g.arc(c[0], c[1], f.r * cell, a - 0.52, a + 0.52);
          g.closePath();
          g.fill();
        }
      } else if (f.k === 'death') {
        g.fillStyle = pal.muted;
        g.beginPath();
        g.arc(f.x * cell, f.y * cell, f.boss ? cell : cell * 0.2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    };

    // --- Panneaux
    const levelName = (t: RunState['towers'][number]) => {
      if (t.level === 0) return 'Base';
      const def = TOWERS[t.kind];
      return t.path >= 0 ? `${def.paths[t.path].name} ${t.level - 2}` : `Niv. ${t.level}`;
    };

    const upgradePanel = (t: RunState['towers'][number]): HTMLElement[] => {
      const def = TOWERS[t.kind];
      if (def.special) {
        return [h('p', { class: 'small' }, t.locked
          ? `Tour spéciale de la carte : U pour la débloquer (${specialPrice(s)} or). Dégâts ×${fmt(t.power ?? 1)}, ni améliorable ni vendable.`
          : `Tour spéciale débloquée · dégâts ×${fmt(t.power ?? 1)}`)];
      }
      const sell = `S vendre (+${sellValue(t)}${t.fresh ? ', prix plein' : ''})`;
      if (t.level >= MAX_LEVEL) return [h('p', { class: 'small muted' }, `Niveau maximum · ${sell}`)];
      if (t.level + 1 > s.tier) {
        return [h('p', { class: 'small muted' }, `🔒 Amélioration ${t.level + 1} : débloquée après le niveau ${TIER_UNLOCK[t.level + 1]} de la campagne · ${sell}`)];
      }
      if (t.level === 2) {
        const choices = def.paths.map((p, k) => {
          const up = p.ups[0];
          const b = h(
            'button',
            { class: `td-path${choosing ? ' on' : ''}`, type: 'button' },
            h('b', {}, `${choosing ? `${k + 1} · ` : ''}${p.name}`),
            h('span', { class: 'small' }, ` ${up.name} (${priceOf(s, up.cost)} or) : ${up.text}`),
            h('span', { class: 'small muted' }, ` puis ${p.ups[1].name} : ${p.ups[1].text}`),
          );
          b.addEventListener('click', () => {
            choosing = false;
            act(`U${t.x}.${t.y}.${k}`);
          });
          return b;
        });
        return [
          h('p', { class: 'small' }, choosing ? 'Choisis la voie : 1 ou 2 (une autre touche pour annuler).' : `U pour choisir sa voie (définitif) · ${sell}`),
          h('div', { class: 'td-paths' }, ...choices),
        ];
      }
      const up = upgradeOf(t)!;
      return [h('p', { class: 'small' }, `U ${up.name} (${priceOf(s, up.cost)} or) : ${up.text} · ${sell}`)];
    };

    const render = () => {
      if (gone) return;
      const w = running ? running.number : s.wave + 1;
      const total = campaign ? levelWaves(s.level) : FINAL_WAVE;
      stats.replaceChildren(
        campaign ? h('span', { class: 'stat' }, s.level > LEVEL_COUNT ? 'Défi ' : 'Niveau ', h('b', {}, String(s.level > LEVEL_COUNT ? s.level - LEVEL_COUNT : s.level))) : '',
        h('span', { class: 'stat' }, 'Vague ', h('b', {}, w <= total ? `${Math.min(w, total)}/${total}` : `${w} ∞`)),
        h('span', { class: 'stat' }, 'Vies ', h('b', { 'data-k': 'lives' }, String(s.lives))),
        h('span', { class: 'stat' }, 'Or ', h('b', { 'data-k': 'gold' }, String(s.gold))),
        h('span', { class: 'stat' }, '×', h('b', {}, String(speed))),
        s.hero ? h('span', { class: 'small muted' }, `${HEROES.find((x) => x.id === s.hero!.id)?.name ?? ''} niv. ${s.hero.level}`) : '',
        h('span', { class: 'muted small td-rank' }, saveStatus()),
      );
      const shop = s.allowed.map((id, i) => {
        const def = TOWERS.find((t) => t.id === id)!;
        const count = s.towers.filter((t) => TOWERS[t.kind].id === id).length;
        const full = def.maxPerMap !== undefined && count >= def.maxPerMap;
        const cost = priceOf(s, def.cost);
        return h('span', { class: 'chip' + (s.gold >= cost && !full ? '' : ' off') }, h('kbd', {}, KEYS[i]), ` ${def.name} ${cost}`, full ? ' (max)' : '');
      });
      const t = towerAt(cx, cy);
      if (!t || t.level !== 2) choosing = false;
      const detail: (HTMLElement | string)[] = [];
      if (t) {
        const def = TOWERS[t.kind];
        const st = towerStats(def, t.level, t.path);
        detail.push(h('p', { class: 'small' }, h('b', {}, `${def.name} · ${def.special ? 'spéciale' : levelName(t)}`), ` — ${statsLine(st)}`));
        detail.push(...upgradePanel(t));
      } else if (isBuildable(s.map, cx, cy)) detail.push(h('p', { class: 'small muted' }, `Case libre : ${KEYS.slice(0, s.allowed.length).join(', ')} pour construire.`));
      else detail.push(h('p', { class: 'small muted' }, 'Chemin des ennemis.'));

      const blocks: HTMLElement[] = [];
      if (!running && !s.over) {
        const plan = campaign ? planLevelWave(s.seed, s.level, s.wave + 1) : planWave(s.seed, s.wave + 1);
        const counts = new Map<number, number>();
        for (const sp of plan.spawns) counts.set(sp.enemy, (counts.get(sp.enemy) ?? 0) + 1);
        const list = [...counts].map(([e, n]) => (ENEMIES[e].tier === 'boss' ? bossName(ENEMIES[e], s.level) : `${n} ${ENEMIES[e].name}`)).join(', ');
        const tag = plan.boss !== null ? ' · BOSS' : plan.theme ? ` · vague thématique « ${plan.theme} »` : '';
        blocks.push(h('p', { class: 'small' }, h('b', {}, `Vague ${plan.wave}${tag}`), ` : ${list}. Espace pour lancer.`));
        const intro = plan.intro ?? (plan.boss !== null ? plan.boss : null);
        if (intro !== null) {
          const d = ENEMIES[intro];
          blocks.push(
            h(
              'div',
              { class: 'td-intro' },
              previewItem(d.id, 40, equippedFinish(meta, 'es', d.id)),
              h('div', {}, h('b', {}, `${d.tier === 'boss' ? `Boss : ${bossName(d, s.level)}` : `Nouvel ennemi : ${d.name}`}`), h('span', { class: 'small' }, ` — ${d.text}${d.flying ? ' · volant' : ''}${d.camo ? ' · camouflé' : ''}${d.armor ? ` · armure ${d.armor}` : ''}`), h('br'), h('span', { class: 'small muted' }, `Contres : ${d.counters}`)),
            ),
          );
        }
      }
      info.replaceChildren(h('div', { class: 'td-shop' }, ...shop), ...detail, ...blocks);
      info.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.tabIndex = -1));
      noteEl.textContent = note;

      overlay.hidden = true;
      if (s.over) {
        overlay.replaceChildren(...(s.won ? wonOverlay() : lostOverlay()));
        overlay.hidden = false;
      } else if (showVictory) {
        overlay.replaceChildren(
          h('strong', {}, 'Victoire !'),
          h('span', {}, `Bagou est tombé : ${FINAL_WAVE} vagues tenues.`),
          h('span', { class: 'muted small' }, 'Entrée pour continuer (les PV montent de 8 % par vague).'),
        );
        overlay.hidden = false;
      } else if (paused) {
        overlay.replaceChildren(h('strong', {}, 'Pause'), h('span', { class: 'muted small' }, 'P pour reprendre'));
        overlay.hidden = false;
      }
      if (!running) draw(1);
    };

    const button = (label: string, onClick: () => void, main = false) => {
      const b = h('button', { class: `field${main ? ' rl-spin' : ''}`, type: 'button' }, label);
      b.addEventListener('click', onClick);
      return b;
    };

    const wonOverlay = () => {
      const bonus = s.level > LEVEL_COUNT;
      const first = bonus ? starsBefore === 0 : s.level > clearedBefore;
      const unlocks = first && !bonus ? unlocksBetween(clearedBefore, s.level) : [];
      const bonusUnlocked = !bonus && first ? BONUS.filter((b) => b.unlock > clearedBefore && b.unlock <= s.level) : [];
      if (bonusUnlocked.length) unlocks.push('un défi de Tonton Jean-Mi');
      const stars = starsOf(s);
      return [
        h('strong', {}, `${levelTitle(s.level)} réussi !`),
        h('span', { class: 'td-stars big' }, starText(stars)),
        h('span', {}, `${plural(s.lives, 'vie')} restante${s.lives > 1 ? 's' : ''} sur ${s.startLives ?? s.lives} · ${plural(s.kills, 'ennemi')} vaincu${s.kills > 1 ? 's' : ''}`),
        stars > starsBefore ? h('span', { class: 'small' }, `+${stars - starsBefore} ★ pour la boutique à étoiles`) : h('span', { class: 'small muted' }, `Ton record sur ce niveau : ${starText(starsBefore)}`),
        session ? h('span', { class: 'small' }, `+${levelPoints(s.level, first)} points ◆${first ? '' : ' (niveau rejoué)'}`) : '',
        unlocks.length ? h('span', { class: 'small' }, `Débloqué : ${unlocks.join(', ')}.`) : '',
        multiConfigured ? h('span', { class: `small${session ? '' : ' td-unsaved'}` }, saveStatus()) : '',
        h('div', { class: 'td-deck-actions' }, button('Carte', toMenu), button('La suite de l’histoire', outro, true)),
        h('span', { class: 'muted small' }, 'Entrée la suite · M carte'),
      ];
    };

    const lostOverlay = () => {
      const foe = s.lostTo ? ENEMIES.find((e) => e.id === s.lostTo) : null;
      return [
        h('strong', {}, campaign ? `Perdu au niveau ${s.level}, vague ${s.wave + 1}` : `Perdu à la vague ${s.wave + 1}`),
        h('span', {}, `${plural(s.wave, 'vague')} tenue${s.wave > 1 ? 's' : ''} · ${plural(s.kills, 'ennemi')} vaincu${s.kills > 1 ? 's' : ''}${s.bossKills ? ` · ${plural(s.bossKills, 'boss')}` : ''}`),
        session && !campaign ? h('span', { class: 'small' }, `+${GAIN_MULT * s.wave * (s.wave + 1)} points ◆ gagnés`) : '',
        foe ? h('span', { class: 'small muted' }, `Vaincu par : ${foe.tier === 'boss' ? bossName(foe, s.level) : foe.name}. Contre conseillé : ${foe.counters}.`) : '',
        h('div', { class: 'td-deck-actions' }, button('Carte', toMenu), button('Recommencer', retry, true)),
        h('span', { class: 'muted small' }, 'Entrée recommencer · M carte · C caisses'),
      ];
    };

    const toMenu = () => {
      remove(SAVE_KEY);
      show(menuScreen);
    };
    const retry = () => {
      remove(SAVE_KEY);
      void begin(s.mode, s.level);
    };
    const outro = () => {
      remove(SAVE_KEY);
      focusLevel = s.level > LEVEL_COUNT ? s.level : Math.min(LEVEL_COUNT, s.level + 1);
      const L = s.level;
      show(() => storyScreen(`${levelTitle(L)} · ${levelStory(L).name}`, actOf(L).name, levelStory(L).outro, () => show(menuScreen), () => show(menuScreen)));
    };

    // --- Vagues
    let onEnd: () => void = () => {};
    const offUpload = onUpload((e) => {
      if (gone || e.session !== session) return;
      if (e.kind === 'sent') {
        if (note.startsWith('Enregistrement en attente')) note = '';
      } else if (e.kind === 'refused') {
        note = `⚠ Le serveur a refusé cette partie (${e.message}) : la suite ne sera pas enregistrée.`;
        session = null;
        persist();
      } else note = `Enregistrement en attente (${e.message}) : nouvel essai dans quelques secondes…`;
      render();
    });
    /** Où en est l'enregistrement de la partie sur le serveur. */
    const saveStatus = () => {
      if (!session) return multiConfigured ? '⚠ partie non enregistrée' : 'hors ligne';
      const n = pendingFor(session);
      return n ? `enregistrement… (${n} vague${n > 1 ? 's' : ''})` : '✓ enregistré sur le serveur';
    };
    const launch = async () => {
      if (running || s.over || showVictory) return;
      note = '';
      confirmAbandon = false;
      choosing = false;
      snapshot = { s: structuredClone(s), actions: actions.slice() };
      running = startWave(s);
      const number = running.number;
      prev = new Map();
      last = performance.now();
      acc = 0;
      blip(330);
      render();
      await new Promise<void>((resolve) => (onEnd = resolve));
      if (gone) return;
      const sent = actions.join(';');
      actions = [];
      snapshot = null;
      if (s.won) recordStars(meta, s.level, starsOf(s));
      // La vague part au serveur tout de suite (file gardée dans le navigateur jusqu'à confirmation).
      if (session) {
        enqueue({ session, step: number - 1, actions: sent });
      }
      if (!campaign && s.wave >= FINAL_WAVE && !victorySeen && !s.over) {
        victorySeen = true;
        showVictory = true;
      }
      if (s.won) blip(880);
      persist();
      render();
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!running) return;
      const dt = now - last;
      last = now;
      if (paused || isPanicked()) return draw(Math.min(1, acc / TICK_MS));
      acc += dt * speed;
      if (acc > TICK_MS * 30) acc = TICK_MS * 30; // onglet en arrière-plan : on rattrape sans geler la page
      let ticked = false;
      while (acc >= TICK_MS && running) {
        acc -= TICK_MS;
        if (!ticked) fx = [];
        ticked = true;
        prev = new Map(running.enemies().map((e) => [e.uid, [e.x, e.y]]));
        const before = s.kills;
        const more = running.tick(fx);
        if (s.kills > before) blip(520, 0.03);
        if (!more) {
          running = null;
          fx = [];
          onEnd();
          render();
          return;
        }
      }
      draw(Math.min(1, acc / TICK_MS));
      const lv = stats.querySelector('[data-k="lives"]');
      const gd = stats.querySelector('[data-k="gold"]');
      if (lv) lv.textContent = String(s.lives);
      if (gd) gd.textContent = String(s.gold);
    };

    // --- Actions
    const act = (a: string) => {
      if (s.over || showVictory) return;
      const err = running ? running.act(a) : applyAction(s, a);
      if (err) note = err.charAt(0).toUpperCase() + err.slice(1) + '.';
      else {
        note = '';
        actions.push(running ? `${a}@${running.ticks()}` : a);
        if (!running) persist();
      }
      render();
      if (running) draw(Math.min(1, acc / TICK_MS));
    };

    const abandon = () => {
      if (!confirmAbandon && !s.over) {
        confirmAbandon = true;
        note = 'R encore une fois pour abandonner cette partie.';
        return render();
      }
      toMenu();
    };

    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      cx = Math.max(0, Math.min(COLS - 1, Math.floor((e.clientX - r.left) / cell)));
      cy = Math.max(0, Math.min(ROWS - 1, Math.floor((e.clientY - r.top) / cell)));
      render();
    });

    const offKeys = pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (s.over) {
        if (key === 'enter' || key === ' ') {
          e.preventDefault();
          return s.won ? outro() : retry();
        }
        if (key === 'm') return toMenu();
        if (key === 'c') return navigate('/td/caisses');
        if (key === 'backspace') {
          e.preventDefault();
          return ctx.onExit();
        }
        return;
      }
      if (showVictory && (key === 'enter' || key === ' ')) {
        e.preventDefault();
        showVictory = false;
        persist();
        return render();
      }
      if (choosing) {
        choosing = false;
        if (key === '1' || key === '2') return act(`U${cx}.${cy}.${Number(key) - 1}`);
        if (key !== 'u') render();
        if (key === 'u') return render();
      }
      const slot = KEYS.indexOf(key);
      if (key === 'arrowleft') cx = Math.max(0, cx - 1);
      else if (key === 'arrowright') cx = Math.min(COLS - 1, cx + 1);
      else if (key === 'arrowup') cy = Math.max(0, cy - 1);
      else if (key === 'arrowdown') cy = Math.min(ROWS - 1, cy + 1);
      else if (slot >= 0 && slot < s.allowed.length) return act(`B${cx}.${cy}.${TOWERS.findIndex((t) => t.id === s.allowed[slot])}`);
      else if (key === 'u') {
        const t = towerAt(cx, cy);
        if (t && t.level === 2 && t.level + 1 <= s.tier) {
          choosing = true;
          return render();
        }
        if (t && TOWERS[t.kind].special && t.locked) return act(`A${cx}.${cy}`);
        return act(`U${cx}.${cy}`);
      } else if (key === 's') return act(`S${cx}.${cy}`);
      else if (key === ' ' || key === 'enter') {
        e.preventDefault();
        return void launch();
      } else if (key === 'f') speed = speed === 3 ? 1 : speed + 1;
      else if (key === 'p') paused = !paused;
      else if (key === 'r') return abandon();
      else if (key === 'backspace') {
        e.preventDefault();
        return ctx.onExit();
      } else return;
      e.preventDefault();
      render();
    });

    const onResize = () => {
      resize();
      render();
    };
    window.addEventListener('resize', onResize);
    resize();
    void metaReady.then(() => render());
    render();
    raf = requestAnimationFrame(frame);

    return () => {
      gone = true;
      offUpload();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      offKeys();
      // Vague en cours abandonnée : on revient à son début (le serveur ne l'a pas encore vue).
      if (running && snapshot) {
        s = snapshot.s;
        actions = snapshot.actions;
      }
      if (!s.over && load<Saved | null>(SAVE_KEY, null)) persist();
    };
  };

  startUploads(); // vagues restées en attente (page rechargée, réseau coupé…)
  const resumed = load<Saved | null>(SAVE_KEY, null);
  show(resumed && !resumed.s.over ? () => runScreen(resumed) : menuScreen);

  return () => {
    disposed = true;
    leave();
  };
}

export const towerDefense: Game = {
  id: 'td',
  name: 'Tower defense',
  description: 'Solo · campagne de 20 niveaux, mode infini classé',
  modes: ['solo'],
  mount,
};
