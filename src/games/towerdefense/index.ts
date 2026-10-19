import { isTyping, pushKeys } from '../../core/input';
import { isPanicked } from '../../core/panic';
import { blip } from '../../core/sound';
import { getBest, load, remove, save, setBest } from '../../core/storage';
import { getAccount } from '../../net/auth';
import { rpc } from '../../net/ranked';
import { multiConfigured } from '../../net/supabase';
import { h, hints } from '../../ui/dom';
import type { Game, GameContext } from '../types';
import {
  applyAction, COLS, isBuildable, KINDS, MAX_LEVEL, newGame, PATH, pathPos, ROWS, startWave,
  towerDamage, towerRange, upgradeCost, waveInfo, type Shot, type State,
} from './logic';

interface Saved {
  s: State;
  actions: string[]; // constructions depuis la dernière vague (envoyées au lancement)
  session: string | null;
}

type Running = ReturnType<typeof startWave>;

const TICK_MS = 100;

function mount(ctx: GameContext): () => void {
  let saved: Saved | null = load<Saved | null>('state:td', null);
  let s: State = saved?.s ?? newGame();
  let actions: string[] = saved?.actions ?? [];
  let session: string | null = saved?.session ?? null;
  let sessionPending: Promise<string | null> | null = null;
  let cx = 4;
  let cy = 2;
  let speed = 1;
  let paused = false;
  let running: Running | null = null;
  let prev: number[] = []; // progression au tick précédent (pour une animation fluide)
  let shots: Shot[] = [];
  let acc = 0;
  let last = 0;
  let raf = 0;
  let note = '';
  let confirmRestart = false;
  let disposed = false;
  let best = getBest('td');

  // --- DOM
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
        ['← ↑ → ↓', 'case'], ['1 2 3', 'construire'], ['U', 'améliorer'], ['S', 'vendre'],
        ['Espace', 'lancer la vague'], ['F', 'vitesse'], ['P', 'pause'], ['R', 'nouvelle partie'], ['Retour arrière', 'quitter'],
      ),
    ),
  );

  const persist = () => {
    if (s.over) remove('state:td');
    else save('state:td', { s, actions, session } satisfies Saved);
    best = setBest('td', s.wave);
  };

  // --- Partie classée
  const ensureSession = () => {
    // Seule une partie neuve peut devenir classée : le serveur part de zéro et reçoit
    // les constructions déjà faites au lancement de la première vague.
    if (session || !multiConfigured || s.wave > 0) return;
    sessionPending ??= rpc<string>('td_start').then(
      (id) => {
        if (!disposed && s.wave === 0) session = id;
        persist();
        render();
        return id;
      },
      (e: Error) => {
        note = `Partie non classée : ${e.message}.`;
        render();
        return null;
      },
    );
  };

  // --- Rendu
  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      bg: v('--surface'), grid: v('--border'), path: v('--surface-2'), text: v('--text'), muted: v('--muted'),
      accent: v('--accent'), enemy: v('--p1'), boss: v('--text'), fast: v('--tone4'),
      kinds: [v('--tone3'), v('--tone1'), v('--tone5')],
    };
  };
  let cell = 32;
  const resize = () => {
    const cs = getComputedStyle(ctx.root);
    const inner = ctx.root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const w = Math.min(640, inner > 0 ? inner : 640);
    cell = Math.floor(w / COLS);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = cell * COLS * ratio;
    canvas.height = cell * ROWS * ratio;
    canvas.style.width = `${cell * COLS}px`;
    canvas.style.height = `${cell * ROWS}px`;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const towerAt = (x: number, y: number) => s.towers.find((t) => t.x === x && t.y === y);

  const draw = (frac: number) => {
    const c = colors();
    const u = cell / 100; // pixels par unité de jeu
    g.fillStyle = c.bg;
    g.fillRect(0, 0, cell * COLS, cell * ROWS);
    // chemin
    g.fillStyle = c.path;
    for (const [x, y] of PATH) g.fillRect(x * cell, y * cell, cell, cell);
    g.strokeStyle = c.grid;
    g.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      g.beginPath();
      g.moveTo(x * cell + 0.5, 0);
      g.lineTo(x * cell + 0.5, ROWS * cell);
      g.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      g.beginPath();
      g.moveTo(0, y * cell + 0.5);
      g.lineTo(COLS * cell, y * cell + 0.5);
      g.stroke();
    }
    // portée de la tour sous le curseur
    const hover = towerAt(cx, cy);
    if (hover && !running) {
      g.beginPath();
      g.arc((cx + 0.5) * cell, (cy + 0.5) * cell, towerRange(hover.kind, hover.level) * u, 0, Math.PI * 2);
      g.fillStyle = c.accent + '22';
      g.fill();
      g.strokeStyle = c.accent;
      g.stroke();
    }
    // tours
    s.towers.forEach((t) => {
      const px = t.x * cell;
      const py = t.y * cell;
      // socle carré : une tour ne se confond jamais avec un ennemi (ronds), même en noir et blanc
      g.fillStyle = c.kinds[t.kind - 1] + '40';
      g.beginPath();
      g.roundRect(px + 2, py + 2, cell - 4, cell - 4, cell * 0.18);
      g.fill();
      g.fillStyle = c.kinds[t.kind - 1];
      const pad = cell * 0.24;
      if (t.kind === 2) {
        g.beginPath();
        g.arc(px + cell / 2, py + cell / 2, cell / 2 - pad, 0, Math.PI * 2);
        g.fill();
      } else if (t.kind === 3) {
        g.beginPath();
        g.moveTo(px + cell / 2, py + pad);
        g.lineTo(px + cell - pad, py + cell - pad);
        g.lineTo(px + pad, py + cell - pad);
        g.closePath();
        g.fill();
      } else g.fillRect(px + pad, py + pad, cell - 2 * pad, cell - 2 * pad);
      // niveau : petits points
      g.fillStyle = c.text;
      for (let l = 0; l < t.level; l++) g.fillRect(px + 3 + l * (cell / 7), py + cell - 5, cell / 9, 3);
    });
    // ennemis
    if (running) {
      const w = running.wave;
      running.enemies.forEach((e, i) => {
        if (e.state !== 1) return;
        const p = prev[i] + (e.progress - prev[i]) * frac;
        const [x, y] = pathPos(Math.min(Math.round(p), (PATH.length - 1) * 100 - 1));
        const r = (w.type === 'boss' ? 0.38 : w.type === 'rapide' ? 0.2 : 0.26) * cell;
        g.beginPath();
        g.arc(x * u, y * u, r, 0, Math.PI * 2);
        g.fillStyle = w.type === 'boss' ? c.boss : w.type === 'rapide' ? c.fast : c.enemy;
        g.fill();
        // barre de vie
        g.fillStyle = c.grid;
        g.fillRect(x * u - r, y * u - r - 5, 2 * r, 3);
        g.fillStyle = c.text;
        g.fillRect(x * u - r, y * u - r - 5, (2 * r * Math.max(0, e.hp)) / e.maxHp, 3);
      });
      // tirs du dernier tick
      g.strokeStyle = c.text;
      g.globalAlpha = 0.5;
      for (const sh of shots) {
        const t = s.towers[sh.tower];
        const e = running.enemies[sh.target];
        if (!t || !e) continue;
        const [x, y] = pathPos(Math.min(e.progress, (PATH.length - 1) * 100 - 1));
        g.beginPath();
        g.moveTo((t.x + 0.5) * cell, (t.y + 0.5) * cell);
        g.lineTo(x * u, y * u);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // curseur
    g.strokeStyle = c.accent;
    g.lineWidth = 2;
    g.strokeRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
  };

  const render = () => {
    const w = waveInfo(s.wave + 1);
    stats.replaceChildren(
      h('span', { class: 'stat' }, 'Vague ', h('b', {}, String(running ? running.number : s.wave + 1))),
      h('span', { class: 'stat' }, 'Vies ', h('b', {}, String(s.lives))),
      h('span', { class: 'stat' }, 'Or ', h('b', {}, String(s.gold))),
      h('span', { class: 'stat' }, '×', h('b', {}, String(speed))),
    );
    const t = towerAt(cx, cy);
    const shop = KINDS.map((k, i) =>
      h('span', { class: 'chip' + (s.gold >= k.cost ? '' : ' off') }, h('kbd', {}, String(i + 1)), ` ${k.name} ${k.cost}`),
    );
    let detail: string;
    if (t) {
      const k = KINDS[t.kind - 1];
      detail = `${k.name} niv. ${t.level} · dégâts ${towerDamage(t.kind, t.level)} · portée ${(towerRange(t.kind, t.level) / 100).toFixed(1)}`;
      detail += t.level < MAX_LEVEL ? ` · U améliorer (${upgradeCost(t.kind, t.level)})` : ' · niveau max';
      detail += ` · S vendre (+${Math.floor(t.invested / 2)})`;
    } else if (isBuildable(cx, cy)) detail = 'Case libre : 1, 2 ou 3 pour construire.';
    else detail = 'Chemin des ennemis.';
    const next = running ? '' : `Prochaine vague : ${w.count} ennemi${w.count > 1 ? 's' : ''} ${w.type === 'normal' ? '' : w.type} (${w.hp} PV). Espace pour lancer.`;
    info.replaceChildren(
      h('div', { class: 'td-shop' }, ...shop, h('span', { class: 'muted small td-rank' }, session ? 'partie classée' : multiConfigured ? 'non classée' : '')),
      h('p', { class: 'small' }, detail),
      next ? h('p', { class: 'muted small' }, next) : '',
    );
    noteEl.textContent = note;
    overlay.hidden = true;
    if (s.over) {
      overlay.replaceChildren(h('strong', {}, `Perdu à la vague ${s.wave + 1}`), h('span', { class: 'muted small' }, `${s.wave} vagues tenues · record ${best} · R pour rejouer`));
      overlay.hidden = false;
    } else if (paused) {
      overlay.replaceChildren(h('strong', {}, 'Pause'), h('span', { class: 'muted small' }, 'P pour reprendre'));
      overlay.hidden = false;
    }
    if (!running) draw(1);
  };

  // --- Vagues
  const launch = async () => {
    if (running || s.over) return;
    note = '';
    confirmRestart = false;
    const sent = actions.join(';');
    actions = [];
    // Vérification serveur en parallèle de l'animation locale
    let check: Promise<{ wave: number; lives: number; gold: number; kills: number; over: boolean } | null> = Promise.resolve(null);
    if (multiConfigured) {
      if (!session && sessionPending) await sessionPending;
      const id = session;
      if (id) check = rpc<{ wave: number; lives: number; gold: number; kills: number; over: boolean }>('td_wave', { session_id: id, actions: sent }).catch((e: Error) => {
        note = `Partie non classée désormais : ${e.message}.`;
        session = null;
        return null;
      });
    }
    running = startWave(s);
    prev = running.enemies.map((e) => e.progress);
    last = performance.now();
    acc = 0;
    blip(330);
    render();
    const finished = new Promise<void>((resolve) => (onEnd = resolve));
    await finished;
    if (disposed) return;
    const server = await check;
    if (server && (server.wave !== s.wave || server.lives !== s.lives || server.gold !== s.gold || server.kills !== s.kills)) {
      note = 'Résultat différent du serveur : partie non classée désormais.';
      session = null;
    } else if (server && s.over) {
      note = getAccount()?.verified ? `${s.wave} vagues enregistrées au classement.` : `${s.wave} vagues enregistrées. Ajoute un email (Réglages → Compte) pour apparaître au classement.`;
    }
    persist();
    render();
  };
  let onEnd: () => void = () => {};

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const dt = now - last;
    last = now;
    if (paused || isPanicked()) return;
    acc += dt * speed;
    while (acc >= TICK_MS && running) {
      acc -= TICK_MS;
      prev = running.enemies.map((e) => e.progress);
      const before = s.kills;
      shots = [];
      const more = running.tick(shots);
      if (s.kills > before) blip(520, 0.03);
      if (!more) {
        running = null;
        shots = [];
        onEnd();
        render();
        return;
      }
    }
    draw(Math.min(1, acc / TICK_MS));
    // rafraîchit les compteurs (or, vies) sans tout reconstruire à chaque image
    const vals = stats.querySelectorAll('b');
    vals[1].textContent = String(s.lives);
    vals[2].textContent = String(s.gold);
  };

  // --- Actions du joueur
  const act = (a: string) => {
    if (running || s.over) return;
    const err = applyAction(s, a);
    if (err) note = err.charAt(0).toUpperCase() + err.slice(1) + '.';
    else {
      note = '';
      actions.push(a);
      persist();
    }
    render();
  };

  const restart = () => {
    if (!confirmRestart && !s.over && s.wave > 0) {
      confirmRestart = true;
      note = 'R encore une fois pour abandonner cette partie.';
      return render();
    }
    confirmRestart = false;
    remove('state:td');
    saved = null;
    running = null;
    s = newGame();
    actions = [];
    session = null;
    sessionPending = null;
    note = '';
    ensureSession();
    render();
  };

  // souris / tactile : choisir une case
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    cx = Math.max(0, Math.min(COLS - 1, Math.floor((e.clientX - r.left) / cell)));
    cy = Math.max(0, Math.min(ROWS - 1, Math.floor((e.clientY - r.top) / cell)));
    render();
  });

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft') cx = Math.max(0, cx - 1);
    else if (key === 'arrowright') cx = Math.min(COLS - 1, cx + 1);
    else if (key === 'arrowup') cy = Math.max(0, cy - 1);
    else if (key === 'arrowdown') cy = Math.min(ROWS - 1, cy + 1);
    else if (key === '1' || key === '2' || key === '3') return act(`B${cx}.${cy}.${key}`);
    else if (key === 'u') return act(`U${cx}.${cy}`);
    else if (key === 's') return act(`S${cx}.${cy}`);
    else if (key === ' ' || key === 'enter') {
      e.preventDefault();
      void launch();
      return;
    } else if (key === 'f') speed = speed === 3 ? 1 : speed + 1;
    else if (key === 'p') paused = !paused;
    else if (key === 'r') return restart();
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
  ensureSession();
  render();
  raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    popKeys();
    // Vague en cours : le serveur l'a déjà simulée en entier ; on la termine instantanément
    // pour garder le même état et reprendre à la suivante.
    if (running) {
      while (running.tick());
      persist();
    }
  };
}

export const towerDefense: Game = {
  id: 'td',
  name: 'Tower defense',
  description: 'Solo · vagues infinies, classé',
  modes: ['solo'],
  mount,
};
