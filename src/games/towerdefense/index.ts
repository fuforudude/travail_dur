import { isTyping, pushKeys } from '../../core/input';
import { isPanicked } from '../../core/panic';
import { blip } from '../../core/sound';
import { isTouch, pressKey, touchPad } from '../../core/touch';
import { load, remove, save, setBest } from '../../core/storage';
import { GAIN_MULT } from '../../net/points';
import { multiConfigured } from '../../net/supabase';
import { navigate } from '../../router';
import { h, hints } from '../../ui/dom';
import { spatialNav } from '../../ui/menu';
import type { Game, GameContext } from '../types';
import {
  BONUS, bonusLevel, CHAPTER2_COUNT, CHAPTER2_FIRST, CHAPTER2_LAST, ENEMIES, inChapter2, FINAL_WAVE, HEROES, LEVEL_COUNT, levelBoss, levelWaves, mapOf, MAX_LEVEL, MAX_STARS, maxTier,
  PERK_MAX, perkCost, PERKS, TIER_UNLOCK, TOWERS, towersFor, towerStats, type TowerStats,
} from './engine/data';
import {
  applyAction, newRun, planLevelWave, planWave, priceOf, sellValue, specialPrice, starsOf, startWave, TICK, upgradeOf,
  type Enemy, type Fx, type Mode, type Running, type RunState,
} from './engine/sim';
import {
  buyPerk, emptyMeta, equippedFinish, loadMeta, perksOf, recordStars, resetPerks, starBalance, tdServerUp, type Meta,
} from './net';
import { enqueue, keepTicket, onUpload, pendingFor, startUploads, takeTicket, withPending } from './uploads';
import { drawEnemy, drawTower, enemyLook, enemyRadius, previewItem, readPalette, towerLook, type Palette } from './render';
import { ACTS, ACTS2, actOf, BONUS_ACT, bossName, levelStory, prologueOf, type Line } from './story';
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
const levelPoints = (L: number, first: boolean) => GAIN_MULT * (first ? 100 + 40 * Math.min(L, 45) : 5 * Math.min(L, 45));
/**
 * Numéro affiché : le chapitre 2 continue la campagne (21 à 70) ; en interne il occupe 26 à 75,
 * après les défis bonus (21 à 25, affichés B1 à B5).
 */
const shownLevel = (L: number) => (inChapter2(L) ? L - 5 : L);
const levelTitle = (L: number) => (bonusLevel(L) ? `Défi ${L - LEVEL_COUNT}` : `Niveau ${shownLevel(L)}`);
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

/** Caractéristiques d'une tour, en lignes « libellé : valeur » pour sa fiche. */
function statRows(st: TowerStats): [string, string][] {
  const rows: [string, string][] = [];
  if (st.income) {
    rows.push(['Revenu', `+${st.income} or / vague`]);
    if (st.interest) rows.push(['Intérêts', `${Math.round(st.interest * 100)} % (max ${st.interestCap})`]);
    if (st.aura) rows.push(['Aura', `cadence +${Math.round((st.auraRate ?? 0) * 100)} %, portée +${Math.round((st.auraRange ?? 0) * 100)} %`]);
    return rows;
  }
  if (st.holePct) {
    rows.push(['Trou noir', `${fmt(st.holePct * 100)} % PV max/s`], ['Fréquence', `toutes les ${fmt(st.holeEvery ?? 6)} s`], ['Rayon', fmt(st.holeRadius ?? 1)]);
  } else if (st.beam) rows.push(['Rayon', `${st.beam}/s${(st.beams ?? 1) > 1 ? ` × ${st.beams}` : ''}`]);
  else if (st.dot) rows.push(['Poison', `${st.dot}/s, ${st.maxStacks} cumuls`]);
  else rows.push(['Dégâts', `${st.fireRate ? st.damage : `${st.damage}/s`} ${DAMAGE[st.damageType ?? 'physical']}`]);
  if (st.fireRate) rows.push(['Cadence', `${fmt(st.fireRate)} tir/s`]);
  rows.push(['Portée', st.range >= 50 ? 'toute la carte' : fmt(st.range)]);
  rows.push(['Cibles', st.hitsAir ? 'sol et air' : 'sol']);
  if (st.detectsCamo) rows.push(['Camouflés', 'détectés']);
  if (st.splash) rows.push(['Zone', fmt(st.splash)]);
  if (st.slow) rows.push(['Ralentit', `${Math.round(st.slow * 100)} %`]);
  if (st.stun) rows.push(['Étourdit', `${fmt(st.stun)} s`]);
  if ((st.chain ?? 0) > 1) rows.push(['Chaîne', `${st.chain} cibles`]);
  if ((st.pierce ?? 1) > 1) rows.push(['Perce', `${st.pierce} ennemis`]);
  if (st.crit) rows.push(['Critique', `${Math.round(st.crit * 100)} % (×${st.critMult})`]);
  return rows;
}

