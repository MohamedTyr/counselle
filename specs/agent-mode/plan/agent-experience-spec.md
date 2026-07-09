# Agent Experience Spec — Claude Code / Codex Parity

Date: 2026-07-08
Branch: feat/mvp3-frontend-prototype
Status: APPROVED target — this is the contract every implementation plan must satisfy
Visual source of truth: [`agent-run-target-ui.html`](./agent-run-target-ui.html)
(open it in a browser: `xdg-open specs/agent-mode/plan/agent-run-target-ui.html`
— the thinking toggles and tool details in it are clickable)

Related documents:
- `agent-mode-architecture-plan.md` — Agent V1 architecture
- `agent-run-surface-design.md` — the chronological-surface design (locked 2026-07-07)
- `plans/agent-interactivity-parity.md` — "the run is the message" implementation plan

This document deliberately specifies the **WHAT**: the exact experience a
student must have when the agent works, in the frontend, in the wire
semantics, and in the agent's own behavior/voice. It does not prescribe file
changes. Any implementation plan (frontend, backend, prompts) is measured
against this spec and the mock, not the other way around.

---

## 1. The thesis

**The run is the message, and it never re-renders.**

While the agent works, the student watches one chronological stream: thinking
(collapsed), talk, tool calls, more thinking, and the answer streaming in as
rendered markdown. When the run finishes, that stream **freezes exactly as it
last appeared**. The only change at completion: the streaming cursor stops,
and a sources strip + action row (copy / thumbs) appear beneath the stream.

This is precisely how Claude Code and Codex behave, and it is the entire
point: the transcript of the work IS the response. There is no "trace" that
gets replaced by an "answer". There is no summary section. Nothing moves,
nothing regroups, nothing restyles at the moment of completion.

The mock shows both frames side by side:

- **Panel 1 — while it's working**: the live stream mid-run, with the
  streaming cursor inside a half-finished markdown bullet.
- **Panel 2 — after it finishes**: byte-for-byte the same beats in the same
  order, plus sources chips and the action row (outlined in the mock as
  "the ONLY thing that gets added").

If a change makes the two panels differ by anything more than
(a) cursor gone, (b) remaining answer text present, (c) sources + actions
appended — the change is wrong.

---

## 2. The experience, second by second

