-- Rolling back invalidates all login sessions and pending email changes.
DROP TABLE counselle.auth_action_tokens;
DROP TABLE counselle.auth_sessions;
