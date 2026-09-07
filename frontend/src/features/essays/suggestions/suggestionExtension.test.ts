import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, test } from "vitest";

import type { TiptapContent } from "@/api/workspace/types";
import {
  essaySuggestionsFromApi,
  type EssaySuggestion,
} from "@/domain/essay-suggestion";
import { diffSuggestionText } from "@/features/essays/suggestions/suggestionDiff";
import {
  documentText,
  SuggestionExtension,
  SuggestionPluginKey,
  type ResolvedSuggestion,
} from "@/features/essays/suggestions/suggestionExtension";

/*
 * Anchoring is the one honesty-critical piece of the decoration layer: a
 * suggestion that resolves to the wrong range silently proposes an edit to
 * words the agent never wrote about, and a suggestion that fails to resolve on
 * formatted text disappears without ever telling the student it existed.
 * Everything below is one of those two failure modes.
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
    createdAt: "2026-09-04T12:00:00Z",
    id: "s1",
    kind: newTextPlain === "" ? "deletion" : "replacement",
    newText: newTextPlain,
    newTextPlain,
    oldText: overrides.oldTextPlain,
    rationale: "Tighter.",
    ...overrides,
  };
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

function resolved(editor: Editor): ResolvedSuggestion[] {
  const state = SuggestionPluginKey.getState(editor.state);
  if (!state) {
    throw new Error("suggestion plugin state missing");
  }
  return state.resolved;
}

function paragraphs(...texts: string[]): TiptapContent {
  return {
    type: "doc",
    content: texts.map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  };
}

describe("anchoring", () => {
  test("a unique match resolves to the range holding exactly that text", () => {
    const editor = makeEditor(
      paragraphs("I like pizza. It reminds me of home."),
      [suggestion({ oldTextPlain: "It reminds me of home." })],
    );

    const [entry] = resolved(editor);
    expect(entry.stale).toBe(false);
    expect(editor.state.doc.textBetween(entry.from!, entry.to!, "")).toBe(
      "It reminds me of home.",
    );
  });

  test("zero matches is stale", () => {
    const editor = makeEditor(paragraphs("I like pizza."), [
      suggestion({ oldTextPlain: "I like calzone." }),
    ]);

    expect(resolved(editor)[0]).toMatchObject({ from: null, stale: true });
  });

  test("more than one match is stale — guessing would edit the wrong words", () => {
    const editor = makeEditor(
      paragraphs("I like pizza.", "Truly, I like pizza."),
      [suggestion({ oldTextPlain: "I like pizza." })],
    );

    expect(resolved(editor)[0]).toMatchObject({ from: null, stale: true });
  });
});

describe("formatted spans (the bug the _plain fields exist to fix)", () => {
  test("a bold span anchors through oldTextPlain and never goes stale", () => {
    // The document carries bold as a MARK. Its text is "I love pizza." with no
    // asterisks anywhere, so the markdown form could never match it.
    const editor = makeEditor(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "I love " },
              { type: "text", marks: [{ type: "bold" }], text: "pizza" },
              { type: "text", text: "." },
            ],
          },
        ],
      },
      [
        suggestion({
          newText: "I adore **pizza**.",
          newTextPlain: "I adore pizza.",
          oldText: "I love **pizza**.",
          oldTextPlain: "I love pizza.",
        }),
      ],
    );

    const [entry] = resolved(editor);
    expect(entry.stale).toBe(false);
    expect(editor.state.doc.textBetween(entry.from!, entry.to!, "")).toBe(
      "I love pizza.",
    );
    // The markdown form is genuinely absent — this is what would have failed.
    expect(documentText(editor.state.doc)).not.toContain("**");
  });

  test("italic, heading, list and blockquote spans all anchor", () => {
    const editor = makeEditor(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Why I cook" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", marks: [{ type: "italic" }], text: "Every" },
              { type: "text", text: " Sunday." },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Onions first." }],
                  },
                ],
              },
            ],
          },
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Salt as you go." }],
              },
            ],
          },
        ],
      },
      [
        suggestion({ id: "heading", oldTextPlain: "Why I cook" }),
        suggestion({ id: "italic", oldTextPlain: "Every Sunday." }),
        suggestion({ id: "list", oldTextPlain: "Onions first." }),
        suggestion({ id: "quote", oldTextPlain: "Salt as you go." }),
      ],
    );

    expect(resolved(editor).map((entry) => entry.stale)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  test("a multi-block anchor proves the empty block separator", () => {
    // The backend joins blocks with "".join(...), so "Why I cook" and "Every
    // Sunday." are adjacent with nothing between them. A "\n" or "\n\n"
    // separator on this side would make every cross-paragraph suggestion stale.
    const editor = makeEditor(paragraphs("Why I cook", "Every Sunday."), [
      suggestion({
        newTextPlain: "Why I cookEvery weekend.",
        oldTextPlain: "Why I cookEvery Sunday.",
      }),
    ]);

    const [entry] = resolved(editor);
    expect(entry.stale).toBe(false);
    expect(editor.state.doc.textBetween(entry.from!, entry.to!, "")).toBe(
      "Why I cookEvery Sunday.",
    );
    expect(documentText(editor.state.doc)).toBe("Why I cookEvery Sunday.");
    // The exact call, and the exact string space, the backend produces.
    expect(
      editor.state.doc.textBetween(0, editor.state.doc.content.size, ""),
    ).toBe(editor.state.doc.textContent);
  });
});

describe("position mapping", () => {
  test("an unrelated edit elsewhere leaves the anchor pending and correct", () => {
    const editor = makeEditor(paragraphs("First paragraph.", "I like pizza."), [
      suggestion({ oldTextPlain: "I like pizza." }),
    ]);
    const before = resolved(editor)[0];

    editor.commands.insertContentAt(1, "Brand new opening. ");

    const after = resolved(editor)[0];
    expect(after.stale).toBe(false);
    expect(after.from).not.toBe(before.from);
    expect(editor.state.doc.textBetween(after.from!, after.to!, "")).toBe(
      "I like pizza.",
    );
  });

  test("an edit inside the anchor invalidates it even though the position still maps", () => {
    const editor = makeEditor(paragraphs("I like pizza very much."), [
      suggestion({ oldTextPlain: "I like pizza very much." }),
    ]);
    const before = resolved(editor)[0];

    // Inside the range: mapping tracks it perfectly, the words no longer match.
    editor.commands.insertContentAt(before.from! + 7, "cold ");

    const after = resolved(editor)[0];
    expect(after.stale).toBe(true);
    expect(after.from).not.toBeNull();
  });
});

describe("recompute vs mapping precedence", () => {
  test("a transaction carrying BOTH docChanged and the meta recomputes", () => {
    // This is what accepting a suggestion looks like: the whole document is
    // replaced with the server's copy AND the list shrinks, in one transaction.
    // Taking the mapping branch here would re-validate every sibling against a
    // document that no longer contains its old text and flip them all to stale.
    const first = suggestion({ id: "a", oldTextPlain: "I like pizza." });
    const second = suggestion({
      id: "b",
      oldTextPlain: "It reminds me of home.",
    });
    const editor = makeEditor(
      paragraphs("I like pizza. It reminds me of home."),
      [first, second],
    );
    expect(resolved(editor).map((entry) => entry.stale)).toEqual([
      false,
      false,
    ]);

    editor
      .chain()
      .setContent(paragraphs("I adore pizza. It reminds me of home."), {
        emitUpdate: false,
      })
      .command(({ tr }) => {
        tr.setMeta(SuggestionPluginKey, { suggestions: [second] });
        return true;
      })
      .run();

    const after = resolved(editor);
    expect(after).toHaveLength(1);
    expect(after[0].suggestion.id).toBe("b");
    expect(after[0].stale).toBe(false);
    expect(editor.state.doc.textBetween(after[0].from!, after[0].to!, "")).toBe(
      "It reminds me of home.",
    );
  });

  test("the same document replacement WITHOUT the meta takes the mapping branch", () => {
    // The contrast case, so the test above is proving precedence rather than
    // coincidence: mapping cannot survive a replacement that changed the text.
    const editor = makeEditor(paragraphs("I like pizza."), [
      suggestion({ oldTextPlain: "I like pizza." }),
    ]);

    editor.commands.setContent(paragraphs("I adore pizza."), {
      emitUpdate: false,
    });

    expect(resolved(editor)[0].stale).toBe(true);
  });
});

describe("essaySuggestionsFromApi", () => {
  test("reads the wire shape and derives kind, dropping unusable rows", () => {
    const parsed = essaySuggestionsFromApi([
      {
        created_at: "2026-09-04T12:00:00Z",
        id: "a",
        new_text: "",
        new_text_plain: "",
        old_text: "I love **pizza**.",
        old_text_plain: "I love pizza.",
        rationale: "Cut it.",
      },
      { id: "b", old_text_plain: "" },
      { id: "", old_text_plain: "something" },
      "not an object",
    ]);

    expect(parsed).toEqual([
      {
        createdAt: "2026-09-04T12:00:00Z",
        id: "a",
        kind: "deletion",
        newText: "",
        newTextPlain: "",
        oldText: "I love **pizza**.",
        oldTextPlain: "I love pizza.",
        rationale: "Cut it.",
      },
    ]);
  });
});

describe("diffSuggestionText", () => {
  test("an extending replacement renders as a pure insertion", () => {
    const diff = diffSuggestionText(
      "I like pizza.",
      "I like pizza. It reminds me of home.",
    );

    expect(diff.shape).toBe("insertion");
    expect(diff.oldMiddle).toBe("");
    expect(diff.newMiddle).toBe(" It reminds me of home.");
  });

  test("deleting a clause renders as a pure deletion, not a replacement", () => {
    const diff = diffSuggestionText(
      "I like pizza, which is my favorite food.",
      "I like pizza.",
    );

    expect(diff.shape).toBe("deletion");
    expect(diff.newMiddle).toBe("");
    expect(diff.oldMiddle).toBe(", which is my favorite food");
  });

  test("a genuine replacement keeps both sides", () => {
    const diff = diffSuggestionText(
      "The food was good.",
      "The food was unforgettable.",
    );

    expect(diff.shape).toBe("replacement");
    expect(diff.oldMiddle).toBe("good");
    expect(diff.newMiddle).toBe("unforgettable");
  });

  test("a shared substring inside unrelated words is not trimmed", () => {
    const diff = diffSuggestionText("the cat", "this dog");

    expect(diff.prefixLength).toBe(0);
    expect(diff.suffixLength).toBe(0);
    expect(diff.oldMiddle).toBe("the cat");
    expect(diff.newMiddle).toBe("this dog");
  });

  test("a stored deletion needs no trim", () => {
    const diff = diffSuggestionText("I like pizza.", "");

    expect(diff.shape).toBe("deletion");
    expect(diff.oldMiddle).toBe("I like pizza.");
  });
});

describe("decorations", () => {
  test("an insertion paints a green <ins> and strikes nothing", () => {
    const editor = makeEditor(paragraphs("I like pizza."), [
      suggestion({
        newTextPlain: "I like pizza. It reminds me of home.",
        oldTextPlain: "I like pizza.",
      }),
    ]);

    editor.commands.focus();
    const html = editor.view.dom.innerHTML;
    expect(html).toContain("essay-suggestion-insert");
    expect(html).not.toContain("essay-suggestion-delete");
    expect(html).toContain("It reminds me of home.");
  });

  test("a deletion paints a struck <del> over the document's own words", () => {
    const editor = makeEditor(paragraphs("I like cold pizza."), [
      suggestion({ oldTextPlain: "cold " }),
    ]);

    const html = editor.view.dom.innerHTML;
    expect(html).toContain("<del");
    expect(html).toContain("essay-suggestion-delete");
    expect(html).not.toContain("essay-suggestion-insert");
  });

  test("a stale suggestion stays visible and inert rather than vanishing", () => {
    const editor = makeEditor(paragraphs("I like pizza very much."), [
      suggestion({ oldTextPlain: "I like pizza very much." }),
    ]);
    editor.commands.insertContentAt(8, "cold ");

    const html = editor.view.dom.innerHTML;
    expect(resolved(editor)[0].stale).toBe(true);
    expect(html).toContain("essay-suggestion-stale");
    // Both channels, not just the tooltip: the dotted line is the only visual
    // signal, so a screen reader needs its own way to hear "stale" at all.
    expect(html).toContain(
      'title="Outdated suggestion: your text changed since this was suggested."',
    );
    // Text, never `aria-label`: `generic` prohibits an accessible name and the
    // browser drops the attribute, so the marker has to be readable content.
    expect(html).not.toContain("aria-label");
    expect(editor.view.dom.textContent).toContain(
      "Outdated suggestion, no longer applies: ",
    );
    expect(editor.view.dom.textContent).toContain(
      ". End of outdated suggestion. ",
    );
  });

  /*
   * The honesty case for assistive technology: reading the essay straight
   * through must never blend a proposal into the student's own sentence. The
   * markers are bracketed text because `deletion` and `insertion` prohibit an
   * accessible name — a labelled <del> reaches no screen reader at all.
   */
  test("a replacement brackets both halves with screen-reader-only markers", () => {
    const editor = makeEditor(paragraphs("I like cold pizza."), [
      suggestion({ newTextPlain: "warm pizza.", oldTextPlain: "cold pizza." }),
    ]);

    const text = editor.view.dom.textContent ?? "";
    expect(text).toContain("Suggested deletion: cold. End of suggested deletion.");
    expect(text).toContain("Suggested insertion: warm. End of suggested insertion.");
    expect(editor.view.dom.innerHTML).not.toContain("aria-label");
    // The markers must stay out of the popover's anchor measurement, which
    // unions every element carrying the change's id.
    expect(
      [...editor.view.dom.querySelectorAll("[data-suggestion-id]")].every(
        (element) => !element.classList.contains("sr-only"),
      ),
    ).toBe(true);
  });

  /*
   * A replacement paints as two elements and a cross-paragraph change as one
   * per block. Washing only the element under the pointer would light up half
   * a decision, so hover is resolved by id across every fragment.
   */
  test("hovering one fragment marks every fragment of the same suggestion", () => {
    const editor = makeEditor(paragraphs("I like cold pizza."), [
      suggestion({ newTextPlain: "warm pizza.", oldTextPlain: "cold pizza." }),
    ]);

    // Re-queried after every dispatch: hover is a decoration, so the rendered
    // elements are replaced rather than mutated in place.
    const washed = () =>
      [...editor.view.dom.querySelectorAll("[data-suggestion-hovered]")].map(
        (element) => element.tagName,
      );

    editor.view.dom
      .querySelector("del")
      ?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(washed()).toEqual(["DEL", "INS"]);

    editor.view.dom.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true }),
    );
    expect(washed()).toEqual([]);
  });
});
