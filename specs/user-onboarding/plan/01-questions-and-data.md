# Questions, data mappings, and save semantics

[Back to plan overview](README.md)

## 9. Exact questions, copy, controls, and Profile mappings

All copy below is final unless browser testing reveals a concrete comprehension problem.

### Shared header copy

- Brand: `Counselle`
- Global exit: `Do this later`
- Progress: `Step {n} of 5`
- Autosave status before a step save: no label
- Save status: `Saving…`, then `Saved`
- Primary action, steps 1–4: `Continue`
- Primary action, step 5: `Finish setup`
- Back action: `Back`

### Step 1 — Basics

**Progress:** Step 1 of 5  
**Heading:** `Let’s make Counselle yours`  
**Description:** `A few details make every answer more useful. This takes about 3 minutes, and everything is optional and editable from Profile.`

| Question / label                  | Control and choices                                                                             | Profile path             | Write rule                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `What should Counselle call you?` | Text input. Helper: `This can be different from the name on your account.`                      | `basics.preferred_name`  | Trim. Blank untouched input is omitted. Explicitly clearing a prefilled Profile value sends `null`. The account name may initialize the local draft, but is saved only after Continue. |
| `Where are you in school?`        | Single-choice tiles: `9th grade`, `10th grade`, `11th grade`, `12th grade`, `Gap year`, `Other` | `basics.grade_level`     | Map exactly to `"9"`, `"10"`, `"11"`, `"12"`, `"gap"`, `"other"`.                                                                                                                      |
| `When do you expect to graduate?` | Graduation-year Select. Helper: `An estimate is fine.`                                          | `basics.graduation_year` | Integer 2000–2100. Suggested list is current year through current year + 8, plus any existing out-of-range-within-schema value. Do not infer from grade.                               |

**Right-panel caption before answers:** `Your timeline helps Counselle make advice timely.`  
**After answers:** deterministic sentence such as `Counselle will call you Maya and plan around a 2028 graduation.` Never mention a missing value.

### Step 2 — Academic snapshot

**Progress:** Step 2 of 5  
**Heading:** `Your academic snapshot`  
**Description:** `Add only the headline numbers you know today. The full academic record belongs in Profile or your documents.`

#### Question 1

**Prompt:** `Which GPA would you like Counselle to use as a quick snapshot?`

Single choice:

- `Unweighted` → local selection controls `academics.gpa_unweighted`
- `Weighted` → local selection controls `academics.gpa_weighted`
- `I’m not sure yet` → local skip; no GPA path is written

When Unweighted or Weighted is selected, reveal:

| Label    | Control                                                       | Profile path          | Validation                                                                                            |
| -------- | ------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `GPA`    | Decimal text input with decimal input mode; placeholder `3.8` | Selected GPA path     | Decimal string, `>= 0`. Never parse through binary float.                                             |
| `Out of` | Decimal text input; placeholder `4.0`                         | `academics.gpa_scale` | Decimal string, `> 0`. Required only when GPA is entered. If unweighted, value must not exceed scale. |

Error copy:

- Invalid decimal: `Enter a GPA using numbers, such as 3.8.`
- Missing scale: `Add the scale so Counselle reads this GPA correctly.`
- Invalid scale: `Enter a scale greater than 0.`
- Unweighted GPA above scale: `An unweighted GPA can’t be higher than its scale.`

The local GPA-type choice is not a new Profile field. Only the selected numeric path is written. Never clear the non-selected GPA path.

#### Question 2

**Prompt:** `Do you have a test score you want Counselle to use?`

Multi-select controls:

- `SAT` reveals `SAT total`, writes `testing.sat.total`, integer 400–1600.
- `ACT` reveals `ACT composite`, writes `testing.act.composite`, integer 1–36.
- `None yet` is a local mutually exclusive choice and writes nothing.

Error copy:

- SAT: `Enter an SAT total from 400 to 1600.`
- ACT: `Enter an ACT composite from 1 to 36.`

Do not ask for SAT sections, ACT sections, dates, superscores, PSAT, AP, IB, or English-proficiency testing here.

#### Question 3

**Prompt:** `Are you planning to take or retake either test?`  
**Helper:** `Choose only what you currently expect. Dates are optional.`

Multi-select:

- `SAT` → `{ "test": "SAT", "date": optional ISO date }`
- `ACT` → `{ "test": "ACT", "date": optional ISO date }`

Profile path: `testing.planned_tests`.

