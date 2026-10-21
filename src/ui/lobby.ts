import { isTyping, pushKeys } from '../core/input';
import { getSettings } from '../core/settings';
import { cancelChallenge, challenge, pendingChallenges, respond, watchMyMatches, type DuelGame, type MatchRow } from '../games/online';
import { getGame } from '../games/registry';
import type { Game } from '../games/types';
import { ensureAccount } from '../net/auth';
import { isValidCode, normalizeCode, Room, type Player } from '../net/room';
import { getSupabase, multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { nameEl } from '../net/cosmetics';
import { friendList, inviteToRoom, type Friend } from '../net/friends';
import { chatPanel } from './chat';
import { h, hints } from './dom';
import { page } from './layout';

const DUEL_GAMES: DuelGame[] = ['connect4', 'tictactoe', 'chess', 'checkers', 'quoridor', 'quarto'];
/** Jeux à 4 (fonction serveur board4) : lancés pour tout le salon, l'ordinateur complète. */
const FOUR_GAMES = ['chess4', 'quoridor4'] as const;
type FourGame = (typeof FOUR_GAMES)[number];
let lastGame = 0; // jeu proposé par défaut : le dernier choisi

/** `#/join` : saisie d'un code de salon. */
export function joinView(root: HTMLElement): () => void {
  const content = page(root, 'Rejoindre un salon');
  if (!multiConfigured) return notConfigured(content);

  const input = h('input', { class: 'field code-input', minlength: 4, maxlength: 4, required: true, pattern: '[A-Z]{4}', placeholder: 'ABCD', 'aria-label': 'Code du salon', autocomplete: 'off' });
  const form = h(
    'form',
    { class: 'card narrow' },
    h('h1', {}, 'Rejoindre un salon'),
    h('p', { class: 'muted' }, 'Saisis le code à 4 lettres.'),
    input,
    h('button', { class: 'field', type: 'submit' }, 'Rejoindre'),
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
      h('h1', {}, 'Multijoueur indisponible'),
      h('p', { class: 'muted' }, 'Les salons ne sont pas disponibles en mode local. Tu peux jouer en solo depuis l’accueil.'),
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

  let loadingGame = false;
  const startGame = (matchId: string, gameId: DuelGame | FourGame) => {
    const info = getGame(gameId);
    if (!room || unmountGame || loadingGame || !info) return;
    incoming = outgoing = null;
    notice = '';
    stage.replaceChildren(h('p', { class: 'muted' }, `Chargement du ${info.name}…`));
    void room.setBusy(true);
    const r = room;
    loadingGame = true;
    // Le code du jeu n'est téléchargé qu'au début de la partie.
    void info.load().then((game) => {
      loadingGame = false;
      if (disposed || unmountGame) return;
      stage.replaceChildren();
      mountGame(game, matchId, r);
    }, (e: Error) => {
      loadingGame = false;
      notice = `Chargement impossible : ${e.message}`;
      void r.setBusy(false);
      render();
    });
  };

  const mountGame = (game: Game, matchId: string, r: Room) => {
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
    if (m.room !== code || unmountGame || loadingGame) return;
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

  // Amis : on peut les inviter dans le salon (ils reçoivent une notification, un clic les y amène).
  let friends: Friend[] = [];
  const invited = new Set<string>();
  const loadFriends = () =>
    friendList().then(
      (list) => {
        friends = list.filter((f) => f.status === 'friend');
        render();
      },
      () => {}, // amis pas encore installés côté serveur : pas de liste
    );
  const invite = async (f: Friend) => {
    try {
      await inviteToRoom(f.id, code, DUEL_GAMES[gameIndex]);
      invited.add(f.id);
      notice = `Invitation envoyée à ${f.username}.`;
    } catch (e) {
      notice = (e as Error).message;
    }
    render();
  };

  // Partie à 4 : avec les joueurs du salon qui ne sont pas déjà en partie (3 au plus).
  let launching4 = false;
  const startFour = (game: FourGame) => {
    if (!room || launching4) return;
    launching4 = true;
    void act(async () => {
      try {
        const { board4 } = await import('../games/four/online4');
        const players = others().filter((p) => !p.busy).slice(0, 3).map((p) => p.id);
        const { id } = await board4<{ id: string }>({ op: 'create', game, room: code, players });
        startGame(id, game);
      } finally {
        launching4 = false;
      }
    });
  };
  /** Nouvelle partie à 4 où je suis : on la rejoint tout de suite. */
  const watchFour = async () => {
    const supabase = await getSupabase();
    if (!supabase) return () => {};
    const channel = supabase
      .channel(`m4room:${code}:${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches4', filter: `room=eq.${code}` }, (p) => {
        const m = p.new as { id: string; game: FourGame; players: (string | null)[]; status: string; plies: number };
        if (m.players?.includes(me) && m.status === 'playing' && m.plies === 0 && !unmountGame && !loadingGame) startGame(m.id, m.game);
      })
      .subscribe();
    return () => void supabase.removeChannel(channel);
  };

  const pickGame = (i: number) => {
    gameIndex = lastGame = (i + DUEL_GAMES.length) % DUEL_GAMES.length;
    render();
  };

  const render = () => {
    if (unmountGame || loadingGame || !room) return;
    const list = others();
    selected = Math.min(selected, Math.max(0, list.length - 1));

    const items = room.players.map((p: Player) => {
      const i = list.indexOf(p);
      const li = h(
        'li',
        {
          class: (p.id === me ? 'me' : '') + (i === selected ? ' selected' : ''),
          role: i >= 0 ? 'button' : undefined,
          tabindex: i >= 0 ? 0 : undefined,
          'aria-label': i >= 0 ? `Défier ${p.name}` : undefined,
        },
        h('span', { class: 'dot' + (p.busy ? ' on' : '') }),
        nameEl(p.id, p.name),
        p.id === me ? h('span', { class: 'tag' }, 'toi') : null,
        h('span', { class: 'muted small push' }, p.busy ? 'En partie' : i >= 0 ? 'Défier' : ''),
      );
      if (i >= 0) {
        li.addEventListener('focus', () => { selected = i; });
        li.addEventListener('keydown', (e) => {
          if (e.key !== ' ') return;
          e.preventDefault();
          li.click();
        });
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

    const copy = h('button', { class: 'field small-btn', type: 'button' }, 'Copier le lien');
    copy.addEventListener('click', copyLink);
    stage.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'lobby-head' }, h('h1', {}, 'Salon'), h('span', { class: 'code' }, code)),
        h('p', {}, copy),
        h(
          'div',
          { class: 'picker' },
          h('span', { class: 'muted small' }, 'Jeu du défi'),
          h('span', { class: 'picker-games', role: 'group', 'aria-label': 'Jeu du défi' }, ...chips),
        ),
        h(
          'div',
          { class: 'picker' },
          h('span', { class: 'muted small' }, 'À 4 joueurs'),
          h(
            'span',
            { class: 'picker-games' },
            ...FOUR_GAMES.map((g) => {
              const b = h('button', { class: 'chip', type: 'button', disabled: launching4 }, gameName(g));
              b.addEventListener('mousedown', (e) => e.preventDefault());
              b.addEventListener('click', () => startFour(g));
              return b;
            }),
          ),
        ),
        h('h2', {}, `Joueurs (${room.players.length})`),
        h('ul', { class: 'players' }, ...items),
        list.length ? null : h('p', { class: 'muted small' }, 'Personne d’autre pour l’instant : invite un ami ou partage le code.'),
        friends.length
          ? h(
              'div',
              { class: 'lobby-friends' },
              h('h2', {}, 'Inviter un ami'),
              h(
                'ul',
                { class: 'players' },
                ...friends.map((f) => {
                  const here = room!.player(f.id);
                  const b = h('button', { class: 'field small-btn', type: 'button', disabled: Boolean(here) }, here ? 'dans le salon' : invited.has(f.id) ? 'Réinviter' : 'Inviter');
                  b.addEventListener('mousedown', (e) => e.preventDefault());
                  b.addEventListener('click', () => void invite(f));
                  return h('li', {}, nameEl(f.id, f.username), h('span', { class: 'push' }, b));
                }),
              ),
            )
          : null,
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

  const copyLink = () => {
    if (!navigator.clipboard) return flash(`Copie indisponible : partage le code ${code}.`);
    void navigator.clipboard.writeText(link()).then(
      () => flash('Lien copié.'),
      () => flash(`Copie impossible : partage le code ${code}.`),
    );
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
        if (document.activeElement instanceof HTMLButtonElement) return;
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
        copyLink();
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
    void loadFriends();
    chat = chatPanel(r);
    content.append(chat.el);
    const unwatch = await watchMyMatches(me, onMatch);
    if (disposed) return unwatch();
    offs.push(unwatch);
    const unwatch4 = await watchFour();
    if (disposed) return unwatch4();
    offs.push(unwatch4);
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
