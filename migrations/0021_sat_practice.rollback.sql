-- Drops everything added in 0021_sat_practice.sql, child-first: bookmarks
-- and attempts (no FK to sat_questions, but drop with the feature), then
-- bank metadata, aliases and content (each FK-referencing sat_questions),
-- and finally sat_questions itself.

DROP TABLE counselle.sat_bookmarks;
DROP TABLE counselle.sat_attempts;
DROP TABLE counselle.sat_bank_meta;
DROP TABLE counselle.sat_question_aliases;
DROP TABLE counselle.sat_question_content;
DROP TABLE counselle.sat_questions;
