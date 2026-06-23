# Counselle MVP3 PRD: Personal Statement Studio

Status: Draft
Date: 2026-06-21

## Problem Statement

High-achieving students applying to US colleges often have plenty of raw life material but no clear way to turn it into a compelling Common App personal statement. The hardest part is not just grammar or polish. It is deciding which story is worth telling, staying specific without sounding overproduced, cutting toward the 650-word limit, and knowing whether the essay still sounds true to the student.

This is especially painful for international students applying to many US schools without a real counselor. They face high stakes, unfamiliar expectations, many future essays, and constant uncertainty about whether an essay is authentic, strategic, or simply bland. Generic AI writing tools can produce fluent prose, but they often invent details, flatten the student's voice, or make changes without showing exactly what changed.

Counselle already helps students reason about colleges. MVP3 extends that trust into the writing workspace: a student should be able to write, think, revise, and ask for help in one place while staying in control of every change to their personal statement.

## Solution

Build a Personal Statement Studio for the Common App essay: a Google Docs-like writing workspace with Counselle's essay agent attached.

The student writes directly in a real document editor. A left sidebar organizes drafts, story notes, and named checkpoints. A right-side AI chat helps the student brainstorm, revise, shorten, review, and create draft alternatives. When the student selects text, Counselle can work on exactly that range. When Counselle proposes a replacement, the student sees the change first and chooses whether to accept it.

The product promise is simple:

- The student can write manually.
- The student can ask Counselle to help with the whole essay or selected text.
- Counselle uses the student's real stories as source material.
- Counselle shows proposed changes before applying them.
- The student can accept, reject, save, restore, and keep exploring alternatives without losing control of the essay.

MVP3 starts with the Common App personal statement because it creates value immediately and does not depend on current-cycle school supplement data. The product should feel like a calm document editor with an attached admissions-writing partner, not a dashboard, a wizard, or a generic chatbot.

## User Stories

