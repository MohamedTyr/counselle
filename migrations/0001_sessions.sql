-- counselle.sessions — durable session registry (ADR 0019)
-- depends:

CREATE TABLE counselle.sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NULL,                       -- platform phase fills this (ADR 0019)
  title text NULL,
  source_config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON counselle.sessions (user_id) WHERE user_id IS NOT NULL;