Because arrays replace under merge-patch, the builder must preserve existing non-SAT/ACT planned-test entries. It replaces only the SAT and ACT entries owned by onboarding. If the user explicitly removes all existing onboarding-owned entries and no other entries remain, send `null`; an untouched empty selection is omitted.

**Right-panel caption before answers:** `A quick snapshot is enough to begin.`  
**After answers:** `Counselle will keep your 3.8 weighted GPA and planned SAT in mind.` Values render exactly as entered; no rounding or interpretation.

### Step 3 — Academic direction

**Progress:** Step 3 of 5  
**Heading:** `What are you drawn to?`  
**Description:** `A direction helps Counselle evaluate programs without locking you into a decision.`

| Question                                        | Control and choices                                                                                                                          | Profile path                | Write rule                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `What might you want to study?`                 | Accessible tag entry, maximum 3 in onboarding. Placeholder: `Type a major and press Enter`. Helper: `Add up to 3. Broad interests are fine.` | `interests.intended_majors` | Trim, preserve entry order, remove case-insensitive duplicates. Onboarding cap is 3; Profile model remains 10.                                      |
| `How certain do you feel about that direction?` | Single-choice rows: `I’m set` / `I have a direction` / `I’m exploring`                                                                       | `interests.major_certainty` | Map to `locked`, `leaning`, `exploring`. Supporting descriptions: `I’m unlikely to change it.`, `I have a leading idea.`, `I want room to explore.` |
| `Does any specialized path matter to you?`      | Multi-select chips: `Pre-med`, `Pre-law`, `BS/MD`, `Nursing`, `ABET-accredited engineering`, `Other`                                         | `interests.preprofessional` | Map to `pre_med`, `pre_law`, `bs_md`, `nursing`, `engineering_accreditation`, `other`. Empty untouched selection is omitted.                        |

Tag-entry keyboard contract:

- Enter or comma commits a non-empty token.
- Backspace on an empty input selects, then removes, the final tag.
- Each tag has a labelled remove button with a 44px coarse-pointer hit area.
- Duplicate text announces `That major is already added.`
- The fourth entry announces `You can add up to 3 here. Add more later in Profile.`

**Right-panel caption before answers:** `Direction changes which programs and pathways are worth considering.`  
**After answers:** `Counselle will keep your interest in computer science and economics, with pre-law in mind.`

### Step 4 — Context

**Progress:** Step 4 of 5  
**Heading:** `Context that changes the advice`  
**Description:** `Location, citizenship, and cost can change which options are realistic. Share only what you’re comfortable sharing.`

#### Question 1 — residence

**Prompt:** `Where do you live now?`

- `Country` → `background.residence.country`, text input with `autocomplete="country-name"`.
- `State or region` → `background.residence.state`, text input with `autocomplete="address-level1"`; helper `Use a state, province, or region.`

Do not ask for city. Do not infer country or state from IP, timezone, browser locale, or account email.

#### Question 2 — citizenship and visa

- Label: `What is your citizenship status?`
- Text input placeholder: `U.S. citizen, dual citizen, permanent resident…`
- Profile path: `background.citizenship`
- Disclosure control: `Add visa status`
- Revealed label: `Current or expected visa status`
- Revealed helper: `Only if this affects how you’ll apply.`
- Profile path: `background.visa_status`

Visa visibility is user-controlled. Do not infer international status from country or citizenship text.

#### Question 3 — first generation

**Prompt:** `Are you a first-generation college student?`  
**Helper:** `Colleges define this differently. Choose the answer that best matches how you understand your situation.`

- `Yes` → `background.first_gen: true`
- `No` → `background.first_gen: false`
- `Not sure` → omit unless explicitly clearing a prefilled value

#### Question 4 — aid need

**Prompt:** `Will you need financial aid to attend?`

- `Yes` → `aid.need_aid: true`
- `No` → `aid.need_aid: false`
- `Not sure` → omit unless explicitly clearing a prefilled value

If `Yes`, reveal:

- Label: `About how much can your family pay each year?`
- Helper: `An estimate is fine. Leave blank if you don’t know yet.`
- Control: currency input with visible `$` prefix and `USD per year` suffix
- Profile path: `aid.budget_per_year`
- Value: non-negative decimal string
- Error: `Enter a yearly budget of 0 or more.`

If a pre-existing budget exists and the user changes aid need to No, do **not** silently clear the budget. The full Profile remains the place for deliberate cleanup.

#### Question 5 — merit priority

