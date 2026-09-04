# Tasks redesign — spec

Status: draft for review · Owner: — · Date: 2026-09-04

## 0. What we learned from the apps that won this category

We looked at Things 3, Todoist, Apple Reminders, TickTick and Sunsama. The pattern is consistent enough to treat as a rule set rather than taste.

| Rule | Who does it | What it looks like |
|---|---|---|
| Capture is one line | Todoist, Things, Reminders, TickTick | Type a title with a date in the same string, press Enter. Nothing else is required. Todoist's Quick Add highlights the date inline as you type; you tap the word to un-highlight it if it was part of the name. |
| Two dates max, with different meanings | Things (since 2017), Todoist (added Deadlines Jan 2025) | *When* = the day I plan to touch it. *Deadline* = the day the outside world requires it. Todoist resisted this for years, then converged on exactly the Things model — that's the strongest signal available that it's the right one. |
| Notifications are a property of a date, not a third date | Things, Reminders, Todoist | A reminder fires *for* the When or Deadline. It is never a standalone field. Things explicitly documents: Due/When doesn't alert, Deadline can go overdue, Reminder is the alert on either. |
| Two states | Everyone | Open / done. "Waiting" is a tag (Things), a list, or a future When date. Nobody has a *Doing* column. |
| Today is curated, not computed | Things, Sunsama | Today is a list you deliberately put things into. Things' Today doesn't go red when you don't finish; Sunsama's whole product is the 5-minute morning ritual of choosing it. |
| One row, many groupings | Things, Todoist, Reminders | Same row component in every list. Views differ by grouping/filter, never by rendering. |
| Reschedule is one control | All | Click the date → Today / Tomorrow / Weekend / Next week / Someday / pick. Same popover everywhere. |
| Deadlines are rare on purpose | Things community, Todoist docs | Both explicitly advise reserving Deadline for external consequences. For our user every real deadline is external and mostly inheritable from the application — so we get this for free. |

Everything below follows from these eight rules.

## 1. Product framing

**User.** One student, ~40 open tasks across a handful of applications, a few months of horizon, and an agent (Counselle) that can create and update tasks on their behalf.

**Job.** Know what to do today, not miss a school's date, and not think about the tool.

**Non-goals.** Team workflows, delegation, WIP limits, kanban, per-task time tracking, custom fields, multiple assignees, notifications we can't send.

**Design rule (the whole spec in one line):** *one line to capture, one click to complete, one control to reschedule; everything else hides.*

## 2. Data model

### 2.1 Task fields (user-facing)

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | text | yes | Never blank. Never "Untitled task". |
| `notes` | markdown text | no | |
| `when` | date | no | The day the student plans to work on it. Null = Anytime. |
| `deadline` | date | no | External date. Defaults from the linked application's date when one exists (see §2.4). |
| `done_at` | timestamp | no | Non-null = done. This *is* the status. |
| `flagged` | bool | no | Replaces priority in the UI. |
| `application_id` | fk | no | |
| `essay_id` | fk | no | Setting an essay implies its application. |

That is 8 fields, 6 of which are editable in the detail panel (§7). Compare: 13 today.

### 2.2 Fields removed from the UI surface

| Field | Disposition |
|---|---|
| `status` (todo/doing/waiting/done) | Collapsed to `done_at`. Keep the column for one release, migrate, then drop. See §10. |
| `planned_for` | Renamed → `when`. Same semantics, honest name. |
| `due_at` | Renamed → `deadline`. Date-only; drop the time component. |
| `reminder_at` | **Deleted.** Nothing reads it. Reintroduce only when a notification channel exists, and then as "remind me" on When/Deadline, not a third date. |
| `priority` (low/med/high) | Keep column. UI maps `high` ↔ flagged, everything else ↔ unflagged. No migration. |
| `category` | Derived, not stored by the user (§2.3). Column stays for agent use only. |
| `requirement_kind` | Agent-internal. Never rendered. Untouched. |
| `assignee` | Derived from `created_by` on the task row / change row. Removed as an input. |
| `needs_input` | Replaced by the agent asking in the composer (§8). Removed. |

### 2.3 Derived label

Exactly one label is shown per row, computed at render time:

```
if essay_id       → "Essay · <school short name>"
elif application_id → "<school short name>"
elif category (agent-set) → category display name
else → no label
```

No category picker. If the user needs to organise, they link to a school or essay. If a free-text label system is ever wanted, it gets built as labels, not as a fixed enum — but it is out of scope for this pass.

### 2.4 Deadline inheritance

When `application_id` is set and `deadline` is null, the row *displays* the application's deadline in a muted style ("inherits from MIT · Jan 1"). It is not written to the task. Setting an explicit deadline overrides it; clearing it returns to inheritance. This keeps the school's date correct when the application's date changes.

### 2.5 Invariants

- `title` non-empty (server validates; client never sends empty).
- `done_at` set ⇒ task excluded from Today/Upcoming/Anytime regardless of dates.
- `when` and `deadline` are dates, not datetimes.
- A task is never created server-side before the user has typed a title.

## 3. Task states

Two: **open** and **done**.

- Check the box → `done_at = now`, row strikes through and fades over 300 ms, then leaves the list. The existing undo toast stays (5 s).
- Uncheck in the Logbook → `done_at = null`, row returns to whichever list its dates put it in.
- There is no *doing*. Focus is expressed by ordering in Today (§6.1).
- There is no *waiting* (decision, §11). "Waiting on Ms. Lee's rec letter" is a task with `when` = the check-in date. The quick-add parser recognises `waiting` / `wait for` as a hint to prompt for a check-in date (§4.3).

## 4. Capture

### 4.1 Quick-add bar

A single persistent text input at the top of every list (Today, Upcoming, Anytime, and each application/essay page). Placeholder: `Add a task… e.g. "Berkeley CSS Profile fri"`. Keyboard: `n` focuses it from anywhere; `Esc` blurs and clears.

Enter creates the task in one round trip and returns focus to the input, ready for the next. There is no sheet, no ghost row, no "Untitled task".

### 4.2 Inline parsing

As the user types, recognised tokens are highlighted in-place (Todoist style). Clicking a highlighted token un-parses it (so "monthly report" keeps its word).

| Token | Sets | Examples |
|---|---|---|
| Relative day | `when` | `today`, `tomorrow`, `tmr`, `fri`, `next mon`, `this weekend`, `in 3 days` |
| Absolute day | `when` | `sep 12`, `12 sep`, `9/12`, `2026-09-12` |
| `by <date>` / `due <date>` | `deadline` | `by nov 1`, `due jan 1` |
| `!` or `!!` | `flagged` | trailing `!` |
| `@<school>` | `application_id` | `@mit`, `@berkeley` — fuzzy against the student's applications |
| `#<essay>` | `essay_id` | `#supplement`, `#why-mit` — fuzzy against essays of the matched/only school |

Parsing runs client-side against a small deterministic grammar (chrono-node or equivalent for dates; a 20-line matcher for the rest). The agent is not in the capture path — capture must work offline and in <50 ms.

Context defaults: quick-add on an application page pre-sets `application_id`; on an essay page pre-sets `essay_id`. In Today, an undated task defaults `when = today`. In Upcoming and Anytime it defaults to null.

### 4.3 Waiting hint

If the title starts with or contains `waiting on`, `waiting for`, `wait for`, and no date was parsed, the input shows a one-line inline prompt: *"When should you check on this?"* with the scheduler chips (§5). Skipping leaves it in Anytime. This is the entire replacement for the waiting lane.

### 4.4 Errors

The only failure mode is the network. On failure the row stays in the list marked pending and retries; the input is not cleared until success. No modal.

## 5. Scheduler popover

One component, used everywhere a date is shown or set: quick-add hint, row date chip, detail panel When/Deadline, agent-proposed dates.

```
┌──────────────────────────┐
│ Today          Tomorrow  │
│ This weekend   Next week │
│ ─────────────────────── │
│ Pick a date…             │
│ Anytime (clear)          │
└──────────────────────────┘
```

- Opened from a row chip it edits `when`. Opened from the Deadline field it edits `deadline` (and "Anytime" reads "No deadline").
- Keyboard: `t` today, `m` tomorrow, `w` weekend, `k` next week, `a` anytime, `p` picker. These also work with a row focused and no popover open.
- Picker is a plain month calendar; no time selection.
- Drag-and-drop is removed entirely. This popover is the only rescheduling mechanism.

