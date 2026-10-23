import { pushKeys } from '../core/input';
import { getAccount } from '../net/auth';
import { nameEl } from '../net/cosmetics';
import { friendList, requestFriend, type Friend } from '../net/friends';
import { activityLabel, atCasino, isHiddenOnline, onlinePlayers, onOnline, setHiddenOnline, type OnlinePlayer } from '../net/online';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { openDock } from './spectateDock';

/** `#/en-ligne` : les joueurs connectés en ce moment, ce qu'ils font, et de quoi les rejoindre. */
export function onlineView(root: HTMLElement): () => void {
  const content = page(root, 'En ligne');
  const count = h('p', { class: 'muted small' });
  const status = h('p', { class: 'status' });
  const list = h('div', { class: 'friend-list' });
  const hide = h('input', { type: 'checkbox', checked: isHiddenOnline() });
  hide.addEventListener('change', () => {
    setHiddenOnline(hide.checked);
    status.textContent = hide.checked ? 'Tu n’apparais plus dans la liste (tu la vois toujours).' : 'Tu apparais de nouveau dans la liste.';
  });
  content.append(
    h(
      'div',
      { class: 'card' },
      h('h1', {}, 'Joueurs en ligne'),
      count,
      h('label', { class: 'online-hide small' }, hide, 'Me cacher de la liste'),
      status,
      list,
    ),
    hints(['Retour arrière', 'accueil']),
  );
  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      navigate('/');
    }
  });
  if (!multiConfigured) {
    list.replaceChildren(h('p', { class: 'muted' }, 'Pas disponible en mode local.'));
    return offKeys;
  }

  let friends: Friend[] = [];
  const relation = (id: string) => friends.find((f) => f.id === id)?.status;
  const button = (label: string, run: () => void) => {
    const b = h('button', { class: 'field small-btn', type: 'button' }, label);
    b.addEventListener('click', run);
    return b;
  };

  const actions = (p: OnlinePlayer): HTMLElement[] => {
    if (p.id === getAccount()?.id) return [h('span', { class: 'muted small' }, 'toi')];
    const rel = relation(p.id);
    if (rel === 'friend')
      return [
        ...(atCasino(p.at)
          ? [
              button('Regarder', () => {
                void openDock(p.id, false, p.name);
                status.textContent = `${p.name} est sur le côté.`;
              }),
            ]
          : []),
        button('Son appart', () => navigate(`/appart/${p.id}`)),
      ];
    if (rel === 'sent') return [h('span', { class: 'muted small' }, 'demande envoyée')];
    return [
      button(rel === 'received' ? 'Accepter' : 'Ajouter', () =>
        requestFriend(p.id)
          .then(async (r) => {
            status.textContent = r === 'friend' ? `${p.name} est maintenant ton ami.` : `Demande envoyée à ${p.name}.`;
            friends = await friendList().catch(() => friends);
            render();
          })
          .catch((e: Error) => (status.textContent = e.message)),
      ),
    ];
  };

  const render = () => {
    const all = onlinePlayers();
    const active = all.filter((p) => !p.away).length;
    count.textContent = all.length ? `${all.length} connecté${all.length > 1 ? 's' : ''}${active < all.length ? `, dont ${all.length - active} absent${all.length - active > 1 ? 's' : ''}` : ''}.` : 'Connexion…';
    list.replaceChildren(
      ...all.map((p) =>
        h(
          'div',
          { class: 'friend-row online-row' + (p.away ? ' away' : '') },
          h('span', { class: 'online-dot' + (p.away ? ' away' : '') }),
          h('span', { class: 'online-who' }, nameEl(p.id, p.name), h('span', { class: 'muted small' }, p.away ? 'absent' : activityLabel(p.at))),
          h('span', { class: 'friend-actions' }, ...actions(p)),
        ),
      ),
    );
  };

  render();
  void friendList()
    .then((f) => {
      friends = f;
      render();
    })
    .catch(() => {});
  const offOnline = onOnline(render);
  return () => {
    offOnline();
    offKeys();
  };
}
