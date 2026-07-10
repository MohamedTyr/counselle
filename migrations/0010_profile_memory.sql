-- Student profile, document, and memory persistence.
-- depends: 0009_pg_trgm
-- All rows cascade from counselle.users. Account deletion first removes durable
-- chat checkpoints, then deletes this owner row and its student-owned data.

CREATE TABLE counselle.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES counselle.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE counselle.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) <= 500),
  doc_type text NOT NULL DEFAULT 'other' CHECK (
    doc_type IN (
      'transcript', 'resume', 'essay', 'recommendation', 'award', 'school_report', 'other'
    )
  ),
  filename text NOT NULL CHECK (char_length(filename) <= 500),
  mime text NOT NULL CHECK (char_length(mime) <= 500),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 15728640),
  content bytea NOT NULL,
  extracted_text text,
  text_status text NOT NULL CHECK (text_status IN ('extracted', 'unsupported', 'failed')),
  summary text CHECK (char_length(summary) <= 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (octet_length(content) = size_bytes)
);
CREATE INDEX documents_user_active_idx
  ON counselle.documents (user_id)
  WHERE archived_at IS NULL;

CREATE TABLE counselle.memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX memories_user_active_idx
  ON counselle.memories (user_id)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX memories_user_content_active_idx
  ON counselle.memories (user_id, content)
  WHERE archived_at IS NULL;