1. As a high-achieving international applicant, I want one place to write my Common App personal statement, so that I do not have to move between documents, chat tools, and notes.
2. As a student without a counselor, I want Counselle to help me decide what story to tell, so that I can start from real material instead of staring at a blank page.
3. As a student, I want to write directly in the essay editor, so that I always feel ownership over the draft.
4. As a student, I want the center document to be the main focus of the screen, so that writing feels like the primary activity.
5. As a student, I want an AI chat beside the document, so that I can ask for help without leaving the essay.
6. As a student, I want the chat to understand the active essay draft, so that I do not have to paste the whole essay into every request.
7. As a student, I want to select a sentence or paragraph and ask for help with only that text, so that Counselle does not rewrite parts I did not ask it to touch.
8. As a student, I want selected text to appear clearly in the chat context, so that I know what Counselle is responding to.
9. As a student, I want quick actions for prompting, rewriting, and shortening selected text, so that common editing tasks are fast.
10. As a student, I want Counselle to preview a replacement before changing my essay, so that I can stay in control.
11. As a student, I want to accept a suggested edit, so that a good revision can be applied quickly.
12. As a student, I want to reject a suggested edit, so that my original writing remains unchanged.
13. As a student, I want accepted and rejected suggestions to remain visible in the chat, so that I can remember what changed and why.
14. As a student, I want Counselle to preserve my meaning when polishing, so that the essay still tells the truth.
15. As a student, I want Counselle to ask for missing real details instead of inventing them, so that my essay stays honest.
16. As a student, I want Counselle to avoid generic admissions language, so that my essay still sounds like me.
17. As a student, I want Counselle to help make vague claims more specific, so that my essay shows concrete moments instead of abstract traits.
18. As a student, I want Counselle to help sharpen reflection, so that the essay explains why the story matters.
19. As a student, I want Counselle to help cut toward 650 words, so that I can meet the Common App limit without losing the core story.
20. As a student, I want a visible word count, so that I always know how close I am to the limit.
21. As a student, I want basic formatting controls, so that the editor feels like a real writing surface.
22. As a student, I want document comments, so that feedback can stay attached to specific writing.
23. As a student, I want a full-draft review, so that I can understand the essay's biggest issue and the next best revision.
24. As a student, I want review feedback to include anchored comments, so that advice points to exact places in the draft.
25. As a student, I want review feedback to flag truth or voice risks, so that I do not accidentally submit something that feels fabricated or over-polished.
26. As a student, I want to create multiple draft variants, so that I can try different directions without destroying the current draft.
27. As a student, I want to clone the current draft into a new draft, so that I can experiment safely.
28. As a student, I want Counselle to create a new draft artifact when it writes an alternate version, so that agent work becomes a real editable draft.
29. As a student, I want to open drafts from the sidebar, so that draft switching is obvious.
30. As a student, I want to open a draft directly from a chat card, so that when Counselle says it created something, I can inspect it immediately.
31. As a student, I want draft names and word counts, so that I can recognize which version I am working on.
32. As a student, I want a story bank, so that my personal memories and reusable details are organized outside the essay itself.
33. As a student, I want to add a story note, so that I can preserve raw material before I know where it belongs.
34. As a student, I want story notes to include reusable details, so that Counselle has concrete facts to draw from.
35. As a student, I want to open and edit story notes in the sidebar, so that story management stays lightweight.
36. As a student, I want to tell Counselle to use a story in chat, so that the agent can help turn that memory into essay material.
37. As a student, I want Counselle to propose story cards from things I tell it, so that useful memories do not get lost in the transcript.
38. As a student, I want to confirm sensitive or inferred story details before they become reusable context, so that the story bank stays accurate.
39. As a student, I want named checkpoints, so that I can save important essay states before taking risks.
40. As a student, I want to load a checkpoint, so that I can return to a known good version.
41. As a student, I want checkpoints to be intentional saves rather than automatic noise, so that they feel meaningful.
42. As a student, I want automatic history for edits and agent actions, so that I can understand what happened over time.
43. As a student, I want history to include accepted and rejected suggestions, so that revision decisions are traceable.
44. As a student, I want history to stay out of the main writing area until I ask for it, so that it does not distract me.
45. As a student, I want a share dialog, so that sharing the essay with a parent, friend, or counselor feels like a natural future workflow.
46. As a student, I want share controls to be clear about access levels, so that I understand whether someone can view, comment, or edit.
47. As a student, I want the share experience not to imply real collaboration that does not exist yet, so that I am not misled.
48. As a student, I want chat history inside the essay workspace, so that I can return to prior writing conversations.
49. As a student, I want a new-chat control, so that I can start a fresh line of thinking without losing my essay.
50. As a student, I want starter prompts in the chat, so that I immediately understand what Counselle can help with.
51. As a student, I want Counselle to help me brainstorm from scratch, so that I can move from scattered memories to an essay direction.
52. As a student, I want Counselle to interview me when it needs more information, so that it can write from real details.
53. As a student, I want Counselle to show task progress during large essay work, so that long writing tasks do not feel like a black box.
54. As a student, I want to interrupt or stop active work, so that I can redirect Counselle when it is going the wrong way.
55. As a student, I want any queued message state to be honest, so that I know whether Counselle has actually received my request.
56. As a student, I want the workspace to recover if I refresh during active work, so that I do not lose the essay or agent progress.
57. As a student, I want saving failures to be visible, so that I know when I should retry or copy my essay.
58. As a student, I want stale edit conflicts to be handled safely, so that Counselle never overwrites newer writing with an old suggestion.
59. As a student, I want external search to be optional and visible, so that I understand when outside information influenced the advice.
60. As a student, I want Common App personal-statement work to be grounded in my facts rather than web facts, so that outside sources never replace lived experience.
61. As a student, I want the interface to work on a laptop and a phone, so that I can revise whenever I have time.
62. As a student, I want the workspace to feel calm and serious, so that it matches the stakes of college applications.
63. As a student, I want Counselle to leave me with editable artifacts, not just advice, so that every agent turn moves the essay forward.
64. As a parent or informal reviewer, I want a familiar share flow, so that I can be invited into the process without learning a new system.
65. As Counselle's operator, I want the product to prove essay help without expanding into every admissions-writing workflow at once, so that MVP3 can ship a focused wedge.

## Implementation Decisions

This PRD intentionally records product decisions, not detailed technical design.

