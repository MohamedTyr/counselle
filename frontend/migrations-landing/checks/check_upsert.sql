-- Pins the waitlist update rule (functions/api/waitlist.ts, UPSERT). Each
-- statement below repeats that statement verbatim with literals in place of
-- ?1..?9; change them together. Run after any change to the statement:
--
--   npx wrangler d1 execute acceptra-waitlist --local --file migrations-landing/checks/check_upsert.sql
--
-- Local only. Any broken rule aborts the run with a constraint failure on
-- _upsert_check.ok; a passing run's last result lists every check.
-- Rows use the reserved .invalid domain and are removed at both ends.

DELETE FROM waitlist WHERE email LIKE '%@check.invalid';
DROP TABLE IF EXISTS _upsert_check;
DROP TABLE IF EXISTS _upsert_first;
CREATE TABLE _upsert_check (name TEXT NOT NULL, ok INTEGER NOT NULL CHECK (ok = 1));

-- 1. A new email creates one row with its first-touch fields.
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('a@check.invalid', 'me', 'plan', 'monthly', NULL, NULL, 'newsletter', 'email', 'launch')
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

CREATE TABLE _upsert_first AS SELECT * FROM waitlist WHERE email = 'a@check.invalid';

-- 2. Same side, with answers: they fill in; first-touch fields don't move.
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('a@check.invalid', 'me', 'nav', 'yearly', 'student', '2028', 'twitter', 'social', 'other')
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

INSERT INTO _upsert_check
SELECT '2. same side fills role and class_of, first-touch unchanged',
       w.role = 'student' AND w.class_of = '2028'
       AND w.source = f.source AND w.plan = f.plan AND w.created_at = f.created_at
       AND w.utm_source = f.utm_source AND w.utm_medium = f.utm_medium
       AND w.utm_campaign = f.utm_campaign
FROM waitlist w, _upsert_first f WHERE w.email = f.email;

-- 3. Same side, without answers: stored answers are never replaced by null.
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('a@check.invalid', 'me', 'nav', NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

INSERT INTO _upsert_check
SELECT '3. same side without role keeps the stored role and class_of',
       role = 'student' AND class_of = '2028'
FROM waitlist WHERE email = 'a@check.invalid';

-- 4. Side switch: the old side's answers are dropped for the new post's.
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('a@check.invalid', 'school', 'schools', NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

INSERT INTO _upsert_check
SELECT '4a. switch to school resets role and class_of',
       w.side = 'school' AND w.role IS NULL AND w.class_of IS NULL
       AND w.source = f.source AND w.plan = f.plan AND w.created_at = f.created_at
FROM waitlist w, _upsert_first f WHERE w.email = f.email;

INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('a@check.invalid', 'me', 'nav', NULL, 'parent', NULL, NULL, NULL, NULL)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

INSERT INTO _upsert_check
SELECT '4b. switch back to me takes the new post''s answers',
       side = 'me' AND role = 'parent' AND class_of IS NULL
FROM waitlist WHERE email = 'a@check.invalid';

-- 5. One normalised email is one row. (Trimming, NFC and lowercasing happen
--    in the function before this statement; this pins the key it relies on.)
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('b@check.invalid', 'me', 'nav', NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES ('b@check.invalid', 'me', 'link', NULL, 'student', NULL, NULL, NULL, NULL)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

INSERT INTO _upsert_check
SELECT '5. a repeated email stays one row', count(*) = 1
FROM waitlist WHERE email = 'b@check.invalid';

SELECT name, ok FROM _upsert_check;

DELETE FROM waitlist WHERE email LIKE '%@check.invalid';
DROP TABLE _upsert_check;
DROP TABLE _upsert_first;
