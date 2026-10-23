import './styles.css';
import './mobile.css';
import './polish.css';
import { initPanic } from './core/panic';
import { initPrank } from './core/prank';
import { initSuspension } from './core/suspension';
import { applyTheme } from './core/settings';
import { onStale, startUpdateChecks } from './core/update';
import { initTouch } from './core/touch';
import { consumeAuthRedirect, ensureAccount, onAccount } from './net/auth';
import { startNotifications } from './net/friends';
import { startPoints } from './net/points';
import { startIdleIncome } from './net/idle';
import { syncServerClock } from './net/serverClock';
import { multiConfigured } from './net/supabase';
import { lazy, prefetchViews, route, startRouter } from './router';
import { homeView } from './ui/home';
import { playView } from './ui/play';
import { initPointsUi, initSocialUi, toast } from './ui/toast';

applyTheme();
initTouch();
initPanic();
initPrank();
initSuspension();
initPointsUi();
initSocialUi();
startUpdateChecks();
onStale(() => toast('Nouvelle version du site : elle se charge à ton prochain changement de page.', 'info', { label: 'Recharger', run: () => location.reload() }));

// L'accueil et les parties solo sont dans le fichier principal ; les autres pages sont
// téléchargées à leur première visite (le site s'ouvre plus vite).
route(/^\/$/, homeView);
route(/^\/game\/([\w-]+)$/, playView);
route(/^\/settings$/, lazy(() => import('./ui/settings').then((m) => m.settingsView)));
route(/^\/join$/, lazy(() => import('./ui/lobby').then((m) => m.joinView)));
route(/^\/room\/(\w+)$/, lazy(() => import('./ui/lobby').then((m) => m.lobbyView)));
route(/^\/scores$/, lazy(() => import('./ui/scores').then((m) => m.scoresView)));
route(/^\/account(?:\?(\w+))?$/, lazy(() => import('./ui/account').then((m) => m.accountView)));
route(/^\/points$/, lazy(() => import('./ui/points').then((m) => m.pointsView)));
route(/^\/roulette$/, lazy(() => import('./ui/roulette').then((m) => m.rouletteView)));
route(/^\/slots$/, lazy(() => import('./ui/slots').then((m) => m.slotsView)));
route(/^\/shop$/, lazy(() => import('./ui/shop').then((m) => m.shopView)));
route(/^\/admin$/, lazy(() => import('./ui/admin').then((m) => m.adminView)));
route(/^\/appart(?:\/([0-9a-f-]{36}))?$/, lazy(() => import('./ui/apartment').then((m) => m.apartmentView)));
route(/^\/caisses$/, lazy(() => import('./ui/crates').then((m) => m.cratesView)));
route(/^\/amis(?:\/(ajouter|demandes))?$/, lazy(() => import('./ui/friends').then((m) => m.friendsView)));
route(/^\/td\/caisses$/, lazy(() => import('./games/towerdefense/crates').then((m) => m.tdCratesView)));

/**
 * Vagues de tower defense en attente (page fermée trop tôt, réseau coupé…) : envoyées dès l'ouverture
 * du site, sur n'importe quelle page, sans attendre qu'on rouvre le jeu.
 */
function flushTdUploads(): void {
  let pending = false;
  try {
    pending = (JSON.parse(localStorage.getItem('td:uploads:td') ?? '[]') as unknown[]).length > 0;
  } catch {
    // stockage indisponible
  }
  if (pending) void import('./games/towerdefense/uploads').then((m) => m.startUploads());
}

// Retour d'un lien reçu par email : Supabase lit les jetons avant que le routeur ne touche au hash.
// Appli installable (PWA) : le service worker garde le site pour l'ouvrir même sans réseau.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}

consumeAuthRedirect().finally(() => {
  startRouter();
  // Une fois l'accueil affiché et le navigateur au repos, on prépare les autres pages.
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 3000));
  idle(() => prefetchViews(), { timeout: 8000 });
  if (multiConfigured) {
    void ensureAccount();
    onAccount((a) => {
      if (!a) return;
      void startPoints(a.id);
      void syncServerClock(); // heure du serveur : changer l'heure de l'appareil ne change rien
      startIdleIncome(a.id); // revenus de l'appart, sur toutes les pages
      void startNotifications(a.id);
      flushTdUploads(); // parties de tower defense pas encore arrivées au serveur
    });
  }
});
