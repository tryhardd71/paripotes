import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const PARIPOTES_TARGET = process.env.PARIPOTES_URL || 'https://paripotes.onrender.com';
const IMPOSTEUR_TARGET = process.env.IMPOSTEUR_URL || 'https://imposteur-mots.onrender.com';

const PUBLIC_PARIPOTES = '/paripotes';
const PUBLIC_IMPOSTEUR = '/imposteur';

function rewriteHtml(body, prefix) {
  return body
    .toString('utf8')
    .replace(/(href|src)="\//g, `$1="${prefix}/`)
    .replace(/(href|src)='\//g, `$1='${prefix}/`);
}

function rewriteJs(body, prefix, game) {
  let js = body.toString('utf8');

  if (game === 'imposteur') {
    js = js.replace(
      'const socket = io();',
      `const socket = io({ path: '${prefix}/socket.io' });`
    );
  }

  if (game === 'paripotes') {
    js = js.replace(/(['"`])\/api\//g, `$1${prefix}/api/`);
  }

  return js;
}

function createGameProxy(prefix, target, game) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    ws: true,
    pathRewrite: (p) => p.replace(new RegExp(`^${prefix}`), '') || '/',
    selfHandleResponse: true,
    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req) => {
      const type = proxyRes.headers['content-type'] || '';
      const url = req.url || '';

      if (type.includes('text/html')) {
        return rewriteHtml(responseBuffer, prefix);
      }

      if (type.includes('javascript') || url.endsWith('.js')) {
        return rewriteJs(responseBuffer, prefix, game);
      }

      return responseBuffer;
    }),
  });
}

const app = express();

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/config.js', (_, res) => {
  res.type('application/javascript');
  res.send(
    `window.HUB_CONFIG = ${JSON.stringify({
      paripotesUrl: PUBLIC_PARIPOTES,
      imposteurUrl: PUBLIC_IMPOSTEUR,
    })};`
  );
});

app.use(PUBLIC_IMPOSTEUR, createGameProxy(PUBLIC_IMPOSTEUR, IMPOSTEUR_TARGET, 'imposteur'));
app.use(PUBLIC_PARIPOTES, createGameProxy(PUBLIC_PARIPOTES, PARIPOTES_TARGET, 'paripotes'));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Hub → http://localhost:${PORT}`);
  console.log(`  PariPotes  → ${PUBLIC_PARIPOTES} → ${PARIPOTES_TARGET}`);
  console.log(`  Imposteur  → ${PUBLIC_IMPOSTEUR} → ${IMPOSTEUR_TARGET}`);
});