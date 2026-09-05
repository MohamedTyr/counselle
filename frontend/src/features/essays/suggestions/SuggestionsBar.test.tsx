import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { EssaySuggestion } from "@/domain/essay-suggestion";
import {
  SuggestionsBar,
  type SuggestionResolution,
} from "@/features/essays/suggestions/SuggestionsBar";
import type { EssaySuggestionsController } from "@/features/essays/suggestions/useEssaySuggestions";

/*
 * While one change is resolving, every other change's controls are locked.
 *
 * They must be locked with `aria-disabled`, never the native attribute: a
 * student can be keyboard-focused on any row in this list, and native
 * `disabled` ejects focus from whatever holds it — dropping them to `<body>`
 * mid-review, which is exactly why `Button`'s own loading state avoids it.
 * `aria-disabled` does not block activation on its own, so the handlers have
 * to refuse as well; both halves are tested here because either one alone is
 * a bug.
 *
 * The rest is about what a student can actually read and reach: the row order,
 * the accessible name of a row's own Accept, and the fact that neither Accept
 * nor Reject is weighted over the other.
 */

function suggestion(id: string, oldText: string, newText: string) {
  return {
    createdAt: "2026-09-05T09:00:00Z",
    id,
    kind: newText === "" ? "deletion" : "replacement",
    newText,
    newTextPlain: newText,
    oldText,
    oldTextPlain: oldText,
    rationale: "tighter",
  } satisfies EssaySuggestion;
}

const suggestions = [
  suggestion("a", "I like pizza a lot.", "I like pizza."),
  suggestion("b", "It was good.", "It was unforgettable."),
];

/** Both pending, in the order the server sent them. */
const bothPending: SuggestionResolution[] = [
  { from: 10, id: "a", stale: false },
  { from: 40, id: "b", stale: false },
];

function controller(
  overrides: Partial<EssaySuggestionsController> = {},
): EssaySuggestionsController {
  return {
    acceptAll: vi.fn(),
    acceptOne: vi.fn(),
    isResolving: false,
    rejectAll: vi.fn(),
    rejectOne: vi.fn(),
    resolving: null,
    ...overrides,
  };
}

async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /proposed/i }));
}

function rowFor(text: RegExp) {
  return screen.getByText(text).closest("li") as HTMLElement;
}

function acceptIn(row: HTMLElement) {
  return within(row).getByRole("button", { name: /^Accept:/ });
}

describe("locked sibling controls", () => {
  test("are aria-disabled, not natively disabled, and keep their focus", async () => {
    const user = userEvent.setup();
    const acceptOne = vi.fn();
    const view = render(
      <SuggestionsBar
        controller={controller()}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );
    await openList(user);

    const sibling = acceptIn(rowFor(/unforgettable/));
    sibling.focus();
    expect(document.activeElement).toBe(sibling);

    view.rerender(
      <SuggestionsBar
        controller={controller({
          acceptOne,
          isResolving: true,
          resolving: { action: "accept", id: "a" },
        })}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );

    const locked = acceptIn(rowFor(/unforgettable/));
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).not.toBeDisabled();
    /* The whole reason for `aria-disabled` over the native attribute. */
    expect(document.activeElement).toBe(locked);

    await user.click(locked);
    expect(acceptOne).not.toHaveBeenCalled();
  });

  /*
   * The pressed button, not just its siblings. `Button`'s `loading` prop used
   * to set the native attribute as well, which dropped focus to `<body>` the
   * instant a student accepted anything — so a keyboard review restarted from
   * the top of the page after every single change.
   */
  test("the control being pressed keeps its own focus while it resolves", async () => {
    const user = userEvent.setup();
    const view = render(
      <SuggestionsBar
        controller={controller()}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );
    await openList(user);

    const pressed = acceptIn(rowFor(/unforgettable/));
    pressed.focus();

    view.rerender(
      <SuggestionsBar
        controller={controller({
          isResolving: true,
          resolving: { action: "accept", id: "b" },
        })}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );

    const busy = acceptIn(rowFor(/unforgettable/));
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).not.toBeDisabled();
    expect(document.activeElement).toBe(busy);
  });

  test("the bulk controls are locked by a single change resolving", async () => {
    const user = userEvent.setup();
    const acceptAll = vi.fn();
    render(
      <SuggestionsBar
        controller={controller({
          acceptAll,
          isResolving: true,
          resolving: { action: "accept", id: "a" },
        })}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );
    await openList(user);

    const acceptAllButton = screen.getByRole("button", { name: "Accept all" });
    expect(acceptAllButton).toHaveAttribute("aria-disabled", "true");
    expect(acceptAllButton).not.toBeDisabled();

    await user.click(acceptAllButton);
    expect(acceptAll).not.toHaveBeenCalled();
  });
});

