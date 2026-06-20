import crypto from 'crypto';
import db from './db.js';
import { sendOtpEmail } from './email.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function sendOtp(email, code) {
  return sendOtpEmail(email, code);
}

export function storeOtp(email, code) {
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
  `).run(email.toLowerCase().trim(), code, expires);
}

export function verifyOtp(email, code) {
  const row = db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(email.toLowerCase().trim());
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email.toLowerCase().trim());
    return false;
  }
  if (row.code !== code.trim()) return false;
  db.prepare('DELETE FROM otp_codes WHERE email = ?').run(email.toLowerCase().trim());
  return true;
}

export function createSession(userId) {
  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

export function getUserFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  return row || null;
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const user = getUserFromToken(token);
  if (!user) return res.status(401).json({ error: 'Non connecté' });
  req.user = user;
  req.token = token;
  next();
}