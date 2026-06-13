# plans/ — local scratch space

This folder is **ephemeral scratch space for work-in-progress planning**. While a feature or MVP is being actively designed and built, its plan lives here.

Nothing here is canonical. The permanent, shareable home for finalized PRDs and plans is [`../specs/`](../specs/).

## The convention

- **Work here** while a plan is being drafted, reviewed, and implemented.
- **When the work is finished and verified perfect**, move the finalized PRD/plan to `specs/<feature>/` (see [`../specs/README.md`](../specs/README.md)). That is the "approved and done / being implemented" record for teammates.
- Don't let plans rot here. If it's done, it graduates to `specs/`. If it's abandoned, delete it.

## Personal scratch

Need truly private, never-committed notes (prompt drafts, throwaway working notes)? Put them under `plans/.local/` — that path is gitignored.
