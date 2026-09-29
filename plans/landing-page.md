# Landing page — content and layout spec

**Status:** draft for owner review, 2026-09-16
**Scope:** what the page says, in what order, and why each block is there. No visual design yet (palette, type, and motion values come later under `DESIGN.md`).
**Inputs:** live read of kollegio.ai and borderless.so (2026-09-16), the feature set of this repo including what is in flight, and the current `frontend/src/features/landing/`.
**Assumption, locked by the owner:** the page describes the product as it will be when the page ships. Goal mode, deep research, and the competitor-parity features in §2 are written in the present tense.

The page has one job: a student lands, understands in five seconds that this counselor will either guide them or do the work for them, sees it happen, and signs in with Google.

---

## 1. Competitor teardown

### Kollegio (kollegio.ai)

Structure, top to bottom: trust line ("~300K+ students & families") → H1 "Your one-stop solution for all things college apps" → four-verb subhead → single CTA → marquee of feature names (Direct Admissions, Plan Applications, Review Essays, Scholarship Finder, Activity Feedback) → three feature blocks with video (matching, scholarships, essays) → "dozens of other tools" → college quiz CTA → four testimonials → blog/aid links → price anchor ("Pay nothing and get the services of a $10,000 college coach") → FAQ (trouble? writes essays? free? data safe?) → footer.

What works:
- The **price anchor**. "$10,000 coach, free" is the single strongest line on the page.
- The FAQ handles the four real objections a student has, by name.
- The trust line sits above the H1, read before the promise.
- One CTA, repeated, same label.

What fails:
- The H1 is a category description, not a promise. "One-stop solution" is what every SaaS says.
- Nothing above the fold shows the product. The first thing after the CTA is a rotating list of nouns.
- Three audiences in the nav (students, colleges, educators) dilute the student pitch.
- Features are named as tools, not as outcomes for the reader.

### Borderless (borderless.so)

Structure: pill nav (Stories, Pricing, Acceptances, Get started) → H1 "Every university in the world, now within reach" → subhead that names the villain ("reserved for the lucky few who had a college counselor. Not anymore.") and names the agent ("Kai") → CTA "Get started with Kai" → university logo marquee → four stat counters → acceptance-story carousel (name, country flag, school, "full ride") → H2 "Not a chatbot. A counselor that plans, guides, reviews, and follows up until you hit submit" → five real product panels (college list with Reach/Match/Likely, deadline table, WhatsApp nudge bubbles, essay with tracked edits and review notes, weekly task board) → full workspace screenshot with a WhatsApp thread beside it → six-step "It starts with you. It ends with an acceptance" → WhatsApp section → "But is it just ChatGPT?" two-column comparison → team with flags and schools → founder note "We were the students Borderless is built for" → three "they thought it was impossible" quotes → closing CTA "Join 11,000+ students" → second logo marquee → footer.

What works, and this is the stronger page by a wide margin:
- The H1 is emotional and specific. The subhead **names the villain** (counselor access) and **names the agent**.
- "Not a chatbot" as a headline. It pre-empts the number one objection, then proves it with **real UI**, not icons.
- Every feature panel is a screenshot of the product doing a concrete thing for a named student.
- The **ChatGPT comparison table**. Six rows, each a thing a student has already felt ChatGPT fail at.
- Social proof is stories with a person, a country, a school, and money. Not star ratings.
- The founder note gives permission to trust: "we were you".
- The closing CTA repeats the opening promise.

What fails:
- The fold is text plus a logo strip. The product does not appear until scroll three.
- The stories carousel comes before the product, so a skeptical reader hits testimonials before knowing what the thing is.
- Long. Two logo marquees, two testimonial sections, a team section. Past the comparison table it repeats itself.
- The six-step section restates the five-panel section.
- "Does the heavy lifting" is one bullet. The page then shows a chat app. It promises autonomy and demonstrates none.

### What both leave open

Neither page shows the AI **working**. Neither lets you **try it before signing up**. Neither says **where the answers come from** or what happens when the AI **does not know**. And neither offers the thing a stressed student actually wants at 1am: **"just do it for me."** Those four gaps are the spine of the page below.

---

## 2. What the page sells

Every claim on the page maps to a row here.

### Guide me: the counselor

