# ADR 0026 — MVP3 frontend reset on the Counselle design system

## Status

Accepted.

Supersedes ADR 0020 for all frontend work after the 2026-07-05 frontend reset.

## Context

ADR 0020 intentionally cloned LibreChat for MVP2. That choice shipped the chat
app quickly, but the product direction has changed: MVP3 is an admissions
workspace and essay studio, not a LibreChat-shaped chat clone.

The old `frontend/` has been backed up to `frontend.backup-20260705-070513/`
and the active `frontend/` has been cleared. The MVP3 prototype in
`mvp3-frontend/` now contains the visual language and workspace shape to import
from. The backend contract remains the same `/v1` same-origin API with cookie
auth and SSE streams.

## Decision

The new `frontend/` is rebuilt from the MVP3 design system and workspace shell:
React, TypeScript, Vite, Tailwind CSS 4, shadcn-style source primitives,
Radix/Base UI primitives, lucide icons, React Router, and focused feature
modules.

The active frontend must not import the old LibreChat vendor tree, LibreChat
tokens, LibreChat route structure, or LibreChat naming. The old backup remains a
reference for the backend client contract only: auth, `/v1` HTTP helpers, SSE
transport, protocol types, transcript projection, and turn reduction.

The initial import is shell-first:

- `src/app` owns app bootstrap, providers, and router creation.
- `src/app/shell` owns the workspace frame and route outlet.
- `src/features/shell` owns product sidebar composition.
- `src/components/ui` owns generic shadcn/MVP3 primitives.
- Real backend client code stays behind a separate `src/api` seam when it is
  imported later.

Fixture-backed prototype state is not production state. Demo fixtures may exist
only in an obvious local/dev module and must not leak through shell interfaces.

## Rationale

The frontend now needs an admissions workspace module, not a chat-clone module.
Keeping the old clone architecture would make every new MVP3 surface fight the
accepted record: dependencies, token names, file layout, and ownership language
would all point to the wrong product.

The shell-first import gives the reset a small deep module before feature pages
arrive. Sidebar behavior, responsive layout, collapse state, mobile sheet
behavior, and outlet motion live in one place. Routes and future feature modules
cross one narrow shell seam.

The backend client remains valuable and should not be rewritten casually. It is
kept as a separate module because same-origin cookie auth, stream reattach,
cancel, transcript projection, and turn reduction are protocol concerns, not
layout concerns.

## Alternatives

- Continue the LibreChat clone and restyle it toward MVP3. Rejected because the
  product and module shape are now different enough that the old clone becomes
  drag rather than leverage.
- Copy the entire `mvp3-frontend/` prototype into `frontend/` at once. Rejected
  because it would import fixture-backed pages and feature dependencies before
  the production seams are clear.
- Rebuild every primitive from scratch. Rejected because the MVP3 prototype
  already has shadcn-style primitives and tokens; use the wheel we have.

## Consequences

ADR 0020 is historical for MVP2 and no longer governs active frontend work.
Future frontend changes should use MVP3 naming and module ownership.

Feature pages are imported one at a time after the shell is verified. The
backend auth/chat client is imported as its own phase and must not be folded
into the shell.

Docs that still describe the active frontend as LibreChat-derived should be
updated when they are touched for MVP3 work.
