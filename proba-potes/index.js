import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initData } from './data.js';
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
  getUserFromToken,
  sanitizeUser,
} from './auth.js';
import * as data from './data.js';
import { createProba, acceptProba, submitPick, getForumForUser } from './forum.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3003;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

function isEmailConfigured() {
  return !!(
    (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) ||
    (process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

app.get('/api/auth/check', async (req, res) => {
  const email = req.query.email?.toLowerCase().trim();
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  const user = await getUserByEmail(email);
  res.json({ exists: !!user, hasPassword: !!user?.password_hash });
});

app.post('/api/auth/send-code', async (req, res) => {
  const { email, reset } = req.body;
  if (!email?.includes('@')) return res.status(400).json({ error: 'Email invalide' });

  const user = await getUserByEmail(email);
  if (user?.password_hash && !reset) {
    return res.status(400).json({ error: 'Ce compte existe déjà. Connecte-toi avec ton mot de passe.' });
  }
  if (!isEmailConfigured()) {
    return res.status(503).json({ error: 'Envoi email non configuré sur le serveur.' });
  }

  const code = generateCode();
  await storeOtp(email, code);
  res.json({ ok: true, message: `Code envoyé à ${email}` });
  sendOtp(email, code).catch((err) => console.error('Email error:', err.message));
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, rememberMe = true } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  const user = await getUserByEmail(email);
  if (!user?.password_hash) return res.status(401).json({ error: 'Compte introuvable. Inscris-toi d\'abord.' });

  if (!(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  const token = await createSession(user.id, rememberMe !== false);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, code, username, password, rememberMe = true } = req.body;
  if (!email || !code || !password) {
    return res.status(400).json({ error: 'Email, code et mot de passe requis' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
  if (!(await verifyOtp(email, code))) return res.status(401).json({ error: 'Code invalide ou expiré' });

  const normalizedEmail = email.toLowerCase().trim();
  let user = await getUserByEmail(normalizedEmail);
  const passHash = await hashPassword(password);

  if (!user) {
    user = await data.createUser(
      normalizedEmail,
      username?.trim() || normalizedEmail.split('@')[0],
      passHash
    );
  } else {
    if (username?.trim()) await data.updateUsername(user.id, username.trim());
    await data.updateUserPassword(user.id, passHash);
    user = await getUserByEmail(normalizedEmail);
  }

  const token = await createSession(user.id, rememberMe !== false);
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  await data.deleteSession(req.token);
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

async function broadcastForum() {
  const sockets = await io.fetchSockets();
  for (const socket of sockets) {
    if (socket.user) {
      const forum = await getForumForUser(socket.user.id);
      socket.emit('forum_update', { user: sanitizeUser(socket.user), ...forum });
    }
  }
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = await getUserFromToken(token);
    if (!user) return next(new Error('Non connecté'));
    socket.user = user;
    socket.token = token;
    next();
  } catch (err) {
    next(err);
  }
});

io.on('connection', async (socket) => {
  socket.join('forum');
  const forum = await getForumForUser(socket.user.id);
  socket.emit('forum_update', { user: sanitizeUser(socket.user), ...forum });

  socket.on('create_proba', async ({ description, cote, reverse }, cb) => {
    const result = await createProba(socket.user.id, { description, cote, reverse });
    if (result.error) return cb?.({ error: result.error });
    cb?.({ success: true });
    broadcastForum();
  });

  socket.on('accept_proba', async ({ probaId }, cb) => {
    const result = await acceptProba(probaId, socket.user.id);
    if (result.error) return cb?.({ error: result.error });
    cb?.({ success: true });
    broadcastForum();
  });

  socket.on('submit_pick', async ({ probaId, number }, cb) => {
    const result = await submitPick(probaId, socket.user.id, number);
    if (result.error) return cb?.({ error: result.error });
    cb?.({ success: true, resolved: result.resolved });
    broadcastForum();
  });
});

await initData();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Proba Potes — port ${PORT}`);
});