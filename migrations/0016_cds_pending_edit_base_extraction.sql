-- Bind every pending review edit to the extraction it was authored against, so
-- an edit can never be applied to a *different* extraction's packet than the
-- values the admin was looking at when they wrote it.
-- depends: 0015_cds_admin

-- Without this column nothing ties a `cds_pending_edits` row to a generation of
-- extracted values. An edit left behind by a crashed approve (the pipeline-pool
-- transaction commits before the app-pool cleanup runs — two roles, two
-- connections, no shared transaction) stayed indistinguishable from a live
-- proposal: the review screen kept showing it as "pending" over a value that
-- was already live and being served, and the next approve after a rerun
-- silently re-applied it over the freshly re-extracted value.
--
-- Existing rows cannot be backfilled: `counselle_app` has zero grants on
-- `cds_library` (0015 §"No FK: cross-schema"), so this migration has no way to
-- learn which extraction any given row was authored against, and guessing would
-- reintroduce exactly the mis-application this column exists to prevent. They
-- are deleted instead — a pending edit is uncommitted, un-applied scratch state
-- that an admin recreates in seconds on the review screen, and an unbindable
-- one is by definition the orphan class being eliminated. NOT NULL keeps that
-- structural: there is no third "unbound" state for the read path to guess at.
DELETE FROM counselle.cds_pending_edits;

ALTER TABLE counselle.cds_pending_edits
ADD COLUMN base_extraction_id uuid NOT NULL;
