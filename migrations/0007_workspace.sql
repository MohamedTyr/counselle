-- MVP3 workspace tables + change log.
-- depends: 0006_indexes

CREATE TABLE counselle.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  school_unitid integer NOT NULL,
  status text NOT NULL DEFAULT 'Considering',
  list_type text NOT NULL,
  round text NOT NULL,
  deadline date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX applications_user_school_active_idx
  ON counselle.applications (user_id, school_unitid)
  WHERE archived_at IS NULL;
CREATE INDEX applications_user_active_idx
  ON counselle.applications (user_id)
  WHERE archived_at IS NULL;

CREATE TABLE counselle.essays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  application_id uuid REFERENCES counselle.applications(id) ON DELETE CASCADE,
  title text NOT NULL,
  essay_type text NOT NULL DEFAULT 'Supplement',
  status text NOT NULL DEFAULT 'Not started',
  prompt text,
  content jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  word_count integer NOT NULL DEFAULT 0,
  word_limit integer,
  comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_via_application uuid REFERENCES counselle.applications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX essays_user_active_idx
  ON counselle.essays (user_id)
  WHERE archived_at IS NULL;
CREATE INDEX essays_application_idx ON counselle.essays (application_id);

CREATE TABLE counselle.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  application_id uuid REFERENCES counselle.applications(id) ON DELETE CASCADE,
  essay_id uuid REFERENCES counselle.essays(id) ON DELETE SET NULL,
  title text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'todo',
  category text NOT NULL DEFAULT 'other',
  priority text NOT NULL DEFAULT 'med',
  assignee text NOT NULL DEFAULT 'student',
  needs_input boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  planned_for timestamptz,
  reminder_at timestamptz,
  completed_at timestamptz,
  archived_via_application uuid REFERENCES counselle.applications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX tasks_user_active_idx
  ON counselle.tasks (user_id)
  WHERE archived_at IS NULL;
CREATE INDEX tasks_application_idx ON counselle.tasks (application_id);
CREATE INDEX tasks_essay_idx ON counselle.tasks (essay_id);

CREATE TABLE counselle.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  activity_type text NOT NULL DEFAULT '',
  position_label text NOT NULL DEFAULT '',
  organization text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  grades text[] NOT NULL DEFAULT '{}',
  timing text[] NOT NULL DEFAULT '{}',
  hours_per_week numeric,
  weeks_per_year numeric,
  continue_in_college boolean,
  story text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX activities_user_active_idx
  ON counselle.activities (user_id)
  WHERE archived_at IS NULL;

CREATE TABLE counselle.honors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL,
  title text NOT NULL DEFAULT '',
  grades text[] NOT NULL DEFAULT '{}',
  levels text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX honors_user_active_idx
  ON counselle.honors (user_id)
  WHERE archived_at IS NULL;

CREATE TABLE counselle.workspace_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  actor text NOT NULL,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  op text NOT NULL,
  application_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_changes_user_id_idx
  ON counselle.workspace_changes (user_id, id);
