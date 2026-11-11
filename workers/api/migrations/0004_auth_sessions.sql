-- KP e-Exam Platform — Auth foundation for Exam Engine Phase 2.
-- Apply ONLY to kp_exam_platform_staging after explicit approval.
-- Google OAuth secrets are Worker secrets; never store credentials in D1.

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  picture_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_oauth_states_expiry
  ON auth_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_token_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_profile
  ON auth_sessions(profile_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT,
  event_type TEXT NOT NULL,
  event_detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_profile_created
  ON auth_audit_log(profile_id, created_at DESC);

-- The Phase 1 attempts table used an opaque text user_id. Bind it to the
-- authenticated profile table without rebuilding existing attempt data.
CREATE TRIGGER IF NOT EXISTS trg_attempts_require_profile_insert
BEFORE INSERT ON user_attempts
WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'attempt user_id must reference an authenticated profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_attempts_require_profile_update
BEFORE UPDATE OF user_id ON user_attempts
WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'attempt user_id must reference an authenticated profile');
END;

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0004_auth_sessions');
