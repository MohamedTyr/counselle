-- Structural rollback only; nulls carry no recoverable information.

ALTER TABLE counselle.tasks
  DROP COLUMN sort_order;
