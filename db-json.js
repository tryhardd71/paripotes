import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'data.json');

const defaultData = {
  users: [],
  otp_codes: [],
  sessions: [],
  leagues: [],
  league_members: [],
  matches: [],
  match_odds: [],
  bets: [],
  _seq: { users: 0, leagues: 0, matches: 0, match_odds: 0, bets: 0 },
};

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch {}
  return structuredClone(defaultData);
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let data = load();

function nextId(table) {
  data._seq[table] = (data._seq[table] || 0) + 1;
  save(data);
  return data._seq[table];
}

export function reload() {
  data = load();
}

export const db = {
  prepare(sql) {
    return {
      run(...params) {
        return execRun(sql, params);
      },
      get(...params) {
        return execGet(sql, params);
      },
      all(...params) {
        return execAll(sql, params);
      },
    };
  },
  transaction(fn) {
    return (...args) => {
      const result = fn(...args);
      save(data);
      return result;
    };
  },
  exec() { save(data); },
};

function execRun(sql, params) {
  const result = execute(sql, params, 'run');
  if (sql.includes('INSERT INTO matches') && typeof params[0] === 'object') {
    return upsertMatchObj(params[0]);
  }
  if (sql.includes('INSERT INTO match_odds') && typeof params[0] === 'object') {
    return upsertOddsObj(params[0]);
  }
  save(data);
  return result;
}

function execGet(sql, params) {
  const rows = execute(sql, params, 'all');
  return rows[0] || undefined;
}

function execAll(sql, params) {
  return execute(sql, params, 'all');
}

