import { pushKeys, isTyping } from '../core/input';
import { deleteAccount, ensureAccount, linkEmail, onAccount, refreshAccount, sendLoginLink, signOut, type Account } from '../net/auth';
import { getSettings } from '../core/settings';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `#/account` : email facultatif, pour apparaître au classement et retrouver son compte. */
export function accountView(root: HTMLElement, [flag]: string[]): () => void {
  const content = page(root, 'Compte');
  const card = h('div', { class: 'card' });
  content.append(card, hints(['↑ ↓', 'naviguer'], ['Entrée', 'valider'], ['Retour arrière', 'réglages']));
  let notice = flag === 'erreur' ? 'Le lien est invalide ou a expiré. Redemande un email.' : '';
  let account: Account | null = null;
  let loading = multiConfigured;

  const focusables = () => [...card.querySelectorAll<HTMLElement>('input, button')];

  const form = (label: string, placeholder: string, button: string, onSubmit: (email: string) => Promise<string | null>, success: string) => {
    const input = h('input', { class: 'field', type: 'email', placeholder, 'aria-label': label, autocomplete: 'email' });
    const btn = h('button', { class: 'field', type: 'submit' }, button);
    const f = h('form', { class: 'stack' }, h('label', { class: 'small muted' }, label), input, btn);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!EMAIL_RE.test(email)) {
        notice = 'Adresse email invalide.';
        return render();
      }
      btn.disabled = true;
      const err = await onSubmit(email);
      notice = err ?? success.replace('{email}', email);
      render();
    });
    return f;
  };

  const button = (label: string, action: () => void) => {
    const b = h('button', { class: 'field', type: 'button' }, label);
    b.addEventListener('click', action);
    return b;
  };

  // Suppression du compte : il faut retaper son pseudo.
  const dangerZone = (): HTMLElement[] => {
    const input = h('input', { class: 'field', placeholder: getSettings().name, 'aria-label': 'Ton pseudo, pour confirmer', autocomplete: 'off' });
    const btn = h('button', { class: 'field danger', type: 'submit' }, 'Supprimer définitivement mon compte');
    const f = h(
      'form',
      { class: 'stack' },
      h('label', { class: 'small muted' }, `Tout sera effacé : scores, points, appart, meubles, amis. C’est irréversible. Tape ton pseudo (${getSettings().name}) pour confirmer.`),
      input,
      btn,
    );
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const err = await deleteAccount(input.value.trim());
      if (err) {
        notice = err;
        return render();
      }
      navigate('/');
    });
    return [h('h2', {}, 'Supprimer mon compte'), f];
  };

  const render = () => {
    const parts: (HTMLElement | null)[] = [h('h1', {}, 'Compte')];
    if (!multiConfigured) {
      parts.push(h('p', { class: 'muted' }, 'Les comptes et classements ne sont pas disponibles en mode local.'));
    } else if (loading) {
      parts.push(h('p', { class: 'muted' }, 'Connexion…'));
    } else if (!account) {
      parts.push(h('p', { class: 'muted' }, 'Connexion au serveur impossible. Réessaie plus tard.'));
    } else if (account.verified) {
      parts.push(
        h('p', {}, 'Compte vérifié : ', h('strong', {}, account.email ?? '')),
        button('Se déconnecter', async () => {
          await signOut();
          notice = 'Déconnecté. Tu joues maintenant avec un nouveau compte invité.';
          render();
        }),
      );
    } else {
      parts.push(
        h('p', {}, 'Tu joues avec un ', h('strong', {}, 'compte invité'), '.'),
        h(
          'p',
          { class: 'muted small' },
          'Ajoute un email pour apparaître dans les classements et retrouver ton compte sur un autre appareil. Tes scores sont conservés.',
        ),
        account.pendingEmail
          ? h('p', { class: 'notice' }, `Email de vérification envoyé à ${account.pendingEmail}. Clique sur le lien reçu, puis reviens ici.`)
          : null,
        account.pendingEmail ? button('J’ai cliqué sur le lien', async () => {
          await refreshAccount();
          if (!account?.verified) notice = 'Pas encore vérifié. Le lien peut mettre une minute à arriver (pense aux spams).';
          render();
        }) : null,
        form('Ajouter mon email', 'prenom.nom@exemple.fr', 'Envoyer l’email de vérification', linkEmail, 'Email envoyé à {email}. Clique sur le lien pour confirmer.'),
        h('h2', {}, 'Retrouver mon compte'),
        form('Email du compte', 'prenom.nom@exemple.fr', 'Recevoir un lien de connexion', sendLoginLink, 'Si un compte existe pour {email}, un lien de connexion vient d’être envoyé.'),
      );
    }
    if (account) parts.push(...dangerZone());
    if (notice) parts.push(h('p', { class: 'notice' }, notice));
    parts.push(button('Retour aux réglages', () => navigate('/settings')));
    card.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
    if (!card.contains(document.activeElement)) focusables()[0]?.focus();
  };

  const off = onAccount((a) => {
    account = a;
    render();
  });
  void ensureAccount().then((a) => {
    account = a;
    loading = false;
    render();
  });
  render();

  const popKeys = pushKeys((e) => {
    const list = focusables();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === 'Backspace' && !isTyping(e)) {
      e.preventDefault();
      navigate('/settings');
    }
  });
  return () => {
    off();
    popKeys();
  };
}
