import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, 'data.json');

let mode = 'none';
let pool = null;
let j = null;

const defaultJson = () => ({
  users: [],
  otp_codes: [],
  sessions: [],
  probas: [],
  seq: { users: 0 },
});

function loadJson() {
  try {
    if (fs.existsSync(JSON_PATH)) return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  } catch {}
  return defaultJson();
}

function saveJson() {
  fs.writeFileSync(JSON_PATH, JSON.stringify(j, null, 2));
}

export async function initData() {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    mode = 'postgres';
    console.log('🗄️  Proba Potes — PostgreSQL');
    return;
  }
  j = loadJson();
  mode = 'json';
  console.log('🗄️  Proba Potes — data.json (dev)');
}

export function getDataMode() {
  return mode;
}

// ─── Users & auth ───────────────────────────────────────────────────────────

export async function getUserByEmail(email) {
  const e = email.toLowerCase().trim();
  if (mode === 'postgres') {
    const r = await pool.query('SELECT * FROM users WHERE email = $1', [e]);
    return r.rows[0] || null;
  }
  return j.users.find((u) => u.email === e) || null;
}

export async function getUserById(id) {
  if (mode === 'postgres') {
    const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return j.users.find((u) => u.id === id) || null;
}

export async function createUser(email, username, passwordHash) {
  if (mode === 'postgres') {
    const r = await pool.query(
      'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [email.toLowerCase().trim(), username, passwordHash]
    );
    return r.rows[0];
  }
  const id = ++j.seq.users;
  const user = {
    id,
    email: email.toLowerCase().trim(),
    username,
    password_hash: passwordHash,
  };
  j.users.push(user);
  saveJson();
  return user;
}

export async function updateUserPassword(id, passwordHash) {
  if (mode === 'postgres') {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
    return;
  }
  const u = j.users.find((x) => x.id === id);
  if (u) u.password_hash = passwordHash;
  saveJson();
}

export async function updateUsername(id, username) {
  if (mode === 'postgres') {
    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, id]);
    return;
  }
  const u = j.users.find((x) => x.id === id);
  if (u) u.username = username;
  saveJson();
}

export async function storeOtp(email, code, expiresAt) {
  const e = email.toLowerCase().trim();
  if (mode === 'postgres') {
    await pool.query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT(email) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
      [e, code, expiresAt]
    );
    return;
  }
  j.otp_codes = j.otp_codes.filter((o) => o.email !== e);
  j.otp_codes.push({ email: e, code, expires_at: expiresAt });
  saveJson();
}

export async function verifyOtp(email, code) {
  const e = email.toLowerCase().trim();
  if (mode === 'postgres') {
    const r = await pool.query('SELECT * FROM otp_codes WHERE email = $1', [e]);
    const row = r.rows[0];
    if (!row || new Date(row.expires_at) < new Date() || row.code !== code.trim()) {
      if (row) await pool.query('DELETE FROM otp_codes WHERE email = $1', [e]);
      return false;
    }
    await pool.query('DELETE FROM otp_codes WHERE email = $1', [e]);
    return true;
  }
  const row = j.otp_codes.find((o) => o.email === e);
  if (!row || new Date(row.expires_at) < new Date() || row.code !== code.trim()) {
    j.otp_codes = j.otp_codes.filter((o) => o.email !== e);
    saveJson();
    return false;
  }
  j.otp_codes = j.otp_codes.filter((o) => o.email !== e);
  saveJson();
  return true;
}

export async function createSession(token, userId, expiresAt) {
  if (mode === 'postgres') {
    await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
      token,
      userId,
      expiresAt,
    ]);
    return;
  }
  j.sessions.push({ token, user_id: userId, expires_at: expiresAt });
  saveJson();
}

export async function getUserFromToken(token) {
  if (!token) return null;
  if (mode === 'postgres') {
    const r = await pool.query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    return r.rows[0] || null;
  }
  const s = j.sessions.find((x) => x.token === token && new Date(x.expires_at) > new Date());
  if (!s) return null;
  return j.users.find((u) => u.id === s.user_id) || null;
}

export async function deleteSession(token) {
  if (mode === 'postgres') {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return;
  }
  j.sessions = j.sessions.filter((s) => s.token !== token);
  saveJson();
}

