-- Keep recovery links and in-flight logins invalid after an email changes back.
-- depends: 0022_auth_launch

ALTER TABLE counselle.users
    ADD COLUMN credential_revision bigint NOT NULL DEFAULT 0
    CHECK (credential_revision >= 0);
