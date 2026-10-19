import './styles.css';
import { initPanic } from './core/panic';
import { applyTheme } from './core/settings';
import { route, startRouter } from './router';
import { homeView } from './ui/home';
import { settingsView } from './ui/settings';

applyTheme();
initPanic();

route(/^\/$/, homeView);
route(/^\/settings$/, settingsView);

startRouter();