// ─── Forum probas ─────────────────────────────────────────────────────────────

function rowToProba(row) {
  return {
    id: row.id,
    creatorId: row.creator_id,
    accepterId: row.accepter_id,
    creatorName: row.creator_name,
    accepterName: row.accepter_name,
    description: row.description,
    initialCote: row.initial_cote,
    reverse: row.reverse,
    round: row.round,
    roundHolderId: row.round_holder_id,
    currentCote: row.current_cote,
    state: row.state,
    picks: typeof row.picks === 'string' ? JSON.parse(row.picks) : row.picks || {},
    result: typeof row.result === 'string' ? JSON.parse(row.result) : row.result,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    resolvedAt: row.resolved_at,
  };
}

export async function listProbas() {
  if (mode === 'postgres') {
    const r = await pool.query(`
      SELECT p.*, c.username AS creator_name, a.username AS accepter_name
      FROM proba_posts p
      JOIN users c ON c.id = p.creator_id
      LEFT JOIN users a ON a.id = p.accepter_id
      ORDER BY p.created_at DESC
    `);
    return r.rows.map(rowToProba);
  }
  return j.probas
    .map((p) => {
      const creator = j.users.find((u) => u.id === p.creator_id);
      const accepter = j.users.find((u) => u.id === p.accepter_id);
      return rowToProba({
        ...p,
        creator_name: creator?.username,
        accepter_name: accepter?.username,
      });
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getProba(id) {
  const all = await listProbas();
  return all.find((p) => p.id === id) || null;
}

export async function insertProba(proba) {
  if (mode === 'postgres') {
    await pool.query(
      `INSERT INTO proba_posts (
        id, creator_id, description, initial_cote, reverse, round, round_holder_id,
        current_cote, state, picks, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [
        proba.id,
        proba.creatorId,
        proba.description,
        proba.initialCote,
        proba.reverse,
        proba.round,
        proba.roundHolderId,
        proba.currentCote,
        proba.state,
        JSON.stringify(proba.picks || {}),
      ]
    );
    return;
  }
  j.probas.unshift({
    id: proba.id,
    creator_id: proba.creatorId,
    accepter_id: null,
    description: proba.description,
    initial_cote: proba.initialCote,
    reverse: proba.reverse,
    round: proba.round,
    round_holder_id: proba.roundHolderId,
    current_cote: proba.currentCote,
    state: proba.state,
    picks: proba.picks || {},
    result: null,
    created_at: new Date().toISOString(),
    accepted_at: null,
    resolved_at: null,
  });
  saveJson();
}

export async function updateProba(id, fields) {
  if (mode === 'postgres') {
    const sets = [];
    const vals = [];
    let i = 0;
    const map = {
      accepterId: 'accepter_id',
      state: 'state',
      round: 'round',
      roundHolderId: 'round_holder_id',
      currentCote: 'current_cote',
      picks: 'picks',
      result: 'result',
      acceptedAt: 'accepted_at',
      resolvedAt: 'resolved_at',
    };
    for (const [k, col] of Object.entries(map)) {
      if (fields[k] !== undefined) {
        sets.push(`${col} = $${++i}`);
        vals.push(
          k === 'picks' || k === 'result' ? JSON.stringify(fields[k]) : fields[k]
        );
      }
    }
    if (!sets.length) return;
    vals.push(id);
    await pool.query(`UPDATE proba_posts SET ${sets.join(', ')} WHERE id = $${++i}`, vals);
    return;
  }
  const p = j.probas.find((x) => x.id === id);
  if (!p) return;
  if (fields.accepterId !== undefined) p.accepter_id = fields.accepterId;
  if (fields.state !== undefined) p.state = fields.state;
  if (fields.round !== undefined) p.round = fields.round;
  if (fields.roundHolderId !== undefined) p.round_holder_id = fields.roundHolderId;
  if (fields.currentCote !== undefined) p.current_cote = fields.currentCote;
  if (fields.picks !== undefined) p.picks = fields.picks;
  if (fields.result !== undefined) p.result = fields.result;
  if (fields.acceptedAt !== undefined) p.accepted_at = fields.acceptedAt;
  if (fields.resolvedAt !== undefined) p.resolved_at = fields.resolvedAt;
  saveJson();
}