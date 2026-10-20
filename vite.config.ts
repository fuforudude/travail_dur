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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.'); // inclut aussi les variables VITE_* de l'environnement (CI)
  return {
    base: '/travail_dur/',
    plugins: [csp(env.VITE_SUPABASE_URL)],
  };
});
