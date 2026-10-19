import './styles.css';
import { initPanic } from './core/panic';
import { initPrank } from './core/prank';
import { applyTheme } from './core/settings';
import { consumeAuthRedirect, ensureAccount } from './net/auth';
import { multiConfigured } from './net/supabase';
import { route, startRouter } from './router';
import { accountView } from './ui/account';
import { homeView } from './ui/home';
import { joinView, lobbyView } from './ui/lobby';
import { playView } from './ui/play';
import { scoresView } from './ui/scores';
import { settingsView } from './ui/settings';

applyTheme();
initPanic();
initPrank();

route(/^\/$/, homeView);
route(/^\/settings$/, settingsView);
route(/^\/game\/([\w-]+)$/, playView);
route(/^\/join$/, joinView);
route(/^\/scores$/, scoresView);
route(/^\/account(?:\?(\w+))?$/, accountView);
route(/^\/room\/(\w+)$/, lobbyView);

// Retour d'un lien reçu par email : Supabase lit les jetons avant que le routeur ne touche au hash.
consumeAuthRedirect().finally(() => {
  startRouter();
  if (multiConfigured) void ensureAccount();
});
