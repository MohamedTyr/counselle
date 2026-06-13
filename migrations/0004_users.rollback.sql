-- NOTE: the dev purge in the forward migration is ONE-WAY — rollback cannot
-- restore the deleted NULL-user sessions or their checkpoint rows. That is
-- accepted (dev-only; the eval runner re-mints them).
ALTER TABLE counselle.sessions DROP CONSTRAINT sessions_user_fk;
DROP TABLE counselle.oauth_accounts;
DROP TABLE counselle.users;
