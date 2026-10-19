import './styles.css';
import { applyTheme } from './core/settings';
import { route, startRouter } from './router';
import { homeView } from './ui/home';
import { settingsView } from './ui/settings';

applyTheme();

route(/^\/$/, homeView);
route(/^\/settings$/, settingsView);

startRouter();
