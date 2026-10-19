import { h } from './dom';

export interface MenuItem {
  label: string;
  detail?: string;
  /** Pastille à gauche : un caractère et une teinte (1 à 5). */
  icon?: string;
  tone?: number;
  disabled?: boolean;
  action(): void;
}

/**
 * Liste verticale navigable aux flèches. Le focus DOM suit la sélection,
 * donc Entrée et Espace activent nativement le bouton (et le clic marche aussi).
 */
export function menu(items: MenuItem[], initial = 0): { el: HTMLElement; onKey(e: KeyboardEvent): boolean; focus(): void } {
  const buttons = items.map((it) =>
    h(
      'button',
      { class: 'menu-item', disabled: it.disabled, type: 'button' },
      it.icon ? h('span', { class: `menu-icon tone${it.tone ?? 1}`, 'aria-hidden': 'true' }, it.icon) : null,
      h('span', { class: 'menu-label' }, it.label),
      it.detail ? h('span', { class: 'menu-detail' }, it.detail) : null,
    ),
  );
  buttons.forEach((b, i) => b.addEventListener('click', () => items[i].action()));
  const el = h('div', { class: 'menu', role: 'menu' }, ...buttons);
  const enabled = () => buttons.filter((b) => !b.disabled);

  const focusAt = (i: number) => {
    const list = enabled();
    if (list.length) list[(i + list.length) % list.length].focus();
  };

  return {
    el,
    focus() {
      const start = buttons[initial];
      if (start && !start.disabled) start.focus();
      else focusAt(0);
    },
    onKey(e) {
      const list = enabled();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (i < 0) focusAt(0);
        else focusAt(i + (e.key === 'ArrowDown' ? 1 : -1));
        return true;
      }
      if ((e.key === 'Enter' || e.key === ' ') && i < 0) {
        // Rien n'a le focus (par ex. après un clic ailleurs) : on le remet.
        e.preventDefault();
        focusAt(0);
        return true;
      }
      return false;
    },
  };
}
