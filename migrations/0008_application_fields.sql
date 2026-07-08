-- Application + essay field completeness pass (specs/mvp3 follow-up).
-- Adds per-school aid/scholarship dates, free-text notes/major, a per-school
-- test-submission decision, and a per-essay deadline override.
-- depends: 0007_workspace

ALTER TABLE counselle.applications
  ADD COLUMN aid_deadline date,
  ADD COLUMN scholarship_deadline date,
  ADD COLUMN notes text,
  ADD COLUMN intended_major text,
  ADD COLUMN test_plan text;

ALTER TABLE counselle.essays
  ADD COLUMN deadline date;

-- Round data migration: 'Scholarship deadline' is removed from the Round
-- enum (it capped the product at one tracked date per school). Existing rows
-- move to 'RD' and their old deadline value is preserved as the new
-- scholarship_deadline (dev-only data; no rollback of this step).
UPDATE counselle.applications
SET scholarship_deadline = deadline,
    round = 'RD'
WHERE round = 'Scholarship deadline';
