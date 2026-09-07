import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";

import type { TiptapContent } from "@/api/workspace/types";
import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { countWords } from "@/features/essays/essay-content";
import { SuggestionExtension } from "@/features/essays/suggestions/suggestionExtension";
import { projectAcceptAll } from "@/features/essays/suggestions/word-projection";

/*
 * The projected count is a claim about the student's word budget, so it is
 * either right or it is not made. These are the cases where the arithmetic the
 * plan drafted — sum `countWords(new) - countWords(old)` per change — gives a
 * different answer from the document the student would actually be left with.
 */

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
});

function suggestion(
  overrides: Partial<EssaySuggestion> & { oldTextPlain: string },
): EssaySuggestion {
  const newTextPlain = overrides.newTextPlain ?? "";
  return {
    createdAt: "2026-09-07T12:00:00Z",
    id: "s1",
    kind: newTextPlain === "" ? "deletion" : "replacement",
    newText: newTextPlain,
    newTextPlain,
    oldText: overrides.oldTextPlain,
    rationale: "Tighter.",
    ...overrides,
  };
}

function paragraphs(...texts: string[]): TiptapContent {
  return {
    content: texts.map((text) => ({
      content: [{ text, type: "text" }],
      type: "paragraph",
    })),
    type: "doc",
  } as unknown as TiptapContent;
}

function makeEditor(content: TiptapContent, suggestions: EssaySuggestion[]) {
  const editor = new Editor({
    content,
    extensions: [
      StarterKit,
      SuggestionExtension.configure({ getSuggestions: () => suggestions }),
    ],
  });
  editors.push(editor);
  return editor;
}

describe("projectAcceptAll", () => {
  test("its reading of the current count matches the editor's own", () => {
    const editor = makeEditor(
      paragraphs("The food was good.", "It changed how I cook."),
      [suggestion({ oldTextPlain: "good", newTextPlain: "unforgettable" })],
    );

    const projection = projectAcceptAll(editor);

    // Blocks joined with whitespace, exactly as `editor.getText()` counts them
    // — nine words, not eight with "good.It" glued into one.
    expect(projection?.current).toBe(countWords(editor.getText()));
    expect(projection?.current).toBe(9);
  });

  test("a plain replacement projects its word delta", () => {
    const editor = makeEditor(paragraphs("The food was good."), [
      suggestion({ oldTextPlain: "good", newTextPlain: "worth the flight" }),
    ]);

    expect(projectAcceptAll(editor)?.projected).toBe(6);
  });

  test("deleting only a space merges two words the change never counted", () => {
    // Per-change arithmetic says zero: `countWords(" ")` and `countWords("")`
    // are both 0. The document loses a word all the same.
    const editor = makeEditor(paragraphs("Some times I cook."), [
      suggestion({ oldTextPlain: "e t", newTextPlain: "et" }),
    ]);

    const projection = projectAcceptAll(editor);

    expect(projection?.current).toBe(4);
    expect(projection?.projected).toBe(3);
  });

  test("dropping a trailing space merges into the word after it", () => {
    // Per-change arithmetic says zero: "good " and "good" are one word each.
    const editor = makeEditor(paragraphs("The food was good enough."), [
      suggestion({ oldTextPlain: "good ", newTextPlain: "good" }),
    ]);

    const projection = projectAcceptAll(editor);

    expect(projection?.current).toBe(5);
    // "The food was goodenough." — four words.
    expect(projection?.projected).toBe(4);
  });

  test("several changes across paragraphs each land", () => {
    const editor = makeEditor(
      paragraphs("The food was good.", "It changed how I cook."),
      [
        suggestion({
          id: "a",
          newTextPlain: "worth the flight",
          oldTextPlain: "good",
        }),
        suggestion({ id: "b", newTextPlain: "", oldTextPlain: " how I cook" }),
      ],
    );

    const projection = projectAcceptAll(editor);

    expect(projection?.current).toBe(9);
    // "The food was worth the flight." + "It changed." = 6 + 2
    expect(projection?.projected).toBe(8);
  });

  test("says nothing when two changes overlap", () => {
    // Accepting is cumulative, so the server applies one and skips the other —
    // and which one survives is the order the agent happened to emit them in.
    const editor = makeEditor(paragraphs("The food was really good."), [
      suggestion({ id: "a", newTextPlain: "great", oldTextPlain: "really good" }),
      suggestion({ id: "b", newTextPlain: "very", oldTextPlain: "was really" }),
    ]);

    expect(projectAcceptAll(editor)).toBeNull();
  });

  test("says nothing when a change swallows a paragraph break", () => {
    const editor = makeEditor(paragraphs("The food was good.", "I cook now."), [
      suggestion({ oldTextPlain: "good.I cook", newTextPlain: "good. I bake" }),
    ]);

    expect(projectAcceptAll(editor)).toBeNull();
  });

  test("says nothing when every change is outdated", () => {
    // Two identical sentences: the anchor is ambiguous, so the plugin calls it
    // stale and accepting all would apply nothing.
    const editor = makeEditor(paragraphs("I cook.", "I cook."), [
      suggestion({ oldTextPlain: "I cook.", newTextPlain: "I bake." }),
    ]);

    expect(projectAcceptAll(editor)).toBeNull();
  });

  test("says nothing when there is nothing pending", () => {
    expect(projectAcceptAll(makeEditor(paragraphs("I cook."), []))).toBeNull();
  });
});
