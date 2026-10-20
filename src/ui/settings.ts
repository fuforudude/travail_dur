import { captureNextKey, isTyping, pushKeys } from '../core/input';
import { clearCustomPdf, getCustomPdf, preparePdfScreen, resetPdfScreen, setCustomPdf } from '../core/panicPdf';
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
  const palette = toggle(
    () => (getSettings().palette === 'color' ? '‹ Couleur ›' : '‹ Noir et blanc ›'),
    () => updateSettings({ palette: getSettings().palette === 'color' ? 'mono' : 'color' }),
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
  const cover = toggle(
    () => (getSettings().panicScreen === 'pdf' ? '‹ Un PDF ›' : '‹ Faux carnet de notes ›'),
    () => {
      updateSettings({ panicScreen: getSettings().panicScreen === 'pdf' ? 'notes' : 'pdf' });
      refreshHint();
      refreshPdf();
    },
  );

  // PDF montré par la touche panique : choisi ici, gardé dans ce navigateur.
  const pdfButton = h('button', { class: 'field pdf-choice', type: 'button' }, '…');
  const pdfInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  const pdfReset = h('button', { class: 'field', type: 'button', hidden: true }, 'Retirer ce PDF');
  const pdfStatus = h('p', { class: 'muted small' });
  const refreshPdf = async () => {
    const custom = await getCustomPdf();
    pdfButton.textContent = custom?.name ?? 'Choisir un PDF…';
    pdfButton.title = custom ? 'Choisir un autre PDF' : 'Par exemple le support du cours';
    pdfReset.hidden = !custom;
    pdfButton.disabled = getSettings().panicScreen !== 'pdf';
  };
  pdfButton.addEventListener('click', () => pdfInput.click());
  pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files?.[0];
    pdfInput.value = '';
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      pdfStatus.textContent = 'Fichier trop lourd (30 Mo maximum).';
      return;
    }
    pdfStatus.textContent = 'Chargement…';
    try {
      await setCustomPdf(file);
      await preparePdfScreen();
      pdfStatus.textContent = `${file.name} sera affiché par la touche panique. Il reste dans ce navigateur, rien n’est envoyé.`;
    } catch {
      resetPdfScreen();
      await clearCustomPdf().catch(() => {});
      pdfStatus.textContent = 'Ce fichier ne peut pas être lu comme un PDF.';
    }
    void refreshPdf();
  });
  pdfReset.addEventListener('click', async () => {
    await clearCustomPdf();
    pdfStatus.textContent = 'PDF retiré : la touche panique affiche le faux carnet.';
    void refreshPdf();
  });
  void refreshPdf();

  const account = h('button', { class: 'field', type: 'button' }, 'Email, classements…');
  account.addEventListener('click', () => navigate('/account'));
  const back = h('button', { class: 'field', type: 'button' }, 'Retour à l’accueil');
  back.addEventListener('click', () => navigate('/'));

  const row = (label: string, control: HTMLElement) => h('div', { class: 'row' }, h('span', {}, label), control);
  const panicHint = h('p', { class: 'muted small' });
  const refreshHint = () => {
    const what = getSettings().panicScreen === 'pdf' ? 'le PDF ci-dessous (sinon un faux carnet de notes)' : 'un faux carnet de notes';
    panicHint.textContent = `${keyLabel(getSettings().panicKey)} ou Ctrl+Maj+Espace affiche ${what} ; même touche pour revenir.`;
  };
  refreshHint();

  const controls: HTMLElement[] = [name, theme.b, palette.b, sound.b, panic, cover.b, pdfButton, pdfReset, account, back];
  content.append(
    h(
      'div',
      { class: 'card' },
      h('h1', {}, 'Réglages'),
      row('Pseudo', name),
      nameError,
      row('Thème', theme.b),
      row('Couleurs', palette.b),
      row('Son', sound.b),
      row('Touche panique', panic),
      row('Elle affiche', cover.b),
      row('PDF', pdfButton),
      pdfReset,
      pdfInput,
      pdfStatus,
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
      // On saute les boutons masqués ou désactivés.
      const usable = controls.filter((c) => !c.hidden && !(c as HTMLButtonElement).disabled);
      const j = usable.indexOf(controls[i]);
      usable[(j + (e.key === 'ArrowDown' ? 1 : usable.length - 1)) % usable.length].focus();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping(e)) {
      e.preventDefault();
      if (document.activeElement === theme.b) theme.run();
      if (document.activeElement === palette.b) palette.run();
      if (document.activeElement === sound.b) sound.run();
      if (document.activeElement === cover.b) cover.run();
    } else if (e.key === 'Enter' && document.activeElement === name) {
      name.dispatchEvent(new Event('change'));
      theme.b.focus();
    } else if (e.key === 'Backspace' && !isTyping(e)) {
      e.preventDefault();
      navigate('/');
    }
  });
}
