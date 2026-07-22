-- Sticky per-session Quick/Think response mode (plans/quick-think-response-mode.md §4.1).
-- depends: 0013_essay_prompt_drafts

ALTER TABLE counselle.sessions
ADD COLUMN response_mode text NOT NULL DEFAULT 'quick',
ADD CONSTRAINT sessions_response_mode_check
CHECK (response_mode IN ('quick', 'think'));
