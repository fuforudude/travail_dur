import { isTyping, pushKeys } from '../../core/input';
import { isPanicked } from '../../core/panic';
import { blip } from '../../core/sound';
import { load, remove, save, setBest } from '../../core/storage';
import { getAccount } from '../../net/auth';
import { multiConfigured } from '../../net/supabase';
import { navigate } from '../../router';
import { h, hints } from '../../ui/dom';
import { spatialNav } from '../../ui/menu';
import type { Game, GameContext } from '../types';
import { crateOf, isFree } from './catalog';
import { COLS, deckSlots, ENEMIES, FINAL_WAVE, PATH, ROWS, TOWERS, towerStats, type TowerStats } from './engine/data';
import {
  applyAction, isBuildable, newRun, planWave, sellValue, startWave, TICK, upgradeOf,
  type Enemy, type Fx, type Running, type RunState,
} from './engine/sim';
import { equippedFinish, loadMeta, sendWave, startRun, type Meta } from './net';
import { drawEnemy, drawTower, enemyLook, enemyRadius, previewItem, readPalette, towerLook, type Palette } from './render';
import './td.css';

interface Saved {
  s: RunState;
  actions: string[]; // constructions depuis la dernière vague (envoyées à la fin de la suivante)
  session: string | null;
  victory?: boolean; // message de la vague 50 déjà montré
}

const SAVE_KEY = 'state:td2';
const TICK_MS = TICK * 1000;
const LEVELS = ['Base', 'U1', 'U2'];
const DAMAGE = { physical: 'physique', magic: 'magique', pure: 'pur' } as const;

