-- Revocable login sessions and pending, single-use email changes.
-- Conversation sessions remain in counselle.sessions.
-- depends: 0021_sat_practice

CREATE TABLE counselle.auth_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL when an OAuth provider did not prove when the person authenticated.
  authenticated_at timestamptz NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_idx ON counselle.auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx ON counselle.auth_sessions (expires_at);

CREATE TABLE counselle.auth_action_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_change', 'reauthenticate')),
  session_hash text NULL REFERENCES counselle.auth_sessions(token_hash) ON DELETE CASCADE,
  CHECK ((purpose = 'reauthenticate') = (session_hash IS NOT NULL)),
  email varchar(320) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, purpose),
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_action_tokens_expiry_idx ON counselle.auth_action_tokens (expires_at);
