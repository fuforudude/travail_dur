import { isTyping, pushKeys } from '../core/input';
import { nameEl } from '../net/cosmetics';
import {
  friendList,
  getNotifications,
  markRead,
  noteText,
  onNotifications,
  removeFriend,
  requestFriend,
  respondFriend,
  searchPlayers,
  type Friend,
  type Relation,
} from '../net/friends';
import { formatPoints, getWallet, givePoints } from '../net/points';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

type Tab = 'friends' | 'requests' | 'add';
const TABS: [Tab, string][] = [
  ['friends', 'Mes amis'],
  ['requests', 'Demandes'],
  ['add', 'Ajouter un ami'],
];
let lastTab: Tab = 'friends';

/** `#/amis` : mes amis (et leurs apparts), les demandes, la recherche par pseudo. */
export function friendsView(root: HTMLElement, [param]: string[]): () => void {
  const content = page(root, 'Amis');
  let tab: Tab = param === 'ajouter' ? 'add' : param === 'demandes' ? 'requests' : lastTab;
  let friends: Friend[] = [];
  let status = '';
  let disposed = false;
  let giftTo = ''; // ami à qui on est en train d'envoyer des points
  const body = h('div', {});
  const statusEl = h('p', { class: 'status' });
  const tabsEl = h('div', { class: 'tabs' });
  const search = h('input', { class: 'field', placeholder: 'Pseudo à chercher', maxlength: 16, 'aria-label': 'Pseudo', autocomplete: 'off' });
  const results = h('div', { class: 'friend-list' });
  content.append(h('div', { class: 'card' }, h('h1', {}, 'Amis'), tabsEl, statusEl, body), hints(['← →', 'onglet'], ['Retour arrière', 'accueil (hors du champ)']));

  if (!multiConfigured) {
    body.replaceChildren(h('p', { class: 'muted' }, 'Les amis ne sont pas disponibles en mode local.'));
    return () => {};
  }

  const say = (t: string) => {
    status = t;
    statusEl.textContent = t;
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      say(ok);
      await load();
    } catch (e) {
      say((e as Error).message);
    }
  };

  const button = (label: string, onClick: () => void, cls = '') => {
    const b = h('button', { class: `field small-btn ${cls}`, type: 'button' }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  const row = (id: string, name: string, ...actions: HTMLElement[]) =>
    h('div', { class: 'friend-row' }, nameEl(id, name), h('span', { class: 'friend-actions' }, ...actions));

  const renderTabs = () => {
    const pending = friends.filter((f) => f.status === 'received').length + getNotifications().filter((n) => n.kind === 'room_invite' && !n.read).length;
    tabsEl.replaceChildren(
      ...TABS.map(([id, label]) => {
        const b = h('button', { class: 'tab' + (id === tab ? ' on' : ''), type: 'button' }, label, id === 'requests' && pending ? h('span', { class: 'badge' }, ` ${pending}`) : '');
        b.addEventListener('click', () => switchTo(id));
        return b;
      }),
    );
  };

  const renderSearch = async () => {
    const q = search.value.trim();
    if (q.length < 2) {
      results.replaceChildren(h('p', { class: 'muted small' }, 'Tape au moins 2 lettres du pseudo.'));
      return;
    }
    try {
      const list = await searchPlayers(q);
      if (disposed || search.value.trim() !== q) return;
      const label: Record<Relation, string> = { friend: 'Déjà ami', sent: 'Demande envoyée', received: 'Accepter', none: 'Ajouter' };
      results.replaceChildren(
        ...(list.length
          ? list.map((p) =>
              row(
                p.id,
                p.username,
                p.relation === 'none' || p.relation === 'received'
                  ? button(label[p.relation], () => void act(() => requestFriend(p.id).then(() => renderSearch()), p.relation === 'received' ? `${p.username} est maintenant ton ami.` : `Demande envoyée à ${p.username}.`))
                  : h('span', { class: 'muted small' }, label[p.relation]),
              ),
            )
          : [h('p', { class: 'muted small' }, 'Personne avec ce pseudo.')]),
      );
    } catch (e) {
      results.replaceChildren(h('p', { class: 'notice' }, (e as Error).message));
    }
  };
  let timer: number | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void renderSearch(), 250);
  });

  const render = () => {
    renderTabs();
    statusEl.textContent = status;
    if (tab === 'add') {
      body.replaceChildren(search, results);
      search.focus();
      void renderSearch();
      return;
    }
    if (tab === 'requests') {
      const received = friends.filter((f) => f.status === 'received');
      const sent = friends.filter((f) => f.status === 'sent');
      // Invitations dans un salon reçues pendant l'heure écoulée (même si le site était fermé).
      const invites = getNotifications().filter((n) => n.kind === 'room_invite' && n.room && Date.now() - Date.parse(n.created_at) < 3_600_000);
      body.replaceChildren(
        h('h2', {}, 'Invitations'),
        invites.length
          ? h(
              'div',
              { class: 'friend-list' },
              ...invites.map((n) =>
                h(
                  'div',
                  { class: 'friend-row' },
                  h('span', {}, noteText(n)),
                  h('span', { class: 'friend-actions' }, button('Rejoindre', () => {
                    void markRead([n.id]);
                    navigate(`/room/${n.room}`);
                  })),
                ),
              ),
            )
          : h('p', { class: 'muted small' }, 'Aucune invitation en cours.'),
        h('h2', {}, 'Reçues'),
        received.length
          ? h('div', { class: 'friend-list' }, ...received.map((f) => row(f.id, f.username, button('Accepter', () => void act(() => respondFriend(f.id, true), `${f.username} est maintenant ton ami.`)), button('Refuser', () => void act(() => respondFriend(f.id, false), 'Demande refusée.')))))
          : h('p', { class: 'muted small' }, 'Aucune demande reçue.'),
        h('h2', {}, 'Envoyées'),
        sent.length
          ? h('div', { class: 'friend-list' }, ...sent.map((f) => row(f.id, f.username, h('span', { class: 'muted small' }, 'en attente'), button('Annuler', () => void act(() => removeFriend(f.id), 'Demande annulée.')))))
          : h('p', { class: 'muted small' }, 'Aucune demande envoyée.'),
      );
      return;
    }
    const mine = friends.filter((f) => f.status === 'friend');
    body.replaceChildren(
      mine.length
        ? h(
            'div',
            { class: 'friend-list' },
            ...mine.map((f) => {
              let sure = false;
              const remove = button('Retirer', () => {
                if (!sure) {
                  sure = true;
                  remove.textContent = 'Confirmer ?';
                  return;
                }
                void act(() => removeFriend(f.id), `${f.username} n’est plus ton ami.`);
              });
              const gift = button('Envoyer ◆', () => {
                giftTo = giftTo === f.id ? '' : f.id;
                render();
              });
              gift.setAttribute('aria-expanded', String(giftTo === f.id));
              const line = row(f.id, f.username, gift, button('Regarder', () => navigate(`/regarder/${f.id}`)), button('Voir son appart', () => navigate(`/appart/${f.id}`)), remove);
              return giftTo === f.id ? [line, giftForm(f)] : [line];
            }).flat(),
          )
        : h('p', { class: 'muted' }, 'Pas encore d’amis.'),
    );
  };

  // Don de points à un ami : montant, message facultatif, et confirmation au-delà de 10 % du solde.
  const giftForm = (f: Friend) => {
    const amount = h('input', { class: 'field', type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: 'Montant', 'aria-label': `Points à envoyer à ${f.username}` });
    const note = h('input', { class: 'field', maxlength: 80, placeholder: 'Message (facultatif)', 'aria-label': 'Message' });
    const send = h('button', { class: 'field small-btn', type: 'submit' }, 'Envoyer');
    let sure = 0;
    const form = h('form', { class: 'gift-form' }, amount, note, send);
    amount.addEventListener('input', () => {
      sure = 0;
      send.textContent = 'Envoyer';
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Math.floor(Number(amount.value));
      const balance = getWallet()?.balance ?? 0;
      if (!(n >= 1)) return say('Indique un nombre de points.');
      if (n > balance) return say(`Tu n’as que ${formatPoints(balance)} points.`);
      if (n > balance / 10 && sure !== n) {
        sure = n;
        send.textContent = `Confirmer ${formatPoints(n)} ?`;
        return;
      }
      send.disabled = true;
      givePoints(f.id, n, note.value.trim())
        .then(() => {
          giftTo = '';
          say(`${formatPoints(n)} points envoyés à ${f.username}.`);
          render();
        })
        .catch((err: Error) => {
          send.disabled = false;
          say(err.message);
        });
    });
    queueMicrotask(() => amount.focus());
    return form;
  };

  const load = async () => {
    try {
      friends = await friendList();
    } catch (e) {
      say((e as Error).message);
    }
    if (!disposed) render();
  };

  const switchTo = (t: Tab) => {
    tab = lastTab = t;
    render();
    // Ouvrir les demandes : les notifications de demandes d'ami sont lues.
    if (t === 'requests') {
      const ids = getNotifications().filter((n) => !n.read && n.kind !== 'room_invite').map((n) => n.id);
      if (ids.length) void markRead(ids);
    }
  };

  void load();
  const offNotes = onNotifications((_, fresh) => (fresh && fresh.kind !== 'room_invite' ? void load() : render()));
  const offKeys = pushKeys((e) => {
    if (isTyping(e)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const i = TABS.findIndex(([id]) => id === tab);
      switchTo(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      navigate('/');
    }
  });
  return () => {
    disposed = true;
    clearTimeout(timer);
    offNotes();
    offKeys();
  };
}
