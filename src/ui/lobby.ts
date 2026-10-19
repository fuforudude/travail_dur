import { isTyping, pushKeys } from '../core/input';
import { getSettings } from '../core/settings';
import { games, getGame } from '../games/registry';
import type { Game } from '../games/types';
import { localId } from '../net/identity';
import { isValidCode, normalizeCode, Room, type Player } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

/** État du salon diffusé par l'hôte. */
interface LobbyState {
  gameId: string;
  /** Joueurs de la partie en cours, ou null si on est dans le salon. */
  playing: string[] | null;
}

const multiGames = (): Game[] => games.filter((g) => g.modes.includes('multi'));

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

/** `#/room/<CODE>` : salon, puis partie. */
export function lobbyView(root: HTMLElement, [rawCode]: string[]): (() => void) | void {
  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) return navigate('/join');
  const content = page(root, `Salon ${code}`);
  if (!multiConfigured) return notConfigured(content);

  let room: Room | null = null;
  let disposed = false;
  let state: LobbyState = { gameId: multiGames()[0]?.id ?? '', playing: null };
  let unmountGame: (() => void) | null = null;
  let notice = '';
  const offs: (() => void)[] = [];
  const lastNames = new Map<string, string>(); // pour nommer un joueur parti

  const status = h('p', { class: 'muted' }, `Connexion au salon ${code}…`);
  content.append(status);

  const nameOf = (id: string) => room?.player(id)?.name ?? 'Un joueur';

  const broadcastState = () => {
    if (room?.isHost) room.send('lobby:state', state);
  };

  const startGame = (gameId: string, players: string[]) => {
    state = { gameId, playing: players };
    if (!room || !players.includes(room.me.id)) return render();
    const game = getGame(gameId);
    if (!game) return;
    notice = '';
    content.replaceChildren();
    const r = room;
    unmountGame = game.mount({
      root: content,
      mode: 'multi',
      room: r,
      players,
      me: { id: r.me.id, name: r.me.name },
      onExit: () => {
        r.send('game:quit');
        endGame('Tu as quitté la partie.');
      },
    });
  };

  const endGame = (message: string) => {
    unmountGame?.();
    unmountGame = null;
    state = { ...state, playing: null };
    notice = message;
    broadcastState();
    render();
  };

  const tryStart = () => {
    if (!room?.isHost || state.playing) return;
    const game = getGame(state.gameId);
    if (!game) return;
    const ready = room.players.filter((p) => p.ready);
    const min = game.minPlayers ?? 1;
    const max = game.maxPlayers ?? Infinity;
    if (!room.me.ready) return flash('Passe-toi « prêt » avant de lancer.');
    if (ready.length < min) return flash(`Il faut au moins ${min} joueurs prêts.`);
    if (ready.length > max) return flash(`${game.name} se joue à ${max} joueurs maximum.`);
    const players = ready.map((p) => p.id);
    room.send('lobby:start', { gameId: game.id, players });
    startGame(game.id, players);
    broadcastState();
  };

  const flash = (msg: string) => {
    notice = msg;
    render();
  };

  const render = () => {
    if (unmountGame || !room) return;
    const r = room;
    const game = getGame(state.gameId);
    const link = `${location.origin}${location.pathname}#/room/${code}`;

    const list = h(
      'ul',
      { class: 'players' },
      ...r.players.map((p: Player) =>
        h(
          'li',
          { class: p.id === r.me.id ? 'me' : '' },
          h('span', { class: 'dot' + (p.ready ? ' on' : '') }),
          h('span', {}, p.name),
          p.id === r.hostId ? h('span', { class: 'tag' }, 'hôte') : null,
          p.id === r.me.id ? h('span', { class: 'tag' }, 'toi') : null,
          h('span', { class: 'muted small push' }, p.ready ? 'prêt' : 'pas prêt'),
        ),
      ),
    );

    const picker = h(
      'div',
      { class: 'picker' },
      h('span', { class: 'muted' }, 'Jeu'),
      h('strong', {}, (r.isHost && multiGames().length > 1 ? '‹ ' : '') + (game?.name ?? '—') + (r.isHost && multiGames().length > 1 ? ' ›' : '')),
      game ? h('span', { class: 'muted small' }, `${game.minPlayers ?? 1}–${game.maxPlayers ?? '∞'} joueurs`) : null,
    );

    const playing = state.playing
      ? h('p', { class: 'notice' }, `Partie en cours : ${state.playing.map(nameOf).join(' contre ')}. Tu pourras jouer à la prochaine.`)
      : null;

    content.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'lobby-head' }, h('h1', {}, 'Salon'), h('span', { class: 'code' }, code)),
        h('p', { class: 'muted small link' }, link),
        picker,
        h('h2', {}, `Joueurs (${r.players.length})`),
        list,
        playing,
        notice ? h('p', { class: 'notice' }, notice) : null,
        h('p', { class: 'muted small' }, r.isHost ? 'Tu es l’hôte : choisis le jeu et lance la partie.' : 'L’hôte choisit le jeu et lance la partie.'),
      ),
      r.isHost
        ? hints(['R', 'prêt'], ['← →', 'jeu'], ['Entrée', 'lancer'], ['C', 'copier le lien'], ['Retour arrière', 'quitter'])
        : hints(['R', 'prêt'], ['C', 'copier le lien'], ['Retour arrière', 'quitter']),
    );
  };

  const leave = () => navigate('/');

  offs.push(
    pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'backspace') {
        e.preventDefault();
        leave();
      } else if (!room) {
        return;
      } else if (key === 'r') {
        void room.setReady(!room.me.ready);
      } else if (key === 'c') {
        navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/room/${code}`).then(
          () => flash('Lien copié.'),
          () => flash('Copie impossible : partage le code ' + code + '.'),
        );
      } else if ((key === 'arrowleft' || key === 'arrowright') && room.isHost && !state.playing) {
        const list = multiGames();
        const i = list.findIndex((g) => g.id === state.gameId);
        state = { ...state, gameId: list[(i + (key === 'arrowright' ? 1 : list.length - 1)) % list.length].id };
        broadcastState();
        render();
      } else if (key === 'enter') {
        e.preventDefault();
        tryStart();
      }
    }),
  );

  Room.join(code, { id: localId, name: getSettings().name }).then(
    (r) => {
      if (disposed) return void r.leave();
      room = r;
      offs.push(
        r.onPlayers((players) => {
          // Déconnexion d'un joueur en pleine partie : retour au salon.
          if (state.playing) {
            const gone = state.playing.find((id) => !players.some((p) => p.id === id));
            if (gone) {
              const name = lastNames.get(gone) ?? 'Un joueur';
              if (unmountGame) endGame(`${name} s’est déconnecté. Retour au salon.`);
              else state = { ...state, playing: null };
            }
          }
          players.forEach((p) => lastNames.set(p.id, p.name));
          // L'hôte (éventuellement nouveau) informe les arrivants de l'état du salon.
          broadcastState();
          render();
        }),
        r.on('lobby:state', (s: LobbyState, msg) => {
          if (msg.from !== r.hostId) return;
          if (unmountGame) return; // en partie, c'est notre propre état qui compte
          state = s;
          render();
        }),
        r.on('lobby:start', (s: { gameId: string; players: string[] }, msg) => {
          if (msg.from !== r.hostId || unmountGame) return;
          startGame(s.gameId, s.players);
        }),
        r.on('game:quit', (_p, msg) => {
          if (unmountGame && state.playing?.includes(msg.from)) endGame(`${nameOf(msg.from)} a quitté la partie.`);
        }),
      );
      render();
    },
    (err: Error) => {
      if (disposed) return;
      status.textContent = `${err.message}.`;
      content.append(hints(['Retour arrière', 'accueil']));
    },
  );

  return () => {
    disposed = true;
    unmountGame?.();
    offs.forEach((off) => off());
    void room?.leave();
  };
}
