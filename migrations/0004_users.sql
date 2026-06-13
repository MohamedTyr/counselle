-- counselle.users + counselle.oauth_accounts — fastapi-users auth (ADR 0021)
-- depends: 0003_field_index

-- Applied as counselle_app (the app DSN), which therefore OWNS these tables.

CREATE TABLE counselle.users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  hashed_password varchar(1024) NULL,        -- NULL for OAuth-only users (honest has_password)
  is_active boolean NOT NULL DEFAULT true,
  is_superuser boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  name text NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive email uniqueness (fastapi-users looks up via lower(email)).
CREATE UNIQUE INDEX users_email_lower_idx ON counselle.users (lower(email));

CREATE TABLE counselle.oauth_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  oauth_name varchar(100) NOT NULL,
  access_token varchar(1024) NOT NULL,
  expires_at bigint NULL,                     -- Unix epoch; bigint avoids int32 2038 overflow
  refresh_token varchar(1024) NULL,
  account_id varchar(320) NOT NULL,
  account_email varchar(320) NOT NULL
);
-- UNIQUE: one provider account links to exactly one user.
CREATE UNIQUE INDEX oauth_accounts_oauth_account_idx
  ON counselle.oauth_accounts (oauth_name, account_id);
CREATE INDEX oauth_accounts_user_idx ON counselle.oauth_accounts (user_id);

-- sessions.user_id now references a real user (CASCADE: deleting a user drops
-- their sessions; the no-FK checkpoint tables are swept in DELETE /v1/me).
ALTER TABLE counselle.sessions
  ADD CONSTRAINT sessions_user_fk
  FOREIGN KEY (user_id) REFERENCES counselle.users(id) ON DELETE CASCADE;

-- Dev purge (one-way; accepted dev-only — MVP1 eval sessions are re-runnable).
-- The FK above would reject the orphaned NULL-user MVP1 rows on any future
-- write; their checkpoint rows have no FK, so sweep them by hand IN ORDER.
DELETE FROM counselle.sessions WHERE user_id IS NULL;
DELETE FROM counselle.checkpoints
  WHERE thread_id NOT IN (SELECT session_id::text FROM counselle.sessions);
DELETE FROM counselle.checkpoint_writes
  WHERE thread_id NOT IN (SELECT session_id::text FROM counselle.sessions);
-- NOTE: checkpoint_migrations has no thread_id — never touch it.
DELETE FROM counselle.checkpoint_blobs
  WHERE thread_id NOT IN (SELECT session_id::text FROM counselle.sessions);
