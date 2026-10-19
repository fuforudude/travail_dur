import { isTyping, pushKeys } from '../core/input';
import { getSettings } from '../core/settings';
import { connect4 } from '../games/connect4';
import { cancelChallenge, challenge, pendingChallenges, respond, watchMyMatches, type MatchRow } from '../games/connect4/online';
import { ensureAccount } from '../net/auth';
import { isValidCode, normalizeCode, Room, type Player } from '../net/room';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

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
  let incoming: MatchRow | null = null;
  let outgoing: MatchRow | null = null;
  let unmountGame: (() => void) | null = null;
  let notice = '';
  const offs: (() => void)[] = [];

  const status = h('p', { class: 'muted' }, `Connexion au salon ${code}…`);
  content.append(status);

  const others = (): Player[] => room?.players.filter((p) => p.id !== me) ?? [];
  const nameOf = (id: string) => room?.nameOf(id) ?? 'Un joueur';
  // Tolérant aux horloges décalées : c'est le serveur qui fait respecter l'expiration (2 min).
  const fresh = (m: MatchRow) => Date.now() - Date.parse(m.created_at) < 600_000;
  const link = () => `${location.origin}${location.pathname}#/room/${code}`;

  const startGame = (matchId: string) => {
    if (!room || unmountGame) return;
    incoming = outgoing = null;
    notice = '';
    content.replaceChildren();
    void room.setBusy(true);
    const r = room;
    unmountGame = connect4.mount({
      root: content,
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
    if (m.status === 'playing' && m.moves === 0 && fresh(m)) return startGame(m.id);
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
      const id = await challenge(target.id, code);
      outgoing ??= { id, p1: me, p2: target.id, room: code, status: 'pending', created_at: new Date().toISOString() } as MatchRow;
    });
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
      ? h('p', { class: 'notice' }, `${nameOf(incoming.p1)} te défie à Puissance 4. `, h('kbd', {}, 'O'), ' accepter · ', h('kbd', {}, 'N'), ' refuser')
      : outgoing
        ? h('p', { class: 'notice' }, `Défi envoyé à ${nameOf(outgoing.p2)}, en attente… `, h('kbd', {}, 'N'), ' annuler')
        : null;

    content.replaceChildren(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'lobby-head' }, h('h1', {}, 'Salon'), h('span', { class: 'code' }, code)),
        h('p', { class: 'muted small link' }, link()),
        h('h2', {}, `Joueurs (${room.players.length})`),
        h('ul', { class: 'players' }, ...items),
        list.length ? null : h('p', { class: 'muted small' }, 'Personne d’autre pour l’instant : partage le code.'),
        banner,
        notice ? h('p', { class: 'notice' }, notice) : null,
      ),
      hints(['↑ ↓', 'joueur'], ['Entrée', 'défier à Puissance 4'], ['C', 'copier le lien'], ['Retour arrière', 'quitter']),
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
      } else if (key === 'enter') {
        e.preventDefault();
        sendChallenge();
      } else if (key === 'o' && incoming) {
        const m = incoming;
        incoming = null;
        void act(async () => {
          const status = await respond(m.id, true);
          if (status === 'playing') startGame(m.id);
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
    const unwatch = await watchMyMatches(me, onMatch);
    if (disposed) return unwatch();
    offs.push(unwatch);
    (await pendingChallenges(me, code)).forEach(onMatch);
    render();
  })().catch((err: Error) => {
    if (disposed) return;
    status.textContent = `${err.message}.`;
    content.append(hints(['Retour arrière', 'accueil']));
  });

  return () => {
    disposed = true;
    unmountGame?.();
    offs.forEach((off) => off());
    void room?.leave();
  };
}
