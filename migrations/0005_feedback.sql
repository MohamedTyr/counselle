-- counselle.feedback — per-message thumbs (B4, §29; wire-contract §2.2 `feedback?`)
-- depends: 0004_users

-- Applied as counselle_app (the app DSN), which therefore OWNS this table.
-- A row is the caller's stored rating on an ASSISTANT message_id; the transcript
-- read joins it so a thumbs-up survives reload (the honesty piece — without the
-- read path, a re-tap toggle is a lie after F5).

CREATE TABLE counselle.feedback (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES counselle.sessions(session_id) ON DELETE CASCADE,
  message_id text NOT NULL,                  -- the assistant message_id (G1)
  rating varchar(8) NOT NULL CHECK (rating IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)               -- one rating per (caller, message)
);

-- The transcript read joins feedback per session for the authed user.
CREATE INDEX feedback_session_idx ON counselle.feedback (session_id);
