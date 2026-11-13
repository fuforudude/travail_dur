import { isTyping, pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { formatPoints, getWallet, holdWallet, keepStake, loadPlinkoPayouts, onWallet, type PlinkoRisk, spinPlinko, stakeLabel, stakeSteps } from '../net/points';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { autoPlay } from './autoplay';
import { h, hints } from './dom';
import { page } from './layout';
import { BIG_WIN_X100, createPlinkoBoard, multLabel } from './plinkoBoard';

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
  'Le gain est arrondi à l’entier inférieur. On peut lâcher une nouvelle bille avant l’arrivée de la précédente ; les rangées et le risque ne changent pas tant qu’une bille tombe.',
];

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
  let air = 0; // billes demandées au serveur ou encore en l'air
  // Solde d'affichage tant que des billes tombent : mise retirée au lancement, gain ajouté à l'arrivée.
  // Quand plus aucune bille ne tombe, on revient au solde exact du serveur (getWallet, libéré par holdWallet).
  let local = 0;
  let payouts: Map<string, number[]> | null = null;
  let message = 'Choisis ta mise, puis lâche la bille.';
  let autoNet = 0;
  let autoBalls = 0;
  let destroyed = false;
  const timers: number[] = [];
  const shownBalance = () => (air > 0 ? local : (getWallet()?.balance ?? 0));
  const bets = () => stakeSteps(shownBalance(), 8);
  const mults = () => payouts?.get(`${rows}:${RISKS[riskIdx][0]}`);

  const board = createPlinkoBoard();
  const betEl = h('div', { class: 'sl-bet' });
  const rowsEl = h('div', { class: 'pk-choice' });
  const riskEl = h('div', { class: 'pk-choice' });
  const status = h('p', { class: 'status', 'aria-live': 'polite' });
  const balanceEl = h('span', { class: 'stat' });
  const bigEl = h('div', { class: 'pk-big', hidden: true });
  const drop = h('button', { class: 'field rl-spin', type: 'button' }, 'Lâcher la bille (Espace)');
  drop.addEventListener('mousedown', (e) => e.preventDefault());
  drop.addEventListener('click', () => void launch());
  const rules = h('div', { class: 'rules card', hidden: true }, h('h2', {}, 'Règles'), ...PLINKO_RULES.map((p) => h('p', {}, p)));
  const rulesBtn = h('button', { class: 'field', type: 'button' }, 'Règles');
  rulesBtn.addEventListener('mousedown', (e) => e.preventDefault());
  rulesBtn.addEventListener('click', () => (rules.hidden = !rules.hidden));

  const auto = autoPlay(
    [5, 10, 25, 50, 100],
    async () => {
      if (!(await launch())) return false;
      await new Promise((ok) => timers.push(window.setTimeout(ok, 1000))); // reste sous la limite de 12 mises par 10 s
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

  content.classList.add('wide');
  content.append(
    h(
      'div',
      { class: 'game pk-game' },
      h('div', { class: 'game-bar' }, balanceEl),
      h('div', { class: 'pk-machine' }, h('div', { class: 'pk-stage' }, board.el, bigEl), h('div', { class: 'pk-settings' }, h('span', { class: 'muted small' }, 'Rangées'), rowsEl, h('span', { class: 'muted small' }, 'Risque'), riskEl), betEl, h('div', { class: 'rl-buttons' }, drop, rulesBtn), auto.el),
      status,
      rules,
      hints(['Espace', 'lâcher'], ['← →', 'mise'], ['↑ ↓', 'rangées'], ['R', 'risque'], ['A', 'auto'], ['S', 'arrêter l’auto'], ['Retour arrière', 'quitter']),
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
    if (air > 0) return;
    const next = Math.max(MIN_ROWS, Math.min(MAX_ROWS, n));
    if (next === rows) return;
    rows = next;
    drawBoard();
  };
  const setRisk = (i: number) => {
    if (air > 0) return;
    riskIdx = (i + RISKS.length) % RISKS.length;
    drawBoard();
  };

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
    const locked = air > 0;
    rowsEl.replaceChildren(
      token('−', false, locked || rows <= MIN_ROWS, () => (setRows(rows - 1), render())),
      h('b', { class: 'pk-rows' }, String(rows)),
      token('+', false, locked || rows >= MAX_ROWS, () => (setRows(rows + 1), render())),
    );
    riskEl.replaceChildren(...RISKS.map(([, label], i) => token(label, i === riskIdx, locked, () => (setRisk(i), render()))));
    drop.disabled = !payouts || auto.running();
    status.textContent = autoBalls ? `${message} · Auto : ${autoBalls} bille${autoBalls > 1 ? 's' : ''}, bilan ${autoNet >= 0 ? '+' : ''}${formatPoints(autoNet)}` : message;
  };

  const showBig = (text: string) => {
    bigEl.textContent = text;
    bigEl.hidden = false;
    timers.push(window.setTimeout(() => (bigEl.hidden = true), 3500));
    [660, 880, 1100, 1320, 1760].forEach((f, i) => timers.push(window.setTimeout(() => blip(f, 0.09), i * 90)));
  };

  /**
   * Une bille : le serveur tire le chemin, la bille le suit. La mise quitte le solde local au lancement, le gain
   * y entre à l'arrivée ; le badge de la barre du haut reste gelé (holdWallet) jusqu'à l'arrivée de la dernière bille.
   * Retourne false si la bille n'est pas partie.
   */
  const launch = async (): Promise<boolean> => {
    const m = mults();
    if (!m || destroyed) return false;
    const stake = bet;
    if (shownBalance() < stake) {
      message = 'Pas assez de points pour cette mise.';
      render();
      return false;
    }
    if (!auto.running()) autoBalls = 0;
    const rowsNow = rows;
    const risk = RISKS[riskIdx][0];
    if (air === 0) local = getWallet()?.balance ?? 0;
    local -= stake;
    air++;
    const release = holdWallet();
    render();
    try {
      const r = await spinPlinko(stake, rowsNow, risk);
      if (destroyed) {
        air--;
        release();
        return false;
      }
      // Le serveur fait autorité : une réponse incohérente n'est pas animée, son gain compte quand même.
      if (!Array.isArray(r?.path) || r.path.length !== rowsNow || r.path.reduce((t, v) => t + v, 0) !== r.slot) {
        local += r.payout;
        air--;
        release();
        message = 'Réponse du serveur illisible : la bille n’est pas affichée, ton solde est à jour.';
        render();
        return false;
      }
      const big = r.mult_x100 >= BIG_WIN_X100;
      message = '…';
      render();
      void board.drop(r.path, { big }).then(() => {
        local += r.payout;
        air--;
        release(); // à la dernière bille, le solde exact du serveur réapparaît (ici et dans la barre du haut)
        if (destroyed) return;
        message = r.payout ? `${multLabel(r.mult_x100)} : gagné ${formatPoints(r.payout)} point${r.payout > 1 ? 's' : ''}` : `${multLabel(r.mult_x100)} : Perdu`;
        blip(r.payout > r.stake ? 880 : 300);
        if (big) showBig(`${multLabel(r.mult_x100)} ! +${formatPoints(r.payout)}`);
        if (auto.running() || autoBalls) {
          autoBalls++;
          autoNet += r.payout - r.stake;
        }
        render();
      });
      return true;
    } catch (e) {
      local += stake; // mise rendue : le serveur ne l'a pas prise
      air--;
      release();
      message = (e as Error).message;
      render();
      return false;
    }
  };

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
    else if (key === ' ' || key === 'enter') {
      if (!e.repeat && !auto.running()) void launch(); // touche maintenue : une seule bille
    } else if (key === 'a') {
      if (auto.running()) auto.stop();
      else void auto.start(10);
    } else if (key === 's') auto.stop();
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
    auto.stop();
    board.destroy();
    timers.forEach((t) => (clearInterval(t), clearTimeout(t)));
    offWallet();
    offKeys();
  };
}