describe("the pending count", () => {
  test("is announced politely and excludes changes that went stale", () => {
    render(
      <SuggestionsBar
        controller={controller()}
        onRevealSuggestion={vi.fn()}
        resolutions={[
          { from: 10, id: "a", stale: false },
          { from: 40, id: "b", stale: true },
        ]}
        suggestions={suggestions}
      />,
    );

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent("Counselle proposed 1 change.");
  });
});

/*
 * A bordered Accept met before the student has seen a single change is a nudge
 * toward accepting rewrites of their own essay sight unseen, so bulk action
 * only exists once the list showing what it applies to is open.
 */
describe("bulk controls", () => {
  test("are not offered while the list is collapsed", async () => {
    const user = userEvent.setup();
    render(
      <SuggestionsBar
        controller={controller()}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Accept all" }),
    ).not.toBeInTheDocument();

    await openList(user);
    expect(
      screen.getByRole("button", { name: "Accept all" }),
    ).toBeInTheDocument();
  });
});

describe("the row list", () => {
  test("is ordered by position in the document, with outdated changes last", async () => {
    const user = userEvent.setup();
    render(
      <SuggestionsBar
        controller={controller()}
        onRevealSuggestion={vi.fn()}
        /* Server order is a, b; document order is b, a; and a is outdated,
         * which sinks it regardless. */
        resolutions={[
          { from: 90, id: "a", stale: true },
          { from: 40, id: "b", stale: false },
        ]}
        suggestions={suggestions}
      />,
    );
    await openList(user);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/unforgettable/);
    expect(rows[1]).toHaveTextContent(/Outdated/);
  });

  test("names the change in each row's own accept and reject", async () => {
    const user = userEvent.setup();
    render(
      <SuggestionsBar
        controller={controller()}
        onRevealSuggestion={vi.fn()}
        resolutions={bothPending}
        suggestions={suggestions}
      />,
    );
    await openList(user);

    /* Six identically-named "Accept" buttons is the only keyboard path to
     * rewriting a specific sentence. */
    expect(
      screen.getByRole("button", {
        name: "Accept: Replace “good → unforgettable”",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reject: Replace “good → unforgettable”",
      }),
    ).toBeInTheDocument();
  });

  test("an outdated row keeps its preview and offers only a dismiss", async () => {
    const user = userEvent.setup();
    const rejectOne = vi.fn();
    render(
      <SuggestionsBar
        controller={controller({ rejectOne })}
        onRevealSuggestion={vi.fn()}
        resolutions={[
          { from: 10, id: "a", stale: false },
          { from: 40, id: "b", stale: true },
        ]}
        suggestions={suggestions}
      />,
    );
    await openList(user);

    /* "Stale is shown, never hidden" cuts both ways: the row says it is
     * outdated AND still says what it was. */
    const stale = rowFor(/unforgettable/);
    expect(stale).toHaveTextContent("Outdated");
    expect(
      within(stale).queryByRole("button", { name: /^Accept:/ }),
    ).toBeNull();

    await user.click(within(stale).getByRole("button", { name: /^Dismiss/ }));
    expect(rejectOne).toHaveBeenCalledWith("b");
  });
});
