import './styles.css';
import { initPanic } from './core/panic';
import { initPrank } from './core/prank';
import { applyTheme } from './core/settings';
import { consumeAuthRedirect, ensureAccount, onAccount } from './net/auth';
import { startPoints } from './net/points';
import { multiConfigured } from './net/supabase';
import { lazy, prefetchViews, route, startRouter } from './router';
import { homeView } from './ui/home';
import { playView } from './ui/play';
import { initPointsUi } from './ui/toast';

applyTheme();
initPanic();
initPrank();
initPointsUi();

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

// Retour d'un lien reçu par email : Supabase lit les jetons avant que le routeur ne touche au hash.
consumeAuthRedirect().finally(() => {
  startRouter();
  // Une fois l'accueil affiché et le navigateur au repos, on prépare les autres pages.
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 3000));
  idle(() => prefetchViews(), { timeout: 8000 });
  if (multiConfigured) {
    void ensureAccount();
    onAccount((a) => a && void startPoints(a.id));
  }
});
