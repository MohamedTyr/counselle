"""Round-trip, escaping, and block-preservation coverage for essay_markdown.

Honesty-critical per AGENTS.md: a serializer/parser asymmetry here would
silently corrupt a student's essay or make `edit_essay`'s `old_text` fail to
match text `read_essay` just showed the agent, so these are real tests, not
scaffolding.
"""

from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.workspace import essay_markdown as em

# Printable ASCII, no leading/trailing whitespace (paragraph content is
# inline text; whitespace edges are markdown-it's job, not ours to fuzz).
_ARBITRARY_TEXT = st.text(
    alphabet=st.characters(min_codepoint=32, max_codepoint=126),
    min_size=1,
    max_size=60,
).filter(lambda s: s == s.strip() and s.strip() != "")

# Unicode prose: letters/marks/punctuation/symbols from any script (accents,
# curly quotes, em dashes, emoji), still excluding control/surrogate/format
# categories and hard whitespace edges.
_UNICODE_TEXT = st.text(
    alphabet=st.characters(blacklist_categories=("Cc", "Cs", "Cf"), blacklist_characters="\n\r"),
    min_size=1,
    max_size=60,
).filter(lambda s: s == s.strip() and s.strip() != "")


def _text_doc(text: str, marks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return {"type": "doc", "content": [{"type": "paragraph", "content": [node]}]}


# --------------------------------------------------------------------------
# Round-trip invariant
# --------------------------------------------------------------------------


@given(text=_ARBITRARY_TEXT)
def test_round_trip_is_idempotent_for_arbitrary_paragraph_text(text: str) -> None:
    doc = _text_doc(text)
    md = em.to_markdown(doc)
    assert em.to_markdown(em.to_tiptap(md)) == md


@given(text=_UNICODE_TEXT)
def test_round_trip_is_idempotent_for_unicode_prose(text: str) -> None:
    """Real essays: accents, curly quotes, em dashes, emoji — not just ASCII."""
    doc = _text_doc(text)
    md = em.to_markdown(doc)
    assert em.to_markdown(em.to_tiptap(md)) == md


@given(a=_ARBITRARY_TEXT, b=_ARBITRARY_TEXT)
def test_round_trip_adjacent_runs_with_overlapping_marks_never_corrupts_visible_text(
    a: str, b: str
) -> None:
    """Two sibling text nodes sharing one mark but not another must not let
    their independently-wrapped delimiters fuse into a different construct
    (the CRITICAL bug: bold "a" next to bold+italic "b" naively serializes
    as "**a****_b_**", which drops the italic and leaks a literal "**" into
    the visible text). This is the one invariant that must hold for *any*
    input, including single punctuation/digit characters where CommonMark's
    own emphasis flanking rules can't represent italic at all — for those,
    `essay_markdown` degrades to dropping bold/italic/strike rather than
    ever leaking delimiter characters into the readable text (see
    `test_round_trip_adjacent_runs_with_overlapping_word_marks_keeps_marks`
    for the guarantee that normal word-shaped essay content keeps its
    marks)."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": a, "marks": [{"type": "bold"}]},
                    {"type": "text", "text": b, "marks": [{"type": "bold"}, {"type": "italic"}]},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    visible_text = "".join(n.get("text", "") for n in reparsed["content"][0]["content"])
    assert visible_text == a + b, f"visible text corrupted: {visible_text!r} != {(a + b)!r}"


@given(
    a=st.text(alphabet=st.characters(whitelist_categories=("Ll", "Lu")), min_size=1, max_size=20),
    b=st.text(alphabet=st.characters(whitelist_categories=("Ll", "Lu")), min_size=1, max_size=20),
)
def test_round_trip_adjacent_runs_with_overlapping_word_marks_keeps_marks(a: str, b: str) -> None:
    """For realistic essay content — word-shaped text, not lone punctuation —
    partially-overlapping adjacent marks must round-trip with formatting
    intact, not just avoid corruption."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": a, "marks": [{"type": "bold"}]},
                    {"type": "text", "text": b, "marks": [{"type": "bold"}, {"type": "italic"}]},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    marks_seen = [
        set(m["type"] for m in n.get("marks") or []) for n in reparsed["content"][0]["content"]
    ]
    assert {"bold", "italic"} in marks_seen, f"italic on the second run was lost: {reparsed}"


