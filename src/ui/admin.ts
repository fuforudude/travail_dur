import { isTyping, pushKeys } from '../core/input';
import {
  addArtwork,
  adminLog,
  deleteArtwork,
  deletePlayer,
  findPlayers,
  givePoints,
  giveItem,
  isAdmin,
  renamePlayer,
  scareNow,
  setCurse,
  type PlayerRow,
} from '../net/admin';
import { artworks, BASES, FINISHES, itemName } from '../net/apartment';
import { nameEl } from '../net/cosmetics';
import { enrollTotp, mfaState, verifyTotp } from '../net/mfa';
import { formatPoints } from '../net/points';
import { ITEMS } from '../net/shop';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

const SLOT_NAMES: Record<string, string> = { name_color: 'couleur de pseudo', name_effect: 'effet de pseudo', title: 'titre', skin: 'skin' };
const LEVELS = ['', 'rare (8 à 15 min)', 'normal (3 à 8 min)', 'fréquent (1 à 3 min)'];
const ACTIONS: Record<string, string> = {
  points: 'Points',
  rename: 'Renommage',
  curse: 'Malédiction',
  uncurse: 'Fin de malédiction',
  scare: 'Screamer',
  give: 'Don d’objet',
  delete: 'Joueur supprimé',
  artwork_add: 'Photo ajoutée',
  artwork_delete: 'Photo supprimée',
};

