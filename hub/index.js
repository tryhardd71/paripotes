import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const PARIPOTES_API = process.env.PARIPOTES_URL || 'https://paripotes.onrender.com';
const IMPOSTEUR_API = process.env.IMPOSTEUR_URL || 'https://imposteur-mots.onrender.com';

const PUBLIC_PARIPOTES = '/paripotes';
const PUBLIC_IMPOSTEUR = '/imposteur';

const app = express();

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/config.js', (_, res) => {
  res.type('application/javascript');
  res.send(
    `window.HUB_CONFIG = ${JSON.stringify({
      paripotesUrl: PUBLIC_PARIPOTES,
      imposteurUrl: PUBLIC_IMPOSTEUR,
      paripotesApi: PARIPOTES_API,
      imposteurApi: IMPOSTEUR_API,
    })};`
  );
});

app.use(PUBLIC_IMPOSTEUR, express.static(path.join(__dirname, 'games/imposteur')));
app.use(PUBLIC_PARIPOTES, express.static(path.join(__dirname, 'games/paripotes')));

app.get(PUBLIC_IMPOSTEUR, (_, res) => res.redirect(`${PUBLIC_IMPOSTEUR}/`));
app.get(PUBLIC_PARIPOTES, (_, res) => res.redirect(`${PUBLIC_PARIPOTES}/`));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Hub → http://localhost:${PORT}`);
  console.log(`  PariPotes  → ${PUBLIC_PARIPOTES} (API: ${PARIPOTES_API})`);
  console.log(`  Imposteur  → ${PUBLIC_IMPOSTEUR} (API: ${IMPOSTEUR_API})`);
});