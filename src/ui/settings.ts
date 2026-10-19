import { captureNextKey, isTyping, pushKeys } from '../core/input';
import { getSettings, keyLabel, updateSettings } from '../core/settings';
import { setUsername } from '../net/auth';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

export function settingsView(root: HTMLElement): () => void {
  const content = page(root, 'Réglages');
  const s = getSettings();

  const name = h('input', { class: 'field', maxlength: 16, value: s.name, 'aria-label': 'Pseudo' });
  const nameError = h('p', { class: 'muted small' });
  name.addEventListener('change', async () => {
    const value = name.value.trim();
    if (value === getSettings().name) return;
    const err = await setUsername(value);
    nameError.textContent = err ?? 'Pseudo enregistré.';
    if (err) name.value = getSettings().name;
  });

  const toggle = (label: () => string, flip: () => void) => {
    const b = h('button', { class: 'field toggle', type: 'button' }, label());
    const run = () => {
      flip();
      b.textContent = label();
    };
    b.addEventListener('click', run);
    return { b, run };
  };

  const theme = toggle(
    () => (getSettings().theme === 'light' ? '‹ Clair ›' : '‹ Sombre ›'),
    () => updateSettings({ theme: getSettings().theme === 'light' ? 'dark' : 'light' }),
  );
  const sound = toggle(
    () => (getSettings().sound ? '‹ Activé ›' : '‹ Désactivé ›'),
    () => updateSettings({ sound: !getSettings().sound }),
  );
  const panic = h('button', { class: 'field', type: 'button' }, keyLabel(s.panicKey));
  panic.addEventListener('click', () => {
    panic.textContent = 'Appuie sur une touche…';
    captureNextKey((e) => {
      const forbidden = ['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Backspace'];
      if (!forbidden.includes(e.key) && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
        updateSettings({ panicKey: e.key });
      }
      panic.textContent = keyLabel(getSettings().panicKey);
      refreshHint();
    });
  });
  const account = h('button', { class: 'field', type: 'button' }, 'Email, classements…');
  account.addEventListener('click', () => navigate('/account'));
  const back = h('button', { class: 'field', type: 'button' }, 'Retour à l’accueil');
  back.addEventListener('click', () => navigate('/'));

  const row = (label: string, control: HTMLElement) => h('div', { class: 'row' }, h('span', {}, label), control);
  const panicHint = h('p', { class: 'muted small' });
  const refreshHint = () => {
    panicHint.textContent = `${keyLabel(getSettings().panicKey)} ou Ctrl+Maj+Espace affiche un faux écran de notes ; même touche pour revenir.`;
  };
  refreshHint();

  const controls: HTMLElement[] = [name, theme.b, sound.b, panic, account, back];
  content.append(
    h(
      'div',
      { class: 'card' },
      h('h1', {}, 'Réglages'),
      row('Pseudo', name),
      nameError,
      row('Thème', theme.b),
      row('Son', sound.b),
      row('Touche panique', panic),
      panicHint,
      row('Compte', account),
      back,
    ),
    hints(['↑ ↓', 'naviguer'], ['← →', 'changer'], ['Entrée', 'valider'], ['Retour arrière', 'accueil']),
  );
  name.focus();

  return pushKeys((e) => {
    const i = controls.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (document.activeElement === name) name.dispatchEvent(new Event('change'));
      controls[(i + (e.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length].focus();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping(e)) {
      e.preventDefault();
      if (document.activeElement === theme.b) theme.run();
      if (document.activeElement === sound.b) sound.run();
    } else if (e.key === 'Enter' && document.activeElement === name) {
      name.dispatchEvent(new Event('change'));
      theme.b.focus();
    } else if (e.key === 'Backspace' && !isTyping(e)) {
      e.preventDefault();
      navigate('/');
    }
  });
}