@given(a=_ARBITRARY_TEXT, mid=_ARBITRARY_TEXT, b=_ARBITRARY_TEXT)
def test_marked_unmarked_marked_never_bleeds_the_mark_onto_the_middle_run(
    a: str, mid: str, b: str
) -> None:
    """CRITICAL regression: two separately-emitted bold spans around an
    unmarked middle run (e.g. "**Fig.**1**Table**") can have their
    delimiters fused by CommonMark's matcher into one continuous bold span
    that silently bolds the middle text too. Visible text and idempotency
    must both survive regardless of how the verify/fallback path resolves
    the ambiguity."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": a, "marks": [{"type": "bold"}]},
                    {"type": "text", "text": mid},
                    {"type": "text", "text": b, "marks": [{"type": "bold"}]},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    visible = "".join(n.get("text", "") for n in reparsed["content"][0]["content"])
    assert visible == a + mid + b
    assert em.to_markdown(reparsed) == md


def test_marked_unmarked_marked_concrete_fig_table_repro() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Fig.", "marks": [{"type": "bold"}]},
                    {"type": "text", "text": "1"},
                    {"type": "text", "text": "Table", "marks": [{"type": "bold"}]},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    nodes = reparsed["content"][0]["content"]
    assert "".join(n.get("text", "") for n in nodes) == "Fig.1Table"
    # Safe outcomes: "1" survives unmarked as its own node, or (the actual
    # fallback outcome here) the whole ambiguous run degrades to no bold at
    # all. Never acceptable: "1" ending up bold.
    for node in nodes:
        if node.get("text") == "1":
            assert "bold" not in {m["type"] for m in node.get("marks") or []}


@pytest.mark.parametrize(
    "text",
    ["&Mu;", "&amp;", "&#65;", "&#x41;", "&notarealentity;", "A & B & C", "Fish & Chips"],
)
def test_ampersand_is_never_decoded_as_an_html_entity(text: str) -> None:
    """CommonMark's "entity" inline rule decodes "&Mu;" -> "Μ" and
    "&amp;" -> "&" independent of the html option, so literal ampersands in
    essay text must always be escaped or they silently change."""
    doc = _text_doc(text)
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert reparsed["content"][0]["content"][0]["text"] == text
    assert em.to_markdown(reparsed) == md


def test_apply_edits_simultaneous_sibling_edits_in_one_batch_keep_each_items_attrs() -> None:
    """MEDIUM regression: editing two-or-more adjacent list items in a
    single `apply_edits` call makes SequenceMatcher return one multi-item
    replace block instead of separate 1-1 blocks; each sibling's own attrs
    must still survive via positional pairing."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "attrs": {"textAlign": "left"},
                                "content": [{"type": "text", "text": "item one"}],
                            }
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "attrs": {"textAlign": "center"},
                                "content": [{"type": "text", "text": "item two"}],
                            }
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "attrs": {"textAlign": "right"},
                                "content": [{"type": "text", "text": "item three"}],
                            }
                        ],
                    },
                ],
            }
        ],
    }
    result = em.apply_edits(
        doc,
        [
            em.Edit(old_text="item two", new_text="ITEM TWO"),
            em.Edit(old_text="item three", new_text="ITEM THREE"),
        ],
    )
    items = result.new_doc["content"][0]["content"]
    expected = [("left", "item one"), ("center", "ITEM TWO"), ("right", "ITEM THREE")]
    for item, (align, text) in zip(items, expected, strict=True):
        para = item["content"][0]
        assert para["attrs"]["textAlign"] == align
        assert para["content"][0]["text"] == text


