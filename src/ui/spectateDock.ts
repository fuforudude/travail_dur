// Fenêtre « Regarder » sur le côté : le casino d'un ami en direct, dans un coin de l'écran, pendant
// qu'on continue à jouer ailleurs sur le site. Elle reste ouverte d'une page à l'autre (et après un
// rechargement), se réduit en simple pastille, et se déplace en la tirant par son titre.

import { load, save, remove } from '../core/storage';
import { canWatch, playerName, recentSpins, watchSpins } from '../net/spectate';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h } from './dom';
import { net, signed, spinStage, type SpinStage } from './spinStage';

const KEY = 'regarder:dock';
const MARGIN = 8;

interface Saved {
  uid: string;
  min: boolean;
  x?: number;
  y?: number;
}

let current: { uid: string; el: HTMLElement; stage: SpinStage; stop: () => void; offRoute: () => void } | null = null;
let opening = 0;

const saved = () => load<Saved | null>(KEY, null);
const update = (patch: Partial<Saved>) => {
  const s = saved();
  if (s) save(KEY, { ...s, ...patch });
};

/** Garde la fenêtre entière dans l'écran. */
function place(el: HTMLElement, x: number, y: number): void {
  const maxX = window.innerWidth - el.offsetWidth - MARGIN;
  const maxY = window.innerHeight - el.offsetHeight - MARGIN;
  el.style.left = `${Math.max(MARGIN, Math.min(maxX, x))}px`;
  el.style.top = `${Math.max(MARGIN, Math.min(maxY, y))}px`;
  el.style.right = el.style.bottom = 'auto';
}

export function closeDock(): void {
  opening++;
  remove(KEY);
  if (!current) return;
  current.stop();
  current.stage.dispose();
  current.offRoute();
  current.el.remove();
  current = null;
}

/** Ouvre (ou remplace) la fenêtre sur le côté pour cet ami. */
export async function openDock(uid: string, min = false): Promise<void> {
  if (!multiConfigured) return;
  if (current?.uid === uid) {
    current.el.classList.toggle('min', false);
    update({ min: false });
    return;
  }
  const keep = saved();
  closeDock();
  save(KEY, { uid, min, x: keep?.x, y: keep?.y });
  const ticket = ++opening;
  const [allowed, name] = await Promise.all([canWatch(uid), playerName(uid)]);
  if (ticket !== opening) return;
  if (!allowed) {
    remove(KEY);
    return;
  }

  const lastEl = h('span', { class: 'sp-dock-last' });
  const flash = (text: string, cls: string) => {
    lastEl.textContent = text;
    lastEl.className = `sp-dock-last ${cls}`;
    void lastEl.offsetWidth; // relance l'animation
    lastEl.classList.add('flash');
  };
  const stage = spinStage({
    sound: false,
    onStart: (s) => flash(s.game === 'roulette' ? '🎡 …' : '🎰 …', ''),
    onPlayed: (s) => flash(signed(net(s)), net(s) > 0 ? 'win' : net(s) < 0 ? 'loss' : ''),
  });

  const btn = (label: string, title: string, run: () => void) => {
    const b = h('button', { class: 'sp-dock-btn', type: 'button', title, 'aria-label': title }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // ne prend pas le focus au jeu en cours
    b.addEventListener('click', run);
    return b;
  };
  const el = h(
    'aside',
    { class: 'sp-dock' + (min ? ' min' : ''), role: 'complementary', 'aria-label': `Casino de ${name} en direct` },
    h(
      'div',
      { class: 'sp-dock-head' },
      h('span', { class: 'sp-dot' }),
      h('span', { class: 'sp-dock-name' }, name),
      lastEl,
      btn('⤢', 'Ouvrir en grand', () => navigate(`/regarder/${uid}`)),
      btn('–', 'Réduire ou agrandir', () => {
        const isMin = el.classList.toggle('min');
        update({ min: isMin });
        requestAnimationFrame(() => el.style.left && place(el, el.offsetLeft, el.offsetTop));
      }),
      btn('✕', 'Arrêter de regarder', closeDock),
    ),
    h('div', { class: 'sp-dock-body' }, stage.status, stage.roulette, stage.slots),
  );
  document.body.append(el);
  const pos = saved();
  if (pos?.x !== undefined && pos.y !== undefined) place(el, pos.x, pos.y);

  // Déplacement : on tire la fenêtre par son titre.
  const head = el.firstElementChild as HTMLElement;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
    const dx = e.clientX - el.offsetLeft;
    const dy = e.clientY - el.offsetTop;
    head.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const move = (ev: PointerEvent) => place(el, ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      head.removeEventListener('pointermove', move);
      el.classList.remove('drag');
      update({ x: el.offsetLeft, y: el.offsetTop });
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up, { once: true });
    head.addEventListener('pointercancel', up, { once: true });
  });

  // Cachée sur la page « Regarder » du même ami (elle montre déjà tout) ; toujours dans l'écran.
  const onRoute = () => (el.hidden = location.hash === `#/regarder/${uid}`);
  const onResize = () => el.style.left && place(el, el.offsetLeft, el.offsetTop);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('resize', onResize);
  onRoute();

  current = {
    uid,
    el,
    stage,
    stop: watchSpins(uid, (s) => stage.push(s)),
    offRoute: () => {
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('resize', onResize);
    },
  };
  const last = (await recentSpins(uid, 1).catch(() => []))[0];
  if (last && ticket === opening && !lastEl.textContent) flash(signed(net(last)), net(last) > 0 ? 'win' : net(last) < 0 ? 'loss' : '');
}

/** Au chargement du site : rouvre la fenêtre laissée ouverte. */
export function restoreDock(): void {
  const s = saved();
  if (s) void openDock(s.uid, s.min);
}
