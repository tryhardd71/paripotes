import { createPgBackend } from './db-pg.js';
import { createJsonBackend } from './db-json.js';

let backend = null;

export async function initDb() {
  if (process.env.DATABASE_URL) {
    backend = await createPgBackend();
    console.log('🗄️  Base PostgreSQL connectée (données persistantes)');
  } else {
    backend = createJsonBackend();
    console.log('🗄️  Base locale data.json (dev — pas persistant sur Render)');
  }
}

function requireBackend() {
  if (!backend) throw new Error('DB non initialisée — appelle initDb() au démarrage');
  return backend;
}

export const db = {
  prepare(sql) {
    return requireBackend().prepare(sql);
  },
  transaction(fn) {
    return requireBackend().transaction(fn);
  },
};

export function getDbType() {
  return backend?.type || 'none';
}

export default db;