@pytest.mark.parametrize(
    "text",
    [
        "# not a heading",
        "## also not a heading",
        "- not a bullet",
        "* not a bullet either",
        "+ not a bullet",
        "1. not a list",
        "42) not a list",
        "> not a quote",
        "```not a fence",
        "~~~not a fence",
        "---",
        "***",
        "___",
        "===",
        "snake_case_stays_readable",
        "_leading underscore_needs escaping",
        "trailing underscore needs escaping_",
        "a*b*c intraword asterisk is emphasis",
        "cost > benefit mid-line angle bracket",
        "5.5 GPA and A+ student and top-notch",
        r"already\_escaped stays literal after round trip",
        "brackets [like this] and code `like this`",
        "+",
        "-",
        "*",
        "1.",
        ">",
        "--",
        "==",
    ],
)
def test_round_trip_preserves_literal_text_that_looks_like_markup(text: str) -> None:
    doc = _text_doc(text)
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    # The literal text must survive completely (not just idempotently).
    only_text_node = reparsed["content"][0]["content"][0]
    assert only_text_node["text"] == text


@pytest.mark.parametrize("second_line", ["--", "-", "==", "="])
def test_hard_break_continuation_that_looks_like_setext_underline_stays_a_paragraph(
    second_line: str,
) -> None:
    """A hard-broken paragraph whose second line is a dash/equals run must
    not retroactively become a heading on reparse (the CRITICAL setext bug:
    "First line\\\\n--" re-parses as an h2 with the trailing "\\\\" leaking
    into the text unless the leading dash/equals run is escaped)."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "First line"},
                    {"type": "hardBreak"},
                    {"type": "text", "text": second_line},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    assert reparsed["content"][0]["type"] == "paragraph"
    assert reparsed["content"][0]["content"][0]["text"] == "First line"


def test_adjacent_code_marked_runs_do_not_fuse_their_backtick_fences() -> None:
    """Two sibling text nodes both carrying the `code` mark must merge into
    one code span instead of each picking its own backtick fence and
    producing a literal "``" inside the reparsed code text."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "a", "marks": [{"type": "code"}]},
                    {"type": "text", "text": "b", "marks": [{"type": "code"}]},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    text_node = reparsed["content"][0]["content"][0]
    assert text_node["text"] == "ab"
    assert {m["type"] for m in text_node["marks"]} == {"code"}


@pytest.mark.parametrize(
    "extra_mark",
    [
        {"type": "underline"},
        {"type": "textStyle", "attrs": {"fontFamily": "Georgia"}},
    ],
)
def test_adjacent_code_runs_merge_even_when_one_carries_a_dropped_mark(
    extra_mark: dict[str, Any],
) -> None:
    """CRITICAL regression: two adjacent `code` atoms must merge before
    picking a backtick fence even when they're distinguishable only by a
    mark this module doesn't render (underline, textStyle, ...) — merging
    on raw mark-list equality (rather than render-relevant marks) let two
    such atoms stay separate, each pick its own fence, and fuse into a
    corrupted "``" inside the reparsed text. Confirmed to also corrupt an
    untouched sibling paragraph through `apply_edits`, since a non-
    idempotent block can never be reused by identity."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "a", "marks": [{"type": "code"}]},
                    {"type": "text", "text": "b", "marks": [{"type": "code"}, extra_mark]},
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    visible = "".join(n.get("text", "") for n in reparsed["content"][0]["content"])
    assert visible == "ab"


def test_adjacent_link_runs_with_same_href_stay_idempotent_despite_a_dropped_mark() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "a",
                        "marks": [{"type": "link", "attrs": {"href": "https://x.com"}}],
                    },
                    {
                        "type": "text",
                        "text": "b",
                        "marks": [
                            {"type": "link", "attrs": {"href": "https://x.com"}},
                            {"type": "underline"},
                        ],
                    },
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    visible = "".join(n.get("text", "") for n in reparsed["content"][0]["content"])
    assert visible == "ab"


def test_link_href_with_unbalanced_paren_does_not_corrupt_the_essay() -> None:
    """W1: a bare `[text](href)` destination containing an unescaped ")" ends
    the link early and leaks the href's tail into the paragraph as literal
    text (e.g. "http://a.com/a)b" -> link text stays "click" but the visible
    paragraph gains junk "b)" and the href truncates to "http://a.com/a").
    The angle-bracket destination form must be used instead so the full href
    and the link mark both survive a render/parse/render round trip.
    """
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [{"type": "link", "attrs": {"href": "http://a.com/a)b"}}],
                    }
                ],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md

    paragraph_content = reparsed["content"][0]["content"]
    visible = "".join(n.get("text", "") for n in paragraph_content)
    assert visible == "click"

    link_marks = [m for n in paragraph_content for m in n.get("marks") or [] if m["type"] == "link"]
    assert len(link_marks) == 1
    assert link_marks[0]["attrs"]["href"] == "http://a.com/a)b"


def test_apply_edits_does_not_corrupt_an_untouched_sibling_paragraph_with_split_code_marks() -> (
    None
):
    """The code-merge fix must also protect `apply_edits`: a non-idempotent
    untouched block can't be reused by identity, so it gets rebuilt from a
    fresh (and, before the fix, corrupted) reparse."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "a", "marks": [{"type": "code"}]},
                    {
                        "type": "text",
                        "text": "b",
                        "marks": [{"type": "code"}, {"type": "textStyle", "attrs": {}}],
                    },
                ],
            },
            {"type": "paragraph", "content": [{"type": "text", "text": "Edit this one."}]},
        ],
    }
    result = em.apply_edits(doc, [em.Edit(old_text="Edit this one.", new_text="Edited.")])
    first_para_text = "".join(n.get("text", "") for n in result.new_doc["content"][0]["content"])
    assert first_para_text == "ab"