/** `#/admin` : réservé aux admins (le serveur refuse de toute façon chaque action à un non-admin). */
export function adminView(root: HTMLElement): () => void {
  const content = page(root, 'Admin');
  content.classList.add('wide');
  const wrap = h('div', { class: 'admin' }, h('p', { class: 'muted' }, 'Vérification…'));
  content.append(wrap, hints(['Retour arrière', 'accueil (hors des champs)']));
  let disposed = false;

  const notice = h('p', { class: 'status admin-notice' });
  const say = (text: string) => (notice.textContent = text);
  const run = async (what: () => Promise<unknown>, ok: string) => {
    try {
      await what();
      say(ok);
      return true;
    } catch (e) {
      say((e as Error).message);
      return false;
    }
  };

  // --- Joueurs -------------------------------------------------------------
  const search = h('input', { class: 'field', placeholder: 'Rechercher par pseudo ou identifiant', 'aria-label': 'Recherche' });
  const results = h('tbody', {});
  const detail = h('div', { class: 'admin-detail card', hidden: true });
  let players: PlayerRow[] = [];
  let selected: PlayerRow | null = null;

  const loadPlayers = async () => {
    try {
      players = await findPlayers(search.value.trim());
      results.replaceChildren(
        ...players.map((p) => {
          // Les trois actions courantes, directement sur la ligne.
          const edit = h('button', { class: 'field small-btn', type: 'button' }, 'Modifier');
          edit.addEventListener('click', () => {
            select(p);
            detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
          const curse = h('button', { class: 'field small-btn' + (p.cursed ? ' on' : ''), type: 'button', disabled: p.is_admin }, p.cursed ? 'Libérer' : 'Maudire');
          curse.addEventListener('click', async () => {
            if (await run(() => setCurse(p.id, !p.cursed, p.curse_level), p.cursed ? `${p.username} est libéré.` : `${p.username} est maudit (niveau ${p.curse_level}).`)) void loadPlayers();
          });
          const del = h('button', { class: 'field small-btn danger', type: 'button', disabled: p.is_admin }, 'Supprimer');
          let sure = false;
          del.addEventListener('click', async () => {
            if (!sure) {
              sure = true;
              del.textContent = 'Confirmer ?';
              say(`Supprimer ${p.username} efface son compte, ses scores, ses points et ses objets. Clique à nouveau pour confirmer.`);
              return;
            }
            if (await run(() => deletePlayer(p.id), `${p.username} a été supprimé.`)) {
              if (selected?.id === p.id) {
                selected = null;
                detail.hidden = true;
              }
              void loadPlayers();
            }
          });
          return h(
            'tr',
            { class: selected?.id === p.id ? 'me' : '' },
            h('td', {}, nameEl(p.id, p.username), p.is_admin ? h('span', { class: 'tag' }, ' admin') : '', p.verified ? '' : h('span', { class: 'muted small' }, ' invité')),
            h('td', {}, formatPoints(p.balance)),
            h('td', {}, p.cursed ? h('span', { class: 'tag danger-tag' }, `maudit · ${p.curse_level}`) : ''),
            h('td', { class: 'admin-actions' }, edit, curse, del),
          );
        }),
      );
      if (selected) {
        const fresh = players.find((p) => p.id === selected!.id);
        if (fresh) select(fresh);
      }
    } catch (e) {
      say((e as Error).message);
    }
  };
  let timer: number | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void loadPlayers(), 250);
  });

  const select = (p: PlayerRow) => {
    selected = p;
    const amount = h('input', { class: 'field', type: 'number', step: 1, value: 1000, 'aria-label': 'Montant' });
    const reason = h('input', { class: 'field', placeholder: 'Motif (facultatif)', maxlength: 80, 'aria-label': 'Motif' });
    const give = h('button', { class: 'field', type: 'button' }, 'Donner');
    const take = h('button', { class: 'field', type: 'button' }, 'Retirer');
    const points = async (sign: 1 | -1) => {
      const n = Math.floor(Math.abs(Number(amount.value)));
      if (!n) return say('Montant invalide.');
      if (await run(() => givePoints(p.id, sign * n, reason.value), `${sign > 0 ? '+' : '−'}${formatPoints(n)} points pour ${p.username}.`)) void loadPlayers();
    };
    give.addEventListener('click', () => void points(1));
    take.addEventListener('click', () => void points(-1));

    const newName = h('input', { class: 'field', value: p.username, maxlength: 16, 'aria-label': 'Nouveau pseudo' });
    const rename = h('button', { class: 'field', type: 'button' }, 'Renommer');
    rename.addEventListener('click', async () => {
      if (await run(() => renamePlayer(p.id, newName.value), 'Pseudo changé.')) void loadPlayers();
    });

    const level = h('select', { class: 'field', 'aria-label': 'Niveau' }, ...[1, 2, 3].map((l) => h('option', { value: l, selected: l === p.curse_level }, `Niveau ${l} : ${LEVELS[l]}`)));
    const curse = h('button', { class: 'field', type: 'button' }, p.cursed ? 'Lever la malédiction' : 'Maudire');
    curse.addEventListener('click', async () => {
      if (await run(() => setCurse(p.id, !p.cursed, Number(level.value)), p.cursed ? 'Malédiction levée.' : `${p.username} est maudit.`)) void loadPlayers();
    });
    level.addEventListener('change', () => {
      if (p.cursed) void run(() => setCurse(p.id, true, Number(level.value)), 'Niveau changé.').then(() => loadPlayers());
    });
    const scare = h('button', { class: 'field danger', type: 'button' }, 'Screamer maintenant');
    scare.addEventListener('click', () => void run(() => scareNow(p.id), 'Screamer envoyé (si le joueur a le site ouvert).'));

    const item = h('select', { class: 'field', 'aria-label': 'Objet' },
      h('optgroup', { label: 'Boutique' }, ...ITEMS.map((i) => h('option', { value: i.id }, `${i.name} (${SLOT_NAMES[i.slot.split(':')[0]]}${i.slot.startsWith('skin:') ? ' ' + i.slot.slice(5) : ''})`))),
      h('optgroup', { label: 'Meubles' }, ...BASES.flatMap((b) => FINISHES.map((f) => h('option', { value: `${b.id}:${f.id}` }, itemName(`${b.id}:${f.id}`))))),
    );
    const gift = h('button', { class: 'field', type: 'button' }, 'Donner l’objet');
    gift.addEventListener('click', () => void run(() => giveItem(p.id, item.value), 'Objet donné.'));

    const row = (label: string, ...controls: HTMLElement[]) => h('div', { class: 'admin-row' }, h('span', { class: 'muted small' }, label), h('div', { class: 'admin-controls' }, ...controls));
    detail.hidden = false;
    detail.replaceChildren(
      h('h2', {}, nameEl(p.id, p.username), ' ', h('span', { class: 'muted small' }, `◆ ${formatPoints(p.balance)} · ${formatPoints(p.earned)} gagnés en jouant`)),
      row('Points', amount, reason, give, take),
      row('Pseudo', newName, rename),
      row('Malédiction', level, curse, scare),
      row('Objet', item, gift),
      h('p', { class: 'muted small' }, `Identifiant : ${p.id}`),
    );
    results.querySelectorAll('tr').forEach((tr, i) => tr.classList.toggle('me', players[i]?.id === p.id));
    // Les malédictions se gèrent aussi ici : niveau et screamer immédiat.
  };

  // --- Photos --------------------------------------------------------------
  const file = h('input', { class: 'field', type: 'file', accept: 'image/*', 'aria-label': 'Photo' });
  const title = h('input', { class: 'field', placeholder: 'Titre de la photo', maxlength: 80, 'aria-label': 'Titre' });
  const upload = h('button', { class: 'field', type: 'button' }, 'Ajouter la photo');
  const gallery = h('div', { class: 'admin-gallery' });
  const loadGallery = async () => {
    try {
      const list = await artworks();
      gallery.replaceChildren(
        ...(list.length
          ? list.map((a) => {
              const del = h('button', { class: 'field danger', type: 'button' }, 'Supprimer');
              let sure = false;
              del.addEventListener('click', async () => {
                if (!sure) {
                  sure = true;
                  del.textContent = 'Confirmer ?';
                  return;
                }
                if (await run(() => deleteArtwork(a.id), 'Photo supprimée (les cadres qui la montraient sont vidés).')) void loadGallery();
              });
              return h('figure', { class: 'admin-photo' }, h('img', { src: a.url, alt: a.title, loading: 'lazy' }), h('figcaption', {}, a.title), del);
            })
          : [h('p', { class: 'muted' }, 'Aucune photo pour l’instant.')]),
      );
    } catch (e) {
      gallery.replaceChildren(h('p', { class: 'notice' }, (e as Error).message));
    }
  };
  upload.addEventListener('click', async () => {
    const f = file.files?.[0];
    if (!f) return say('Choisis d’abord une image.');
    if (f.size > 5 * 1024 * 1024) return say('Image trop lourde (5 Mo maximum).');
    say('Envoi…');
    if (await run(() => addArtwork(f, title.value.trim() || f.name.replace(/\.[^.]+$/, '')), 'Photo ajoutée.')) {
      file.value = '';
      title.value = '';
      void loadGallery();
    }
  });

  // --- Journal -------------------------------------------------------------
  const log = h('ol', { class: 'pts-history' });
  const loadLog = async () => {
    try {
      const rows = await adminLog();
      log.replaceChildren(
        ...rows.map((r) =>
          h('li', {}, h('b', {}, ACTIONS[r.action] ?? r.action), r.detail ? h('span', {}, ` — ${r.detail}`) : null, h('span', { class: 'muted small push' }, ' ', new Date(r.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))),
        ),
      );
    } catch (e) {
      log.replaceChildren(h('li', { class: 'notice' }, (e as Error).message));
    }
  };

  // Double authentification : les actions d'admin l'exigent (admin_check, 0037_securite.sql).
  const secondFactor = async () => {
    let st;
    try {
      st = await mfaState();
    } catch (e) {
      wrap.replaceChildren(h('div', { class: 'card narrow' }, h('h1', {}, 'Administration'), h('p', { class: 'notice' }, (e as Error).message)));
      return;
    }
    if (disposed) return;
    if (st.verified) return showAdmin();
    const code = h('input', { class: 'field', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '123 456', 'aria-label': 'Code à 6 chiffres' });
    const btn = h('button', { class: 'field', type: 'submit' }, 'Valider');
    const status = h('p', { class: 'status' });
    let factorId = st.factorId;
    const form = h('form', { class: 'stack' }, code, btn, status);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!factorId) return;
      btn.disabled = true;
      try {
        await verifyTotp(factorId, code.value);
        if (!disposed) showAdmin();
      } catch (err) {
        status.textContent = (err as Error).message;
        btn.disabled = false;
        code.select();
      }
    });
    const card = h('div', { class: 'card narrow' }, h('h1', {}, 'Double authentification'));
    if (factorId) {
      card.append(h('p', { class: 'muted' }, 'Entre le code à 6 chiffres affiché par ton appli d’authentification.'), form);
    } else {
      card.append(h('p', { class: 'muted' }, 'Les actions d’admin demandent maintenant un code en plus de l’email. Scanne ce QR code avec une appli d’authentification (Google Authenticator, Microsoft Authenticator, 2FAS…), puis entre le code affiché.'));
      try {
        const t = await enrollTotp();
        factorId = t.factorId;
        card.append(
          h('img', { class: 'admin-qr', src: t.qr, alt: 'QR code à scanner', width: 200, height: 200 }),
          h('p', { class: 'small muted' }, 'Ou recopie la clé : ', h('code', {}, t.secret)),
          form,
        );
      } catch (err) {
        card.append(h('p', { class: 'notice' }, (err as Error).message));
      }
    }
    if (disposed) return;
    wrap.replaceChildren(card);
    code.focus();
  };

  void isAdmin().then((ok) => {
    if (disposed) return;
    if (!ok) {
      wrap.replaceChildren(h('div', { class: 'card narrow' }, h('h1', {}, 'Accès refusé'), h('p', { class: 'muted' }, 'Cette page est réservée aux admins.')));
      return;
    }
    void secondFactor();
  });

  const showAdmin = () => {
    wrap.replaceChildren(
      h('h1', {}, 'Administration'),
      notice,
      h('section', { class: 'card' }, h('h2', {}, 'Joueurs'), search, h('table', { class: 'scores admin-players' }, h('thead', {}, h('tr', {}, h('th', {}, 'Joueur'), h('th', {}, 'Solde'), h('th', {}, ''), h('th', {}, 'Actions'))), results)),
      detail,
      h('section', { class: 'card' }, h('h2', {}, 'Photos des cadres'), h('div', { class: 'admin-controls' }, file, title, upload), gallery),
      h('section', { class: 'card' }, h('h2', {}, 'Journal'), log),
    );
    void loadPlayers();
    void loadGallery();
    void loadLog();
  };

  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace' && !isTyping(e)) {
      e.preventDefault();
      navigate('/');
    }
  });
  const logTimer = window.setInterval(() => void loadLog(), 15_000);
  return () => {
    disposed = true;
    clearInterval(logTimer);
    offKeys();
  };
}