**Prompt:** `Should Counselle prioritize schools that offer merit scholarships?`

- `Yes` → `aid.merit_priority: true`
- `No` → `aid.merit_priority: false`
- `Not sure` → omit unless explicitly clearing a prefilled value

This question remains visible regardless of need-based-aid answer because merit strategy can matter independently.

**Right-panel caption before answers:** `These details help Counselle separate attractive options from realistic ones.`  
**After answers:** a bounded sentence such as `Counselle will consider your U.S. residence, financial-aid need, and merit priority.` Never expose the budget in the decorative caption; it remains visible in the form and completion receipt.

### Step 5 — Fit

**Progress:** Step 5 of 5  
**Heading:** `What feels like a fit?`  
**Description:** `Only choose preferences that genuinely matter. Leaving something blank keeps your options open.`

#### Question 1 — regions

**Prompt:** `Where are you open to studying?`

Suggested multi-select chips:

- `Northeast`
- `Mid-Atlantic`
- `South`
- `Midwest`
- `Southwest`
- `Mountain West`
- `West Coast`
- `Outside the U.S.`

Also provide `Add another region` through the same tag-entry behavior.

`Open anywhere` is a local mutually exclusive option. For a new untouched profile it writes nothing. If the Profile already contains regions and the student explicitly chooses Open anywhere, send `preferences.regions: null` because the student has deliberately removed the constraint.

Profile path: `preferences.regions` as the exact displayed strings, except local Open anywhere.

#### Question 2 — size

**Prompt:** `What school sizes appeal to you?`

Multi-select:

- `Small` → `small`
- `Medium` → `medium`
- `Large` → `large`

Profile path: `preferences.sizes`.

#### Question 3 — setting

**Prompt:** `What settings appeal to you?`

Multi-select:

- `Urban` → `urban`
- `Suburban` → `suburban`
- `College town` → `college_town`
- `Rural` → `rural`

Profile path: `preferences.settings`.

#### Question 4 — must-haves

**Prompt:** `What are your must-haves?`  
**Helper:** `Add up to 3. Examples: strong co-op program, easy access to research, active campus life.`

Accessible tag entry, maximum 3 in onboarding. Profile path: `preferences.must_haves`. The Profile's larger model limit remains unchanged.

#### Question 5 — dealbreakers

**Prompt:** `Any dealbreakers?`  
**Helper:** `Add up to 3. Examples: too far from home, required religious services, very large classes.`

Accessible tag entry, maximum 3 in onboarding. Profile path: `preferences.dealbreakers`.

**Right-panel caption before answers:** `Fit is about the life around the degree, not just a ranking.`  
**After answers:** `Counselle will look for medium or large schools in urban settings and protect your non-negotiables.`

### Completion state

When at least one onboarding value was saved:

- **Heading:** `Counselle has the essentials`
- **Description:** `Your answers are already part of your Profile, and Counselle can use them in every conversation. You can change or add details anytime.`

When the student completed all five screens without saving a value:

- **Heading:** `You’re ready to start`
- **Description:** `Counselle can help without a completed Profile. Add context anytime when you want more tailored answers.`

Show a concise receipt containing only fields actually present:

- `Timeline` — grade and/or graduation year
- `Academic snapshot` — GPA type/value/scale and scores
- `Direction` — majors and specialized paths
- `Context` — residence/citizenship, aid posture, budget if present, merit priority
- `Fit` — regions, sizes, settings, must-haves, dealbreakers

Do not show empty receipt rows, completion scores, interpretations, warnings, or admissions labels.

Actions:

- Primary: `Ask Counselle`
- Secondary link: `Review your full Profile`
- Three deterministic starting-prompt rows, rendered as secondary actions:
  1. when grade/year exists: `What should I focus on next for my application timeline?`; otherwise: `Help me figure out the best place to start.`
  2. major-aware when majors exist, otherwise general: `Help me build a starting school list around what I want to study.`
  3. when aid and budget exist: `Help me find schools where my budget and aid needs are realistic.`; when only aid need exists: `Help me find schools where financial aid could make attendance realistic.`; otherwise: `Help me find schools that match the environment I want.`

Clicking a starting prompt opens `/app/ai` and prefills that exact editable text. It does not submit.

## 10. Profile patch construction rules

This is honesty-critical. Implement it in one pure frontend module and test it directly.