def test_code_span_at_paragraph_start_needing_a_wide_fence_is_not_over_escaped() -> None:
    """CRITICAL regression: when a leading inline code span's content
    itself contains backticks, `_code_span` widens its fence (e.g. to 3
    backticks), which makes the *rendered paragraph* start with "```" —
    that must not be mistaken for a fenced-code-block opener and escaped,
    since CommonMark disqualifies a backtick fence whose "info string"
    contains another backtick, so the paragraph could never actually be
    misparsed as a code block in the first place. The old blanket
    leading-backtick escape broke the inline code span's own fence
    matching instead of protecting anything."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "0``", "marks": [{"type": "code"}]}],
            }
        ],
    }
    md = em.to_markdown(doc)
    reparsed = em.to_tiptap(md)
    assert em.to_markdown(reparsed) == md
    node = reparsed["content"][0]["content"][0]
    assert node["text"] == "0``"
    assert {m["type"] for m in node["marks"]} == {"code"}


def test_round_trip_full_document_with_every_supported_node() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 1},
                "content": [{"type": "text", "text": "Salt and Circuits"}],
            },
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "The first thing I ever soldered was "},
                    {"type": "text", "text": "wrong", "marks": [{"type": "italic"}]},
                    {"type": "text", "text": ". The board hissed."},
                ],
            },
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Some "},
                    {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
                    {"type": "text", "text": " and "},
                    {"type": "text", "text": "code", "marks": [{"type": "code"}]},
                    {"type": "text", "text": " and a "},
                    {
                        "type": "text",
                        "text": "link",
                        "marks": [{"type": "link", "attrs": {"href": "https://example.com"}}],
                    },
                    {"type": "hardBreak"},
                    {"type": "text", "text": "after a hard break."},
                ],
            },
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "first"}]}
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "second"}]}
                        ],
                    },
                ],
            },
            {
                "type": "orderedList",
                "attrs": {"start": 3},
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "third"}]}
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "fourth"}]}
                        ],
                    },
                ],
            },
            {
                "type": "blockquote",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "quoted wisdom"}]}
                ],
            },
            {
                "type": "codeBlock",
                "attrs": {"language": "python"},
                "content": [{"type": "text", "text": "print('hi')\nx = 1"}],
            },
            {"type": "horizontalRule"},
        ],
    }
    md = em.to_markdown(doc)
    assert em.to_markdown(em.to_tiptap(md)) == md
    assert "# Salt and Circuits" in md
    assert "*wrong*" in md
    assert "**bold**" in md
    assert "`code`" in md
    assert "[link](https://example.com)" in md
    assert "```python" in md


# --------------------------------------------------------------------------
# Degrade-don't-crash: unknown node types and unknown marks
# --------------------------------------------------------------------------


def test_unknown_node_type_degrades_to_its_text_instead_of_crashing() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "futureNode", "content": [{"type": "text", "text": "still readable"}]}
        ],
    }
    assert em.to_markdown(doc) == "still readable"


def test_underline_and_textstyle_marks_are_dropped_but_do_not_crash() -> None:
    doc = _text_doc(
        "styled text",
        marks=[{"type": "underline"}, {"type": "textStyle", "attrs": {"fontFamily": "Georgia"}}],
    )
    md = em.to_markdown(doc)
    assert md == "styled text"


def test_empty_doc_renders_to_empty_string() -> None:
    empty = {"type": "doc", "content": [{"type": "paragraph"}]}
    assert em.to_markdown(empty) == ""


def test_empty_markdown_parses_to_single_empty_paragraph() -> None:
    assert em.to_tiptap("") == {"type": "doc", "content": [{"type": "paragraph"}]}
    assert em.to_tiptap("   \n  ") == {"type": "doc", "content": [{"type": "paragraph"}]}


# --------------------------------------------------------------------------
# apply_edits: block preservation
# --------------------------------------------------------------------------


def test_apply_edits_replaces_matched_text() -> None:
    doc = _text_doc("The board hissed.")
    result = em.apply_edits(doc, [em.Edit(old_text="hissed", new_text="hissed back")])
    assert result.applied == 1
    assert em.to_markdown(result.new_doc) == "The board hissed back."


def test_apply_edits_leaves_untouched_blocks_byte_identical() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"textAlign": "center"},
                "content": [{"type": "text", "text": "Untouched heading paragraph."}],
            },
            {"type": "paragraph", "content": [{"type": "text", "text": "Edit this one."}]},
        ],
    }
    result = em.apply_edits(doc, [em.Edit(old_text="Edit this one.", new_text="Edited.")])
    # Identity, not just equality: the untouched block is the same object.
    assert result.new_doc["content"][0] is doc["content"][0]
    assert result.new_doc["content"][1] is not doc["content"][1]
    assert em.to_markdown(result.new_doc).splitlines()[0] == "Untouched heading paragraph."


def test_apply_edits_1to1_replacement_carries_old_block_attrs() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {"textAlign": "center"},
                "content": [{"type": "text", "text": "Centered original text."}],
            }
        ],
    }
    result = em.apply_edits(doc, [em.Edit(old_text="original", new_text="revised")])
    new_block = result.new_doc["content"][0]
    assert new_block["attrs"]["textAlign"] == "center"
    assert em.to_markdown(result.new_doc) == "Centered original text.".replace(
        "original", "revised"
    )


def test_apply_edits_inside_one_list_item_preserves_attrs_on_sibling_items() -> None:
    """CRITICAL regression: editing text in list item 2 must not blow away
    item 1's textAlign, even though the whole bulletList's rendered markdown
    changes as a single top-level block."""
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {
                                "type": "paragraph",
                                "attrs": {"textAlign": "center"},
                                "content": [{"type": "text", "text": "item one"}],
                            }
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "item two"}]}
                        ],
                    },
                ],
            }
        ],
    }
    result = em.apply_edits(doc, [em.Edit(old_text="item two", new_text="ITEM TWO")])
    item_one_para = result.new_doc["content"][0]["content"][0]["content"][0]
    assert item_one_para["attrs"]["textAlign"] == "center"
    item_two_para = result.new_doc["content"][0]["content"][1]["content"][0]
    assert item_two_para["content"][0]["text"] == "ITEM TWO"


def test_apply_edits_inside_blockquote_preserves_attrs_on_sibling_paragraphs() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "blockquote",
                "content": [
                    {
                        "type": "paragraph",
                        "attrs": {"textAlign": "right"},
                        "content": [{"type": "text", "text": "quoted one"}],
                    },
                    {"type": "paragraph", "content": [{"type": "text", "text": "quoted two"}]},
                ],
            }
        ],
    }
    result = em.apply_edits(doc, [em.Edit(old_text="quoted two", new_text="QUOTED TWO")])
    first_para = result.new_doc["content"][0]["content"][0]
    assert first_para["attrs"]["textAlign"] == "right"
    second_para = result.new_doc["content"][0]["content"][1]
    assert second_para["content"][0]["text"] == "QUOTED TWO"


def test_apply_edits_earlier_edit_creating_a_duplicate_makes_later_edit_ambiguous() -> None:
    """An edit batch is applied sequentially against the evolving projection,
    so if edit 1 produces a second occurrence of edit 2's old_text, edit 2
    must fail ambiguous rather than silently picking one."""
    doc = _text_doc("alpha beta")
    with pytest.raises(em.EssayEditError) as exc_info:
        em.apply_edits(
            doc,
            [
                em.Edit(old_text="alpha", new_text="beta"),
                em.Edit(old_text="beta", new_text="gamma"),
            ],
        )
    assert exc_info.value.index == 1
    assert exc_info.value.reason == "ambiguous"


def test_apply_edits_heading_level_change_overrides_attrs_but_keeps_align() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 1, "textAlign": "right"},
                "content": [{"type": "text", "text": "Title"}],
            }
        ],
    }
    result = em.apply_edits(doc, [em.Edit(old_text="# Title", new_text="## Title")])
    new_block = result.new_doc["content"][0]
    assert new_block["attrs"]["level"] == 2
    assert new_block["attrs"]["textAlign"] == "right"


def test_apply_edits_new_text_empty_deletes_matched_text() -> None:
    doc = _text_doc("Keep this. Remove this part. Keep this too.")
    result = em.apply_edits(doc, [em.Edit(old_text="Remove this part. ", new_text="")])
    assert em.to_markdown(result.new_doc) == "Keep this. Keep this too."


def test_apply_edits_batch_applies_sequentially_against_evolving_projection() -> None:
    doc = _text_doc("one two three")
    result = em.apply_edits(
        doc,
        [
            em.Edit(old_text="one", new_text="ONE"),
            em.Edit(old_text="ONE two", new_text="ONE TWO"),
        ],
    )
    assert result.applied == 2
    assert em.to_markdown(result.new_doc) == "ONE TWO three"


def test_apply_edits_not_found_raises_with_index_and_reason() -> None:
    doc = _text_doc("hello world")
    with pytest.raises(em.EssayEditError) as exc_info:
        em.apply_edits(doc, [em.Edit(old_text="goodbye", new_text="hi")])
    assert exc_info.value.index == 0
    assert exc_info.value.reason == "not_found"


def test_apply_edits_ambiguous_raises_with_index_and_reason() -> None:
    doc = _text_doc("repeat repeat")
    with pytest.raises(em.EssayEditError) as exc_info:
        em.apply_edits(doc, [em.Edit(old_text="repeat", new_text="once")])
    assert exc_info.value.index == 0
    assert exc_info.value.reason == "ambiguous"
    assert "2 occurrences" in exc_info.value.detail


def test_apply_edits_all_or_nothing_second_edit_failure_raises_without_mutating_input() -> None:
    doc = _text_doc("one two three")
    original_md = em.to_markdown(doc)
    with pytest.raises(em.EssayEditError) as exc_info:
        em.apply_edits(
            doc,
            [
                em.Edit(old_text="one", new_text="ONE"),
                em.Edit(old_text="nonexistent", new_text="x"),
            ],
        )
    assert exc_info.value.index == 1
    # The input doc must be untouched — apply_edits never mutates in place.
    assert em.to_markdown(doc) == original_md


def test_apply_edits_not_found_hints_at_normalized_match() -> None:
    doc = _text_doc("Hello   World")
    with pytest.raises(em.EssayEditError) as exc_info:
        em.apply_edits(doc, [em.Edit(old_text="hello world", new_text="x")])
    assert "re-read" in exc_info.value.detail