const plural = (n: number, word: string) => `${n} ${word}${n > 1 && !/[sx]$/.test(word) ? 's' : ''}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

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

function mount(ctx: GameContext): () => void {
  let meta: Meta = { owned: new Set(), equipped: new Map(), best: 0, online: false };
  let leave: () => void = () => {};
  let disposed = false;
  const metaReady = loadMeta().then((m) => (meta = m));

  const show = (screen: () => () => void) => {
    leave();
    ctx.root.querySelector('.game')?.remove();
    leave = screen();
  };

  // =============================================================================================
  // Écran du deck : choisir ses tours avant la run
  // =============================================================================================
  const deckScreen = () => {
    const wrap = h('div', { class: 'game td-deck' }, h('p', { class: 'muted' }, 'Chargement…'));
    ctx.root.append(wrap);
    let deck: string[] = load<string[]>('deck:td', ['crossbow', 'cannon', 'frost']);
    let note = '';
    let starting = false;
    let focusId = '';
    const has = (id: string) => isFree(id) || meta.owned.has(id);

    const render = () => {
      const slots = deckSlots(meta.best);
      deck = deck.filter(has).slice(0, slots);
      const cards = TOWERS.map((t) => {
        const owned = has(t.id);
        const inDeck = deck.includes(t.id);
        const ups = t.upgrades.map((u, i) => (isFree(u.id) || meta.owned.has(u.id) ? `U${i + 1}` : null)).filter(Boolean).join(' ');
        const b = h(
          'button',
          { class: `shop-item td-card${inDeck ? ' on' : ''}${owned ? '' : ' locked'}`, type: 'button', 'data-id': t.id },
          h('span', { class: 'shop-preview' }, previewItem(t.id, 48, equippedFinish(meta, 'ts', t.id))),
          h('span', { class: 'shop-name' }, t.name),
          h('span', { class: 'muted small' }, `${t.role} · ${t.cost} or`),
          h('span', { class: 'shop-price' }, owned ? (inDeck ? `Dans le deck${ups ? ' · ' + ups : ''}` : `Ajouter${ups ? ' · ' + ups : ''}`) : `🔒 ${crateOf(t.id)?.name ?? ''}`),
        );
        b.addEventListener('click', () => toggle(t.id));
        return b;
      });
      const launch = h('button', { class: 'field rl-spin', type: 'button' }, starting ? 'Lancement…' : 'Lancer la run');
      launch.addEventListener('click', () => void begin());
      const crates = h('button', { class: 'field', type: 'button' }, 'Caisses et skins');
      crates.addEventListener('click', () => navigate('/td/caisses'));
      wrap.replaceChildren(
        h(
          'div',
          { class: 'td-deck-head' },
          h('div', {}, h('h2', {}, 'Ton deck'), h('p', { class: 'muted small' }, `${deck.length} / ${slots} tours · record : vague ${meta.best}${slots < 6 ? ` · un emplacement de plus à la vague ${[15, 30, 45][slots - 3]}` : ''}`)),
          h('div', { class: 'td-deck-actions' }, crates, launch),
        ),
        h('div', { class: 'shop-grid td-deck-grid' }, ...cards),
        h('p', { class: 'status' }, note),
        h('p', { class: 'muted small' }, `50 vagues, un boss toutes les 10, puis le mode infini. Chaque vague n terminée rapporte 2 × n points ◆, qui ouvrent les caisses de tours et de skins.`),
        hints(['← ↑ → ↓', 'tour'], ['Entrée', 'ajouter / retirer'], ['Espace', 'lancer'], ['C', 'caisses'], ['Retour arrière', 'quitter']),
      );
      (wrap.querySelector<HTMLElement>(`[data-id="${focusId}"]`) ?? wrap.querySelector<HTMLElement>('.td-card'))?.focus();
    };

    const toggle = (id: string) => {
      focusId = id;
      note = '';
      if (!has(id)) note = `À débloquer dans la ${crateOf(id)?.name ?? 'boutique'}.`;
      else if (deck.includes(id)) deck = deck.filter((d) => d !== id);
      else if (deck.length >= deckSlots(meta.best)) note = 'Deck plein : retire d’abord une tour.';
      else deck = [...deck, id];
      save('deck:td', deck);
      render();
    };

    const begin = async () => {
      if (starting) return;
      if (!deck.length) {
        note = 'Choisis au moins une tour.';
        return render();
      }
      starting = true;
      render();
      let saved: Saved;
      try {
        if (!multiConfigured) throw new Error('');
        const r = await startRun(deck);
        saved = { s: r.state, actions: [], session: r.id };
      } catch (e) {
        const msg = (e as Error).message;
        saved = { s: newRun((Math.random() * 2 ** 32) >>> 0, deck, [...meta.owned]), actions: [], session: null };
        runNote = msg ? `Partie non classée : ${msg}.` : '';
      }
      if (disposed) return;
      save(SAVE_KEY, saved);
      show(() => runScreen(saved));
    };

    void metaReady.then(() => !disposed && render());
    const nav = spatialNav(wrap);
    const offKeys = pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        return ctx.onExit();
      }
      if (e.key === ' ') {
        e.preventDefault();
        return void begin();
      }
      if (e.key.toLowerCase() === 'c') return navigate('/td/caisses');
      if (nav(e)) focusId = (document.activeElement as HTMLElement | null)?.dataset.id ?? focusId;
    });
    return offKeys;
  };

  // =============================================================================================
  // La run
  // =============================================================================================
  let runNote = '';

  const runScreen = (saved: Saved) => {
    let s = saved.s;
    let actions = saved.actions;
    let session = saved.session;
    let victorySeen = Boolean(saved.victory);
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
          ['← ↑ → ↓', 'case'], ['1 – 6', 'construire'], ['U', 'améliorer'], ['S', 'vendre'], ['Espace', 'lancer la vague'],
          ['F', 'vitesse'], ['P', 'pause'], ['R', 'abandonner'], ['Retour arrière', 'quitter'],
        ),
      ),
    );

    const persist = () => {
      if (s.over) remove(SAVE_KEY);
      else save(SAVE_KEY, { s, actions, session, victory: victorySeen } satisfies Saved);
      setBest('td2', s.wave);
    };

    let cell = 32;
    const resize = () => {
      const cs = getComputedStyle(ctx.root);
      const inner = ctx.root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = Math.min(720, inner > 0 ? inner : 640);
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
      for (const [x, y] of PATH) g.fillRect(x * cell, y * cell, cell, cell);
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
      g.fillText('›', PATH[0][0] * cell + cell / 2, PATH[0][1] * cell + cell / 2);
      g.fillText('⚑', PATH[PATH.length - 1][0] * cell + cell / 2, PATH[PATH.length - 1][1] * cell + cell / 2);

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
      }

      // portée de la tour sous le curseur
      const hover = towerAt(cx, cy);
      if (hover) {
        const st = towerStats(TOWERS[hover.kind], hover.level);
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
        const id = TOWERS[t.kind].id;
        drawTower(g, id, t.level, (t.x + 0.5) * cell, (t.y + 0.5) * cell, cell, l?.angle ?? -Math.PI / 2, towerLook(id, towerFinish(t.kind), pal, now), now, { disabled: (l?.disabledT ?? 0) > 0 });
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
    const render = () => {
      if (gone) return;
      const w = running ? running.number : s.wave + 1;
      stats.replaceChildren(
        h('span', { class: 'stat' }, 'Vague ', h('b', {}, w <= FINAL_WAVE ? `${w}/${FINAL_WAVE}` : `${w} ∞`)),
        h('span', { class: 'stat' }, 'Vies ', h('b', {}, String(s.lives))),
        h('span', { class: 'stat' }, 'Or ', h('b', {}, String(s.gold))),
        h('span', { class: 'stat' }, '×', h('b', {}, String(speed))),
        h('span', { class: 'muted small td-rank' }, session ? 'partie classée' : 'non classée'),
      );
      const shop = s.deck.map((id, i) => {
        const def = TOWERS.find((t) => t.id === id)!;
        const count = s.towers.filter((t) => TOWERS[t.kind].id === id).length;
        const full = def.maxPerMap !== undefined && count >= def.maxPerMap;
        return h('span', { class: 'chip' + (s.gold >= def.cost && !full ? '' : ' off') }, h('kbd', {}, String(i + 1)), ` ${def.name} ${def.cost}`, full ? ' (max)' : '');
      });
      const t = towerAt(cx, cy);
      const detail: (HTMLElement | string)[] = [];
      if (t) {
        const def = TOWERS[t.kind];
        const st = towerStats(def, t.level);
        detail.push(h('p', { class: 'small' }, h('b', {}, `${def.name} · ${LEVELS[t.level]}`), ` — ${statsLine(st)}`));
        const up = upgradeOf(t);
        const sell = `S vendre (+${sellValue(t)}${t.fresh ? ', prix plein' : ''})`;
        if (!up) detail.push(h('p', { class: 'small muted' }, `Niveau maximum · ${sell}`));
        else if (!s.unlocked.includes(up.id)) detail.push(h('p', { class: 'small muted' }, `🔒 ${up.name} : à débloquer (${crateOf(up.id)?.name ?? 'caisse'}) · ${sell}`));
        else detail.push(h('p', { class: 'small' }, `U ${up.name} (${up.cost} or) : ${up.text} · ${sell}`));
      } else if (isBuildable(cx, cy)) detail.push(h('p', { class: 'small muted' }, `Case libre : ${s.deck.map((_, i) => i + 1).join(', ')} pour construire.`));
      else detail.push(h('p', { class: 'small muted' }, 'Chemin des ennemis.'));

      const blocks: HTMLElement[] = [];
      if (!running && !s.over) {
        const plan = planWave(s.seed, s.wave + 1);
        const counts = new Map<number, number>();
        for (const sp of plan.spawns) counts.set(sp.enemy, (counts.get(sp.enemy) ?? 0) + 1);
        const list = [...counts].map(([e, n]) => (ENEMIES[e].tier === 'boss' ? ENEMIES[e].name : `${n} ${ENEMIES[e].name}`)).join(', ');
        const tag = plan.boss !== null ? ' · BOSS' : plan.theme ? ` · vague thématique « ${plan.theme} »` : '';
        blocks.push(h('p', { class: 'small' }, h('b', {}, `Vague ${plan.wave}${tag}`), ` : ${list}. Espace pour lancer.`));
        const intro = plan.intro ?? (plan.boss !== null && ENEMIES[plan.boss].firstWave === plan.wave ? plan.boss : null);
        if (intro !== null) {
          const d = ENEMIES[intro];
          blocks.push(
            h(
              'div',
              { class: 'td-intro' },
              previewItem(d.id, 40, equippedFinish(meta, 'es', d.id)),
              h('div', {}, h('b', {}, `Nouvel ennemi : ${d.name}`), h('span', { class: 'small' }, ` — ${d.text}${d.flying ? ' · volant' : ''}${d.camo ? ' · camouflé' : ''}${d.armor ? ` · armure ${d.armor}` : ''}`), h('br'), h('span', { class: 'small muted' }, `Contres : ${d.counters}`)),
            ),
          );
        }
      }
      info.replaceChildren(h('div', { class: 'td-shop' }, ...shop), ...detail, ...blocks);
      noteEl.textContent = note;

      overlay.hidden = true;
      if (s.over) {
        const foe = s.lostTo ? ENEMIES.find((e) => e.id === s.lostTo) : null;
        const relaunch = h('button', { class: 'field rl-spin', type: 'button' }, 'Relancer');
        relaunch.addEventListener('click', () => newRunScreen());
        const crates = h('button', { class: 'field', type: 'button' }, 'Boutique de caisses');
        crates.addEventListener('click', () => navigate('/td/caisses'));
        overlay.replaceChildren(
          h('strong', {}, `Perdu à la vague ${s.wave + 1}`),
          h('span', {}, `${plural(s.wave, 'vague')} tenue${s.wave > 1 ? 's' : ''} · ${plural(s.kills, 'ennemi')} vaincu${s.kills > 1 ? 's' : ''}${s.bossKills ? ` · ${plural(s.bossKills, 'boss')}` : ''}`),
          session ? h('span', { class: 'small' }, `+${s.wave * (s.wave + 1)} points ◆ gagnés`) : '',
          foe ? h('span', { class: 'small muted' }, `Vaincu par : ${foe.name}. Contre conseillé : ${foe.counters}.`) : '',
          h('div', { class: 'td-deck-actions' }, crates, relaunch),
          h('span', { class: 'muted small' }, 'Entrée relancer · C caisses'),
        );
        overlay.hidden = false;
      } else if (showVictory) {
        overlay.replaceChildren(
          h('strong', {}, 'Victoire !'),
          h('span', {}, `Le Dévoreur est tombé : ${FINAL_WAVE} vagues tenues.`),
          h('span', { class: 'muted small' }, 'Entrée pour continuer en mode infini (les PV montent de 8 % par vague).'),
        );
        overlay.hidden = false;
      } else if (paused) {
        overlay.replaceChildren(h('strong', {}, 'Pause'), h('span', { class: 'muted small' }, 'P pour reprendre'));
        overlay.hidden = false;
      }
      if (!running) draw(1);
    };

    // --- Vagues
    let onEnd: () => void = () => {};
    const launch = async () => {
      if (running || s.over || showVictory) return;
      note = '';
      confirmAbandon = false;
      snapshot = { s: structuredClone(s), actions: actions.slice() };
      running = startWave(s);
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
      if (session) {
        const r = await sendWave(session, sent).catch((e: Error) => {
          note = `Partie non classée désormais : ${e.message}.`;
          session = null;
          return null;
        });
        if (gone) return;
        if (r && (r.wave !== s.wave || r.lives !== s.lives || r.gold !== s.gold || r.kills !== s.kills)) {
          note = 'Résultat différent du serveur : partie non classée désormais.';
          session = null;
        } else if (r && s.over) {
          note = getAccount()?.verified ? `${plural(s.wave, 'vague')} au classement.` : `${plural(s.wave, 'vague')} enregistrées. Ajoute un email (Réglages → Compte) pour apparaître au classement.`;
        }
      }
      if (s.wave >= FINAL_WAVE && !victorySeen && !s.over) {
        victorySeen = true;
        showVictory = true;
      }
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
      const vals = stats.querySelectorAll('b');
      vals[1].textContent = String(s.lives);
      vals[2].textContent = String(s.gold);
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

    const newRunScreen = () => {
      remove(SAVE_KEY);
      show(deckScreen);
    };

    const abandon = () => {
      if (!confirmAbandon && !s.over) {
        confirmAbandon = true;
        note = 'R encore une fois pour abandonner cette run.';
        return render();
      }
      newRunScreen();
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
          return newRunScreen();
        }
        if (key === 'c') return navigate('/td/caisses');
      }
      if (showVictory && (key === 'enter' || key === ' ')) {
        e.preventDefault();
        showVictory = false;
        persist();
        return render();
      }
      const digit = Number(key);
      if (key === 'arrowleft') cx = Math.max(0, cx - 1);
      else if (key === 'arrowright') cx = Math.min(COLS - 1, cx + 1);
      else if (key === 'arrowup') cy = Math.max(0, cy - 1);
      else if (key === 'arrowdown') cy = Math.min(ROWS - 1, cy + 1);
      else if (digit >= 1 && digit <= s.deck.length) return act(`B${cx}.${cy}.${TOWERS.findIndex((t) => t.id === s.deck[digit - 1])}`);
      else if (key === 'u') return act(`U${cx}.${cy}`);
      else if (key === 's') return act(`S${cx}.${cy}`);
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

  const resumed = load<Saved | null>(SAVE_KEY, null);
  show(resumed && !resumed.s.over ? () => runScreen(resumed) : deckScreen);

  return () => {
    disposed = true;
    leave();
  };
}

export const towerDefense: Game = {
  id: 'td',
  name: 'Tower defense',
  description: 'Solo · roguelike, 50 vagues, classé',
  modes: ['solo'],
  mount,
};

