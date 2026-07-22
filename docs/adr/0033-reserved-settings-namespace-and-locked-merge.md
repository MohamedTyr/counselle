# ADR 0033 — Reserved settings namespace and locked merge for `users.settings`

**Status:** Accepted

## Context

ADR 0021 put `users.settings jsonb` in place as a flat, generic bag for a
handful of client-owned preferences (theme, default source-config preset),
written wholesale through `PATCH /v1/me`. Onboarding needs a second writer
of that same column: server-owned flow-progress state (`README.md` §8 of
the onboarding plan) that a student's own settings edits must never be able
to erase, and that must never leak into the generic settings surface either
(a client should not be able to hand-craft a `status: "completed"` write).

Two problems follow from having two writers of one jsonb column:

1. **Ownership** — `PATCH /v1/me`'s existing behavior was a full-object
   replace. A later theme change would silently wipe onboarding progress
   (and vice versa) unless one key is carved out as off-limits to the
   generic route.
2. **Concurrency** — even with ownership fixed, two independent read-merge-
   write cycles against the same row (`PATCH /v1/me` merging `settings`,
   `PATCH /v1/onboarding` merging `settings.onboarding`) can race: both read
   the same snapshot, both write, and the second commit clobbers the
   first's change unless they serialize against each other.

This is the first feature to need a namespaced, independently-owned pocket
inside `settings`. The shape of the fix is general enough to recur, so it
gets its own decision rather than living as an implementation detail of the
onboarding feature.

## Decision

1. **`PATCH /v1/me`'s `settings` field becomes an RFC 7396-style top-level
   patch, not a replacement.** An omitted key is preserved, an explicit
   `null` value deletes that one key, and `settings: null` (clearing the
   whole object) is rejected with 422. This is a behavior change from
   ADR 0021's original full-replace semantics.
2. **A `_RESERVED_SETTINGS_KEYS` allowlist in `api/routes/me.py`** names
   keys that `PATCH /v1/me` must never read, set, or clear. `onboarding` is
   the first entry. A generic-settings write that touches a reserved key is
   rejected with 422 pointing at the owning endpoint. Any future feature
   that needs its own server-owned pocket in `settings` adds its key here
   and gets its own dedicated PATCH route, following the same shape as
   `PATCH /v1/onboarding` (`app/onboarding.py`).
3. **Both writers take the same lock before merging.** `PATCH /v1/me`'s
   settings merge and `app.onboarding.update_onboarding_progress` each open
   a transaction, `SELECT settings FROM counselle.users WHERE id = $1 FOR
   UPDATE`, merge against that freshly-locked row (not a request-start
   snapshot), and write back. The onboarding write additionally scopes its
   `UPDATE` to `jsonb_set(settings, '{onboarding}', ...)` rather than the
   whole column, so it only ever touches its own key. Whichever transaction
   commits second merges against the other's already-applied change instead
   of overwriting it.

## Rationale

A per-key allowlist plus row-level locking is the smallest mechanism that
closes both the ownership hole and the race, and it generalizes: the next
feature that needs a settings pocket the client can't touch directly reuses
the same allowlist-plus-`FOR UPDATE` shape instead of inventing a new one
(or a new table, which ADR 0021 already rejected as ceremony for a few
fields). Keeping the merge RFC-7396-shaped (rather than a bespoke onboarding
special case) means the generic route's behavior stays predictable for
every other key that lives in `settings` today and later.

## Alternatives

- **A separate `onboarding` table/column.** Rejected for the same reason
  ADR 0021 kept settings in one jsonb column: one flow-state field doesn't
  justify a schema change, and it would need its own cascade-delete wiring
  that `settings jsonb` already gets for free.
- **Optimistic concurrency (a version column / `updated_at` compare-and-
  swap) instead of `FOR UPDATE`.** Rejected as more moving parts than
  needed at current write volume (one user editing their own settings from
  at most a couple of tabs); pessimistic row locking inside a single short
  transaction is simpler to reason about and cheap at this scale.
- **Leave `PATCH /v1/me` as a full replace and have the frontend always
  round-trip the current `settings.onboarding` value back through it.**
  Rejected — it makes every settings-writing surface responsible for not
  clobbering a key it doesn't know about, which is exactly the class of bug
  this ADR closes.

## Consequences

Any future feature adding a second write path into `users.settings` must
add its key to `_RESERVED_SETTINGS_KEYS` and take the same `FOR UPDATE`
lock before merging, or it reopens the race this ADR closes. The existing
`PATCH /v1/me` route test suite needed updating for the new patch (not
replace) semantics — a client that previously relied on omitting a settings
key to clear it must now send that key explicitly as `null`.
