import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const PARIPOTES_URL = process.env.PARIPOTES_URL || 'https://paripotes.onrender.com';
const IMPOSTEUR_URL = process.env.IMPOSTEUR_URL || 'https://imposteur-mots.onrender.com';

const app = express();

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/config.js', (_, res) => {
  res.type('application/javascript');
  res.send(`window.HUB_CONFIG = ${JSON.stringify({ paripotesUrl: PARIPOTES_URL, imposteurUrl: IMPOSTEUR_URL })};`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Hub → http://localhost:${PORT}`);
  console.log(`  PariPotes  → ${PARIPOTES_URL}`);
  console.log(`  Imposteur  → ${IMPOSTEUR_URL}`);
});