| Feature | Evidence in repo |
|---|---|
| Ask anything about any of ~2,700 profiled US schools | `counselle_db/`, ADR 0038 |
| Answers from a daily-refreshed structured facts store (admissions, cost, aid, academics, student life, outcomes) plus IPEDS identity | `adapters/collegedata/`, `app/facts/` |
| Every number cited; click through to the source | ADR 0006, `CitationRenderer`, `SourcesRail` |
| Says when a fact is missing instead of guessing; falls back to official web with disclosure | `docs/DATABASE_GUIDE.md` |
| Shows its work live: thinking, steps, tool calls, searches | `specs/agent-mode/`, `AgentRunView` |
| Web, .edu, and Reddit search | ADR 0015 |
| Deep research: multi-source, multi-step reports on a school, a major, a decision | `specs/deep-research/` |
| Asks a clarifying question when it needs one | `specs/clarifying-questions/` |
| Charts and cards inline | `VizBlock` |
| Response modes: quick think, focused answer, guided counselor, deep research | `specs/counseling-response-modes/` |
| Skills: school list, comparison, deep dive, chancing, costs and aid, application rounds, testing strategy, major and fit | `skills/` |
| Essay coaching from three books: brainstorm, draft, revise, fit | `skills/essay-*` |
| Activity and honors feedback; brag sheet and recommender prep | activities workspace + skill |
| Remembers you: profile, documents, curated memory | ADR 0031 |
| Three-minute onboarding that seeds the profile | `specs/user-onboarding/` |
| Slash commands and a skill picker in the composer | `specs/agent-skill-picker/`, `specs/slash-command` |

### Handle it: the agent

| Feature | Evidence in repo |
|---|---|
| Goal mode: `/goal` + an outcome. It plans in the open, uses every tool, and an independent judge checks frozen criteria against tool receipts, not the agent's own claims. Runs until met or budget. Ends in one honest state and names, per criterion, what was done, what was not, and what was never checked | `plans/goal-mode-plan.md`, branch `feat/goal-mode` |
| Writes into the workspace: adds schools, creates tasks, drafts essays, proposes edits. Every write shows a receipt and can be undone | `specs/agent-mutation-receipts/` |
| Essay edits land as tracked changes you accept or reject; a first draft into an empty essay is written for you to react to | ADR 0037 |
| Weekly plan: turns every deadline on your list into this week's short list of finishable steps | tasks + goal mode |
| Nudges where you already are: a heads-up before a deadline or an edit you still owe | email adapter today, messaging channel to add |
| Scholarship finder matched to your profile and list | to build |
| Keeps going between sessions: the list, the essays, the decisions, all remembered | ADR 0031 |

### The workspace

| Feature | Evidence in repo |
|---|---|
| Schools: My list with Reach / Target / Safety, per-application progress | `features/schools/` |
| Explore every profiled school with six always-on filters | `plans/schools-explore-filters.md` |
| Compare: your GPA, SAT, ACT against the admitted class | `features/schools/chances/` |
| Tasks: Today, Upcoming, Anytime, Logbook; When vs Deadline; deadlines inherited from the application | tasks redesign |
| Essays: editor, per-essay AI thread, suggestions bar | ADR 0037 |
| Activities and honors | `features/activities/` |
| Google sign-in, free | fastapi-users |

### What it does not do, and the page says so

Never submits an application. Never writes an essay in its own voice and calls it yours. Never invents a fact about you. US colleges only. These four lines are marketing, not disclaimers: they are what make "leave it running" believable.

---

## 3. Positioning

**The spine: guide me, or handle it.** Counselle is one counselor with two ways in. Ask it anything and it answers like a counselor who shows their work: real admissions data for every US school, every number cited, a plain "I don't have that" when a fact is missing. Or give it a goal with your profile and leave it running: it researches, builds the list, tracks the deadlines, plans the week, drafts the essays, finds the scholarships, and keeps going until an independent check says the goal is met, then reports exactly what it did and did not finish.

**The line it never crosses, said out loud:** *It does the work. You make the calls.* Saying that in the hero is what separates this from every "get you into Harvard" pitch a parent has learned to distrust.

One sentence, the way a competitor could not say it: *Counselle will guide you or do the work for you, from real data, with every step visible and every number cited, and it stops at the decisions that are yours.*

