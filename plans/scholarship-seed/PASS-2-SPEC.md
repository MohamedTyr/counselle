# Pass 2: every row ends as a publishable record

Read `RESEARCH-SPEC.md` first; every rule there still holds (official sources only, never
invent a fact, non-USD → `varies`, never project a future date). This pass changes one
thing: **no skips**. The owner wants all 122 named rows of `list.md` in the app. Each row
you are given must come back as `"outcome": "record"` that passes:

```bash
cd /home/saifuddin/Projects/counselle-scholarships-impl && uv run python plans/scholarship-seed/validate.py --publishable plans/scholarship-seed/<your-file>.json
```

Publishable means: name + sponsor, an http(s) `apply_url` and `source_url`, an award
(`varies` is fine), a deadline that is either a date or `rolling`, and
`last_checked_on: "2026-10-02"` — which you may set **only after reading the facts on the
official page yourself**.

The pass-1 attempt for each row (record or skip, with notes) is in
`plans/scholarship-seed/scholarships.json` — start from it. For a row that already has a
record, **keep `name` exactly as it is** (it is the match key in the database) and return
the full corrected record.

## Sites that block WebFetch (403/412/404 to fetchers)

Use a real browser. Either the Playwright MCP tools (`mcp__plugin_playwright_playwright__*`,
load via ToolSearch) or a Node script run from
`/home/saifuddin/Projects/counselle-scholarships-impl/frontend` (it has `@playwright/test`;
`import { chromium } from "@playwright/test"`, put the script in that folder as
`.scrape-<yourname>.mjs` and delete it when done). A page you read in a real browser is
read; search-result snippets are still not.

## Deadlines that "vary"

- Find the real date first: e.g. a Cambridge/Oxford scholarship tied to the course's
  funding deadline (use the university's published general funding deadline for 2027
  entry), a university aid award tied to the university's admission/aid deadline for the
  2027 entry cycle, a program that reopens each year with a published window.
- If the official source states one recurring date with no year, the next occurrence
  on or after 2026-10-02 is acceptable (say so in `notes`).
- If the last cycle closed and the new date is not out, use the last cycle's stated
  deadline (past date) with `recurs_annually: true`.
- Only if there is genuinely no single deadline (every partner/course sets its own and
  none is general) use `"kind": "rolling"` **and** make the `summary` say
  "Deadlines vary by <course/partner/award>." so the student is not told "apply anytime"
  unqualified.

## Umbrella programs and directories (DAAD, UNCF, Stamps Scholars, Scholars4Dev, Peterson's)

Record the row as what it is, honestly:

- An organization that runs many awards (DAAD, UNCF, Stamps Scholars network): one record
  named for the program (e.g. "DAAD Scholarships", "UNCF Scholarships", "Stamps
  Scholarship"), `summary` saying it is a set of awards and how to find the one that fits
  (e.g. "UNCF runs hundreds of scholarships for students at its member colleges; each has
  its own rules and deadline."), award `varies`, `apply_url` = the program's
  search/apply page, deadline per the rules above (usually rolling + "Deadlines vary by
  award.").
- A scholarship search site (Scholars4Dev, Peterson's): if it runs its **own** award, record
  that award. If it doesn't, record it as a directory: name e.g. "Scholars4Dev scholarship
  listings", summary "A free directory of international scholarships for students from
  developing countries; it does not award money itself.", award `varies`, deadline rolling.

## Paused or discontinued programs

If the sponsor's own page says it is paused/discontinued, record it with its last stated
deadline (past) and `recurs_annually: false`, and start the summary with
"Paused by the sponsor." If you cannot reach any official page at all, even in a browser,
say so in `notes` and still return the best record you can, with `last_checked_on: null` —
the reviewer will decide; do not invent facts to make it publishable.

## Output

Same entry format as pass 1, one entry per row given to you, in row order, written to the
file name you are told. Reply with 3–6 lines: which rows are publishable, which are not
and why.
