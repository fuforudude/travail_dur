import { pushKeys } from '../core/input';
import { getAccount } from '../net/auth';
import { errorMessage, getSupabase, multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

interface Board {
  title: string;
  view: string;
  order: string;
  columns: [string, string][]; // [clé, en-tête]
}

const BOARDS: Board[] = [
  { title: '2048', view: 'leaderboard_2048', order: 'best', columns: [['best', 'Record'], ['max_tile', 'Tuile'], ['games', 'Parties']] },
  { title: 'Tetris', view: 'leaderboard_tetris', order: 'best', columns: [['best', 'Record'], ['lines', 'Lignes'], ['games', 'Parties']] },
  { title: 'Wordle', view: 'leaderboard_wordle', order: 'solved', columns: [['solved', 'Trouvés'], ['games', 'Jours'], ['average', 'Moyenne']] },
  { title: 'Flappy', view: 'leaderboard_flappy', order: 'best', columns: [['best', 'Record'], ['games', 'Parties']] },
  { title: 'Tower defense', view: 'leaderboard_td', order: 'best', columns: [['best', 'Vagues'], ['kills', 'Victimes'], ['games', 'Parties']] },
  { title: 'Puissance 4', view: 'leaderboard_c4', order: 'wins', columns: [['wins', 'Victoires'], ['losses', 'Défaites'], ['draws', 'Nuls']] },
  { title: 'Morpion', view: 'leaderboard_ttt', order: 'wins', columns: [['wins', 'Victoires'], ['losses', 'Défaites'], ['draws', 'Nuls']] },
];

let tab = 0;

/** `#/scores` : classements (comptes avec email vérifié uniquement). */
export function scoresView(root: HTMLElement): () => void {
  const content = page(root, 'Classements');
  const body = h('div', { class: 'card' });
  content.append(body, hints(['← →', 'jeu'], ['Retour arrière', 'accueil']));
  let seq = 0;

  const render = async () => {
    const b = BOARDS[tab];
    const tabs = h(
      'div',
      { class: 'tabs' },
      ...BOARDS.map((x, i) => {
        const t = h('button', { class: 'tab' + (i === tab ? ' on' : ''), type: 'button' }, x.title);
        t.addEventListener('click', () => ((tab = i), void render()));
        return t;
      }),
    );
    if (!multiConfigured) {
      body.replaceChildren(h('h1', {}, 'Classements'), h('p', { class: 'muted' }, 'Le serveur n’est pas configuré.'));
      return;
    }
    body.replaceChildren(h('h1', {}, 'Classements'), tabs, h('p', { class: 'muted' }, 'Chargement…'));
    const mine = ++seq;
    const supabase = await getSupabase();
    const { data, error } = (await supabase!.from(b.view).select('*').order(b.order, { ascending: false }).limit(50)) as {
      data: Record<string, string | number>[] | null;
      error: unknown;
    };
    if (mine !== seq) return; // un autre onglet a été demandé entre-temps
    const me = getAccount();
    const table = h(
      'table',
      { class: 'scores' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Joueur'), ...b.columns.map(([, t]) => h('th', {}, t)))),
      h(
        'tbody',
        {},
        ...(data ?? []).map((row, i) =>
          h(
            'tr',
            { class: row.user_id === me?.id ? 'me' : '' },
            h('td', {}, String(i + 1)),
            h('td', {}, String(row.username)),
            ...b.columns.map(([k]) => h('td', {}, String(row[k] ?? 0))),
          ),
        ),
      ),
    );
    body.replaceChildren(
      h('h1', {}, 'Classements'),
      tabs,
      error ? h('p', { class: 'notice' }, errorMessage(error)) : data?.length ? table : h('p', { class: 'muted' }, 'Personne pour l’instant.'),
      me && !me.verified
        ? h('p', { class: 'muted small' }, 'Seuls les comptes avec un email vérifié apparaissent ici. Ajoute le tien dans Réglages → Compte.')
        : '',
    );
  };

  void render();
  return pushKeys((e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      tab = (tab + (e.key === 'ArrowRight' ? 1 : BOARDS.length - 1)) % BOARDS.length;
      void render();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      navigate('/');
    }
  });
}
