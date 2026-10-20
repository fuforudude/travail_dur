import './styles.css';
import { initPanic } from './core/panic';
import { initPrank } from './core/prank';
import { applyTheme } from './core/settings';
import { consumeAuthRedirect, ensureAccount, onAccount } from './net/auth';
import { startPoints } from './net/points';
import { multiConfigured } from './net/supabase';
import { route, startRouter } from './router';
import { accountView } from './ui/account';
import { homeView } from './ui/home';
import { joinView, lobbyView } from './ui/lobby';
import { playView } from './ui/play';
import { scoresView } from './ui/scores';
import { pointsView } from './ui/points';
import { rouletteView } from './ui/roulette';
import { settingsView } from './ui/settings';
import { slotsView } from './ui/slots';
import { initPointsUi } from './ui/toast';

applyTheme();
initPanic();
initPrank();
initPointsUi();

route(/^\/$/, homeView);
route(/^\/settings$/, settingsView);
route(/^\/game\/([\w-]+)$/, playView);
route(/^\/join$/, joinView);
route(/^\/scores$/, scoresView);
route(/^\/account(?:\?(\w+))?$/, accountView);
route(/^\/room\/(\w+)$/, lobbyView);
route(/^\/points$/, pointsView);
route(/^\/roulette$/, rouletteView);
route(/^\/slots$/, slotsView);

// Retour d'un lien reçu par email : Supabase lit les jetons avant que le routeur ne touche au hash.
consumeAuthRedirect().finally(() => {
  startRouter();
  if (multiConfigured) {
    void ensureAccount();
    onAccount((a) => a && void startPoints(a.id));
  }
});
