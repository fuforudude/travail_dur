import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Content-Security-Policy en balise meta (GitHub Pages ne permet pas d'en-têtes HTTP).
 * Seulement au build : en dev, le client Vite a besoin de son websocket et de styles injectés.
 */
function csp(supabaseUrl: string | undefined): Plugin {
  const origin = supabaseUrl ? new URL(supabaseUrl).host : '';
  const connect = ["'self'", origin && `https://${origin}`, origin && `wss://${origin}`].filter(Boolean).join(' ');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data:${origin ? ` https://${origin}` : ''}`, // photos des cadres (stockage Supabase)
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

/**
 * Numéro de version : le commit sur GitHub (sinon l'heure du build), embarqué dans le site
 * (__BUILD__) et publié dans version.json. Le site compare les deux pour savoir qu'une nouvelle
 * version est en ligne (src/core/update.ts).
 */
function version(build: string): Plugin {
  return {
    name: 'version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, '.'); // inclut aussi les variables VITE_* de l'environnement (CI)
  const build = (loadEnv(mode, '.', '').GITHUB_SHA ?? '').slice(0, 12) || `local-${Date.now()}`;
  return {
    base: '/travail_dur/',
    plugins: [csp(env.VITE_SUPABASE_URL), version(build)],
    define: { __BUILD__: JSON.stringify(command === 'build' ? build : 'dev') },
    // Le worker de l'ordinateur charge le code de chaque jeu à la demande : format module requis.
    worker: { format: 'es' as const },
  };
});
