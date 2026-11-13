import { isTyping, pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { formatPoints, getWallet, holdWallet, keepStake, loadPlinkoPayouts, onWallet, type PlinkoRisk, spinPlinkoBatch, stakeLabel, stakeSteps } from '../net/points';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { autoPlay } from './autoplay';
import { h, hints } from './dom';
import { page } from './layout';
import { BIG_WIN_X100, createPlinkoBoard, multLabel, slotColor } from './plinkoBoard';
import { batchQueue, PER_SECOND, type PlinkoGroup, tokenBucket } from './plinkoQueue';

export const MIN_ROWS = 8;
export const MAX_ROWS = 16;
export const RISKS: [PlinkoRisk, string][] = [
  ['low', 'Bas'],
  ['medium', 'Moyen'],
  ['high', 'Haut'],
];

export const PLINKO_RULES = [
  'La bille tombe d’en haut et rebondit à gauche ou à droite, une chance sur deux, à chaque rangée de clous ; la case où elle s’arrête multiplie la mise.',
  'Plus il y a de rangées et plus le risque est haut, plus les cases des bords paient (jusqu’à ×980) et plus celles du centre paient peu. Retour moyen au joueur : environ 97 % dans tous les réglages.',
  'Le gain est arrondi à l’entier inférieur. On peut lâcher jusqu’à 15 billes par seconde (clics rapides, Espace maintenue ou auto rapide) : les clics en trop sont ignorés, sans rien miser. Les rangées et le risque ne changent pas tant qu’une bille tombe.',
];

/** Écart entre deux billes d'un même envoi, et rythme de la rafale (Espace maintenue, auto rapide). */
const GAP_MS = 1000 / PER_SECOND;
/** Pastilles gardées dans le fil des derniers multiplicateurs. */
const FEED_MAX = 12;
/** Rythme de mise à jour du compteur de billes en jeu. */
const AIR_MS = 250;

type Click = 'ok' | 'token' | 'poor' | 'off';

export function plinkoView(root: HTMLElement): () => void {
  const content = page(root, 'Plinko');
  if (!multiConfigured) {
    content.append(h('div', { class: 'card narrow' }, h('h1', {}, 'Plinko'), h('p', { class: 'muted' }, 'Le Plinko n’est pas disponible en mode local.')));
    return pushKeys((e) => e.key === 'Backspace' && navigate('/'));
  }

  let bet = 10;
  let allIn = false; // mise « All in » choisie : elle suit le solde
  let rows = 12;
  let riskIdx = 1;
  let fast = false; // vitesse de l'auto : 1 bille/s ou 15 billes/s
  let air = 0; // billes reçues du serveur, pas encore arrivées dans leur case
  // Solde d'affichage tant que des billes sont en file, en vol ou en l'air : mise retirée au clic, gain ajouté à
  // l'arrivée. `hold` gèle en même temps le badge du haut ; quand tout est retombé, on le relâche et on revient au
  // solde exact du serveur (getWallet).
  let local = 0;
  let hold: (() => void) | null = null;
  let payouts: Map<string, number[]> | null = null;
  let message = 'Choisis ta mise, puis lâche la bille.';
  let autoNet = 0;
  let autoBalls = 0;
  // Bilan de la rafale en cours (depuis le dernier moment où plus rien ne tombait)
  let burstBalls = 0;
  let burstStake = 0;
  let burstWon = 0;
  let spaceTimer = 0;
  let airTimer = 0;
  let destroyed = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const wait = (ms: number) => new Promise<void>((ok) => later(ok, ms));

  const bucket = tokenBucket();
  const queue = batchQueue((g) => sendGroup(g), () => settle());
  const busy = () => queue.waiting() > 0 || queue.inFlight() || air > 0;
  const shownBalance = () => (hold ? local : (getWallet()?.balance ?? 0));
  const bets = () => stakeSteps(shownBalance(), 8);
  const mults = () => payouts?.get(`${rows}:${RISKS[riskIdx][0]}`);

  const board = createPlinkoBoard();
  const betEl = h('div', { class: 'sl-bet' });
  const rowsEl = h('div', { class: 'pk-choice' });
  const riskEl = h('div', { class: 'pk-choice' });
  const speedEl = h('div', { class: 'pk-choice' });
  const status = h('p', { class: 'status pk-status', 'aria-live': 'polite' });
  const balanceEl = h('span', { class: 'stat' });
  const bigEl = h('div', { class: 'pk-big', hidden: true });
  const airEl = h('div', { class: 'pk-air muted small', 'aria-hidden': 'true' });
  const feedEl = h('div', { class: 'pk-feed', 'aria-hidden': 'true' });
  const drop = h('button', { class: 'field rl-spin', type: 'button' }, 'Lâcher la bille (Espace)');
  drop.addEventListener('mousedown', (e) => e.preventDefault());
  drop.addEventListener('click', () => void click(true)); // chaque clic = une bille, le seau ignore le spam en trop
  const rules = h('div', { class: 'rules card pk-rules', hidden: true }, h('h2', {}, 'Règles'), ...PLINKO_RULES.map((p) => h('p', {}, p)));
  const rulesBtn = h('button', { class: 'field', type: 'button' }, 'Règles');
  rulesBtn.addEventListener('mousedown', (e) => e.preventDefault());
  rulesBtn.addEventListener('click', () => (rules.hidden = !rules.hidden));

  const auto = autoPlay(
    [5, 10, 25, 50, 100],
    async () => {
      for (;;) {
        const r = click(true);
        if (r === 'ok') break;
        if (r === 'poor') message = 'Plus assez de points pour cette mise : auto arrêté.';
        if (r !== 'token') return false;
        await wait(20); // plus de jeton : on attend le suivant au lieu d'arrêter l'auto
        if (destroyed || !auto.running()) return false;
      }
      await wait(fast ? GAP_MS : 1000);
      return !destroyed;
    },
    () => {
      if (auto.running()) {
        autoNet = 0;
        autoBalls = 0;
      }
      render();
    },
  );

  content.classList.add('wide', 'pk-page');
  content.append(
    h(
      'div',
      { class: 'game pk-game' },
      h(
        'div',
        { class: 'pk-layout' },
        h('div', { class: 'pk-machine' }, h('div', { class: 'pk-stage' }, board.el, airEl, feedEl, bigEl)),
        h(
          'div',
          { class: 'pk-side' },
          h('div', { class: 'pk-balance' }, balanceEl),
          betEl,
          h('div', { class: 'pk-settings' }, h('span', { class: 'muted small' }, 'Rangées'), rowsEl, h('span', { class: 'muted small' }, 'Risque'), riskEl),
          h('div', { class: 'rl-buttons pk-buttons' }, drop, rulesBtn),
          h('div', { class: 'pk-auto' }, auto.el, h('div', { class: 'pk-settings' }, h('span', { class: 'muted small' }, 'Vitesse'), speedEl)),
          status,
          rules,
          hints(['Espace', 'lâcher (maintenir : rafale)'], ['← →', 'mise'], ['↑ ↓', 'rangées'], ['R', 'risque'], ['A', 'auto'], ['V', 'vitesse'], ['S', 'arrêter l’auto'], ['Retour arrière', 'quitter']),
        ),
      ),
    ),
  );

  const token = (label: string, on: boolean, disabled: boolean, onClick: () => void, extra = '') => {
    const b = h('button', { class: 'rl-token' + (on ? ' on' : '') + extra, type: 'button', disabled }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  };

  const drawBoard = () => {
    const m = mults();
    if (m) board.setBoard(rows, m);
  };

  const setRows = (n: number) => {
    if (busy()) return;
    const next = Math.max(MIN_ROWS, Math.min(MAX_ROWS, n));
    if (next === rows) return;
    rows = next;
    drawBoard();
  };
  const setRisk = (i: number) => {
    if (busy()) return;
    riskIdx = (i + RISKS.length) % RISKS.length;
    drawBoard();
  };
  const setFast = (on: boolean) => {
    if (!auto.running()) fast = on;
  };

  const points = (n: number) => `${formatPoints(n)} point${n > 1 ? 's' : ''}`;

  const render = () => {
    const w = getWallet();
    const balance = shownBalance();
    balanceEl.replaceChildren('Solde ', h('b', {}, w ? formatPoints(balance) : '…'));
    const list = bets();
    bet = allIn ? list[list.length - 1] : keepStake(list, bet); // le solde a pu changer
    betEl.replaceChildren(
      ...list.map((v) =>
        token(stakeLabel(v, balance), v === bet, false, () => {
          bet = v;
          allIn = v === balance;
          render();
        }, v === balance ? ' all-in' : ''),
      ),
    );
    const locked = busy();
    rowsEl.replaceChildren(
      token('−', false, locked || rows <= MIN_ROWS, () => (setRows(rows - 1), render())),
      h('b', { class: 'pk-rows' }, String(rows)),
      token('+', false, locked || rows >= MAX_ROWS, () => (setRows(rows + 1), render())),
    );
    riskEl.replaceChildren(...RISKS.map(([, label], i) => token(label, i === riskIdx, locked, () => (setRisk(i), render()))));
    speedEl.replaceChildren(token('Normale', !fast, auto.running(), () => (setFast(false), render())), token('Rapide', fast, auto.running(), () => (setFast(true), render())));
    drop.disabled = !payouts || auto.running();
    let line = message;
    if (autoBalls) line += ` · Auto : ${autoBalls} bille${autoBalls > 1 ? 's' : ''}, bilan ${autoNet >= 0 ? '+' : ''}${formatPoints(autoNet)}`;
    else if (burstBalls > 1) line += ` · Rafale : ${burstBalls} billes, misé ${formatPoints(burstStake)}, gagné ${formatPoints(burstWon)}`;
    status.textContent = line;
  };

  /** Quand plus rien n'est en file, en vol ni en l'air : le badge est relâché et le solde exact du serveur revient. */
  const settle = () => {
    if (!busy() && hold) {
      const release = hold;
      hold = null;
      release();
    }
    if (!destroyed) render();
  };

  /** Compteur « N billes en jeu » : un seul texte, relu quelques fois par seconde tant que des billes tombent. */
  const showAir = () => {
    const n = board.inFlight();
    const text = n ? `${n} bille${n > 1 ? 's' : ''} en jeu` : '';
    if (airEl.textContent !== text) airEl.textContent = text;
    if (!n && airTimer) {
      clearInterval(airTimer);
      airTimer = 0;
    }
  };
  const watchAir = () => {
    showAir();
    if (!airTimer) airTimer = window.setInterval(showAir, AIR_MS);
  };

  /** Fil des derniers multiplicateurs : la pastille la plus récente en premier, couleur de sa case. */
  const addFeed = (mult: number, slot: number, rowCount: number) => {
    const pill = h('span', { class: 'pk-pill' }, multLabel(mult));
    pill.style.background = slotColor(slot, rowCount);
    feedEl.prepend(pill);
    while (feedEl.childElementCount > FEED_MAX) feedEl.lastElementChild!.remove();
  };

  const stopSpace = () => {
    if (spaceTimer) clearInterval(spaceTimer);
    spaceTimer = 0;
  };

  const showBig = (text: string) => {
    bigEl.textContent = text;
    bigEl.hidden = false;
    later(() => (bigEl.hidden = true), 3500);
    [660, 880, 1100, 1320, 1760].forEach((f, i) => later(() => blip(f, 0.09), i * 90));
  };

  /**
   * Un clic : une bille en file à la mise courante, mise retirée tout de suite du solde local.
   * Ignoré sans rien miser s'il n'y a plus de jeton (plus de 15 billes/s) ou pas assez de points ;
   * `alone` : clic isolé (bouton, Entrée, premier appui sur Espace), le seul cas où « pas assez de points » s'affiche.
   */
  const click = (alone: boolean): Click => {
    if (!mults() || destroyed) return 'off';
    const stake = bet;
    if (stake < 1 || shownBalance() < stake) {
      if (alone && !hold) {
        message = 'Pas assez de points pour cette mise.';
        render();
      }
      return 'poor';
    }
    if (!bucket.take()) return 'token';
    if (!hold) {
      local = getWallet()?.balance ?? 0;
      hold = holdWallet();
      burstBalls = burstStake = burstWon = 0;
      if (!auto.running()) autoBalls = 0;
    }
    local -= stake;
    queue.push(stake, rows, RISKS[riskIdx][0]);
    render();
    return 'ok';
  };

  /** Une bille arrive dans sa case : son gain entre dans le solde local. */
  const land = (stake: number, mult: number, payout: number, big: boolean, slot: number, rowCount: number) => {
    if (destroyed) return;
    local += payout;
    air--;
    addFeed(mult, slot, rowCount);
    showAir();
    burstBalls++;
    burstStake += stake;
    burstWon += payout;
    message = payout ? `${multLabel(mult)} : gagné ${points(payout)}` : `${multLabel(mult)} : Perdu`;
    blip(payout > stake ? 880 : 300);
    if (big) showBig(`${multLabel(mult)} ! +${formatPoints(payout)}`);
    if (auto.running() || autoBalls) {
      autoBalls++;
      autoNet += payout - stake;
    }
    settle();
  };

  /**
   * Un envoi groupé (appelé par la file, un seul à la fois). Le serveur fait autorité : une bille dont le chemin est
   * incohérent n'est pas animée mais son gain compte ; les billes refusées sont rendues au solde local.
   */
  const sendGroup = async (g: PlinkoGroup): Promise<void> => {
    let r;
    try {
      r = await spinPlinkoBatch(g.bet, g.rows, g.risk, g.n);
    } catch (e) {
      if (destroyed) return;
      local += g.n * g.bet; // mises rendues : le serveur ne les a pas prises
      const text = (e as Error).message;
      if (/^doucement/i.test(text)) {
        if (!spaceTimer && !auto.running() && !queue.waiting() && !air) message = text; // silencieux en rafale
      } else {
        // Erreur franche (réseau, solde, migration) : on n'envoie pas la suite, on arrête la rafale et l'auto.
        local += queue.clear();
        stopSpace();
        auto.stop();
        message = text;
      }
      return;
    }
    if (destroyed) return;
    const refused = Number(r?.refused) || 0;
    const count = g.n - refused;
    const ok =
      refused >= 0 &&
      count >= 0 &&
      Array.isArray(r.paths) &&
      Array.isArray(r.slots) &&
      Array.isArray(r.mults_x100) &&
      r.paths.length === count &&
      r.slots.length === count &&
      r.mults_x100.length === count;
    if (!ok) {
      local += g.n * g.bet - (Number(r?.stake) || 0) + (Number(r?.payout) || 0);
      message = 'Réponse du serveur illisible : les billes ne sont pas affichées, ton solde est à jour.';
      return;
    }
    local += refused * g.bet;
    // Gain de chaque bille ; l'écart d'arrondi éventuel avec le total du serveur va à la dernière.
    const gains = r.mults_x100.map((m) => Math.floor((g.bet * m) / 100));
    if (count) gains[count - 1] += (Number(r.payout) || 0) - gains.reduce((t, v) => t + v, 0);
    let shown = 0;
    let bad = false;
    for (let i = 0; i < count; i++) {
      const path = r.paths[i];
      const mult = r.mults_x100[i];
      const gain = gains[i];
      if (!Array.isArray(path) || path.length !== g.rows || path.some((v) => v !== 0 && v !== 1) || path.reduce((t, v) => t + v, 0) !== r.slots[i]) {
        local += gain;
        bad = true;
        continue;
      }
      air++;
      later(() => {
        if (destroyed) return;
        void board.drop(path, { big: mult >= BIG_WIN_X100 }).then((slot) => land(g.bet, mult, gain, mult >= BIG_WIN_X100, slot, g.rows));
        watchAir();
      }, shown++ * GAP_MS);
    }
    if (bad) message = 'Réponse du serveur illisible : une bille n’est pas affichée, ton solde est à jour.';
    else if (count) message = '…';
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') stopSpace();
  };
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', stopSpace);

  const offWallet = onWallet(render);
  const offKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowright') {
      const list = bets();
      const i = list.indexOf(keepStake(list, bet));
      bet = list[Math.max(0, Math.min(list.length - 1, i + (key === 'arrowleft' ? -1 : 1)))];
      allIn = bet === shownBalance();
    } else if (key === 'arrowup') setRows(rows + 1);
    else if (key === 'arrowdown') setRows(rows - 1);
    else if (key === 'r') setRisk(riskIdx + 1);
    else if (key === ' ') {
      // Espace maintenue : rafale à 15 billes/s tenue par un minuteur (la répétition du clavier est ignorée)
      if (!e.repeat && !auto.running()) {
        click(true);
        if (!spaceTimer) spaceTimer = window.setInterval(() => void click(false), GAP_MS);
      }
    } else if (key === 'enter') {
      if (!e.repeat && !auto.running()) click(true); // une bille par appui
    } else if (key === 'a') {
      if (auto.running()) auto.stop();
      else void auto.start(10);
    } else if (key === 'v') setFast(!fast);
    else if (key === 's') auto.stop();
    else if (key === 'backspace') {
      e.preventDefault();
      return navigate('/');
    } else return;
    e.preventDefault();
    render();
  });

  void loadPlinkoPayouts().then(
    (p) => {
      if (destroyed) return;
      payouts = p;
      drawBoard();
      render();
    },
    (e) => {
      if (destroyed) return;
      message = (e as Error).message;
      render();
    },
  );
  render();
  return () => {
    destroyed = true;
    stopSpace();
    if (airTimer) clearInterval(airTimer);
    auto.stop();
    queue.clear();
    board.destroy();
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    hold?.(); // le badge du haut ne doit pas rester gelé
    hold = null;
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', stopSpace);
    offWallet();
    offKeys();
  };
}
