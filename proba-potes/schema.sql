CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS proba_posts (
  id TEXT PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  accepter_id INTEGER REFERENCES users(id),
  description TEXT NOT NULL,
  initial_cote INTEGER NOT NULL,
  reverse BOOLEAN NOT NULL DEFAULT false,
  round INTEGER NOT NULL DEFAULT 1,
  round_holder_id INTEGER,
  current_cote INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  picks JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proba_posts_state ON proba_posts(state);
CREATE INDEX IF NOT EXISTS idx_proba_posts_created ON proba_posts(created_at DESC);