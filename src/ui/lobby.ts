import { isTyping, pushKeys } from '../core/input';
import { getSettings } from '../core/settings';
import { cancelChallenge, challenge, pendingChallenges, respond, watchMyMatches, type DuelGame, type MatchRow } from '../games/online';
import { getGame } from '../games/registry';
import { ensureAccount } from '../net/auth';
import { isValidCode, normalizeCode, Room, type Player } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { chatPanel } from './chat';
import { h, hints } from './dom';
import { page } from './layout';

const DUEL_GAMES: DuelGame[] = ['connect4', 'tictactoe', 'chess', 'checkers', 'quoridor', 'quarto'];
let lastGame = 0; // jeu proposé par défaut : le dernier choisi

/** `#/join` : saisie d'un code de salon. */
export function joinView(root: HTMLElement): () => void {
  const content = page(root, 'Rejoindre un salon');
  if (!multiConfigured) return notConfigured(content);

  const input = h('input', { class: 'field code-input', maxlength: 4, placeholder: 'ABCD', 'aria-label': 'Code du salon', autocomplete: 'off' });
  const form = h(
    'form',
    { class: 'card narrow' },
    h('h1', {}, 'Rejoindre un salon'),
    h('p', { class: 'muted' }, 'Saisis le code à 4 lettres.'),
    input,
    hints(['Entrée', 'rejoindre'], ['Retour arrière', 'accueil (champ vide)']),
  );
  input.addEventListener('input', () => (input.value = normalizeCode(input.value)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isValidCode(input.value)) navigate(`/room/${input.value}`);
  });
  content.append(form);
  input.focus();
  return pushKeys((e) => {
    if (e.key === 'Backspace' && !input.value) {
      e.preventDefault();
      navigate('/');
    }
  });
}

function notConfigured(content: HTMLElement): () => void {
  content.append(
    h(
      'div',
      { class: 'card narrow' },
      h('h1', {}, 'Multijoueur non configuré'),
      h('p', { class: 'muted' }, 'Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir le README). Le solo reste disponible.'),
      hints(['Retour arrière', 'accueil']),
    ),
  );
  return pushKeys((e) => {
    if (e.key === 'Backspace' || e.key === 'Enter') {
      e.preventDefault();
      navigate('/');
    }
  });
}

/**
 * `#/room/<CODE>` : salon. On y voit qui est là et on se défie.
 * Le défi, son acceptation et toute la partie passent par le serveur.
 */