1. Build one minimal patch per completed step.
2. Never spread an entire Profile section into a patch.
3. Omit untouched and skipped fields at every nesting level.
4. Send `null` only when the student explicitly clears a pre-existing saved value.
5. Preserve explicit `false`; never remove it with truthiness filtering.
6. Send GPA and budget decimals as trimmed strings.
7. Send integer scores and graduation year as integers.
8. Trim text and tag values before comparison and save.
9. Deduplicate tags case-insensitively while preserving the first spelling and order.
10. Empty new arrays are omitted. Explicitly cleared pre-existing arrays send `null`.
11. For arrays the onboarding partially owns, merge against the loaded Profile before sending:
    - preserve planned tests other than SAT/ACT;
    - preserve Profile majors beyond the onboarding's first three if they already exist;
    - preserve must-haves/dealbreakers beyond the three currently exposed unless the user deliberately removes them from the full Profile.
12. Never clear weighted GPA when unweighted is selected, or vice versa.
13. Never clear a saved budget merely because aid need becomes false.
14. The server-returned Profile replaces the React Query cached Profile after each save.
15. A Profile 422 response is translated to the nearest field when possible; unknown validation errors appear in the step error region without discarding the draft.

### Hydration and pre-existing data

- Build initial control state from the loaded server Profile before applying a same-user session draft.
- Any conditional control with a saved value opens automatically: saved visa status, GPA, SAT/ACT, planned-test date, or budget must never be hidden.
- If more than three majors, must-haves, or dealbreakers already exist, expose the first three without deleting the rest and show `And {n} more saved in Profile.`
- If both GPA variants already exist, select the first populated variant for editing and show a quiet note that the other remains saved in Profile.
- `None yet` for scores is offered only when no saved SAT/ACT value exists. Existing scores can be edited here but are deliberately cleared only from the full Profile.
- Local `Not sure` selections clear a saved boolean only when the student actively changes a prefilled Yes/No control to Not sure; that explicit action sends `null`.
- Back/forward navigation within the wizard uses the current local draft and must not rehydrate over newer edits.
- A Profile value written in another tab invalidates the query through the existing workspace event path. If the current step is dirty, do not overwrite it; show `Your Profile changed in another tab. Finish this step or reload the saved version.`

### Reference payloads

These examples demonstrate shape only. Real requests include only values the student supplied or explicitly changed.

**Basics**

```json
{
  "basics": {
    "preferred_name": "Maya",
    "grade_level": "11",
    "graduation_year": 2028
  }
}
```

**Academic snapshot**

```json
{
  "academics": {
    "gpa_weighted": "4.31",
    "gpa_scale": "5.0"
  },
  "testing": {
    "sat": { "total": 1450 },
    "planned_tests": [{ "test": "SAT", "date": "2026-10-03" }]
  }
}
```

**Academic direction**

```json
{
  "interests": {
    "intended_majors": ["Computer science", "Economics"],
    "major_certainty": "leaning",
    "preprofessional": ["pre_law"]
  }
}
```

**Context**

```json
{
  "background": {
    "residence": { "country": "United States", "state": "Illinois" },
    "citizenship": "U.S. citizen",
    "first_gen": true
  },
  "aid": {
    "need_aid": true,
    "budget_per_year": "25000",
    "merit_priority": true
  }
}
```

**Fit**

```json
{
  "preferences": {
    "regions": ["Midwest", "Northeast"],
    "sizes": ["medium", "large"],
    "settings": ["urban", "college_town"],
    "must_haves": ["Strong co-op program", "Easy access to research"],
    "dealbreakers": ["Required religious services"]
  }
}
```

**Explicit boolean No and deliberate clear**

```json
{
  "background": { "first_gen": false },
  "preferences": { "regions": null }
}
```

Never send placeholder values, local-only choices such as `None yet` or `Open anywhere`, or `null` merely because a conditional control is hidden.

### Step-save sequence

1. Validate only non-empty fields on the current screen.
2. Focus the first invalid field and announce its error; stop.
3. Build the minimal `ProfilePatch`.
4. If the patch is non-empty, `PATCH /v1/profile`.
5. Wait for the normalized Profile response and update cache.
6. `PATCH /v1/onboarding` with `advance` or `complete`.
7. Clear the step's session draft.
8. Move to the next step or completion state.

If the Profile save succeeds but progress save fails:

- keep the student on the same screen;
- preserve the server-returned Profile;
- show `Your answers were saved, but we couldn’t move to the next step. Try again.`;
- make Retry resend only the progress command, not the Profile patch;
- never ask the student to re-enter answers.
