# MVP3 Feature Showcase

Generated: 2026-06-30

## Core Selling Point

Counselle MVP3 is **Claude Code for college applications**: an agent-first admissions workspace where the student and the AI agent work on the same application objects: schools, requirements, deadlines, essays, activities, forms, financial aid, documents, recommendations, sources, tasks, and review batches.

The product replaces the scattered admissions stack of spreadsheets, docs, browser tabs, portals, reminders, and generic AI chats with one workspace where the agent has context, can take action, and shows every meaningful change for review.

## Hero Features

### Agentic Admissions Workspace

MVP3 is not a chat app with tabs. It is a structured workspace for the whole college application process. The workspace holds the student profile, school list, school pages, verified requirements, tasks, essays, activities, documents, aid requirements, forms, external handoff state, recommendations, research, sources, agent runs, and review batches.

Selling point: the agent is useful because it operates on real application state, not because it generates isolated answers.

### Persistent Agent Console

The agent lives in a persistent right-side console beside the workspace. The student can chat, start goals, answer clarifying questions, approve permissions, inspect active runs, and open changed objects without losing their place.

Selling point: this makes the product feel like a command center, not a chatbot.

### Manual Work And Agent Work In The Same Place

Every object can be managed manually and by the agent. A student can add a school, edit a task, revise an essay, update a deadline, or review a source by hand. The agent can act on the same objects under the selected mode and permission rules.

Selling point: the product works for students who want full control and for students who want heavy AI help.

### Request, Edit, And Autopilot Modes

MVP3 gives the agent three clear operating modes:

- **Request:** read-only answers and analysis.
- **Edit:** agent can modify workspace objects under permission rules.
- **Autopilot:** agent works freely inside the Counselle workspace and produces a review batch.

Selling point: investors can understand the agent's power level immediately. The product can scale from safe Q&A to real automation without becoming reckless.

### `/goal` For Long-Running Admissions Work

`/goal` turns a normal chat prompt into a longer-running agent task. Example: `/goal build my application plan`. The agent can inspect the profile, check schools, identify missing information, create tasks, map essays, flag aid gaps, and return a reviewable output.

Selling point: this is the "Claude Code" moment for admissions: the student gives a goal, the agent plans and works inside the workspace.

### Live Workspace Reflection

When the agent works, the workspace changes live. If the agent adds Columbia, Columbia appears in the school list. If it creates a Yale essay draft, the essay appears in Essay Studio. If it updates a deadline, the task and school views reflect it.

Selling point: the user sees the agent doing work, not just talking about work.

### Review Batches

Meaningful agent changes are grouped into review batches. The student can accept all, discard all, or inspect item by item. Review items show the object changed, action type, before/after diff, source, risk level, explanation, and links back to the object.

Selling point: Autopilot feels like a pull request for the college application process.

### Trustworthy Admissions Data

School-derived facts carry source, cycle year, recency, verification status, and caveats. Requirements, deadlines, prompts, aid forms, and policies can be `verifying`, `verified`, `stale`, `failed`, `needs review`, or `user override`.

Selling point: Counselle can be trusted in a high-stakes process because it shows where data came from and how certain it is.

### Verified School Data Cache

When a student adds a school, Counselle fetches and verifies per-cycle application data. Once verified, that school's requirement data can be reused for future students in the same cycle.

Selling point: the product gets faster and more valuable as more schools are added and verified.

## Workspace Features

### Home Command Center

Home answers the daily question: "What should I do next?" It shows upcoming deadlines, blocked items, profile gaps, pending review batches, active agent goals, school progress, essay progress, aid tasks, document gaps, and recent changes.

Selling point: the student does not have to scan a spreadsheet to know what matters today.

### Student Profile

The profile is the canonical context the agent uses everywhere. It includes country, citizenship, curriculum, grades, tests, intended majors, budget, aid need, preferences, dealbreakers, visa constraints, personal story, writing voice, achievements, honors, activities, and missing information.

Selling point: the agent becomes personalized because it has durable context.

### College List Workspace

The school list is a dense application portfolio table. It tracks status, category, application round, deadlines, requirements progress, essay count, recommendation requirements, application platform, financial-aid risk, verification status, source status, and user/agent notes.

Selling point: replaces the student's spreadsheet with a live, agent-operable school list.

### School Workspace

Each school has its own workspace with overview, fit notes, requirements, forms, essays, aid, documents, research, tasks, post-submit state, sources, and history.

Selling point: every school becomes a complete application cockpit instead of a row in a spreadsheet and a pile of separate docs.

### Requirements Tracker