Three words for the voice: **precise, calm, on your side.** Not hype, not cute. A 17-year-old at 1am with a deadline should feel that someone competent is awake with them and already working.

The hook is not "AI". Students have ChatGPT. The hook is the three things ChatGPT cannot give them: **"where do I actually stand"**, **"what do I do next"**, and **"just do it for me"**, with proof on screen.

---

## 4. The page, section by section

Conversion order: hook → see it work → the two modes, proven → kill the objection → who else → close. Nine sections. Borderless has fourteen. Shorter converts better when every section earns its place.

### 4.0 Nav

Left: wordmark. Center: How it works · Schools · Stories. Right: Log in · **Start free**.

- "Schools" links to a public, read-only Explore so a visitor can look up their school before signing up. A real feature acting as marketing, and a search-engine landing surface for "[school] acceptance rate" queries.
- "Stories" ships when there are real ones.
- The primary button becomes sticky (nav compresses) after the hero scrolls off. One label everywhere: **Start free**.
- No audience switcher. Students only.

### 4.1 Hero (the fold)

Left column: copy. Right column, or below on phones: **the product itself, live**.

**H1:**
> Your college counselor.
> Guide me, or just handle it.

**Subhead:**
> Ask anything and get an answer with sources, from real admissions data for 2,700+ US schools. Or give it a goal with your profile and let it run: research, list, deadlines, essays, scholarships, until the work is done. It does the work. You make the calls.

**CTA row:** `Start free with Google` · `Try it first ↓`
**Trust line under CTA:** Free. No card. Sign in takes ten seconds.

Alternates to A/B test, same subhead:
- A: **Know exactly where you stand. Then do exactly what's next.**
- B: **A $10,000 counselor's job. Free. With sources.** (Kollegio's anchor, sharpened.)
- C: **The college counselor that shows its work.**

What the H1 must not be: the current "Your college ambitions. A plan that fits you." Pleasant, and says nothing a competitor could not say.

**The hero product (the biggest conversion lever on the page).**

The right side is a real composer with three prefilled chips. The first two mirror the H1's two modes so the visitor picks their own temperament:

- **Handle it:** `/goal tell me straight where I stand at Harvard, and what would actually move it`
- **Guide me:** "What does Northeastern cost for a family making $90k?"
- "My essay sounds like a list of achievements. How do I make it sound like me?"

The `/goal` chip is the strongest proof on the page. The criteria appear before the first tool call, the plan updates as it works, tool calls and searches stream, and it ends on the closing card with every criterion checked, not on a paragraph. Harvard is the student's ambition, so it stays in the string. The goal itself is one the judge can verify: profile compared to the admitted class, admit rate and cost cited, three concrete actions produced. **Never** "/goal get me into Harvard". That run can only end Partial, it is the line every scam counselor uses, and it breaks the trust the page is built on.

Clicking a chip runs one real turn, right there, unauthenticated. At the end, one soft gate under the answer:

> Save this and keep it working → **Continue with Google**

The question or goal the visitor typed carries into their first session after sign-in, so the app opens on the run they already watched. That continuity is the "aha before the account" neither competitor has.

This needs guest mode, deferred by the MVP2 PRD to a growth phase. This page is the growth phase. Requirements: a tight per-IP rate limit, no workspace writes for guests, a small fixed budget for the guest goal run, and the same honesty surfaces as the app. Cost is bounded by the limit and is the cheapest acquisition this product will ever buy.

Layout: the product is the visual. No illustration, no gradient blob, no hero photo. The composer and the streaming run are the imagery.

### 4.2 Proof strip

One line:

> Answers for 2,700+ US colleges, refreshed daily. Every number linked to where it came from.

Below it, a slow marquee of school names as **query chips** ("Michigan · acceptance rate", "Rice · cost after aid", "Purdue · engineering admit rate"), each clickable into the hero composer. This does the job of Borderless's logo marquee (familiarity, "my school is here") and every chip is a real query the product answers.

No "trusted by N students" line until N is real and worth saying. A padded number is the first thing a teenager checks.

### 4.3 Guide me

H2:
> Guide me. A counselor that shows its work.

Three beats, each a real screenshot with two lines of copy:

