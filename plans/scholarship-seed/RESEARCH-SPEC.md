# Scholarship research spec (for subagents)

Today is **2026-10-02**. You research a batch of rows from `list.md` and write one JSON
file. Students (mostly US high-schoolers, some international) read these records and make
real decisions from them, so **never invent a fact**. If the official source doesn't say
it, leave the field at its "unknown" value. A blank is honest; a guess is a lie.

## Sources

- Use WebSearch and WebFetch. Find the sponsor's **own official page** for every row
  (for "kollegio" rows the owner gave no link — search for it). Aggregators (Kollegio,
  scholarships.com, Fastweb, Bold.org, etc.) may help you *find* the official page but are
  never the source of a fact.
- `source_url` = the official page you actually read the facts from.
- `apply_url` = the official page where a student starts the application (often the same
  page, or the sponsor's portal). Never an aggregator.
- If a page fails to load, try a search result snippet only to locate another official
  page — not as a fact source.

## Output

Write `plans/scholarship-seed/batch-<N>.json` (N given to you) in the worktree
`/home/saifuddin/Projects/counselle-scholarships-impl`. It is a JSON array with one object
per row in your batch, in row order, each shaped like:

```json
{
  "row": 8,
  "outcome": "record",          // "record" | "skip"
  "skip_reason": null,           // for "skip": why (not a scholarship, discontinued, can't find an official page...)
  "notes": "free text for the reviewer: what was uncertain, which cycle the dates are from",
  "record": { ...ScholarshipDraft fields below... }   // null for "skip"
}
```

Use `"skip"` when: the row is a website/directory rather than one award (e.g. a scholarship
search site — but if that site runs its **own** named scholarship, record that one instead
and name it properly); the program is discontinued; or no official page can be found.
One row may become **several** records only when the row name itself names several
distinct awards (e.g. "UBC International Leader of Tomorrow / Karen McKellin Award") —
then output one object per award, all with the same `row`.

## The record (validated by pydantic; extra keys are rejected)

```json
{
  "name": "Coca-Cola Scholars Program",          // ≤200 chars, the official name
  "sponsor": "Coca-Cola Scholars Foundation",    // ≤200, the organization
  "summary": "…",                                // ≤200 chars, ONE plain sentence on who it's for / what it is. No hype.
  "apply_url": "https://…",
  "source_url": "https://…",
  "logo_url": "",                                // always "" (the app uses the site icon)
  "award": {
    "kind": "fixed",          // fixed | range | varies | full_tuition | full_ride
    "amount": 20000,          // whole USD, only for fixed. Convert foreign currency? NO — see below.
    "min": null, "max": null, // only for range, whole USD
    "renewable": false,
    "years": null,            // only when renewable: total years incl. the first (1–8)
    "awards_count": 150       // how many per cycle, null if not stated
  },
  "deadline": {
    "kind": "fixed",          // fixed | rolling
    "date": "2026-10-31",     // YYYY-MM-DD, the application deadline of the CURRENT/next cycle
    "opens_on": "2026-08-01", // or null
    "recurs_annually": true
  },
  "basis": ["merit"],         // subset of ["merit","need"]; [] for a drawing/contest
  "fields": [],               // fields of study it's restricted to; [] = any field
  "eligibility": [ … ],       // structured rules, at most one per kind, max 7
  "other_eligibility": [ … ], // ≤10 short lines (≤300 chars) for every rule that isn't structured
  "requirements": {
    "essays": [{"prompt": "…", "words": 500}],   // prompt ≤1000 chars, words null if no limit given
    "recommendations": 2,
    "transcript": true,
    "financial_documents": false,
    "interview": true
  },
  "last_checked_on": "2026-10-02"   // today, ONLY if you read the facts on the official page; else null
}
```

### Award rules

- Money is whole **US dollars**. For a non-USD award (GBP, EUR, CAD, JPY…) do **not**
  convert: use `"kind": "varies"` (or `full_tuition` / `full_ride` if it truly covers that)
  and put the original-currency figure in `notes` and, if helpful, in `summary`.
- `full_ride` = tuition + living costs (cost of attendance). `full_tuition` = tuition only.
- `range` when the sponsor gives a span ("$1,000–$5,000"). `varies` when it doesn't say.
- Renewable: e.g. "$5,000 per year for 4 years" → fixed, amount 5000, renewable true, years 4.

### Deadline rules

- Use the deadline for the cycle a student could apply to **now or next** (2026–27 cycle,
  or 2027 entry). If that date is published, use it.
- If the new cycle's date isn't published yet, use the **most recent past** deadline that
  the official page states, with `recurs_annually: true` — the app shows it as "Closed ·
  reopens yearly". Say in `notes` which cycle it is. **Never project a future date.**
- If several deadlines exist (e.g. by country/round), use the earliest general one and list
  the rest in `notes`.
- No deadline at all (rolling / open year-round) → `"kind": "rolling"`, `date: null`.
- If you genuinely can't find any date → `"kind": "fixed", "date": null` and say so in notes.

### Eligibility rules (structured — the app matches them against the student profile)

Only these kinds exist:

- `{"kind": "citizenship", "any_of": [...]}` — values: `us_citizen`, `permanent_resident`, `daca`, `international`. (`international` = non-US citizens studying in/applying to the US or abroad. For a program only for non-US nationals, use `["international"]`.)
- `{"kind": "state", "any_of": ["CO","WY"]}` — USPS codes, US state residency only.
- `{"kind": "grade", "any_of": ["11","12"]}` — US high-school grades 9–12 only. Do NOT use for college/graduate students.
- `{"kind": "gpa_min", "value": 3.0}` — on a 4.0 scale only.
- `{"kind": "first_gen"}` — must be first-generation college.
- `{"kind": "financial_need"}` — must demonstrate financial need.
- `{"kind": "major", "any_of": ["Nursing", ...]}` — intended field of study (≤100 chars each).

Everything else goes as plain lines in `other_eligibility`, e.g. "Graduate students only",
"Enrolled undergraduates at a community college", "Citizens of Commonwealth countries",
"Must be admitted to the University of Notre Dame", "Enrolled member of a federally
recognized tribe", "Women", "Under 25 at the deadline", "Members of the Oncology Nursing
Society". **Every program not aimed at high-school seniors must say who it IS for here**
(e.g. "Graduate students", "Practicing nurses"), so a student is never misled.
Ethnicity, gender, religion, membership, age, degree level, country → always
`other_eligibility`, never a structured rule.

Don't add a rule the source doesn't state.

### Requirements

Only what the official page states. Essay prompts verbatim when short; otherwise a faithful
condensed version. Unknown → defaults (no essays, 0, false).

## Before you finish

Validate your file:

```bash
cd /home/saifuddin/Projects/counselle-scholarships-impl && uv run python plans/scholarship-seed/validate.py plans/scholarship-seed/batch-<N>.json
```

Fix every error it reports and re-run until it prints OK. Then reply with a 3–6 line
summary: rows recorded, rows skipped (and why), and anything the reviewer must look at.
