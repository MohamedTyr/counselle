-- Student-authored essay prompts that are not yet essays.
-- depends: 0012_drop_old_db_objects

CREATE TABLE counselle.essay_prompt_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES counselle.applications(id) ON DELETE CASCADE,
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  word_limit integer CHECK (word_limit > 0),
  archived_via_application uuid REFERENCES counselle.applications(id) ON DELETE SET NULL,
  converted_to_essay_id uuid REFERENCES counselle.essays(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX essay_prompt_drafts_user_active_idx
  ON counselle.essay_prompt_drafts (user_id)
  WHERE archived_at IS NULL;
CREATE INDEX essay_prompt_drafts_application_idx
  ON counselle.essay_prompt_drafts (application_id);