1. **You watch it think.** Thinking, steps, and every lookup appear as they happen, the way a good counselor talks through a question out loud.
2. **Every number has a source.** Admit rate, cost after aid, the middle 50% SAT: each comes with a chip you can click. From the school's own data, refreshed daily.
3. **When it doesn't know, it says so.** No fact for that school this year? It tells you, then looks on the school's site with the source shown. It never fills a gap with a guess.

Then one wide panel for **deep research**: a question like "Is Northeastern's co-op actually worth the cost for a CS major?" turning into a multi-source report with a sources rail. Copy: *Big question? It reads the school's site, the data, and what students say, and writes you the report.*

The third beat is the one to protect. No competitor says it because no competitor can.

### 4.4 Handle it

The section neither competitor can write. H2:

> Handle it. Give it the goal. It works until it's done.

**Lead panel, full width: one real goal run.** The goal, the frozen criteria, the plan updating as it works, the tool calls, and the closing card that names per criterion what was done, what was not, and what was never checked. Under it, one line:

> It does the work. You make the calls. It never submits an application, never writes in its own voice, never invents a fact about you.

**Then the workspace the run filled**, six panels in a bento with deliberate size contrast (list and essay large, the rest smaller), each a real screenshot with a title and one sentence:

| Panel | Title | Sentence |
|---|---|---|
| Schools | Build a list you can defend. | Reach, Target, Safety from the school's real admit rate, with the filters that matter: cost after aid, admit rate, size, test policy, graduation rate, location. |
| Compare | See yourself against the admitted class. | Your GPA, SAT, and ACT plotted against who actually got in last year. |
| Essays | It proposes. You decide. | Drafts and edits land as tracked changes in your essay. Accept the ones that sound like you. |
| Tasks and the week | Every deadline becomes this week's list. | Deadlines flow down from each application into Today and Upcoming. It plans the week; you plan the day. |
| Scholarships | Money you'd have missed. | Matched to your profile and your list, with deadlines already on your tasks. |
| Nudges | It follows up. | A heads-up before a deadline or an edit you still owe, where you already are. |

Rule for every panel: a real screenshot from the app with real data, cropped tight to the thing the sentence describes. No mockups drawn for the page. If a screenshot is ugly, fix the app.

### 4.5 How it works

Four steps, numbered because it is a real sequence:

1. **Tell it about you.** Three minutes: grades, tests, budget, what you care about. Skip anything.
2. **Ask, or give it a goal.** Type a question, or `/goal` and the outcome. It asks one question back when it needs to.
3. **It does the work.** Researches, adds the school, drafts the task, proposes the edit, finds the scholarship. Every change shows a receipt.
4. **You make the calls, and it remembers.** Accept, reject, redirect. Next week it knows your list, your essays, and what you decided.

Copy only. The panels above already showed the screens.

### 4.6 "But isn't this just ChatGPT?"

Borderless's table, with a third column students actually weigh: the human counselor. H2 is the question itself.

| | ChatGPT | A private counselor | Counselle |
|---|---|---|---|
| Knows the actual admit rate, cost, and class profile for 2,700+ schools | Guesses from old web text | Knows some schools well | Reads the school's own data, refreshed daily |
| Shows you where a number came from | No | Sometimes | Every number, every time |
| Tells you when it doesn't know | No | Usually | Always, enforced in code |
| Remembers your grades, list, and essays | Forgets when you close the tab | Yes | Yes |
| Edits your essay without writing it for you | Rewrites it in its voice | Yes | Tracked changes you accept or reject |
| Tracks deadlines, plans your week, finds scholarships | No | Sometimes | Yes |
| Runs until the goal is met, then reports what it did and didn't finish | No | No | Yes |
| Follows up before something slips | No | If you're lucky | Yes |
| Available at 1am | Yes | No | Yes |
| Cost | $20/month | $3,000 to $10,000 | Free |

Every cell must be true on the day the page ships.

### 4.7 Who built this

A founder note in the Borderless register, short, first person, true. Permission to trust, not biography. Four sentences maximum, ending on the line that becomes the closing CTA.

Stories and testimonials: **real people only.** When they exist, use Borderless's format (name, school, one concrete sentence, the money if there was money) and place them here, after the product, not before it. A founding-cohort program (free forever for the first N students who share their outcome) is how the first stories get made.

### 4.8 FAQ

Six questions, each answering an objection in two sentences:

