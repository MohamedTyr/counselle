---
name: school-deep-dive
description: Procedure for building a cited, in-depth look at one school from the database — resolve, check its facts status, read only the profile plus the 2-3 sections the question actually needs, and compose. Handles the no-facts fallback via the school's own official links. Use when a student asks about a single school in depth.
user_invokable: true
display_name: School deep dive
user_description: Build a cited, in-depth look at one school.
---

# School Deep Dive

## When to use this skill

A student asks about one school in some depth — "tell me about Duke", "what's
MIT like", "give me a full breakdown of UCLA." Also use it to build one
school's side of a multi-school comparison before handing off to
`school-comparison`.

There is no `get_dossier` tool and no fixed shortlist of sections to fill in.
This skill is the procedure that replaces it: resolve, see what's actually
there, read only what the question needs, then compose.

Use `counselor-research` for source routing and discovery breadth; this playbook
handles one-school judgment and composition.

## Step 1 — Resolve

Call `resolve_school(query)` and branch on `status`:

- **`not_found`** — stop. Tell the student the school isn't in the database.
  Do not fabricate data or fall back to general knowledge as if it were
  sourced.
- **`candidates`** — multiple campuses matched. Use the most likely campus
  (main campus first) only when responsible, state the assumption, and
  continue. If no responsible default exists, explain the ambiguity and avoid
  school-specific facts until the student clarifies.
- **`match`** — proceed with the returned `school` and `data` (facts status).

## Step 2 — Read the facts status, not a coverage tier

`resolve_school`'s `data` tells you, for *this* school, right now: whether it
has any CollegeData facts at all (`has_collegedata`), when they were last
confirmed (`facts_updated_at`), and each page's own fetch status (`tabs`:
`ok`/`not_found`/`not_fetched`/`never_fetched`). There is no per-domain
packet or edition any more, and no memorized list of "usable" sections — a
tab's status only says whether that page loaded, not whether any one fact is
present. Call `get_facts` and read its `unavailable` list for the real
per-key state (`not_reported`, `not_fetched`, `not_published`,
`not_collected`).

If `has_collegedata` is false, this school has no CollegeData crawl at all —
say so plainly and move straight to the no-facts fallback (below) rather than
calling `get_facts` expecting rows.

When a stated value hasn't been re-confirmed recently, the answer carries the
`stale_facts` caveat with the date it was last checked — never imply a fresher
check than the data actually has.

## Step 3 — Fetch only what the question needs

Call `get_school_profile(unitid, groups?)` for identity, location, contact,
classification, and official links — always cheap, always available, always
carries the `profile_snapshot` caveat (see `citation-and-recency`).

Then call `get_facts(unitid, sections=[...])` for **at most the 2-3 sections
the question actually calls for** — never every section, and never a fixed
shortlist memorized from a prior conversation. Section ids are fixed and
data-derived from `facts_sections.yaml`: `getting-in`, `money`, `academics`,
`campus-life`, `outcomes`, `applying` — each already includes its own `other`
group of facts that don't fit its named groups. If the student's question
spans more sections than that, read the ones that answer it now and be
honest that the rest wasn't pulled — don't over-fetch "just in case."

Pull the `fact_key`s straight from the `get_facts` rows and `unavailable`
entries you were handed; never guess or reconstruct a key from memory.

## Step 4 — Compose

Lead with what's most decision-relevant to the question asked, not a fixed
section order. Use compact headings and cited bullets. Cite every value with
its marker immediately after the fact (see `citation-and-recency` for
phrasing). Keep the answer honest about depth: if the facts store is thin for
this school, say what isn't available and why (its real absence state)
instead of padding around the gap.

## The no-facts fallback

When `has_collegedata` is false, or the section(s) the question needs return
nothing but `unavailable` entries, the profile's `official_links` group is
your fallback path, not a dead end: `homepage`, `admissions`, `application`,
`financial_aid`, and the **net-price calculator** link all feed
`search_school_site` targets. For example, if a student asks about net price
and there's no facts-store cost data, use the profile's net-price-calculator
URL to target the site search rather than searching the open web blind.
Disclose that you're falling back to the school's own site because
first-party facts aren't available for that question — never present a
profile identity fact as if it were the current metric the student asked for.

For a current official-web number, retrieval date proves nothing: require `source_currentness: current` plus page/metadata `source_period_evidence`. Retry an `undated` or `historical` result with a year-specific official query; if none survives, say the current value could not be verified. Missing is not zero.

## Optional v2 card

When the answer has 4+ comparable numeric facts worth a stat block, call
`render_viz(type="stat_block", …)` using only verified channels: `fact_key`s,
profile fields, or markers already registered this turn (see
`citation-and-recency`). Never assemble a card from numbers you merely recall
from earlier in your own prose — route them back through a ref or a marker.

## Handling rejected cells

If `render_viz` returns `ok: false` with `rejected_cells`, the reference or
marker was wrong — fix the specific cell (a typo'd fact key, a marker that
wasn't actually registered) and retry. A rejection is never license to render
that fact as `unavailable`; "unavailable" is your honest declaration that the
data doesn't exist, and a rejection means something else entirely — the
pointer was wrong, not the data missing. Diagnose and correct it.

## Final answer shape

1. State the decision outcome for this school first.
2. Provide 2–4 reasons that actually drive it.
3. Separate official facts from community observations.
4. Include the main limitation only if it could change action.
5. End with one concrete next step.