## 6. Views

Three lists. All render `TaskRow`. Only grouping and header differ.

### 6.1 Today

- Tasks where `when = today` **or** `when < today` (overdue-by-plan rolls forward visibly, not silently).
- Plus a muted **"Due soon"** section at the bottom: open tasks with `deadline ≤ today + 7` that are *not* already in Today. Each has a "Plan for today" action. This is the Todoist 7-day countdown and Things' Deadlines list, merged into the one place the student looks.
- Manual ordering within Today (single-axis reorder handle, keyboard `⌥↑/↓`). This is the only drag in the app and it is a list reorder, not a status change.
- Header: date, count, and an optional one-line agent nudge if there is one (§8).
- Empty state: "Nothing planned. Pull from Upcoming or ask Counselle to plan your week."

### 6.2 Upcoming

- Tasks with `when > today`, grouped by day for the next 7 days, then by week for the following 3, then by month.
- Tasks with a deadline but no When appear once, in a header-less **"Deadlines without a plan"** group at the top, with a chip that opens the scheduler. This replaces the six-bucket taxonomy with one honest one.
- Empty state: "Nothing scheduled ahead."

### 6.3 Anytime

- Tasks with `when = null`, grouped by derived label (school → essay → unlabelled).
- This is where unscheduled tasks *live*; they are not a problem to be fixed.

### 6.4 Logbook

- Done tasks, newest first, grouped by day. Uncheck to restore. Not in primary nav; reachable from the Today footer ("12 done this week →").

### 6.5 Search

- `⌘K` / `/` opens search over all tasks (open and done). Uses the existing `search_tasks` service. Results render `TaskRow`. This replaces the All-tasks table.

### 6.6 Application and essay pages

Unchanged in structure; their task section becomes a `TaskRow` list with a context-defaulted quick-add bar.

## 7. TaskRow and detail panel

### 7.1 TaskRow (one component, all surfaces)

```
[☐] Title text                           MIT · Essay    Fri  ⚑
```

Left to right: checkbox, title (click to open panel; inline-edit on double-click), derived label, When chip (opens scheduler), deadline chip only when `deadline ≤ 7 days` or overdue (red), flag. Agent-created tasks show a small Counselle glyph after the title, derived from `created_by`.

Density: 36 px rows, no card chrome, no avatars.

### 7.2 Detail panel

Opens as a side panel (desktop) or sheet (mobile). Six rows, in this order:

1. Title (large, editable inline)
2. Notes
3. When (scheduler)
4. Deadline (scheduler; shows inheritance when null)
5. Link (School / Essay — one combined picker; choosing an essay sets both)
6. Flag (toggle in the header, not a row)

Footer, muted, single line: `Created Sep 2 by Counselle · Updated 3h ago`.

Nothing else. If a future field can't justify displacing one of these six, it doesn't ship.

## 8. Agent integration

### 8.1 "Plan with agent" is turned on

The button on each list header opens the composer with a hidden context block: the current view name, the visible tasks (id, title, when, deadline, label), today's date, and upcoming application deadlines. Default prompt text by view:

- Today: *"Help me plan today."*
- Upcoming: *"Look at my next two weeks and tell me what's unrealistic."*
- Anytime: *"Which of these should I schedule, and when?"*

`create_tasks` and `update_task` are already registered; no backend change is required to ship this. Agent-created and -updated tasks are actor-attributed on the change row (existing behaviour).

### 8.2 "Needs input" without a field

When the agent cannot complete a task it created (e.g. it needs a document from the student), it asks in the composer thread and, optionally, creates a task titled with the question and `when = today`. The question is the task; the student answers by doing or replying. No state to maintain.

### 8.3 Agent-proposed changes

Agent edits to dates render in the list with a subtle "changed by Counselle" chip for 24 h (derived from the change row). No approval workflow; undo is the approval workflow.

## 9. Keyboard map

