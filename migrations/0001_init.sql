CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  daily_req_limit INTEGER,
  protocols TEXT NOT NULL DEFAULT '"all"',
  address_override TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_totals (
  token_hash TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS user_usage (
  day TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, token_hash)
);
CREATE TABLE IF NOT EXISTS user_activity (
  day TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  bytes_up INTEGER NOT NULL DEFAULT 0,
  bytes_down INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, token_hash)
);
CREATE TABLE IF NOT EXISTS counters (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  requests_today INTEGER NOT NULL DEFAULT 0,
  requests_total INTEGER NOT NULL DEFAULT 0,
  bytes_up INTEGER NOT NULL DEFAULT 0,
  bytes_down INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_user_usage_hash ON user_usage (token_hash);
CREATE INDEX IF NOT EXISTS idx_user_activity_hash ON user_activity (token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action);
