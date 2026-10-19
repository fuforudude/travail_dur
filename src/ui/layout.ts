import { getSettings } from '../core/settings';
import { h } from './dom';

/** Squelette commun : en-tête discret + zone de contenu. */
export function page(root: HTMLElement, title: string): HTMLElement {
  const content = h('main', { class: 'content' });
  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, 'Notes'),
      h('span', { class: 'crumb' }, title),
      h('span', { class: 'who' }, getSettings().name),
    ),
    content,
  );
  return content;
}
