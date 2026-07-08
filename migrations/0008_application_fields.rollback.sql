-- NOTE: the round data migration in the forward migration is ONE-WAY —
-- rollback cannot restore the original 'Scholarship deadline' round value.
-- That is accepted (dev-only data; the round enum removal is intentional).
ALTER TABLE counselle.essays
  DROP COLUMN deadline;

ALTER TABLE counselle.applications
  DROP COLUMN aid_deadline,
  DROP COLUMN scholarship_deadline,
  DROP COLUMN notes,
  DROP COLUMN intended_major,
  DROP COLUMN test_plan;
