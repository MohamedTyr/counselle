import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { TiptapContent } from "@/api/workspace/types";
import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { SuggestionPluginKey } from "@/features/essays/suggestions/suggestionExtension";
import { useEssayEditor } from "@/features/essays/useEssayEditor";

/*
 * The content resync, which is the one path that can replace the whole
 * document under a student who is only typing.
 *
 * Both tests below are regressions for the same shipped bug: one character
 * typed anywhere in the essay emptied the tracked-change layer about a second
 * later, while the server still held every suggestion and a reload brought
 * them all back. The readout said "outdated" over a document showing nothing —
 * the app contradicting itself on the surface whose whole job is being the
 * number a student can trust.
 */

const ANCHOR = "I like pizza.";
const REST = " It reminds me of home.";

function doc(text: string): TiptapContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/*
 * The same document as Postgres hands it back. `content` lives in a `jsonb`
 * column, which normalises object key order — `{"text": …, "type": "text"}`
 * where Tiptap emits `{"type": "text", "text": …}` — so every save's response
 * is a differently-keyed copy of what the editor already holds.
 */
function asJsonbRoundTrip(value: TiptapContent): TiptapContent {
  const reorder = (raw: unknown): unknown => {
    if (Array.isArray(raw)) {
      return raw.map(reorder);
    }
    if (raw !== null && typeof raw === "object") {
      return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>)
          .map(([key, child]) => [key, reorder(child)] as const)
          .sort(([a], [b]) => b.localeCompare(a)),
      );
    }
    return raw;
  };
  return reorder(value) as TiptapContent;
}

function suggestion(): EssaySuggestion {
  return {
    createdAt: "2026-09-05T09:00:00Z",
    id: "s1",
    kind: "replacement",
    newText: "I adore pizza.",
    newTextPlain: "I adore pizza.",
    oldText: ANCHOR,
    oldTextPlain: ANCHOR,
    rationale: "Stronger verb.",
  };
}

function renderEditor(content: TiptapContent) {
  return renderHook(
    (props: { content: TiptapContent }) =>
      useEssayEditor({
        content: props.content,
        onBlur: vi.fn(),
        onUpdate: vi.fn(),
        suggestions: [suggestion()],
        syncContent: true,
      }),
    { initialProps: { content } },
  );
}

describe("content resync", () => {
  test("a jsonb round-trip of the same document does not replace it", async () => {
    const { result, rerender } = renderEditor(doc(ANCHOR + REST));
    await waitFor(() => expect(result.current.editor).not.toBeNull());

    // What a settled autosave hands back: the server stores exactly what the
    // editor sent and returns it with `jsonb`'s key order, not Tiptap's.
    const saved = result.current.editor!.getJSON() as TiptapContent;
    const before = result.current.editor!.state.doc;
    rerender({ content: asJsonbRoundTrip(saved) });

    // Identity, not equality: a replaced document is a different node even
    // when it holds the same words, and replacing it is what threw the caret
    // out of the student's sentence on every settled save.
    expect(result.current.editor!.state.doc).toBe(before);
  });

  test("a genuine resync re-anchors pending changes instead of dropping them", async () => {
    const { result, rerender } = renderEditor(doc(ANCHOR + REST));
    await waitFor(() => expect(result.current.editor).not.toBeNull());

    // Content the editor has never held, still containing the anchor: this is
    // what an agent write from the main chat looks like arriving in an open,
    // clean editor.
    rerender({ content: doc("A new opening. " + ANCHOR + REST) });

    const editor = result.current.editor!;
    const [resolved] = SuggestionPluginKey.getState(editor.state)!.resolved;
    expect(resolved.stale).toBe(false);
    expect(editor.state.doc.textBetween(resolved.from!, resolved.to!, "")).toBe(
      ANCHOR,
    );
  });

  test("a resync that removes the anchor leaves it stale, not silently gone", async () => {
    const { result, rerender } = renderEditor(doc(ANCHOR + REST));
    await waitFor(() => expect(result.current.editor).not.toBeNull());

    rerender({ content: doc("Nothing here matches." + REST) });

    const [resolved] = SuggestionPluginKey.getState(
      result.current.editor!.state,
    )!.resolved;
    expect(resolved.stale).toBe(true);
    // Still counted: `countPendingChanges` splits the server's rows into
    // waiting and outdated, and both readouts add up to the row count.
    expect(
      SuggestionPluginKey.getState(result.current.editor!.state)!.resolved,
    ).toHaveLength(1);
  });
});
