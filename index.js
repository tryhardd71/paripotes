import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { customAlphabet } from 'nanoid';
import db from './db.js';
import {
  authMiddleware,
  createSession,
  generateCode,
  sendOtp,
  storeOtp,
  verifyOtp,
  hashPassword,
  verifyPassword,
  getUserByEmail,
  sanitizeUser,
} from './auth.js';
import { syncAll } from './sync.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3847;
const leagueCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth ───────────────────────────────────────────────────────────────────

app.get('/api/auth/check', (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  const user = getUserByEmail(email);
  res.json({
    exists: !!user,
    hasPassword: !!user?.password_hash,
  });
});

function isEmailConfigured() {
  return !!(
    process.env.BREVO_API_KEY ||
    process.env.RESEND_API_KEY ||
    (process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

app.post('/api/auth/send-code', async (req, res) => {
  const { email, reset } = req.body;
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email invalide' });

  const user = getUserByEmail(email);
  if (user?.password_hash && !reset) {
    return res.status(400).json({ error: 'Ce compte existe déjà. Connecte-toi avec ton mot de passe.' });
  }

  if (!isEmailConfigured()) {
    return res.status(503).json({
      error: 'Envoi email non configuré sur le serveur. Contacte l\'admin ou réessaie plus tard.',
    });
  }

  const code = generateCode();
  storeOtp(email, code);
  const message = `Code envoyé à ${email} ! Vérifie ta boîte mail (et les spams).`;

  // Répondre tout de suite — Gmail SMTP depuis Render peut prendre 10s+ ou timeout
  if (!req.body.sync) {
    res.json({ ok: true, message });
    sendOtp(email, code).catch((err) => {
      console.error('Email async error:', email, err.message);
    });
    return;
  }

  try {
    await sendOtp(email, code);
    res.json({ ok: true, message });
  } catch (err) {
    console.error('Email error:', err);
    const msg = err.message?.includes('timeout') || err.message?.includes('Timeout')
      ? 'Impossible d\'envoyer l\'email depuis le serveur. Ajoute RESEND_API_KEY sur Render (gratuit) ou réessaie.'
      : (err.message || 'Impossible d\'envoyer le code.');
    res.status(500).json({ error: msg });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, rememberMe = true } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = getUserByEmail(email);
  if (!user?.password_hash) {
    return res.status(401).json({ error: 'Compte introuvable. Inscris-toi d\'abord.' });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });

  const token = createSession(user.id, rememberMe !== false);
  res.json({ token, user: sanitizeUser(user), rememberMe: rememberMe !== false });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, code, username, password, rememberMe = true } = req.body;
  if (!email || !code || !password) {
    return res.status(400).json({ error: 'Email, code et mot de passe requis' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  if (!verifyOtp(email, code)) return res.status(401).json({ error: 'Code invalide ou expiré' });

  const normalizedEmail = email.toLowerCase().trim();
  let user = getUserByEmail(normalizedEmail);
  const passHash = await hashPassword(password);

  if (!user) {
    const name = username?.trim() || normalizedEmail.split('@')[0];
    const result = db.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
      .run(normalizedEmail, name, passHash);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  } else {
    if (username?.trim()) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username.trim(), user.id);
      user.username = username.trim();
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passHash, user.id);
    user.password_hash = passHash;
  }

  const token = createSession(user.id, rememberMe !== false);
  res.json({ token, user: sanitizeUser(user), rememberMe: rememberMe !== false });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, username: req.user.username } });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

// ─── Leagues ────────────────────────────────────────────────────────────────

app.post('/api/leagues', authMiddleware, (req, res) => {
  const { name, startingPoints = 1000 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Nom de ligue requis' });

  const code = leagueCode();
  const result = db.prepare(`
    INSERT INTO leagues (name, code, creator_id, starting_points) VALUES (?, ?, ?, ?)
  `).run(name.trim(), code, req.user.id, startingPoints);

  const leagueId = result.lastInsertRowid;
  db.prepare('INSERT INTO league_members (league_id, user_id, points) VALUES (?, ?, ?)')
    .run(leagueId, req.user.id, startingPoints);

  res.json({
    league: {
      id: leagueId,
      name: name.trim(),
      code,
      startingPoints,
      isCreator: true,
    },
  });
});

app.post('/api/leagues/join', authMiddleware, (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: 'Code requis' });

  const league = db.prepare('SELECT * FROM leagues WHERE code = ?').get(code.trim().toUpperCase());
  if (!league) return res.status(404).json({ error: 'Ligue introuvable' });

  const existing = db.prepare('SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?')
    .get(league.id, req.user.id);
  if (existing) return res.json({ league: formatLeague(league, req.user.id), alreadyMember: true });

  db.prepare('INSERT INTO league_members (league_id, user_id, points) VALUES (?, ?, ?)')
    .run(league.id, req.user.id, league.starting_points);

  res.json({ league: formatLeague(league, req.user.id) });
});