Requirements are structured objects, not prose. They can represent application forms, supplemental essays, recommendations, transcripts, tests, English proficiency, CSS Profile, ISFAA, financial documents, portfolios, interviews, fee waivers, scholarship forms, portals, and school-specific requirements.

Selling point: requirements can generate tasks, link documents, carry sources, and drive the agent's plan.

### Tasks And Deadlines

Tasks connect to schools, requirements, essays, documents, recommenders, forms, aid items, and deadlines. The system can show a `Next up` queue, calendar/week view, blocked items, critical path, external action required, waiting on others, and review pending.

Selling point: turns admissions complexity into a clear work queue.

### Forms And External Handoff

Counselle tracks Common App-style base answers, school-specific questions, education history, family information, testing state, fee waivers, copied-to-external status, portal/account setup, submitted externally status, receipt status, and missing external items.

Selling point: Counselle does not need to submit applications to replace the spreadsheet. It tracks what is ready, copied, submitted, received, or missing.

### Essay Studio

Essay Studio manages the Common App personal statement, supplemental prompts, drafts, versions, word limits, prompt verification, reuse mapping, school specificity checks, comments, copy/export controls, and agent critique/edit flows.

Selling point: essays are connected to schools, prompts, voice, sources, deadlines, and review history instead of living in isolated Google Docs.

### Essay Reuse Map

The product can show which essays can be adapted across schools, where reuse is risky, which prompts require school-specific references, and which drafts need revision.

Selling point: saves time while reducing low-quality copy/paste mistakes.

### Activities And Resume Workspace

The activities workspace manages Common App activities, honors, descriptions, hours, weeks, leadership, impact evidence, resume versions, and recommender brag-sheet material.

Selling point: activities become reusable structured application data, not a one-off document.

### Financial Aid Workspace

Aid is first-class for the target user. The workspace tracks budget, family contribution, aid need, school affordability, need-aware/need-blind notes, scholarships, CSS Profile, IDOC, ISFAA, institutional forms, aid deadlines, financial documents, fee waivers, risk flags, and post-admit funding proof.

Selling point: international financial-aid complexity becomes a core workflow, not an afterthought.

### Document Vault

Documents can include transcript, test score reports, English proficiency, passport, financial documents, certificates, portfolios, resume, writing samples, school reports, and other materials. Documents can satisfy multiple school requirements and carry lifecycle states like needed, requested, received, translated, scanned, uploaded, externally submitted, accepted, rejected, or expired.

Selling point: students can see which document is needed where and what still blocks submission.

### Recommendations Workspace

Recommendations track recommenders, roles, subjects, required/optional rules, invite status, FERPA waiver state, school report ownership, request status, due dates, brag sheets, reminder drafts, and notes.

Selling point: recommendation work becomes visible without giving the agent unsafe external messaging power.

### Research And Sources

Sources are attached wherever facts appear. School requirements, deadlines, prompts, aid data, research notes, and verified facts can show official/community distinction, recency, citations, freshness warnings, and source receipts.

Selling point: Counselle's answers and workspace state are inspectable, not black-box AI output.

### Application Timeline

The timeline shows upcoming deadlines, completed milestones, blockers, week/month views, critical items, and what breaks if the student does nothing.

Selling point: the product gives the student time awareness across the whole application season.

### Post-Submit And Decisions

After submission, Counselle can track portal setup, submitted date, receipt/checklist status, missing materials, interviews, decisions, waitlist/LOCI, aid-package comparison, enrollment deposits, and I-20/visa prep.

Selling point: the product remains useful after the application is sent.

### Notifications And Reminders

MVP3 can support in-app and email reminders first, with WhatsApp/Telegram later through explicit user-controlled flows. Reminders tie back to tasks, deadlines, documents, schools, recommendations, and aid requirements.

Selling point: reminders are grounded in real application state.

## Agent Capability Features

### Profile-Gap Interviewer

The agent can identify missing profile fields and ask targeted questions instead of making the student fill a long form.

Selling point: onboarding can feel like a guided workbench instead of paperwork.

### School-List Builder

The agent can help build or audit a balanced school list using the student profile, preferences, budget, aid need, intended major, and available school data.

Selling point: turns school discovery into an actionable portfolio.

### Requirement Extractor And Verifier

The agent can fetch, verify, cache, and explain requirements for each school and cycle.

Selling point: the product can compound data quality across users.

### Application Plan Builder

The agent can convert a school list into tasks, deadlines, essay plans, forms, aid requirements, document needs, and review batches.

Selling point: the first flagship workflow is immediately understandable and valuable.

### Essay Assistant