| Key | Action |
|---|---|
| `n` | Focus quick-add |
| `↑ ↓` | Move row focus |
| `space` / `e` | Complete / open focused task |
| `t m w k a p` | Reschedule focused task (see §5) |
| `f` | Toggle flag |
| `⌥↑ ⌥↓` | Reorder in Today |
| `1 2 3` | Today / Upcoming / Anytime |
| `⌘K` or `/` | Search |
| `⌘Z` | Undo last completion/reschedule |

## 10. Migration

One-shot, reversible for one release.

| Old | New |
|---|---|
| `status = done` | `done_at = updated_at` |
| `status ∈ {todo, doing}` | `done_at = null` |
| `status = waiting` | `done_at = null`; if `when` is null, set `when = today + 3` and prepend nothing to the title. Log the ids so we can review. |
| `planned_for` | `when` (date part) |
| `due_at` | `deadline` (date part) |
| `reminder_at` | dropped; values logged to a one-off export in case anyone asks |
| `priority = high` | UI flag; column untouched |
| `category` | untouched; UI stops writing it |
| `assignee`, `needs_input` | UI stops reading/writing; columns dropped next release |

Rows titled exactly "Untitled task" with no notes, no links and no dates are deleted in the migration.

## 11. Decisions taken in this draft (flip if you disagree)

1. **`waiting` is removed.** A check-in date is a more truthful representation than a lane: it tells the student *when* to think about it, which is the only thing waiting needs. The quick-add hint (§4.3) preserves the capture ergonomics. Reversal cost: one extra chip in the row and a fourth list; still no board.
2. **`category` picker is removed; label is derived.** A task linked to an essay is an essay task. The only case this loses is a task that is categorical but unlinked (e.g. "Ask counselor about fee waivers"), which now shows no label and lives in Anytime → Unlabelled. Acceptable for a 40-task list. Reversal cost: a free-text label field on the row and panel (row 7), not a re-instated enum.
3. **Deadline is date-only.** School deadlines are date-and-timezone facts that belong on the application, not per-task times.
4. **No third date, ever.** If reminders ship, they are a bell icon on When/Deadline.

## 12. Deletions

Remove outright: `TaskBoard`, `TaskColumn`, `AllTasksTable`, `useTaskDrag`, `useTaskSelection`, `useIsResizing`, the six-bucket logic in `task-filters.ts`, lane copy strings, the `assignee`/`needs_input` selects, `reminder_at` plumbing end to end, the "coming soon" tooltip and D2 comment in `task-actions.tsx`.

Expected: ~5,500 lines → ~1,400. Three fields off the UI, one off the database's promises.

## 13. Acceptance criteria

- New task from an empty list: ≤ 1 interaction after typing (Enter). No row exists until Enter.
- `Berkeley CSS Profile fri` → task titled "Berkeley CSS Profile", `when` = next Friday, `application_id` = Berkeley (via context or `@berkeley`).
- Complete: one click; undo available for 5 s.
- Reschedule from any surface: ≤ 2 clicks (chip, choice).
- Detail panel renders exactly 6 editable rows + 1 footer line.
- Every list, application page and essay page renders `TaskRow`; no other task row component exists in the bundle.
- "Plan with agent" opens the composer with view context; no disabled state remains.
- No code path writes `reminder_at`, `assignee`, or `needs_input`.
- Zero tasks titled "Untitled task" can be created through any UI path.

## 14. Out of scope for this pass

Recurring tasks, subtasks, time-of-day scheduling, calendar integration, push/email reminders, free-text labels, multi-select bulk actions, collaborative/shared tasks.

## Sources consulted

- Cultured Code, *Scheduling To-Dos in Things* — culturedcode.com/things/support/articles/2803579/
- Todoist, *Introduction to deadlines* and *Add deadlines to tasks (Jan 7, 2025)* — todoist.com/help
- Todoist, *Introduction to dates and time* (Quick Add parsing) — todoist.com/help/articles/introduction-to-dates-and-time-q7VobO
- Todoist, *Does Todoist support start dates?* — todoist.com/help/articles/does-todoist-support-start-dates-qhqlgZhk
- Sunsama, *Daily Planning* user manual — help.sunsama.com/docs/usage-guides/daily-planning/
- The Sweet Setup, *Simple Guide to Managing Tasks in Things*; Finer Things in Tech, *Things 3 after 5 months*