app.get('/api/leagues', authMiddleware, (req, res) => {
  const leagues = db.prepare(`
    SELECT l.*, lm.points, (l.creator_id = ?) as is_creator,
      (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as member_count
    FROM league_members lm
    JOIN leagues l ON l.id = lm.league_id
    WHERE lm.user_id = ?
    ORDER BY lm.joined_at DESC
  `).all(req.user.id, req.user.id);

  res.json({
    leagues: leagues.map((l) => ({
      id: l.id,
      name: l.name,
      code: l.code,
      points: l.points,
      startingPoints: l.starting_points,
      memberCount: l.member_count,
      isCreator: !!l.is_creator,
    })),
  });
});

app.get('/api/leagues/:id', authMiddleware, (req, res) => {
  const leagueId = parseInt(req.params.id, 10);
  const member = db.prepare('SELECT * FROM league_members WHERE league_id = ? AND user_id = ?')
    .get(leagueId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Tu n\'es pas dans cette ligue' });

  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  const leaderboard = db.prepare(`
    SELECT u.id, u.username, lm.points,
      (SELECT COUNT(*) FROM bets b WHERE b.league_id = ? AND b.user_id = u.id AND b.status = 'won') as wins,
      (SELECT COUNT(*) FROM bets b WHERE b.league_id = ? AND b.user_id = u.id) as total_bets
    FROM league_members lm
    JOIN users u ON u.id = lm.user_id
    WHERE lm.league_id = ?
    ORDER BY lm.points DESC
  `).all(leagueId, leagueId, leagueId);

  res.json({
    league: formatLeague(league, req.user.id),
    myPoints: member.points,
    leaderboard,
  });
});

function formatLeague(league, userId) {
  const memberCount = db.prepare('SELECT COUNT(*) as c FROM league_members WHERE league_id = ?').get(league.id).c;
  return {
    id: league.id,
    name: league.name,
    code: league.code,
    startingPoints: league.starting_points,
    memberCount,
    isCreator: league.creator_id === userId,
  };
}

// ─── Matches & Odds ───────────────────────────────────────────────────────────

app.get('/api/matches', authMiddleware, (req, res) => {
  const { status, upcoming } = req.query;

  let query = 'SELECT * FROM matches WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (upcoming === 'true') {
    query += ' AND status IN (\'scheduled\', \'live\') AND commence_time >= datetime(\'now\', \'-6 hours\')';
  }

  query += ' ORDER BY commence_time ASC';
  const matches = db.prepare(query).all(...params);

  const getOdds = db.prepare('SELECT * FROM match_odds WHERE match_id = ? ORDER BY bookmaker');
  const getMyBets = db.prepare(`
    SELECT * FROM bets WHERE match_id = ? AND user_id = ? AND league_id = ?
  `);

  const leagueId = req.query.leagueId ? parseInt(req.query.leagueId, 10) : null;

  res.json({
    matches: matches.map((m) => ({
      ...m,
      odds: getOdds.all(m.id),
      myBets: leagueId ? getMyBets.all(m.id, req.user.id, leagueId) : [],
    })),
  });
});

// ─── Bets ───────────────────────────────────────────────────────────────────

