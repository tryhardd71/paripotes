import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function adaptSql(sql) {
  return sql
    .replace(/datetime\('now',\s*'-6 hours'\)/gi, "NOW() - INTERVAL '6 hours'")
    .replace(/datetime\('now'\)/gi, 'NOW()');
}

function toPositional(sql, params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    const obj = params[0];
    const keys = [];
    const converted = sql.replace(/@(\w+)/g, (_, key) => {
      keys.push(key);
      return `$${keys.length}`;
    });
    return { sql: adaptSql(converted), values: keys.map((k) => obj[k]) };
  }
  let i = 0;
  const converted = sql.replace(/\?/g, () => `$${++i}`);
  return { sql: adaptSql(converted), values: params };
}

function withReturningId(sql) {
  const s = sql.trim();
  if (!/^INSERT INTO/i.test(s) || /RETURNING/i.test(s)) return s;
  // otp_codes et sessions n'ont pas de colonne id
  if (/INSERT INTO (otp_codes|sessions|league_members)\b/i.test(s)) return s;
  return `${s} RETURNING id`;
}

function createStmt(runQuery) {
  return (sql) => ({
    async run(...params) {
      let { sql: q, values } = toPositional(sql, params);
      q = withReturningId(q);
      const res = await runQuery(q, values);
      return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount };
    },
    async get(...params) {
      const { sql: q, values } = toPositional(sql, params);
      const res = await runQuery(q, values);
      return res.rows[0];
    },
    async all(...params) {
      const { sql: q, values } = toPositional(sql, params);
      const res = await runQuery(q, values);
      return res.rows;
    },
  });
}

export async function createPgBackend() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    max: 10,
  });
  pool.on('error', (err) => console.error('PG pool error:', err.message));

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  const prepare = createStmt((q, v) => pool.query(q, v));

  return {
    type: 'postgres',
    pool,
    prepare,
    async transaction(fn) {
      const client = await pool.connect();
      const txPrepare = createStmt((q, v) => client.query(q, v));
      try {
        await client.query('BEGIN');
        const result = await fn({ prepare: txPrepare });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}