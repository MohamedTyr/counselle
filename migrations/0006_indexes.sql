-- Additive indexes for the B4 list + feedback-join hot paths (no table churn).
-- depends: 0005_feedback

-- Keyset list (GET /v1/sessions): user-scoped, ordered (updated_at DESC, session_id DESC).
CREATE INDEX sessions_user_updated_idx
  ON counselle.sessions (user_id, updated_at DESC, session_id DESC)
  WHERE user_id IS NOT NULL;

-- Feedback transcript-read join: WHERE user_id=$1 AND session_id=$2.
CREATE INDEX feedback_user_session_idx
  ON counselle.feedback (user_id, session_id);
