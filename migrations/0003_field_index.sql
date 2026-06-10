-- counselle.field_index — pgvector index for field discovery (ADR 0008)
-- The extension may need superuser; if so it is pre-created via the admin DSN
-- and this statement becomes a no-op.
-- depends: 0002_helpers

CREATE EXTENSION IF NOT EXISTS vector;

-- Applied as counselle_app (the app DSN), which therefore OWNS the table — no DML grant needed.
CREATE TABLE counselle.field_index (
  field_key text PRIMARY KEY,
  content_hash text NOT NULL,
  -- 768 matches COUNSELLE_EMBED_DIMENSIONS (Settings default); a dimension
  -- change requires a new migration (the column type is fixed at DDL time).
  -- public-qualified: yoyo's ?schema=counselle search_path excludes public,
  -- where the extension's types live.
  embedding public.vector(768),
  embed_model_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON counselle.field_index TO counselle_ro;
