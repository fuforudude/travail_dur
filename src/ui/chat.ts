import { isTyping } from '../core/input';
import { blip } from '../core/sound';
import { say, watchChat, type ChatMessage } from '../net/chat';
import { nameEl } from '../net/cosmetics';
import type { Room } from '../net/room';
import { h } from './dom';

const MAX_SHOWN = 100;

/**
 * Discussion du salon. Reste affichée pendant les parties : `T` place le curseur dans le champ,
 * Échap le rend au jeu.
 */
export function chatPanel(room: Room): { el: HTMLElement; destroy(): void } {
  const seen = new Set<number>();
  const messages: ChatMessage[] = [];
  let disposed = false;
  let sending = false;
  let loaded = false;
  let unwatch: (() => void) | null = null;

  const list = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const status = h('p', { class: 'muted small chat-status' });
  const input = h('input', { class: 'field', maxlength: 300, placeholder: 'Écrire un message…  (T)', 'aria-label': 'Message', autocomplete: 'off' });
  const form = h('form', { class: 'chat-form' }, input, h('button', { class: 'field', type: 'submit' }, 'Envoyer'));
  const el = h('section', { class: 'card chat' }, h('h2', {}, 'Discussion'), list, status, form);

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const render = () => {
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    list.replaceChildren(
      ...messages.map((m) =>
        h(
          'li',
          { class: m.sender === room.myId ? 'mine' : '' },
          h('span', { class: 'chat-time' }, time(m.created_at)),
          h('b', {}, nameEl(m.sender, room.nameOf(m.sender) ?? m.profiles?.username ?? 'Joueur')),
          ' ',
          m.body,
        ),
      ),
    );
    if (loaded && !messages.length) list.append(h('li', { class: 'muted' }, 'Aucun message pour l’instant.'));
    if (atBottom || messages.at(-1)?.sender === room.myId) list.scrollTop = list.scrollHeight;
  };

  const receive = (batch: ChatMessage[]) => {
    if (disposed) return;
    let fresh = false;
    for (const m of batch) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      messages.push(m);
      fresh ||= m.sender !== room.myId;
    }
    messages.sort((a, b) => a.id - b.id);
    messages.splice(0, Math.max(0, messages.length - MAX_SHOWN));
    if (fresh && batch.length === 1) blip(520);
    render();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    try {
      await say(room.code, text);
      input.value = '';
      status.textContent = '';
    } catch (err) {
      status.textContent = (err as Error).message;
    } finally {
      sending = false;
      render();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') input.blur();
  });

  // Écouteur à part de la pile clavier : la touche doit marcher dans le salon comme en pleine partie.
  // Les jeux n'utilisent pas T, et une touche déjà traitée (preventDefault) est ignorée.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 't') return;
    e.preventDefault();
    input.focus();
  };
  window.addEventListener('keydown', onKey);

  // Les pseudos arrivent avec la présence : on réaffiche quand la liste des joueurs change.
  const offPlayers = room.onPlayers(render);

  watchChat(room.code, receive).then(
    (off) => {
      if (disposed) return off();
      unwatch = off;
      loaded = true;
      render();
    },
    (err: Error) => {
      status.textContent = err.message;
      input.disabled = true;
    },
  );

  return {
    el,
    destroy() {
      disposed = true;
      window.removeEventListener('keydown', onKey);
      offPlayers();
      unwatch?.();
    },
  };
}