- **Will it write my essay for me?** It brainstorms with you, drafts when you ask, and every edit lands as a tracked change. You accept what sounds like you; nothing goes in without you.
- **Will it apply for me?** No. It does everything up to the submit button. That one is yours.
- **Where do the numbers come from?** The school's own published data and federal IPEDS records, refreshed daily. Every number links to its source.
- **What if it doesn't have a fact?** It tells you, and looks on the school's official site with the source shown. It never fills a gap with a guess.
- **Is it free?** Yes.
- **Is my data safe?** Your profile and essays are yours, scoped to your account, never used to train anything. (Verify wording against the privacy policy before shipping.)
- **Does it cover schools outside the US?** Not yet. Today it covers 2,700+ US colleges.

The last answer is deliberate. Borderless's whole audience is international. "Not yet" costs nothing with US students and saves a bad first session with everyone else.

### 4.9 Close

The H1 promise, restated, over the same CTA:

> Guide me, or just handle it.
> **Start free with Google**
> Free. No card. Ten seconds.

Footer: Product (How it works, Schools), Company (About, Privacy, Terms), one support email.

---

## 5. Conversion mechanics

- **One CTA label** on the whole page: `Start free with Google`. Google one-tap where the browser allows it. No email-and-password form on the landing page.
- **Try before account** (§4.1). The visitor gets a real answer or a real goal run first. Sign-in is framed as "save this and keep it working", not "get access".
- **First-turn continuity.** The hero question or goal follows the student into the app. The first screen after sign-in is the run they already watched, plus what it proposed.
- **Sticky CTA** in the nav once the hero CTA scrolls out.
- **Real urgency only.** The season table in `config/assets/` knows the cycle. One line near the close, "Early Decision deadlines: 46 days", computed from it. Countdown timers and "spots left" are not.
- **Phone first.** Teenagers arrive from a link in a group chat. The hero must work at 390px: H1, subhead, one button, then the product. Chips wrap; the run streams full width.
- **No pricing page.** It is free. A pricing link invites a question the page should not raise.
- **Speed.** The hero product is the heaviest thing on the page and must render its shell before any script.
- **Measure four things:** chip clicks in the hero, runs that reach `done`, sign-ins within five minutes of a run, first-session turns after sign-in. Tune on those, not on scroll depth.

---

## 6. Layout and motion, briefly

Detail waits for the design pass. The constraints that shape the content:

- Single-purpose viewports. One idea per fold, long scroll, deliberate pacing. The hero is copy plus product, nothing else.
- Screenshots are the imagery. No illustration set, no hero photo, no icon-above-heading grids.
- The bento in §4.4 uses real size contrast. Six equal cards is the template look both competitors fall into.
- One orchestrated reveal on the hero (copy, then the composer, then the first chip auto-runs). Product panels reveal on scroll once, subtly. Everything under `prefers-reduced-motion` becomes a crossfade.
- Reveal never gates visibility. Every section renders in full without JavaScript.
- Type and palette follow `DESIGN.md`. The landing page is a brand surface, so the color strategy may be more committed than the app, but it is the same family.

---

## 7. Truth rules for this page

These make the page different, and they are about facts, not features.

1. No number that is not true. No padded user counts, no "trusted by".
2. No testimonial that is not a real person who agreed to be quoted.
3. Every screenshot is the real app with real data.
4. Every cell of the comparison table is true on launch day.
5. "US colleges" is stated, not implied away.

---

## 8. What to keep from the current landing page

`frontend/src/features/landing/` has one good bone: `PlanDemo.tsx` replays a question into a plan with tasks you can tick. Its shape (question → plan → steps) is the phone-width variant of the hero product. Keep the skip link and the nav shape. Replace the H1 and subhead, and add every section from §4.2 onward, which today do not exist.

---

## 9. Decisions for the owner

1. **Guest mode for the hero demo.** Per-IP limit, no guest workspace writes, small fixed budget for the guest goal run.
2. **Public read-only Explore** as the "Schools" nav item.
3. **Founding-cohort program** to generate the first real stories.
4. **The H1.** Recommended in §4.1; three alternates to test.
5. **The nudge channel.** Borderless uses WhatsApp. Email is wired today; pick SMS, WhatsApp, or both so §4.4's nudge panel names it.