/** Ce que débloque le passage de `from` à `to` niveaux terminés. */
function unlocksBetween(from: number, to: number): string[] {
  const out: string[] = [];
  for (const id of towersFor(to)) if (!towersFor(from).includes(id)) out.push(`la tour ${towerName(id)}`);
  const names = ['', 'la 1re amélioration', 'la 2e amélioration', 'le choix d’une voie (3e amélioration)', 'la dernière amélioration de chaque voie'];
  for (let t = maxTier(from) + 1; t <= maxTier(to); t++) out.push(names[t]);
  return out;
}

function mount(ctx: GameContext): () => void {
  let meta: Meta = emptyMeta();
  let leave: () => void = () => {};
  let disposed = false;
  // Progression du serveur + résultats encore en route vers lui (file d'envoi).
  const metaReady = loadMeta().then((m) => (meta = withPending(m)));

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
        h('b', {}, bonus ? `B${L - LEVEL_COUNT}` : String(shownLevel(L))),
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
    void keepTicket(); // la prochaine partie démarre aussitôt, même si le serveur traîne
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
      // Chapitre 2 : après le niveau 20, puis dans l'ordre.
      const cleared2 = meta.cleared2;
      const acts2 = ACTS2.map((act, k) => {
        const to = (ACTS2[k + 1]?.from ?? CHAPTER2_LAST + 1) - 1;
        const buttons: HTMLElement[] = [];
        for (let L = act.from; L <= to; L++) {
          const open = cleared >= LEVEL_COUNT && (L === CHAPTER2_FIRST || cleared2 >= L - 1);
          buttons.push(levelButton(L, open, L === CHAPTER2_FIRST ? `après le niveau ${LEVEL_COUNT}` : ''));
        }
        return h('section', { class: 'td-act' }, h('h3', {}, act.name), h('div', { class: 'td-levels' }, ...buttons));
      });
      const done2 = [...meta.stars.keys()].filter(inChapter2).length;

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
        h('span', { class: 'small muted' }, meta.best ? `Record : vague ${meta.best}` : 'Classé'),
      );
      infinite.addEventListener('click', () => play('infinite', 0));
      const crates = h('button', { class: 'field', type: 'button' }, 'Caisses (héros, skins)');
      crates.addEventListener('click', () => navigate('/td/caisses'));

      wrap.replaceChildren(
        serverDown && !navigator.onLine
          ? h('p', { class: 'notice td-server-down' }, 'Pas de réseau : tes parties sont gardées sur cet appareil et enregistrées dès le retour de la connexion.')
          : serverDown && pendingFor()
          ? h('p', { class: 'notice td-server-down' }, 'Le serveur ne répond pas pour l’instant : tes parties sont gardées sur cet appareil et enregistrées dès qu’il répond.')
          : serverDown
          ? h('p', { class: 'notice td-server-down' }, '⚠ Le serveur du tower defense est injoignable : tes parties ne sont pas enregistrées (niveaux réussis, étoiles, classement). Il faut déployer la fonction serveur « td » sur Supabase.')
          : '',
        h(
          'div',
          { class: 'td-deck-head' },
          h(
            'div',
            {},
            h('h2', {}, 'L’expédition'),
            h('p', { class: 'muted small' }, `${cleared} / ${LEVEL_COUNT} niveaux${cleared >= LEVEL_COUNT ? ` · chapitre 2 : ${done2} / ${CHAPTER2_COUNT}` : ''} · ★ ${balance.earned} / ${MAX_STARS}`),
          ),
          h('div', { class: 'td-deck-actions' }, crates),
        ),
        ...acts,
        h('section', { class: 'td-act' }, h('h3', {}, BONUS_ACT.name), h('div', { class: 'td-levels' }, ...bonusButtons)),
        h('h2', { class: 'td-chapter' }, 'Chapitre 2 · La chasse à la sorcière'),
        ...acts2,
        h('section', { class: 'td-act' }, h('h3', {}, 'Après l’expédition'), h('div', { class: 'td-levels' }, infinite)),
        h(
          'section',
          { class: 'td-act' },
          h('h3', {}, `Boutique à étoiles · ★ ${balance.left} à dépenser`),
          h('div', { class: 'td-heroes' }, ...perkRows),
          h('div', { class: 'td-deck-actions' }, reset),
          shopNote ? h('p', { class: 'status td-shop-note' }, shopNote) : '',
        ),
        h(
          'section',
          { class: 'td-act' },
          h('h3', {}, 'Héros'),
          h('div', { class: 'td-heroes' }, heroBtn(null), ...owned.map(heroBtn)),
          owned.length ? '' : h('p', { class: 'muted small' }, 'Les héros sortent des caisses (C).'),
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
      const next = cleared < LEVEL_COUNT ? cleared + 1 : cleared2 ? Math.min(CHAPTER2_LAST, cleared2 + 1) : CHAPTER2_FIRST;
      const target = focusLevel ? `level:${focusLevel}` : `level:${next}`;
      (wrap.querySelector<HTMLElement>(`[data-id="${target}"]`) ?? wrap.querySelector<HTMLElement>('.td-level'))?.focus();
    };

    const play = (mode: Mode, L: number) => {
      if (starting) return;
      focusLevel = L;
      if (mode === 'infinite') return void begin(mode, 0);
      const lines = [...prologueOf(L), ...levelStory(L).intro];
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


  /**
   * Lance une partie, sans attendre le serveur : elle démarre sur le ticket réservé d'avance, et son
   * démarrage part dans la file d'envoi (uploads.ts). Sans ticket (toute première partie, serveur
   * injoignable depuis l'ouverture du jeu), on en demande un, puis la partie est jouée sur place,
   * non enregistrée.
   */
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
    const options = { mode, level: L, cleared: meta.cleared, cleared2: meta.cleared2, hero: chosenHero(), perks: perksOf(meta) };
    const ticket = takeTicket() ?? (multiConfigured && (await keepTicket(6000)) ? takeTicket() : null);
    if (disposed) return;
    let saved: Saved;
    if (ticket) {
      saved = { s: newRun(ticket.seed, options), actions: [], session: ticket.id };
      enqueue({ kind: 'start', session: ticket.id, options });
      runNote = '';
    } else {
      saved = { s: newRun((Math.random() * 2 ** 32) >>> 0, options), actions: [], session: null };
      runNote = multiConfigured ? '⚠ Serveur injoignable : cette partie ne sera pas enregistrée.' : '';
    }
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
      touchPad([{ label: 'Passer', key: 'Tab' }, { label: 'Suite', key: 'Enter', wide: true }]),
      hints(['Entrée', 'suite'], ['Tab', 'passer'], ['Retour arrière', 'carte']),
    );
    ctx.root.append(wrap);
    const render = () => {
      const shown = lines.slice(0, i + 1);
      box.replaceChildren(
        ...shown.map((l, k) => h('p', { class: `td-line${k === i ? ' now' : ''}` }, h('b', {}, `${l.who} : `), l.text)),
        h('p', { class: 'muted small' }, i < lines.length - 1 ? `${i + 1} / ${lines.length}` : isTouch() ? 'Touche l’écran pour continuer' : 'Entrée pour continuer'),
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
        touchPad(
          [{ label: map.special ? 'Améliorer / débloquer' : 'Améliorer', key: 'u', wide: true }, { label: 'Vendre', key: 's' }],
          [{ label: '▶ Vague', key: ' ', wide: true }, { label: 'Vitesse', key: 'f' }, { label: 'Pause', key: 'p' }],
        ),
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
    // Ondes des clics sur le plateau (coordonnées en pixels du canvas).
    const RIPPLE_MS = 450;
    let ripples: { x: number; y: number; at: number }[] = [];
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
      // Onde au point cliqué : on voit que le clic a été pris en compte.
      const t = performance.now();
      ripples = ripples.filter((rp) => t - rp.at < RIPPLE_MS);
      for (const rp of ripples) {
        const k = (t - rp.at) / RIPPLE_MS;
        g.save();
        g.globalAlpha = 1 - k;
        g.strokeStyle = pal.accent;
        g.lineWidth = 3 * (1 - k) + 1;
        g.beginPath();
        g.arc(rp.x, rp.y, cell * (0.15 + 0.6 * k), 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
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

    const actionButton = (label: string, action: string, opts: { disabled?: boolean; main?: boolean } = {}) => {
      const b = h('button', { class: `field${opts.main ? ' rl-spin' : ''}`, type: 'button', disabled: opts.disabled }, label);
      b.addEventListener('click', () => act(action));
      return b;
    };

    /** Fiche de la tour sélectionnée : stats lisibles et boutons d'action. */
    const towerCard = (t: RunState['towers'][number]): HTMLElement => {
      const def = TOWERS[t.kind];
      const st = towerStats(def, t.level, t.path);
      const head = h(
        'div',
        { class: 'td-card-head' },
        previewItem(def.as ?? def.id, 36, def.special ? null : towerFinish(t.kind)),
        h('b', {}, def.name),
        h('span', { class: 'muted small' }, def.special ? `spéciale · dégâts ×${fmt(t.power ?? 1)}` : levelName(t)),
      );
      const grid = h('div', { class: 'td-card-stats' }, ...statRows(st).map(([k, v]) => h('div', { class: 'td-stat' }, h('span', {}, k), h('b', {}, v))));
      const actions: HTMLElement[] = [];
      const extra: HTMLElement[] = [];
      if (def.special) {
        const price = specialPrice(s) ?? 0;
        if (t.locked) actions.push(actionButton(`Débloquer · ${price} or`, `A${t.x}.${t.y}`, { disabled: s.gold < price, main: true }));
      } else {
        const sell = actionButton(`Vendre +${sellValue(t)}`, `S${t.x}.${t.y}`);
        if (t.level >= MAX_LEVEL) actions.push(h('span', { class: 'muted small' }, 'Niveau maximum'));
        else if (t.level + 1 > s.tier) actions.push(h('span', { class: 'muted small' }, `🔒 après le niveau ${TIER_UNLOCK[t.level + 1]}`));
        else if (t.level === 2) {
          // Choix de la voie (définitif) : un bouton par voie.
          extra.push(
            h(
              'div',
              { class: 'td-paths' },
              ...def.paths.map((p, k) => {
                const up = p.ups[0];
                const cost = priceOf(s, up.cost);
                const b = h(
                  'button',
                  { class: `td-path${choosing ? ' on' : ''}`, type: 'button', disabled: s.gold < cost },
                  h('b', {}, `${choosing ? `${k + 1} · ` : ''}${p.name} · ${cost} or`),
                  h('span', { class: 'small' }, up.text),
                );
                b.addEventListener('click', () => {
                  choosing = false;
                  act(`U${t.x}.${t.y}.${k}`);
                });
                return b;
              }),
            ),
          );
        } else {
          const up = upgradeOf(t)!;
          const cost = priceOf(s, up.cost);
          actions.push(actionButton(`Améliorer · ${cost} or`, `U${t.x}.${t.y}`, { disabled: s.gold < cost, main: true }));
          extra.push(h('p', { class: 'small muted td-card-next' }, `${up.name} : ${up.text}`));
        }
        actions.push(sell);
      }
      return h('div', { class: 'td-card' }, head, grid, actions.length ? h('div', { class: 'td-card-actions' }, ...actions) : '', ...extra);
    };

    const render = () => {
      if (gone) return;
      const w = running ? running.number : s.wave + 1;
      const total = campaign ? levelWaves(s.level) : FINAL_WAVE;
      stats.replaceChildren(
        campaign ? h('span', { class: 'stat' }, bonusLevel(s.level) ? 'Défi ' : 'Niveau ', h('b', {}, String(bonusLevel(s.level) ? s.level - LEVEL_COUNT : shownLevel(s.level)))) : '',
        h('span', { class: 'stat' }, 'Vague ', h('b', {}, w <= total ? `${Math.min(w, total)}/${total}` : `${w} ∞`)),
        h('span', { class: 'stat' }, 'Vies ', h('b', { 'data-k': 'lives' }, String(s.lives))),
        h('span', { class: 'stat' }, 'Or ', h('b', { 'data-k': 'gold' }, String(s.gold))),
        h('span', { class: 'stat' }, '×', h('b', {}, String(speed))),
        s.hero ? h('span', { class: 'small muted' }, `${HEROES.find((x) => x.id === s.hero!.id)?.name ?? ''} niv. ${s.hero.level}`) : '',
      );
      const shop = s.allowed.map((id, i) => {
        const def = TOWERS.find((t) => t.id === id)!;
        const count = s.towers.filter((t) => TOWERS[t.kind].id === id).length;
        const full = def.maxPerMap !== undefined && count >= def.maxPerMap;
        const cost = priceOf(s, def.cost);
        const chip = h('button', { class: 'chip td-chip' + (s.gold >= cost && !full ? '' : ' off'), type: 'button' }, h('kbd', { class: 'keyboard-only' }, KEYS[i]), ` ${def.name} ${cost}`, full ? ' (max)' : '');
        chip.addEventListener('click', () => pressKey(KEYS[i]));
        return chip;
      });
      const t = towerAt(cx, cy);
      if (!t || t.level !== 2) choosing = false;
      const detail: (HTMLElement | string)[] = [];
      if (t) detail.push(towerCard(t));

      const blocks: HTMLElement[] = [];
      if (!running && !s.over) {
        const plan = campaign ? planLevelWave(s.seed, s.level, s.wave + 1) : planWave(s.seed, s.wave + 1);
        const counts = new Map<number, number>();
        for (const sp of plan.spawns) counts.set(sp.enemy, (counts.get(sp.enemy) ?? 0) + 1);
        const list = [...counts].map(([e, n]) => (ENEMIES[e].tier === 'boss' ? bossName(ENEMIES[e], s.level) : `${n} ${ENEMIES[e].name}`)).join(', ');
        const tag = plan.boss !== null ? ' · BOSS' : plan.theme ? ` · vague thématique « ${plan.theme} »` : '';
        blocks.push(h('p', { class: 'small' }, h('b', {}, `Vague ${plan.wave}${tag}`), ` : ${list}. ${isTouch() ? '▶ Vague' : 'Espace'} pour lancer.`));
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
          h('span', { class: 'muted small' }, `${isTouch() ? '▶ Vague' : 'Entrée'} pour continuer (les PV montent de 8 % par vague).`),
        );
        overlay.hidden = false;
      } else if (paused) {
        overlay.replaceChildren(h('strong', {}, 'Pause'), h('span', { class: 'muted small' }, isTouch() ? 'Pause pour reprendre' : 'P pour reprendre'));
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
      const bonus = s.level > LEVEL_COUNT; // défi bonus ou chapitre 2 : pas de déblocage de tours
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
        saveLine(),
        h('div', { class: 'td-deck-actions' }, button('Carte', toMenu), button('La suite de l’histoire', outro, true)),
        h('span', { class: 'muted small keyboard-only' }, 'Entrée la suite · M carte'),
      ];
    };

    const lostOverlay = () => {
      const foe = s.lostTo ? ENEMIES.find((e) => e.id === s.lostTo) : null;
      return [
        h('strong', {}, campaign ? `Perdu au niveau ${s.level}, vague ${s.wave + 1}` : `Perdu à la vague ${s.wave + 1}`),
        h('span', {}, `${plural(s.wave, 'vague')} tenue${s.wave > 1 ? 's' : ''} · ${plural(s.kills, 'ennemi')} vaincu${s.kills > 1 ? 's' : ''}${s.bossKills ? ` · ${plural(s.bossKills, 'boss')}` : ''}`),
        session && !campaign ? h('span', { class: 'small' }, `+${GAIN_MULT * s.wave * (s.wave + 1)} points ◆ gagnés`) : '',
        saveLine(),
        foe ? h('span', { class: 'small muted' }, `Vaincu par : ${foe.tier === 'boss' ? bossName(foe, s.level) : foe.name}. Contre conseillé : ${foe.counters}.`) : '',
        h('div', { class: 'td-deck-actions' }, button('Carte', toMenu), button('Recommencer', retry, true)),
        h('span', { class: 'muted small keyboard-only' }, 'Entrée recommencer · M carte · C caisses'),
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
      focusLevel = bonusLevel(s.level) ? s.level : inChapter2(s.level) ? Math.min(CHAPTER2_LAST, s.level + 1) : Math.min(LEVEL_COUNT, s.level + 1);
      const L = s.level;
      show(() => storyScreen(`${levelTitle(L)} · ${levelStory(L).name}`, actOf(L).name, levelStory(L).outro, () => show(menuScreen), () => show(menuScreen)));
    };

    // --- Vagues
    let onEnd: () => void = () => {};
    // L'enregistrement se fait tout seul, en arrière-plan : on n'en parle qu'en fin de partie, ou si
    // le serveur refuse la partie.
    const offUpload = onUpload((e) => {
      if (gone || e.kind === 'waiting' || e.session !== session) return;
      if (e.kind === 'refused') {
        note = `⚠ Le serveur a refusé cette partie (${e.message}) : elle ne sera pas enregistrée.`;
        session = null;
        persist();
        render();
      } else if (s.over) render();
    });
    /** Où en est l'enregistrement, en fin de partie. */
    const saveLine = () => {
      if (!multiConfigured) return '';
      if (!session) return h('span', { class: 'small td-unsaved' }, '⚠ partie non enregistrée');
      if (!pendingFor(session)) return h('span', { class: 'small muted' }, '✓ enregistré');
      return h('span', { class: 'small muted' }, navigator.onLine ? 'Enregistrement… (tu peux quitter, il se termine tout seul)' : 'Gardé sur cet appareil : enregistré au retour du réseau');
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
      // La vague part au serveur tout de suite (file gardée dans le navigateur jusqu'à confirmation),
      // avec son résultat attendu : la carte en tient compte en attendant le serveur.
      if (session) {
        const outcome = { mode: s.mode, level: s.level, wave: s.wave, won: s.won, stars: s.won ? starsOf(s) : 0 };
        enqueue({ session, step: number - 1, actions: sent, outcome });
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
      if (!running) {
        if (ripples.length) draw(1); // l'onde d'un clic s'anime aussi entre les vagues
        return;
      }
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
      ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, at: performance.now() });
      blip(towerAt(cx, cy) ? 620 : 480, 0.02);
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