app.post('/api/bets', authMiddleware, (req, res) => {
  const { leagueId, matchId, outcome, stake, bookmaker } = req.body;

  if (!leagueId || !matchId || !outcome || !stake || !bookmaker) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }
  if (!['home', 'draw', 'away'].includes(outcome)) {
    return res.status(400).json({ error: 'Résultat invalide' });
  }
  if (stake <= 0 || stake > 500) {
    return res.status(400).json({ error: 'Mise entre 1 et 500 points' });
  }

  const member = db.prepare('SELECT * FROM league_members WHERE league_id = ? AND user_id = ?')
    .get(leagueId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Pas dans cette ligue' });
  if (member.points < stake) return res.status(400).json({ error: 'Points insuffisants' });

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match introuvable' });
  if (match.status !== 'scheduled') {
    return res.status(400).json({ error: 'Les paris sont fermés pour ce match' });
  }
  if (new Date(match.commence_time) < new Date()) {
    return res.status(400).json({ error: 'Le match a déjà commencé' });
  }

  const oddsRow = db.prepare('SELECT * FROM match_odds WHERE match_id = ? AND bookmaker = ?')
    .get(matchId, bookmaker);
  if (!oddsRow) return res.status(400).json({ error: 'Bookmaker introuvable' });

  const oddsValue = outcome === 'home' ? oddsRow.home_odds
    : outcome === 'away' ? oddsRow.away_odds
    : oddsRow.draw_odds;

  if (!oddsValue) return res.status(400).json({ error: 'Pas de cote pour ce résultat' });

  const existing = db.prepare(`
    SELECT * FROM bets WHERE user_id = ? AND league_id = ? AND match_id = ? AND status = 'pending'
  `).get(req.user.id, leagueId, matchId);
  if (existing) return res.status(400).json({ error: 'Tu as déjà un pari sur ce match' });

  const placeBet = db.transaction(() => {
    db.prepare('UPDATE league_members SET points = points - ? WHERE league_id = ? AND user_id = ?')
      .run(stake, leagueId, req.user.id);

    const result = db.prepare(`
      INSERT INTO bets (user_id, league_id, match_id, outcome, stake, odds, bookmaker)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, leagueId, matchId, outcome, stake, oddsValue, bookmaker);

    return result.lastInsertRowid;
  });

  const betId = placeBet();
  const newPoints = db.prepare('SELECT points FROM league_members WHERE league_id = ? AND user_id = ?')
    .get(leagueId, req.user.id).points;

  res.json({
    bet: { id: betId, outcome, stake, odds: oddsValue, bookmaker, potentialWin: Math.round(stake * oddsValue * 100) / 100 },
    points: newPoints,
  });
});

app.get('/api/bets', authMiddleware, (req, res) => {
  const leagueId = parseInt(req.query.leagueId, 10);
  if (!leagueId) return res.status(400).json({ error: 'leagueId requis' });

  const bets = db.prepare(`
    SELECT b.*, m.home_team, m.away_team, m.commence_time, m.home_score, m.away_score, m.status as match_status
    FROM bets b
    JOIN matches m ON m.id = b.match_id
    WHERE b.league_id = ? AND b.user_id = ?
    ORDER BY b.created_at DESC
  `).all(leagueId, req.user.id);

  res.json({ bets });
});

// ─── Sync ───────────────────────────────────────────────────────────────────

app.post('/api/sync', authMiddleware, async (_req, res) => {
  try {
    const result = await syncAll();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (_req, res) => {
  const matchCount = db.prepare('SELECT COUNT(*) as c FROM matches').get().c;
  const oddsCount = db.prepare('SELECT COUNT(*) as c FROM match_odds').get().c;
  const bookmakers = db.prepare('SELECT DISTINCT bookmaker FROM match_odds ORDER BY bookmaker').all().map((r) => r.bookmaker);

  res.json({
    matches: matchCount,
    odds: oddsCount,
    bookmakers,
    oddsApiConfigured: !!process.env.ODDS_API_KEY,
    emailConfigured: isEmailConfigured(),
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────

async function bootstrap() {
  try {
    console.log('🔄 Synchronisation initiale des matchs et cotes...');
    const result = await syncAll();
    console.log('✅ Sync OK:', JSON.stringify(result));
  } catch (err) {
    console.warn('⚠️ Sync initiale échouée:', err.message);
  }

  setInterval(async () => {
    try {
      await syncAll();
    } catch (err) {
      console.warn('Sync périodique échouée:', err.message);
    }
  }, 5 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏆 PariPotes — port ${PORT}\n`);
    if (!process.env.ODDS_API_KEY) {
      console.log('💡 Astuce: définis ODDS_API_KEY pour les cotes multi-bookmakers (the-odds-api.com)');
    }
    console.log('📧 Envoi de codes par email : automatique\n');
  });
}

bootstrap();