The agent can brainstorm, outline, critique, revise, adapt, check word count, check prompt fit, map reuse risk, and preserve versions.

Selling point: students get AI writing help with context and review history, not isolated draft generation.

### Activities And Resume Optimizer

The agent can improve phrasing, find missing impact, rank activities, adapt descriptions, and create resume or brag-sheet versions.

Selling point: the product helps convert raw experience into strong application material.

### Financial Aid Planner

The agent can identify aid form gaps, financial safeties, scholarships, affordability risk, and document requirements.

Selling point: financial-aid planning becomes a core agent workflow for the students who need it most.

### Weekly Planning Assistant

The agent can plan the student's week based on deadlines, blockers, school priority, pending reviews, external actions, and tasks only the student can do.

Selling point: recurring usage is built into the product.

### Application Audit Assistant

The agent can audit an application for missing requirements, stale data, incomplete essays, unverified deadlines, aid gaps, document gaps, external handoff gaps, and pending review items.

Selling point: Counselle can become the safety net before a student submits.

## Interaction And UX Features

### Command Palette

The command palette lets the user search destinations, objects, actions, schools, tasks, essays, forms, documents, aid items, sources, review batches, and agent runs.

Selling point: power users can operate the workspace quickly without relying only on chat.

### Object Chips And Deep Links

When the agent mentions or changes an object, it appears as a typed chip: school, essay, task, requirement, document, form, aid item, recommender, source, review batch, or goal. Clicking opens the exact object in the workspace.

Selling point: the user never has to hunt for what the agent just changed.

### Inspector Drawer

The Inspector shows sources, metadata, comments, version history, requirement receipts, diff details, task dependencies, and agent rationale without replacing the main workspace.

Selling point: trust details are available without cluttering the main screen.

### Risk-First Review

Review batches can order changes by risk, conflict, dependency, source, deadline impact, and object type. High-risk or conflicted changes can be pinned until reviewed.

Selling point: students can safely inspect large agent outputs.

### Undo And Revert

Accepted review items create reversible workspace versions. Deletes archive instead of hard-delete. Discarded items remain in history and can be reopened or revised.

Selling point: autonomy is safe because changes are reversible.

### Mobile Check-In

Mobile focuses on check-in, review, light task/object edits, agent steering, permission handling, and clarification replies.

Selling point: students can keep the process moving from phone without making mobile the primary dense editing surface.

### Accessibility And Internationalization

MVP3 targets keyboard navigation, visible focus states, no hover-only controls, touch-safe actions, accessible review diffs, reduced motion, absolute dates, deadline time zones, international names, Unicode, international addresses, currencies, and low-bandwidth usability.

Selling point: the product is built for international students under stress, not just US desktop users.

## Business And Product Selling Points

### Replaces A Broken Stack

Counselle replaces the practical stack students already use: Sheets or Notion for tracking, Google Docs for writing, folders for documents, portals for submission state, browser tabs for research, reminders for deadlines, and ChatGPT for thinking.

### Owns The System Of Record

The workspace becomes the durable system of record for the admissions process. The agent becomes stronger because the application state lives in Counselle.

### Agentic, But Reviewable

The product can sell powerful automation without asking users to blindly trust it. Review batches make agent work inspectable, reversible, and easy to accept or reject.

### Built Around The Hardest User First

International seniors applying to many US colleges with financial-aid need have the highest context burden. Winning there proves the product can handle the hardest version of admissions work.

### Data Quality Compounds

Verified per-cycle school data can be cached and reused. The more schools students add and verify, the more valuable Counselle becomes for future students.

### Student-First, Counselor-Later

The product starts with student love and reach. Later paid layers can serve families, serious applicants, parents, and counselors without turning the first product into counselor CRM.

### Recurring Seasonal Workflow

Admissions is not a one-off query. It is a multi-month workflow with deadlines, tasks, essays, documents, aid, recommendations, portals, decisions, and follow-up. Counselle has reasons for the student to return every week.

### Clear First Demo

The clearest demo is `/goal build my application plan`: the agent turns a student profile and school list into verified requirements, deadlines, tasks, form handoff items, aid/document gaps, essay plan, and a review batch.

## First MVP3 Slice To Showcase

The first slice should showcase:

- profile setup,
- school list,
- school workspace,
- requirements and verification states,
- tasks and deadlines,
- forms and external handoff,
- essay plan,
- aid and document gaps,
- persistent Agent Console,
- `/goal build my application plan`,
- live workspace changes,
- review batch.

This slice proves the core product: one admissions workspace where the agent can do useful work across the student's application state and the student can review everything before trusting it.