export function lobbyView(root: HTMLElement, [rawCode]: string[]): (() => void) | void {
  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) return navigate('/join');
  const content = page(root, `Salon ${code}`);
  if (!multiConfigured) return notConfigured(content);

  let room: Room | null = null;
  let me = '';
  let disposed = false;
  let selected = 0; // index dans la liste des autres joueurs
  let gameIndex = lastGame; // jeu proposé lors du prochain défi
  let incoming: MatchRow | null = null;
  let outgoing: MatchRow | null = null;
  let unmountGame: (() => void) | null = null;
  let chat: ReturnType<typeof chatPanel> | null = null;
  let notice = '';
  const offs: (() => void)[] = [];

  // La scène affiche le salon ou la partie en cours ; la discussion reste en dessous.
  const stage = h('div', { class: 'lobby-stage' });
  const status = h('p', { class: 'muted' }, `Connexion au salon ${code}…`);
  stage.append(status);
  content.append(stage);

  const others = (): Player[] => room?.players.filter((p) => p.id !== me) ?? [];
  const nameOf = (id: string) => room?.nameOf(id) ?? 'Un joueur';
  // Tolérant aux horloges décalées : c'est le serveur qui fait respecter l'expiration (2 min).
  const fresh = (m: MatchRow) => Date.now() - Date.parse(m.created_at) < 600_000;
  const link = () => `${location.origin}${location.pathname}#/room/${code}`;
  const gameName = (id: string) => getGame(id)?.name ?? id;

  const startGame = (matchId: string, gameId: DuelGame) => {
    const game = getGame(gameId);
    if (!room || unmountGame || !game) return;
    incoming = outgoing = null;
    notice = '';
    stage.replaceChildren();
    void room.setBusy(true);
    const r = room;
    unmountGame = game.mount({
      root: stage,
      mode: 'multi',
      room: r,
      match: matchId,
      me: { id: me, name: getSettings().name },
      onExit: () => {
        unmountGame?.();
        unmountGame = null;
        void r.setBusy(false);
        render();
      },
    });
  };

  const onMatch = (m: MatchRow) => {
    if (m.room !== code || unmountGame) return;
    if (m.status === 'playing' && m.moves === 0 && fresh(m)) return startGame(m.id, m.game);
    if (m.status === 'pending' && fresh(m)) {
      if (m.p2 === me) incoming = m;
      else outgoing = m;
    } else {
      if (incoming?.id === m.id) incoming = null;
      if (outgoing?.id === m.id) {
        outgoing = null;
        if (m.status === 'declined') notice = `${nameOf(m.p2)} a refusé le défi.`;
        if (m.status === 'expired') notice = 'Le défi a expiré.';
      }
    }
    render();
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      notice = '';
      await fn();
    } catch (e) {
      notice = (e as Error).message;
    }
    render();
  };

  const sendChallenge = () => {
    const target = others()[selected];
    if (!room || !target || outgoing) return;
    if (target.busy) {
      notice = `${target.name} est déjà en partie.`;
      return render();
    }
    void act(async () => {
      const game = DUEL_GAMES[gameIndex];
      const id = await challenge(target.id, code, game);
      outgoing ??= { id, game, p1: me, p2: target.id, room: code, status: 'pending', created_at: new Date().toISOString() } as MatchRow;
    });
  };

  const pickGame = (i: number) => {
    gameIndex = lastGame = (i + DUEL_GAMES.length) % DUEL_GAMES.length;
    render();
  };

  const render = () => {
    if (unmountGame || !room) return;
    const list = others();
    selected = Math.min(selected, Math.max(0, list.length - 1));

    const items = room.players.map((p: Player) => {
      const i = list.indexOf(p);
      const li = h(
        'li',
        { class: (p.id === me ? 'me' : '') + (i === selected ? ' selected' : '') },
        h('span', { class: 'dot' + (p.busy ? ' on' : '') }),
        h('span', {}, p.name),
        p.id === me ? h('span', { class: 'tag' }, 'toi') : null,
        h('span', { class: 'muted small push' }, p.busy ? 'en partie' : i === selected ? 'Entrée : défier' : ''),
      );
      if (i >= 0) {
        li.addEventListener('click', () => {
          selected = i;
          sendChallenge();
        });
      }
      return li;
    });

    const banner = incoming
      ? h('p', { class: 'notice' }, `${nameOf(incoming.p1)} te défie au ${gameName(incoming.game)}. `, h('kbd', {}, 'O'), ' accepter · ', h('kbd', {}, 'N'), ' refuser')
      : outgoing
        ? h('p', { class: 'notice' }, `Défi au ${gameName(outgoing.game)} envoyé à ${nameOf(outgoing.p2)}, en attente… `, h('kbd', {}, 'N'), ' annuler')
        : null;

    const chips = DUEL_GAMES.map((g, i) => {
      const b = h('button', { class: 'chip' + (i === gameIndex ? ' on' : ''), type: 'button', 'aria-pressed': String(i === gameIndex) }, gameName(g));
      b.addEventListener('mousedown', (e) => e.preventDefault()); // le focus reste au salon (Entrée = défier)
      b.addEventListener('click', () => pickGame(i));
      return b;
    });

    stage.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'lobby-head' }, h('h1', {}, 'Salon'), h('span', { class: 'code' }, code)),
        h('p', { class: 'muted small link' }, link()),
        h(
          'div',
          { class: 'picker' },
          h('span', { class: 'muted small' }, 'Jeu du défi'),
          h('span', { class: 'picker-games', role: 'group', 'aria-label': 'Jeu du défi' }, ...chips),
        ),
        h('h2', {}, `Joueurs (${room.players.length})`),
        h('ul', { class: 'players' }, ...items),
        list.length ? null : h('p', { class: 'muted small' }, 'Personne d’autre pour l’instant : partage le code.'),
        banner,
        notice ? h('p', { class: 'notice' }, notice) : null,
      ),
      hints(['↑ ↓', 'joueur'], ['← →', 'jeu'], ['Entrée', `défier au ${gameName(DUEL_GAMES[gameIndex])}`], ['T', 'discuter'], ['C', 'copier le lien'], ['Retour arrière', 'quitter']),
    );
  };

  const flash = (msg: string) => {
    notice = msg;
    render();
  };

  offs.push(
    pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'backspace') {
        e.preventDefault();
        return navigate('/');
      }
      if (!room) return;
      if (key === 'arrowdown' || key === 'arrowup') {
        e.preventDefault();
        const n = others().length;
        if (n) selected = (selected + (key === 'arrowdown' ? 1 : n - 1)) % n;
        render();
      } else if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        pickGame(gameIndex + (key === 'arrowright' ? 1 : -1));
      } else if (key === 'enter') {
        e.preventDefault();
        sendChallenge();
      } else if (key === 'o' && incoming) {
        const m = incoming;
        incoming = null;
        void act(async () => {
          const status = await respond(m.id, true);
          if (status === 'playing') startGame(m.id, m.game);
          else notice = 'Ce défi a expiré.';
        });
      } else if (key === 'n' && incoming) {
        const m = incoming;
        incoming = null;
        void act(() => respond(m.id, false));
      } else if (key === 'n' && outgoing) {
        const m = outgoing;
        outgoing = null;
        void act(() => cancelChallenge(m.id));
      } else if (key === 'c') {
        navigator.clipboard?.writeText(link()).then(
          () => flash('Lien copié.'),
          () => flash(`Copie impossible : partage le code ${code}.`),
        );
      }
    }),
  );

  (async () => {
    const account = await ensureAccount();
    if (!account) throw new Error('Connexion au serveur impossible');
    me = account.id;
    const r = await Room.join(code, me);
    if (disposed) return void r.leave();
    room = r;
    offs.push(r.onPlayers(render));
    chat = chatPanel(r);
    content.append(chat.el);
    const unwatch = await watchMyMatches(me, onMatch);
    if (disposed) return unwatch();
    offs.push(unwatch);
    (await pendingChallenges(me, code)).forEach(onMatch);
    render();
  })().catch((err: Error) => {
    if (disposed) return;
    status.textContent = `${err.message}.`;
    stage.append(hints(['Retour arrière', 'accueil']));
  });

  return () => {
    disposed = true;
    unmountGame?.();
    chat?.destroy();
    offs.forEach((off) => off());
    void room?.leave();
  };
}