What a student sees for a typical multi-tool question ("MIT vs Pitzer —
prestige and student life?"):

1. **The instant the run starts** a collapsed thinking row appears:
   a chevron and the word **"Thinking"** with a subtle shimmer on the label.
   It is collapsed by default. The student can click it open *while the model
   is still thinking* and watch the thought text stream into the expanded
   area (muted, italic). When that thinking episode ends, the label settles
   to **"Thought"**. The row never disappears — not later in the run, not at
   completion, not on reload.

2. **The agent talks, then acts.** One or two short sentences of normal
   prose appear — working voice, present tense ("I'll check what students
   and the rankings say about how these two compare."). This is **response
   text**: full-color, markdown-rendered, visually identical to the final
   answer prose. It is *not* muted, *not* italic, *not* behind a toggle,
   *not* a special "narration style".

3. **A tool receipt appears** as one compact row in the flow:
   status dot/spinner + a human label + the essential argument
   (`Searching the web: "MIT vs Pitzer prestige rankings student life"`),
   with a one-line receipt underneath (result count, domains) and an
   expandable details area (query, result count, duration). Collapsed by
   default; expanding it is a student choice that persists. Known tools may
   render richer widgets (plan checklist, school cards); unknown tools get
   the generic receipt. Raw tool JSON is never shown.

4. **Think → talk → act repeats** as many times as the run needs, strictly
   in stream order. Each contiguous thinking run is ONE collapsed row (not
   one row per paragraph). Reaction beats between tools are response text
   ("That came back thin — trying the CDS fields instead.").

5. **The answer streams in as rendered markdown** — headings render as
   headings, bullets as bullets, bold as bold, citations as chips — token by
   token with a blinking cursor at the tail. The answer is not a new zone,
   panel, or bubble: it is simply the last beats of the same stream.

6. **Completion is silent.** The cursor stops. Sources chips and the
   copy/feedback action row fade in below. Everything above them is
   untouched: same order, same styles, same toggle states, zero layout
   shift. A student who expanded a thinking row mid-run still sees it
   expanded.

7. **Reload replays the identical stream.** Leaving and reopening the
   session renders the same beats in the same order with the same kinds —
   thinking rows still collapsed-but-present, tool receipts intact, answer
   as markdown. A settled message must be indistinguishable from "you
   watched it live and it just finished".

8. **The composer stays alive during the run.** Sending a message mid-run
   does not cancel the run; it appears inline in the stream as a user bubble
   and is injected at the next loop boundary (per
   `plans/agent-interactivity-parity.md`). Stop suspends: everything already
   shown stays shown, and the next message continues from there.

---

## 3. The beat taxonomy — exactly two kinds of model text

Everything the model emits lands in the stream as one of these beats:

| Beat | What it is | Rendering contract |
|---|---|---|
| **Thinking** | The model's native reasoning trace (provider thought output, verbatim) | Collapsed row with chevron; label "Thinking" (live, shimmer) / "Thought" (settled); expanded body is muted + italic; one row per contiguous thinking episode; permanent |
| **Response text** | *Everything else the model says*: pre-tool talk, between-tool reactions, and the final answer | Normal full-color prose, **always markdown-rendered**, identical styling wherever it occurs in the stream |
| **Tool call** | One tool invocation | Compact receipt row + expandable public details; never raw payloads |
| **User (steer)** | A message the student sent mid-run | Right-aligned bubble inline in the stream |
| **Viz** | A structured comparison card | Inline card at its stream position |

The critical rule the current UI violates: **there is no third kind of text.**
"Narration" is not a visual category — it is response text that happens to
occur before a tool call. Claude Code does not style the sentence before a
tool call differently from the closing summary, and neither do we. The
thinking/response distinction is the ONLY text distinction, and it must be
unmistakable: muted-italic-behind-a-toggle vs normal markdown prose.

---

## 4. The invariants

Every one of these is an observable, testable behavior. All must hold.

1. **Two text kinds only.** Any model text is either thinking (collapsed,
   muted, toggleable) or response text (normal markdown). Nothing renders as
   plain unstyled/grey paragraph text.

2. **Chronology is sacred.** Beats render in stream arrival order and never
   regroup, re-sort, or merge across kinds — live, at completion, and on
   reload.

3. **Settled = the last frame of the stream.** Completion adds sources +
   actions below the stream and stops the cursor. It must cause zero
   changes to the beats above: no re-render that resets toggle state, no
   style change, no reflow, no reordering, no content diff.

4. **Thinking rows are permanent and toggleable forever.** Collapsed by
   default, expandable at any moment (mid-run or years later), never
   removed at completion or reload. One row per contiguous thinking episode.

5. **Response text is always rendered markdown.** Never a literal `###` or
   `**` visible in prose; never answer text chopped mid-word into separate
   blocks; never markdown-capable text pushed through a plain-text renderer.

6. **The final answer streams.** Visible progressive rendering with a
   cursor. The answer must not pop in as one block after a long silence,
   and it must never appear anywhere but at its chronological position.

7. **Wire honesty: what streamed is what persists.** The persisted record
   replays the exact same beat sequence the live stream produced. If the
   live view and the reloaded view of the same turn can be told apart,
   persistence is wrong.

8. **Tool receipts show public payloads only.** Label + student-safe detail
   + optional widget. Raw model-facing tool results never reach the DOM.

9. **Copy copies the run.** The copy action yields the whole chronological
   run as markdown (response text, tool receipt lines, viz tables, steering
   quotes) with thinking omitted.

10. **Stop is a suspend, not amnesia.** After stop, every beat that streamed
    remains; the follow-up message continues the same conversation with the
    completed tool work in context.

---

## 5. The agent must BEHAVE like an agent (prompts + model config)

Parity is not only rendering. The model's output has to *be* the Claude
Code-shaped stream. Two requirements:

### 5.1 Thinking must be real thinking

- Native provider thought output (Gemini `include_thoughts`) is **on by
  default** and displayed verbatim. Thinking is never synthesized, never
  paraphrased into fake "thoughts", and never suppressed to make the stream
  tidier.
- Interleaved thinking mid-answer (think → write → think → write) is a
  normal, expected stream shape and must render correctly: thought rows
  between answer chunks, answer chunks still classified as answer.

### 5.2 The voice: working agent, not chatbot

The observed run exposed chatbot voice, and the spec bans it. Target voice,
with the observed failures as counter-examples:

**Pre-tool talk (response text, before acting):**
- ✅ "I'll check what students and the rankings say about how these two
  compare." — short intent, then act.
- ❌ "Okay, I'll search the web for rankings, student discussions, and other
  information comparing the prestige and student life at MIT and Pitzer." —
  query echo; restating the tool arguments as prose is noise, the receipt
  row already shows the query.

**Reaction beats (response text, between tools):**
- ✅ "That came back thin — trying the CDS fields instead."
- ❌ Silence followed by an unexplained second search; or findings leaked
  into the reaction ("Pitzer is #36, so now I'll…").

**The final answer (response text, closing the run):**
- ✅ Leads with the conclusion ("Both are highly regarded — for opposite
  reasons."), then the structured comparison, findings carried by citations.
- ❌ "Okay, here is a summary of what the web search reveals about…" —
  meta-preamble narrating the process instead of answering.
- ❌ "While my database shows MIT is much more selective…", "my search didn't
  focus on X" — tool-plumbing references in answer prose. Attribution
  belongs to sources ("Students on College Confidential describe…"), with
  citation chips, not to the agent's machinery.

The existing prompt asset (`config/assets/prompts/counselor.md`, "Narrate As
You Work") already encodes intent-not-findings, one-beat-per-round, and
finish-once. What it does not yet enforce, and this spec requires:

- **No query echo** in pre-tool talk (the receipt shows the arguments).
- **No meta-preamble** opening the final answer; lead with the outcome.
- **No process references** ("the web search reveals", "my database shows")
  in answer prose — source-attributed claims with citations instead.
- Voice calibration: present tense, first person, short declaratives while
  working; confident and structured in the answer.

Prompt iterations are acceptance-tested against §7's checklist, judged on a
real multi-tool run.

---

## 6. Known defects this spec closes (evidence, not prescription)

The 2026-07-08 MIT-vs-Pitzer run (screenshot on file) violated invariants
1, 2, 3, 4, 5 and the §5.2 voice rules. Diagnosed causes, for the record:

1. **Final answer demoted to "narration".** Reproduced in isolation: when
   Gemini interleaves thought parts inside the final response (which
   `include_thoughts` does routinely), the emission router reclassifies the
   already-final answer text as narration at each thinking boundary —
   producing grey plain-text blocks, chopped mid-word at part boundaries
   ("…It" / "'s important…"), with literal `###` visible. Violates
   invariants 1 and 5. (A router fix for exactly this is already staged on
   the branch.)
2. **Narration rendered as plain text.** The narration beat renderer
   bypasses markdown entirely and styles the text as a third visual kind —
   the "grey blob" the student reads as thinking. Violates invariants 1
   and 5, and contradicts §3 (narration is not a visual category).
3. **Completion swaps the view.** After `done`, the session query refetch
   replaces the message list with the server-record replay; any live/record
   divergence appears as the message visibly reorganizing itself — including
   thinking rows vanishing when the divergence eats them. Violates
   invariants 3, 4, 7.
4. **Chatbot voice** (query echo, "Okay, here is a summary…",
   "my database shows"). Violates §5.2.

---

## 7. Acceptance — run this script against a live build

Setup: real backend + frontend, a question that forces multi-tool work with
web search (e.g. "Compare MIT and Pitzer on prestige and student life").

During the run:
- [ ] A collapsed shimmering "Thinking" row appears before any other beat.
- [ ] Expanding it mid-run shows streaming thought text; it stays expanded.
- [ ] Pre-tool talk renders as normal markdown prose (not muted/plain), and
      does not echo the tool query.
- [ ] Each tool shows one compact receipt row; details expand on click.
- [ ] The answer streams progressively as rendered markdown with a cursor.
- [ ] The composer accepts input mid-run; a mid-run send appears inline.

At completion (watch the exact moment):
- [ ] Zero layout shift above the sources strip — record it and scrub frames
      if in doubt.
- [ ] Every thinking row is still present, in place, with its toggle state.
- [ ] No new section, panel, or summary appears; only sources + actions.
- [ ] No literal `###`/`**` anywhere; no mid-word text breaks; no grey
      plain-text paragraphs.
- [ ] The answer opens with the conclusion — no "here is a summary" preamble,
      no "my database/search" process talk.

After reload:
- [ ] The settled message renders the identical beat sequence (kinds, order,
      content) as the live run's final frame.
- [ ] Thinking rows still present and toggleable.

Actions:
- [ ] Copy yields the whole run as markdown, thinking omitted.
- [ ] Stop mid-run keeps everything streamed so far; a follow-up message
      continues with the completed tool work in context.

Voice (subjective, reviewed on the transcript):
- [ ] Pre-tool beats read like a colleague working, not a chatbot narrating.
- [ ] The answer attributes claims to sources, never to tools.

---

## 8. Non-goals

- Ask/Agent mode picker, branching/edit trees, background runs beyond the
  turn registry — unchanged from `plans/agent-interactivity-parity.md`.
- Per-episode thinking durations ("Thought for 12s") — nice-to-have later;
  requires per-beat timing, not turn totals.
- Restyling the settled message beyond this spec (sources strip and action
  row keep their current design).
