PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS pairing_codes;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS rate_limits;

CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,
  phone_secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  device_id TEXT
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  phone_secret_hash TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX pairing_codes_expires_idx ON pairing_codes(expires_at);
CREATE INDEX devices_last_seen_idx ON devices(last_seen_at);
