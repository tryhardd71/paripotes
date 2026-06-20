import crypto from 'crypto';
import { promisify } from 'util';
import db from './db.js';
import { sendOtpEmail } from './email.js';

const scrypt = promisify(crypto.scrypt);
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_SHORT_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_LONG_MS = 90 * 24 * 60 * 60 * 1000;

export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = (await scrypt(password, salt, 64)).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

export async function sendOtp(email, code) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Envoi email trop long — réessaie')), 15000)
  );
  return Promise.race([sendOtpEmail(email, code), timeout]);
}

export async function storeOtp(email, code) {
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await db.prepare(`
    INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
  `).run(email.toLowerCase().trim(), code, expires);
}

export async function verifyOtp(email, code) {
  const normalized = email.toLowerCase().trim();
  const row = await db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(normalized);
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare('DELETE FROM otp_codes WHERE email = ?').run(normalized);
    return false;
  }
  if (row.code !== code.trim()) return false;
  await db.prepare('DELETE FROM otp_codes WHERE email = ?').run(normalized);
  return true;
}

export async function createSession(userId, rememberMe = true) {
  const token = generateToken();
  const ttl = rememberMe ? SESSION_LONG_MS : SESSION_SHORT_MS;
  const expires = new Date(Date.now() + ttl).toISOString();
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

export async function getUserFromToken(token) {
  if (!token) return null;
  const row = await db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

export async function getUserByEmail(email) {
  return await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

export async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Non connecté' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

export function sanitizeUser(user) {
  return { id: user.id, email: user.email, username: user.username };
}