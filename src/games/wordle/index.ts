import { isTyping, pushKeys } from '../../core/input';
import { blip } from '../../core/sound';
import { load, save } from '../../core/storage';
import { getAccount } from '../../net/auth';
import { rpc } from '../../net/ranked';
import { multiConfigured } from '../../net/supabase';
import { h, hints } from '../../ui/dom';
import type { Game, GameContext } from '../types';
import { dayNumber, normalizeLetter, pattern } from './logic';

type Mode = 'daily' | 'practice';

interface Board {
  guesses: string[];
  patterns: string[];
  finished: boolean;
  solved: boolean;
  answer: string | null;
}

const ROWS = 6;
const KEYBOARD = ['AZERTYUIOP', 'QSDFGHJKLM', '⏎WXCVBN⌫'];

function mount(ctx: GameContext): () => void {
  let mode: Mode = multiConfigured ? load<Mode>('wordle:mode', 'daily') : 'practice';
  let board: Board = { guesses: [], patterns: [], finished: false, solved: false, answer: null };
  let current = '';
  let busy = false;
  let note = '';
  let dayLabel = '';
  let words: Set<string> | null = null;
  let solutions: string[] = [];
  let practiceAnswer = '';
  let disposed = false;

  const tabs = h('div', { class: 'tabs' });
  const grid = h('div', { class: 'wd-grid' });
  const keyboard = h('div', { class: 'wd-keys' });
  const status = h('p', { class: 'status' });
  ctx.root.append(
    h(
      'div',
      { class: 'game' },
      tabs,
      grid,
      status,
      keyboard,
      hints(['A–Z', 'écrire'], ['Entrée', 'valider'], ['Retour arrière', 'effacer (ou quitter, ligne vide)'], ['Tab', 'changer de mode']),
    ),
  );

  // --- Rendu
  const letterStates = () => {
    const st = new Map<string, number>();
    board.guesses.forEach((g, r) => {
      for (let i = 0; i < 5; i++) st.set(g[i], Math.max(st.get(g[i]) ?? -1, Number(board.patterns[r][i])));
    });
    return st;
  };

  const render = () => {
    tabs.replaceChildren(
      ...(['daily', 'practice'] as Mode[]).map((m) => {
        const t = h('button', { class: 'tab' + (m === mode ? ' on' : ''), type: 'button', disabled: m === 'daily' && !multiConfigured }, m === 'daily' ? `Mot du jour${dayLabel}` : 'Entraînement');
        t.addEventListener('click', () => switchMode(m));
        return t;
      }),
    );
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const g = board.guesses[r] ?? (r === board.guesses.length && !board.finished ? current.padEnd(5) : '     ');
      const p = board.patterns[r];
      rows.push(
        h(
          'div',
          { class: 'wd-row' + (r === board.guesses.length && !board.finished ? ' active' : '') },
          ...[...g].map((c, i) => h('span', { class: 'wd-tile' + (p ? ` s${p[i]}` : c.trim() ? ' typed' : '') }, c.trim())),
        ),
      );
    }
    grid.replaceChildren(...rows);
    const st = letterStates();
    keyboard.replaceChildren(
      ...KEYBOARD.map((line) =>
        h(
          'div',
          { class: 'wd-krow' },
          ...[...line].map((k) => {
            const s = st.get(k);
            const b = h('button', { class: 'wd-key' + (s !== undefined ? ` s${s}` : '') + (k === '⏎' || k === '⌫' ? ' wide' : ''), type: 'button' }, k);
            b.addEventListener('click', () => press(k === '⏎' ? 'Enter' : k === '⌫' ? 'Backspace' : k));
            return b;
          }),
        ),
      ),
    );
    if (note) status.textContent = note;
    else if (board.finished && board.solved) status.textContent = `Trouvé en ${board.guesses.length} essai${board.guesses.length > 1 ? 's' : ''} !` + (mode === 'practice' ? ' Entrée pour un autre mot.' : ' Reviens demain.');
    else if (board.finished) status.textContent = `Le mot était ${board.answer ?? '?'}.` + (mode === 'practice' ? ' Entrée pour un autre mot.' : ' Reviens demain.');
    else status.textContent = mode === 'daily' ? 'Le même mot pour tout le monde aujourd’hui.' : 'Entraînement : mots au hasard, non classé.';
  };

  // --- Modes
  const newPractice = () => {
    if (!solutions.length) return; // relancé à la fin du chargement des listes
    practiceAnswer = solutions[Math.floor(Math.random() * solutions.length)];
    board = { guesses: [], patterns: [], finished: false, solved: false, answer: null };
    current = '';
    note = '';
    render();
  };

  const loadDaily = async () => {
    busy = true;
    note = 'Chargement du mot du jour…';
    render();
    try {
      const r = await rpc<{ day: string; guesses: string[]; patterns: string[]; solved: boolean; finished: boolean; answer: string | null }>('wordle_today');
      if (disposed || mode !== 'daily') return;
      dayLabel = ` n°${dayNumber(r.day)}`;
      board = { guesses: r.guesses, patterns: r.patterns, finished: r.finished, solved: r.solved, answer: r.answer };
      note = '';
    } catch (e) {
      note = `Mot du jour indisponible : ${(e as Error).message}. Essaie l’entraînement (Tab).`;
    }
    busy = false;
    current = '';
    render();
  };

  const switchMode = (m: Mode) => {
    if (m === 'daily' && !multiConfigured) return;
    mode = m;
    save('wordle:mode', m);
    note = '';
    if (m === 'daily') void loadDaily();
    else newPractice();
  };

  // --- Saisie
  const submit = async () => {
    if (current.length < 5) {
      note = 'Il faut 5 lettres.';
      return render();
    }
    if (words && !words.has(current)) {
      note = 'Mot inconnu.';
      return render();
    }
    note = '';
    const guess = current;
    if (mode === 'practice') {
      if (!practiceAnswer) return; // listes de mots pas encore chargées
      const p = pattern(guess, practiceAnswer);
      board.guesses.push(guess);
      board.patterns.push(p);
      board.solved = p === '22222';
      board.finished = board.solved || board.guesses.length >= ROWS;
      board.answer = board.finished ? practiceAnswer : null;
    } else {
      busy = true;
      try {
        const r = await rpc<{ pattern: string; solved: boolean; finished: boolean; answer: string | null }>('wordle_guess', { guess });
        if (disposed) return;
        board.guesses.push(guess);
        board.patterns.push(r.pattern);
        board.solved = r.solved;
        board.finished = r.finished;
        board.answer = r.answer;
        if (r.finished) note = r.solved && !getAccount()?.verified ? 'Trouvé ! Ajoute un email (Réglages → Compte) pour apparaître au classement.' : '';
      } catch (e) {
        note = (e as Error).message.charAt(0).toUpperCase() + (e as Error).message.slice(1) + '.';
        busy = false;
        return render();
      }
      busy = false;
    }
    current = '';
    blip(board.solved ? 660 : 440, 0.05);
    render();
  };

  const press = (key: string) => {
    if (busy) return;
    if (key === 'Enter') {
      if (board.finished) {
        if (mode === 'practice') newPractice();
        return;
      }
      void submit();
    } else if (key === 'Backspace') {
      if (!current) return ctx.onExit();
      current = current.slice(0, -1);
      note = '';
      render();
    } else if (!board.finished && current.length < 5) {
      const c = normalizeLetter(key);
      if (!c) return;
      current += c;
      note = '';
      render();
    }
  };

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      switchMode(mode === 'daily' ? 'practice' : 'daily');
      return;
    }
    if (e.key === 'Enter' || e.key === 'Backspace' || normalizeLetter(e.key)) {
      e.preventDefault();
      press(e.key);
    }
  });

  render();
  // Les listes de mots (~30 Ko) ne sont chargées qu'à l'ouverture du jeu.
  void import('./words').then((m) => {
    if (disposed) return;
    words = new Set(m.WORDS);
    solutions = m.SOLUTIONS;
    if (mode === 'practice') newPractice();
  });
  if (mode === 'daily') void loadDaily();

  return () => {
    disposed = true;
    popKeys();
  };
}

export const wordle: Game = {
  id: 'wordle',
  name: 'Wordle',
  description: 'Mot du jour classé, ou entraînement',
  modes: ['solo'],
  mount,
};