function execute(sql, params, mode) {
  const s = sql.replace(/\s+/g, ' ').trim();

  if (s.startsWith('INSERT INTO users')) {
    const id = nextId('users');
    data.users.push({
      id, email: params[0], username: params[1],
      password_hash: params[2] || null,
      created_at: now(),
    });
    return { lastInsertRowid: id };
  }

  if (s.startsWith('UPDATE users SET password_hash')) {
    const u = data.users.find((r) => r.id === params[1]);
    if (u) u.password_hash = params[0];
    return {};
  }

  if (s.includes('INSERT INTO otp_codes') && s.includes('ON CONFLICT')) {
    const idx = data.otp_codes.findIndex((r) => r.email === params[0]);
    const row = { email: params[0], code: params[1], expires_at: params[2] };
    if (idx >= 0) data.otp_codes[idx] = row;
    else data.otp_codes.push(row);
    return {};
  }

  if (s.startsWith('DELETE FROM otp_codes WHERE email')) {
    data.otp_codes = data.otp_codes.filter((r) => r.email !== params[0]);
    return {};
  }

  if (s.startsWith('INSERT INTO sessions')) {
    data.sessions.push({ token: params[0], user_id: params[1], expires_at: params[2] });
    return {};
  }

  if (s.startsWith('DELETE FROM sessions WHERE token')) {
    data.sessions = data.sessions.filter((r) => r.token !== params[0]);
    return {};
  }

  if (s.startsWith('INSERT INTO leagues')) {
    const id = nextId('leagues');
    data.leagues.push({
      id, name: params[0], code: params[1], creator_id: params[2],
      starting_points: params[3], created_at: now(),
    });
    return { lastInsertRowid: id };
  }

  if (s.startsWith('INSERT INTO league_members')) {
    data.league_members.push({
      league_id: params[0], user_id: params[1], points: params[2], joined_at: now(),
    });
    return {};
  }

  if (s.startsWith('UPDATE users SET username')) {
    const u = data.users.find((r) => r.id === params[1]);
    if (u) u.username = params[0];
    return {};
  }

  if (s.startsWith('UPDATE league_members SET points = points -')) {
    const m = data.league_members.find((r) => r.league_id === params[1] && r.user_id === params[2]);
    if (m) m.points -= params[0];
    return {};
  }

  if (s.startsWith('UPDATE league_members SET points = points +')) {
    const m = data.league_members.find((r) => r.league_id === params[1] && r.user_id === params[2]);
    if (m) m.points += params[0];
    return {};
  }

  if (s.includes('INSERT INTO matches') && s.includes('ON CONFLICT')) {
    const match = typeof params[0] === 'object' ? params[0] : null;
    if (match) return [upsertMatchObj(match)];
    return [];
  }

  if (s.startsWith('UPDATE matches SET odds_api_id')) {
    const m = data.matches.find((r) => r.id === params[1]);
    if (m) m.odds_api_id = params[0];
    return {};
  }

  if (s.includes('INSERT INTO match_odds') && s.includes('ON CONFLICT')) {
    const o = typeof params[0] === 'object' ? params[0] : null;
    if (o) return [upsertOddsObj(o)];
    return [];
  }

  if (s.startsWith('INSERT INTO bets')) {
    const id = nextId('bets');
    data.bets.push({
      id, user_id: params[0], league_id: params[1], match_id: params[2],
      outcome: params[3], stake: params[4], odds: params[5], bookmaker: params[6],
      status: 'pending', payout: 0, created_at: now(),
    });
    return { lastInsertRowid: id };
  }

  if (s.startsWith('UPDATE bets SET status = ?') && s.includes('payout = ?')) {
    const b = data.bets.find((r) => r.id === params[2]);
    if (b) { b.status = params[0]; b.payout = params[1]; }
    return {};
  }

  if (s.startsWith('UPDATE bets SET status = ?') && s.includes('payout = 0')) {
    const b = data.bets.find((r) => r.id === params[1]);
    if (b) { b.status = params[0]; b.payout = 0; }
    return {};
  }

  // SELECT queries
  if (s.includes('SELECT u.* FROM sessions s')) {
    return data.sessions
      .filter((s) => s.token === params[0] && new Date(s.expires_at) > new Date())
      .map((s) => data.users.find((u) => u.id === s.user_id))
      .filter(Boolean)
      .slice(0, 1);
  }

  if (s.includes('SELECT * FROM otp_codes WHERE email')) {
    return data.otp_codes.filter((r) => r.email === params[0]);
  }

  if (s.includes('SELECT * FROM users WHERE email')) {
    return data.users.filter((r) => r.email === params[0]);
  }

  if (s.includes('SELECT * FROM users WHERE id')) {
    return data.users.filter((r) => r.id === params[0]);
  }

  if (s.includes('SELECT * FROM leagues WHERE code')) {
    return data.leagues.filter((r) => r.code === params[0]);
  }

  if (s.includes('SELECT * FROM leagues WHERE id')) {
    return data.leagues.filter((r) => r.id === params[0]);
  }

  if (s.includes('SELECT 1 FROM league_members')) {
    const found = data.league_members.some((r) => r.league_id === params[0] && r.user_id === params[1]);
    return found ? [{ 1: 1 }] : [];
  }

  if (s.includes('SELECT 1 FROM leagues WHERE code')) {
    const found = data.leagues.some((r) => r.code === params[0]);
    return found ? [{ 1: 1 }] : [];
  }

  if (s.startsWith('DELETE FROM league_members WHERE league_id')) {
    data.league_members = data.league_members.filter(
      (r) => !(r.league_id === params[0] && r.user_id === params[1]),
    );
    save(data);
    return {};
  }

  if (s.includes('SELECT * FROM league_members WHERE league_id') && s.includes('AND user_id')) {
    return data.league_members.filter((r) => r.league_id === params[0] && r.user_id === params[1]);
  }

  if (s.includes('SELECT COUNT(*) as c FROM league_members WHERE league_id')) {
    return [{ c: data.league_members.filter((r) => r.league_id === params[0]).length }];
  }

  if (s.includes('FROM league_members lm') && s.includes('JOIN leagues l') && s.includes('WHERE lm.user_id')) {
    return data.league_members
      .filter((r) => r.user_id === params[1])
      .map((lm) => {
        const l = data.leagues.find((x) => x.id === lm.league_id);
        const memberCount = data.league_members.filter((x) => x.league_id === l.id).length;
        return {
          ...l, points: lm.points, is_creator: l.creator_id === params[0] ? 1 : 0,
          member_count: memberCount,
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  if (s.includes('leaderboard') || (s.includes('SELECT u.id, u.username, lm.points') && s.includes('wins'))) {
    const leagueId = params[0];
    return data.league_members
      .filter((r) => r.league_id === leagueId)
      .map((lm) => {
        const u = data.users.find((x) => x.id === lm.user_id);
        const userBets = data.bets.filter((b) => b.league_id === leagueId && b.user_id === lm.user_id);
        return {
          id: u.id, username: u.username, points: lm.points,
          wins: userBets.filter((b) => b.status === 'won').length,
          total_bets: userBets.length,
        };
      })
      .sort((a, b) => b.points - a.points);
  }

  if (s.includes('SELECT points FROM league_members')) {
    const m = data.league_members.find((r) => r.league_id === params[0] && r.user_id === params[1]);
    return m ? [{ points: m.points }] : [];
  }

  if (s.includes('SELECT * FROM matches WHERE external_id')) {
    return data.matches.filter((r) => r.external_id === params[0]);
  }

  if (s.includes('SELECT id FROM matches WHERE external_id')) {
    const m = data.matches.find((r) => r.external_id === params[0]);
    return m ? [{ id: m.id }] : [];
  }

  if (s.includes('SELECT * FROM matches WHERE lower(home_team)')) {
    const day = params[2]?.replace('%', '') || '';
    return data.matches.filter((r) =>
      r.home_team.toLowerCase() === params[0].toLowerCase()
      && r.away_team.toLowerCase() === params[1].toLowerCase()
      && r.commence_time.startsWith(day)
    ).slice(0, 1);
  }

  if (s.includes('SELECT * FROM matches WHERE status = \'finished\'')) {
    return data.matches.filter((r) =>
      r.status === 'finished' && r.home_score != null && r.away_score != null
    );
  }

  if (s.includes('SELECT * FROM matches WHERE id')) {
    return data.matches.filter((r) => r.id === params[0]);
  }

  if (s.includes('SELECT * FROM match_odds WHERE match_id = ? AND bookmaker')) {
    return data.match_odds.filter((r) => r.match_id === params[0] && r.bookmaker === params[1]);
  }

  if (s.includes('SELECT * FROM match_odds WHERE match_id = ? ORDER BY')) {
    return data.match_odds.filter((r) => r.match_id === params[0]).sort((a, b) => a.bookmaker.localeCompare(b.bookmaker));
  }

  if (s.includes('SELECT * FROM bets WHERE user_id = ? AND league_id = ? AND match_id = ? AND status')) {
    return data.bets.filter((r) =>
      r.user_id === params[0] && r.league_id === params[1] && r.match_id === params[2] && r.status === 'pending'
    );
  }

  if (s.includes('SELECT b.*, lm.points as member_points') && s.includes('b.status = \'pending\'')) {
    return data.bets
      .filter((b) => b.match_id === params[0] && b.status === 'pending')
      .map((b) => {
        const lm = data.league_members.find((r) => r.league_id === b.league_id && r.user_id === b.user_id);
        return { ...b, member_points: lm?.points };
      });
  }

  if (s.includes('SELECT b.*, m.home_team') && s.includes('WHERE b.league_id = ? AND b.user_id = ?')) {
    return data.bets
      .filter((b) => b.league_id === params[0] && b.user_id === params[1])
      .map((b) => {
        const m = data.matches.find((x) => x.id === b.match_id);
        return {
          ...b,
          home_team: m?.home_team, away_team: m?.away_team,
          commence_time: m?.commence_time, home_score: m?.home_score,
          away_score: m?.away_score, match_status: m?.status,
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  if (s.includes('SELECT * FROM bets WHERE match_id = ? AND user_id = ? AND league_id = ?')) {
    return data.bets.filter((r) => r.match_id === params[0] && r.user_id === params[1] && r.league_id === params[2]);
  }

  if (s.includes('SELECT COUNT(*) as c FROM matches')) {
    return [{ c: data.matches.length }];
  }

  if (s.includes('SELECT COUNT(*) as c FROM match_odds')) {
    return [{ c: data.match_odds.length }];
  }

  if (s.includes('SELECT DISTINCT bookmaker FROM match_odds')) {
    return [...new Set(data.match_odds.map((r) => r.bookmaker))].sort().map((bookmaker) => ({ bookmaker }));
  }

  // Dynamic matches query from index.js
  if (s.includes('SELECT * FROM matches WHERE 1=1')) {
    let rows = [...data.matches];
    let pi = 0;
    if (s.includes('AND status = ?')) { rows = rows.filter((r) => r.status === params[pi++]); }
    if (s.includes("status IN ('scheduled', 'live')")) {
      const cutoff = new Date(Date.now() - 6 * 3600000);
      rows = rows.filter((r) => ['scheduled', 'live'].includes(r.status) && new Date(r.commence_time) >= cutoff);
    }
    rows.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
    return rows;
  }

  return mode === 'run' ? {} : [];
}

function upsertMatchObj(match) {
  const idx = data.matches.findIndex((r) => r.external_id === match.external_id);
  if (idx >= 0) {
    Object.assign(data.matches[idx], {
      home_score: match.home_score,
      away_score: match.away_score,
      status: match.status,
      stage: match.stage,
      group_name: match.group_name,
      venue: match.venue,
      updated_at: now(),
    });
    save(data);
    return { lastInsertRowid: data.matches[idx].id };
  }
  const id = nextId('matches');
  data.matches.push({ id, ...match, updated_at: now() });
  save(data);
  return { lastInsertRowid: id };
}

function upsertOddsObj(o) {
  const idx = data.match_odds.findIndex((r) => r.match_id === o.match_id && r.bookmaker === o.bookmaker);
  const row = { ...o, updated_at: now() };
  if (idx >= 0) {
    Object.assign(data.match_odds[idx], row);
    save(data);
    return { lastInsertRowid: data.match_odds[idx].id };
  }
  const id = nextId('match_odds');
  data.match_odds.push({ id, ...row });
  save(data);
  return { lastInsertRowid: id };
}

function now() {
  return new Date().toISOString();
}

export function createJsonBackend() {
  return {
    type: 'json',
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...p) => Promise.resolve(stmt.run(...p)),
        get: (...p) => Promise.resolve(stmt.get(...p)),
        all: (...p) => Promise.resolve(stmt.all(...p)),
      };
    },
    transaction(fn) {
      const wrapped = db.transaction(fn);
      return (...args) => Promise.resolve(wrapped(...args));
    },
  };
}

export default db;