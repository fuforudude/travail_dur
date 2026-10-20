import { setInterceptor } from './input';
import { preparePdfScreen, readyPdfScreen, scrollPdf } from './panicPdf';
import { getSettings } from './settings';

// Icône de document neutre, identique en mode normal et en mode panique.
const NEUTRAL_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#8a8f98"/><path d="M5 5h6M5 8h6M5 11h4" stroke="#8a8f98"/></svg>',
  );

const NORMAL_TITLE = 'Notes';
const PANIC_TITLE = 'Notes – Cours';

let active = false;
let savedFocus: Element | null = null;
const listeners = new Set<(paused: boolean) => void>();

export function isPanicked(): boolean {
  return active;
}

/** Les jeux en temps réel s'abonnent ici pour se mettre en pause. */
export function onPanicChange(cb: (paused: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.href = href;
}

export function togglePanic(): void {
  const app = document.getElementById('app')!;
  const screen = document.getElementById('panic')!;
  active = !active;
  if (active) {
    savedFocus = document.activeElement;
    // Masquer d'abord : rien du jeu ne doit rester affiché à la prochaine frame.
    app.hidden = true;
    showCover(screen);
    screen.hidden = false;
  } else {
    screen.hidden = true;
    app.hidden = false;
    document.title = NORMAL_TITLE;
    (savedFocus as HTMLElement | null)?.focus?.();
  }
  setFavicon(NEUTRAL_ICON);
  listeners.forEach((cb) => cb(active));
}

let notes: HTMLElement | null = null;

/** Met en place l'écran de secours : le PDF (s'il est prêt, sinon dès qu'il l'est) ou le faux carnet. */
function showCover(screen: HTMLElement): void {
  if (getSettings().panicScreen === 'notes') {
    notes ??= buildFakeScreen();
    screen.replaceChildren(notes);
    document.title = PANIC_TITLE;
    notes.querySelector<HTMLElement>('.fake-doc')?.focus();
    return;
  }
  const show = (viewer: { el: HTMLElement; name: string }) => {
    screen.replaceChildren(viewer.el);
    document.title = viewer.name;
    viewer.el.querySelector<HTMLElement>('.pdf-scroll')?.focus();
  };
  const ready = readyPdfScreen();
  if (ready) return show(ready);
  // Pas encore prêt (touche pressée dès l'ouverture) : une visionneuse vide, remplie juste après.
  // Sans PDF choisi dans les réglages, la préparation échoue et on montre le faux carnet.
  const wait = document.createElement('div');
  wait.className = 'pdf-viewer';
  wait.innerHTML = '<div class="pdf-bar"><span class="pdf-title">Chargement…</span></div><div class="pdf-scroll"></div>';
  screen.replaceChildren(wait);
  document.title = 'Document PDF';
  preparePdfScreen().then(
    (viewer) => active && screen.firstChild === wait && show(viewer),
    () => {
      if (!active || screen.firstChild !== wait) return;
      notes ??= buildFakeScreen(); // pas de PDF, ou PDF illisible : faux carnet
      screen.replaceChildren(notes);
      document.title = PANIC_TITLE;
    },
  );
}

function isToggle(e: KeyboardEvent): boolean {
  if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) return true;
  return e.key === getSettings().panicKey && !e.ctrlKey && !e.altKey && !e.metaKey;
}

export function initPanic(): void {
  document.title = NORMAL_TITLE;
  setFavicon(NEUTRAL_ICON);
  setInterceptor((e) => {
    if (isToggle(e)) {
      if (!e.repeat) togglePanic();
      return true;
    }
    // Pendant le faux écran, aucune touche n'atteint le jeu (il est en pause) ;
    // la saisie dans le faux document reste possible, et le PDF défile au clavier.
    if (active) scrollPdf(document.getElementById('panic')!, e.key, e.shiftKey);
    return active ? !isEditable(e.target) : false;
  });
  // Le PDF se prépare dès que le navigateur est libre, pour s'afficher instantanément.
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => {
    if (getSettings().panicScreen === 'pdf') void preparePdfScreen().catch(() => {});
  });
}

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && t.isContentEditable;
}

function buildFakeScreen(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fake';
  wrap.innerHTML = `
    <aside class="fake-side">
      <div class="fake-side-title">Mes carnets</div>
      <ul>
        <li>Cours magistraux</li>
        <li class="on">Économie — S1</li>
        <li>Droit des contrats</li>
        <li>Statistiques</li>
        <li>Anglais</li>
        <li>À faire</li>
      </ul>
    </aside>
    <section class="fake-main">
      <div class="fake-meta">Économie — S1 · modifié il y a 2 min</div>
      <article class="fake-doc" contenteditable="true" spellcheck="false">
        <h1>Chapitre 4 — Les marchés financiers</h1>
        <p><b>Définition :</b> un marché financier est un lieu (aujourd’hui largement dématérialisé) où se rencontrent les agents à besoin de financement et les agents à capacité de financement.</p>
        <h2>I. Le rôle des marchés financiers</h2>
        <ul>
          <li>Financement direct de l’économie (désintermédiation)</li>
          <li>Allocation de l’épargne vers les projets les plus rentables</li>
          <li>Liquidité : possibilité de revendre un titre à tout moment</li>
          <li>Couverture des risques (produits dérivés)</li>
        </ul>
        <h2>II. Marché primaire et marché secondaire</h2>
        <p>Le <b>marché primaire</b> est le « marché du neuf » : émission de nouveaux titres (actions lors d’une introduction en bourse ou d’une augmentation de capital, obligations lors d’un emprunt).</p>
        <p>Le <b>marché secondaire</b> est le « marché de l’occasion » : échange de titres déjà émis. Il ne finance pas directement l’entreprise mais conditionne l’attractivité du marché primaire.</p>
        <h2>III. Formation des prix</h2>
        <p>Le prix d’un actif dépend de l’actualisation des flux futurs attendus : <i>P = Σ Fₜ / (1 + r)ᵗ</i>. Hypothèse d’efficience (Fama, 1970) : les prix reflètent toute l’information disponible.</p>
        <p>Limites : bulles spéculatives, comportements mimétiques (Keynes, concours de beauté), asymétries d’information.</p>
        <p class="fake-todo">→ Relire le TD 3 pour jeudi. Exercice 2 : calcul du rendement d’une obligation.</p>
      </article>
    </section>`;
  return wrap;
}