- MVP3 starts with the Common App personal statement only.
- The primary user is a high-achieving international student applying to many US colleges without a real counselor.
- The product shape is a three-part writing workspace: left organization sidebar, center document editor, right AI chat.
- The center document is the primary surface. The product should feel like a document editor with Counselle attached.
- The existing Essay Studio preview is the product reference for layout, interaction hierarchy, and visual feel.
- The left sidebar is for workspace organization only: essays, drafts, story bank, and checkpoints.
- The left sidebar should not become a feed, dashboard, progress center, review panel, or agent-status area.
- Drafts are simple named alternatives, not a complex branching or merge system.
- Story cards are reusable student memories and facts. They are source material for the agent, not hidden essay plans.
- Checkpoints are named saves created intentionally by the student.
- History is automatic and records meaningful edits, agent suggestions, accepts, rejects, draft actions, story actions, checkpoint actions, and share actions.
- Comments belong with the document because they refer to exact writing.
- The right panel is an AI chat, not an inspector.
- The chat uses the same general composer experience as the rest of Counselle.
- The chat should support normal open-ended writing help, selected-text help, draft artifacts, story artifacts, edit suggestions, task lists, clarifying questions, and reviews.
- The starter chat experience should remain lightweight: a ready-to-edit message plus quick prompts.
- Selecting text is a first-class product action. Selected text can be attached to chat, rewritten, or shortened.
- Selected-text operations must operate only on the selected text unless the student asks otherwise.
- AI edits are proposed before they are applied.
- The student explicitly accepts or rejects proposed edits.
- Counselle-created drafts, stories, reviews, comments, and edit suggestions should appear as visible product artifacts, not just prose claims in chat.
- Clicking an artifact from chat should take the student to the relevant draft, story, review, comment, or edit.
- Counselle may help with large tasks such as "write my Common App essay from scratch," but it must interview for real material before drafting.
- Large writing tasks should show visible progress and leave behind editable artifacts.
- If a student sends another message during active work, the product must be honest about whether that message is queued, interrupting, or not yet accepted.
- The agent must never invent personal facts, hardship, activities, awards, family circumstances, or emotional meaning.
- The agent must not hide meaning changes inside polish.
- The agent must not rewrite the student into generic elite-admissions prose.
- If the essay needs a missing fact, Counselle asks for the real detail.
- External search can support essay strategy and later supplement context, but it cannot validate or replace the student's lived experience.
- Fake school data is allowed only in local demos and tests. Production essay work must be grounded in student-provided facts.
- The Share dialog is included as a product surface, but full collaboration semantics are not part of this MVP unless they are made real and honest.
- The product should preserve the existing Counselle honesty posture: no invisible claims, no fabricated certainty, and no misleading UI states.

## Testing Decisions

Good tests for this feature should prove external behavior, not internal implementation details. A passing test should answer product questions such as: Can a student write? Can they select text? Can they get a proposed edit without the document changing? Can they accept or reject it? Can they recover drafts, stories, checkpoints, and history?

Testing should focus on these product seams:

- The full Essay Studio workspace renders as a document-first three-pane experience.
- The document editor allows manual writing and preserves visible word count behavior.
- Text selection can be attached to chat.
- Rewrite and shorten actions produce edit suggestions for the selected text.
- Edit suggestions do not mutate the essay until accepted.
- Accepted suggestions update the document.
- Rejected suggestions leave the document unchanged.
- Drafts can be created, opened, and recognized by name.
- Agent-created drafts are visible and openable from chat.
- Story cards can be added, opened, edited, and used as chat context.
- Agent-proposed story details require appropriate confirmation when they include inferred personal facts.
- Checkpoints can be saved and restored.
- History records user-visible edit and agent actions.
- The share dialog is present and does not overpromise collaboration behavior.
- Full-draft review produces prioritized, anchored, honesty-aware feedback.
- The product handles save failures, stale edit suggestions, missing checkpoints, and interrupted active work without losing or overwriting essay text.
- Refresh or reattach behavior preserves the visible essay workspace and any durable artifacts.
- On mobile, the workspace remains usable and does not collapse into a cramped desktop table or dashboard.
- LLM evals should specifically cover no fabrication, voice preservation, selection discipline, interview quality, and search discipline.

Prior art in the current product includes the existing chat experience, source controls, clarification widgets, event-driven work visibility, durable sessions, and the Essay Studio preview interactions. The MVP3 tests should use those highest-level product seams where possible.

## Out of Scope

- School-specific supplement essays.
- Current-cycle school essay requirement tracking.
- Deadline tracking.
- Application submission.
- Resume, activities-list, or full application-package work.
- Chancing or admissions probability prediction.
- A separate "voice lock" product surface.
- Hidden thesis/planning objects that the student cannot inspect.
- Automatic branching graphs, merge tools, or Git-like draft lineage.
- Full multi-user collaboration and permissions beyond an honest share-dialog surface.
- Backend message queueing if it requires destabilizing the existing turn lifecycle.
- Main-chat university cards inside Essay Studio.
- Pipeline database access for the essay-writing profile.
- Treating web search as proof of a student's personal experience.
- Any production use of fake student or school data.

## Further Notes

MVP3 should start narrow and strong. The wedge is not "AI writes essays." The wedge is "a serious writing workspace where a student and Counselle can turn real personal material into a better Common App essay without losing truth, voice, or control."

The preview has already established the intended product feel. The PRD should be read as the product-level contract for turning that preview into a real student-facing workflow.

Later expansion can include better story intake, richer visual question widgets, supplement support, a brag-sheet/recommender workspace, college-list integration, and an application requirements ledger. Those should come only after the personal statement loop feels excellent.
