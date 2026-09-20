-- SAT practice: question bank + per-user attempts/bookmarks (plan.md §3.4).
--
-- Three-way join point in the dependency tree today (0019_drop_school_
-- requirements, 0019_tasks_redesign -> 0020_task_sort_order, 0020_essay_
-- sessions each a head off 0018) -- this migration names all three current
-- heads so applying it leaves exactly one.
--
-- Metadata (sat_questions) and content (sat_question_content) are split so
-- /counts and /session -- hit on every filter click -- scan a narrow table
-- and never touch the TOASTed HTML in the content table.
--
-- COLLATE "C" on every question_id column: liprep's session order is
-- IndexedDB primary-key order, i.e. plain code-unit order of questionId.
-- Every id today is 8 lower-case hex characters, for which any collation
-- agrees, but "C" makes that guarantee independent of the database's locale.
--
-- Enumerations are validated in app code (Literal types), as in the existing
-- counselle.* tables. sat_attempts.module/domain_cd/skill_cd are deliberately
-- free text: an imported .liprep log may carry unknown or empty codes.
--
-- Attempts denormalise module/domain/skill/band and carry no FK to
-- sat_questions -- an attempt is a historical fact about what the student
-- saw; a College Board reclassification must not rewrite past analytics, and
-- an imported .liprep file may name ids our bank does not hold. submit can
-- only insert an id it just loaded, which is where integrity matters.
--
-- Applied as counselle_app (the app DSN, which owns every table it
-- creates), matching migrations/0007_workspace.sql -- no GRANT needed.
--
-- depends: 0019_drop_school_requirements 0020_essay_sessions 0020_task_sort_order

CREATE TABLE counselle.sat_questions (
  question_id     text COLLATE "C" PRIMARY KEY,   -- assessment-99 questionId: 8 lower-case hex
  external_id     uuid UNIQUE,                    -- natural key (qbank)
  ibn             text UNIQUE,                    -- natural key (disclosed)
  u_id            uuid NOT NULL,
  source          text NOT NULL,                  -- 'qbank' | 'disclosed'
  module          text NOT NULL,                  -- 'reading' | 'math'
  domain_cd       text NOT NULL,
  skill_cd        text NOT NULL,
  score_band      smallint NOT NULL CHECK (score_band BETWEEN 1 AND 7),
  difficulty      text NOT NULL,                  -- 'E' | 'M' | 'H'
  program         text NOT NULL,
  item_type       text NOT NULL,                  -- 'mcq' | 'spr'
  in_bluebook     boolean NOT NULL,
  cb_created_at   timestamptz,
  cb_updated_at   timestamptz,
  content_sha256  text NOT NULL,
  retired_at      timestamptz,
  CHECK ((external_id IS NULL) <> (ibn IS NULL))
);
CREATE INDEX sat_questions_filter_idx ON counselle.sat_questions (skill_cd, score_band)
  WHERE retired_at IS NULL;

CREATE TABLE counselle.sat_question_content (     -- wide HTML, read one row at a time
  question_id     text COLLATE "C" PRIMARY KEY REFERENCES counselle.sat_questions(question_id),
  stimulus        text,
  stem            text NOT NULL,
  answer_options  jsonb NOT NULL DEFAULT '[]',
  correct_answers text[] NOT NULL CHECK (cardinality(correct_answers) >= 1),
  rationale       text NOT NULL
);

CREATE TABLE counselle.sat_question_aliases (
  alias_id    text COLLATE "C" PRIMARY KEY,
  question_id text COLLATE "C" NOT NULL REFERENCES counselle.sat_questions(question_id)
);

CREATE TABLE counselle.sat_bank_meta (            -- single row
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  content_sha256 text NOT NULL, question_count integer NOT NULL,
  fetched_at timestamptz NOT NULL, synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE counselle.sat_attempts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  client_attempt_id  uuid NOT NULL,               -- retry-safe submit (§4.3)
  question_id        text COLLATE "C" NOT NULL,   -- deliberately not a foreign key (below)
  module             text NOT NULL,
  domain_cd          text NOT NULL DEFAULT '',
  skill_cd           text NOT NULL DEFAULT '',
  score_band         smallint NOT NULL CHECK (score_band BETWEEN 1 AND 7),
  user_answer        text NOT NULL,
  is_correct         boolean NOT NULL,
  time_spent_seconds integer NOT NULL CHECK (time_spent_seconds >= 1),
  solved_at          timestamptz NOT NULL DEFAULT now(),
  local_date         date NOT NULL,
  UNIQUE (user_id, client_attempt_id)
);
CREATE INDEX sat_attempts_user_time_idx     ON counselle.sat_attempts (user_id, solved_at, id);
CREATE INDEX sat_attempts_user_question_idx ON counselle.sat_attempts (user_id, question_id, solved_at, id);

CREATE TABLE counselle.sat_bookmarks (
  user_id       uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  question_id   text COLLATE "C" NOT NULL,
  bookmarked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
