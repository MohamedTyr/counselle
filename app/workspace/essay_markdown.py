"""Tiptap JSON <-> markdown projection for the essay content tools.

The agent never sees or produces Tiptap JSON (ADR 0030). ``to_markdown``
renders a Tiptap doc the way ``read_essay`` presents it; ``to_tiptap`` parses
a full markdown string back (used for ``write_essay`` and initial drafts);
``apply_edits`` is the ``edit_essay`` engine — it re-renders the doc as
top-level markdown blocks, applies exact-string replacements against that
projection, re-parses only the edited result, and reuses the original JSON
node for every block whose rendered markdown is unchanged so student-set
block attrs (``textAlign``) and marks the parser can't produce survive edits
elsewhere in the document.

Parsing never fails — any string is valid markdown (worst case, one plain
paragraph) — so callers only need to handle ``EssayEditError`` from
``apply_edits``, never a parse error.

Known limitation: CommonMark itself trims leading/trailing whitespace from a
paragraph line (space, tab, and other Unicode whitespace), so a block edited
via ``apply_edits`` that happens to start or end with literal whitespace
loses it on that block's next reparse — untouched blocks are unaffected
since they're reused by identity, not reparsed. Essay prose essentially
never carries meaningful leading/trailing whitespace, so this is accepted
rather than worked around.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Literal

from markdown_it import MarkdownIt
from markdown_it.token import Token

# HTML is disabled: the editor schema has no raw-HTML node, so treating
# "<b>" as literal text (rather than an html_block/html_inline token this
# module would otherwise have to degrade) keeps parsing total and avoids
# inventing an escaping story for angle brackets.
_MD = MarkdownIt("commonmark", {"html": False}).enable("strikethrough")

_INLINE_MARK_MAP = {"strong": "bold", "em": "italic", "s": "strike", "a": "link"}

# "&" is escaped even though html_block/html_inline are disabled: CommonMark
# entity references ("&Mu;", "&#65;", "&amp;") are handled by a separate
# core "entity" rule that fires regardless of the html option, decoding a
# literal "&Mu;" in essay text into "Μ".
_ALWAYS_ESCAPE = set("\\`*~[]<&")

_ATX_RE = re.compile(r"^#{1,6}(\s|$)")
_BULLET_RE = re.compile(r"^[-*+](\s|$)")
_ORDERED_RE = re.compile(r"^(\d+)([.)])(\s|$)")
_BLOCKQUOTE_RE = re.compile(r"^>")
_BACKTICK_FENCE_RE = re.compile(r"^(`{3,})(.*)$")
_TILDE_FENCE_RE = re.compile(r"^~{3,}")
_THEMATIC_BREAK_RE = re.compile(r"^ {0,3}([-*_])( ?\1){2,}\s*$")
# Setext underlines: a line of only "=" (H1) or only "-" (H2) turns the
# *previous* line into a heading. "-" overlaps with _BULLET_RE (single "-")
# and _THEMATIC_BREAK_RE (3+ dashes) for most counts, but a bare "--" (and
# only "--") slips through both, so it needs its own check.
_SETEXT_RE = re.compile(r"^ {0,3}=+\s*$")
_SETEXT_DASH_RE = re.compile(r"^ {0,3}-+\s*$")


@dataclass(frozen=True)
class Edit:
    old_text: str
    new_text: str


@dataclass(frozen=True)
class EditResult:
    """``new_doc`` aliases unchanged nodes from the input doc by reference
    (that's how block preservation is achieved — see ``apply_edits``), so it
    is not independent of the doc that was passed in. ``apply_edits`` itself
    never mutates that input, but a caller that later mutates ``new_doc`` in
    place must not assume the original doc is unaffected."""

    new_doc: dict[str, Any]
    applied: int


class EssayEditError(Exception):
    """Raised by ``apply_edits`` when an edit's ``old_text`` can't be applied.

    ``index`` is the 0-based position of the failing edit in the batch;
    ``reason`` is ``"not_found"`` or ``"ambiguous"``; ``detail`` is a
    human-readable message a tool layer can surface directly.
    """

    def __init__(self, index: int, reason: Literal["not_found", "ambiguous"], detail: str) -> None:
        self.index = index
        self.reason = reason
        self.detail = detail
        super().__init__(detail)


# --------------------------------------------------------------------------
# Serializer: Tiptap doc -> markdown
# --------------------------------------------------------------------------


def to_markdown(doc: dict[str, Any]) -> str:
    blocks = doc.get("content") or []
    return "\n\n".join(_serialize_block(block) for block in blocks)


def _serialize_block(node: dict[str, Any]) -> str:
    node_type = node.get("type")
    if node_type == "paragraph":
        return _escape_block_leading(_serialize_inline_content(node.get("content") or []))
    if node_type == "heading":
        level = min(6, max(1, node.get("attrs", {}).get("level", 1)))
        text = _escape_block_leading(_serialize_inline_content(node.get("content") or []))
        return f"{'#' * level} {text}"
    if node_type == "bulletList":
        return _serialize_list(node, ordered=False)
    if node_type == "orderedList":
        return _serialize_list(node, ordered=True)
    if node_type == "blockquote":
        return _serialize_blockquote(node)
    if node_type == "codeBlock":
        return _serialize_code_block(node)
    if node_type == "horizontalRule":
        return "---"
    # Unknown node type (future editor extension): degrade to a plain-text
    # paragraph of every descendant "text" field rather than crashing.
    text = "".join(_collect_text(node))
    return _escape_block_leading(_escape_inline(text))


def _collect_text(node: Any) -> list[str]:
    if isinstance(node, dict):
        pieces = [node["text"]] if isinstance(node.get("text"), str) else []
        for child in node.get("content", []):
            pieces.extend(_collect_text(child))
        return pieces
    if isinstance(node, list):
        out: list[str] = []
        for child in node:
            out.extend(_collect_text(child))
        return out
    return []


# Nesting order (outside-in) for the wrap-style marks — the ones whose
# delimiter is the same character on open and close, so two adjacent runs
# that are each wrapped independently can fuse into one longer (and wrong)
# delimiter run at the boundary, e.g. bold "a" next to bold+italic "b" would
# naively serialize as "**a****_b_**", which re-parses as "a" bold, then a
# literal "**", then "b" italic, then a literal "**". Grouping consecutive
# runs that share a mark under a single wrap (recursing per mark level)
# means each delimiter appears exactly once at its span's real boundary:
# "**a_b_**". Code and link are handled per-leaf below instead, since their
# delimiters (backtick fence picked per run; brackets/parens) don't have
# this same-character-touching hazard between *different* runs.
_WRAP_MARKS = ("bold", "italic", "strike")
# Italic uses "*" rather than "_": CommonMark suppresses "_..._" emphasis
# when both flanking characters are alphanumeric ("intraword emphasis"),
# which is exactly the boundary produced when a plain-text run is
# immediately followed by a bold+italic run inside the same bold wrap
# ("**a_b_**" fails to reparse "b" as italic — "a" and "b" flank the "_"
# on both sides). "*" has no such exception and CommonMark's delimiter-run
# algorithm still nests it correctly against an adjacent "**" bold marker.
_WRAP_DELIM = {"bold": "**", "italic": "*", "strike": "~~"}


def _serialize_inline_content(content: list[dict[str, Any]]) -> str:
    atoms = _flatten_inline_atoms(content)
    grouped = _serialize_group(atoms, 0)
    if _inline_round_trips(atoms, grouped):
        return grouped
    # CommonMark's delimiter-matching algorithm doesn't always pair two
    # separately-emitted "**"/"*"/"~~" runs the way this module intends —
    # depending on the flanking punctuation, two runs meant as sibling spans
    # can nest instead (turning "**a**b**c**" into one continuous bold span
    # that "bleeds" onto the unmarked "b"), or a run can be unparseable as
    # emphasis at all (e.g. italic around a lone punctuation character next
    # to a digit), leaking delimiter characters into the visible text.
    # Either failure is worse than losing formatting, so verify the grouped
    # output reproduces both the exact text *and* which spans of it carry
    # bold/italic/strike, and if it doesn't, fall back to a plain-escaped
    # rendering that drops bold/italic/strike (keeping code/link, which have
    # no equivalent ambiguity) for this run. Re-merge after dropping marks:
    # two atoms that used to differ only by a wrap mark are now identical,
    # and escaping must see them as one combined span (see
    # `_merge_text_atoms`) to stay idempotent under re-parsing.
    stripped = _merge_text_atoms([_drop_wrap_marks(a) for a in atoms])
    return "".join(_serialize_leaf(a) for a in stripped)


def _drop_wrap_marks(atom: dict[str, Any]) -> dict[str, Any]:
    if atom.get("type") != "text":
        return atom
    marks = [m for m in atom.get("marks") or [] if m["type"] not in _WRAP_MARKS]
    return {**atom, "marks": marks}


def _inline_round_trips(atoms: list[dict[str, Any]], markdown: str) -> bool:
    """True if reparsing ``markdown`` reproduces both the exact text and the
    same bold/italic/strike spans as ``atoms`` — not just the same text.
    Comparing only text would miss "mark bleed": CommonMark can fuse two
    separately-emitted same-character delimiter runs into one continuous
    span, silently applying a mark to characters that never had it.
    """
    expected_text = "".join(a.get("text", "") for a in atoms if a.get("type") == "text")
    reparsed = _parse_inline_fragment(markdown)
    actual_text = "".join(a.get("text", "") for a in reparsed if a.get("type") == "text")
    if actual_text != expected_text:
        return False
    return _wrap_mark_spans(atoms) == _wrap_mark_spans(reparsed)


def _wrap_mark_spans(atoms: list[dict[str, Any]]) -> list[tuple[int, frozenset[str]]]:
    """Contiguous (text length, {bold/italic/strike}) runs, collapsing
    adjacent atoms with an identical wrap-mark set — the same normalization
    both a fresh doc's atoms and a reparsed fragment's atoms go through, so
    two structurally-equivalent mark layouts compare equal regardless of
    how many underlying text nodes each happens to be split into."""
    text_atoms = [a for a in atoms if a.get("type") == "text"]
    spans: list[tuple[int, frozenset[str]]] = []
    for atom in text_atoms:
        marks = frozenset(m["type"] for m in (atom.get("marks") or []) if m["type"] in _WRAP_MARKS)
        length = len(atom.get("text", ""))
        if spans and spans[-1][1] == marks:
            spans[-1] = (spans[-1][0] + length, marks)
        else:
            spans.append((length, marks))
    return spans


def _parse_inline_fragment(markdown: str) -> list[dict[str, Any]]:
    for tok in _MD.parse(markdown):
        if tok.type == "inline":
            return _parse_inline(tok)
    return []


def _flatten_inline_atoms(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten to text/hardBreak leaves (degrading unknown inline nodes to
    their own children) and merge adjacent text nodes with an identical
    mark set — otherwise two adjacent same-mark runs (most commonly two
    ``code`` runs) would each pick their own delimiter and touch, e.g.
    "`a``b`" re-parsing as one code span with a literal "``" inside it."""
    flat: list[dict[str, Any]] = []
    for node in content:
        node_type = node.get("type")
        if node_type in ("text", "hardBreak"):
            flat.append(node)
        else:
            flat.extend(_flatten_inline_atoms(node.get("content") or []))
    return _merge_text_atoms(flat)


def _merge_text_atoms(atoms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge adjacent text atoms sharing an identical mark set into one.

    Escaping decisions (the intraword-underscore exception) are made per
    atom's own text, so an underscore sitting right at an atom boundary
    escapes defensively even when the *combined* text wouldn't need it.
    Without this merge, that boundary-conservative escape wouldn't survive
    a parse-reparse cycle: parsing drops the now-meaningless atom boundary,
    producing one bigger atom whose interior underscore no longer needs
    escaping — a different (unescaped) string than the original, breaking
    the round-trip invariant. Merging first (both before serializing and
    after ``_drop_wrap_marks`` strips marks in the fallback path) keeps
    atom boundaries — and therefore escaping decisions — stable across
    generations.
    """
    merged: list[dict[str, Any]] = []
    for atom in atoms:
        if (
            merged
            and atom.get("type") == "text"
            and merged[-1].get("type") == "text"
            and _marks_key(merged[-1]) == _marks_key(atom)
        ):
            merged[-1] = {**merged[-1], "text": merged[-1]["text"] + atom.get("text", "")}
        else:
            merged.append(atom)
    return merged


def _serialize_group(atoms: list[dict[str, Any]], level: int) -> str:
    if level >= len(_WRAP_MARKS):
        return "".join(_serialize_leaf(a) for a in atoms)
    mark = _WRAP_MARKS[level]
    parts: list[str] = []
    i = 0
    while i < len(atoms):
        if not _atom_has_mark(atoms[i], mark):
            parts.append(_serialize_group([atoms[i]], level + 1))
            i += 1
            continue
        j = i
        while j < len(atoms) and _atom_has_mark(atoms[j], mark):
            j += 1
        inner = _serialize_group(atoms[i:j], level + 1)
        parts.append(f"{_WRAP_DELIM[mark]}{inner}{_WRAP_DELIM[mark]}")
        i = j
    return "".join(parts)


def _atom_has_mark(atom: dict[str, Any], mark: str) -> bool:
    if atom.get("type") != "text":
        return False
    return mark in {m["type"] for m in atom.get("marks") or []}


def _serialize_leaf(atom: dict[str, Any]) -> str:
    if atom.get("type") == "hardBreak":
        return "\\\n"
    marks = atom.get("marks") or []
    mark_types = {m["type"] for m in marks}
    raw = atom.get("text", "")
    text = _code_span(raw) if "code" in mark_types else _escape_inline(raw)
    link = next((m for m in marks if m["type"] == "link"), None)
    if link is not None:
        href = (link.get("attrs") or {}).get("href", "")
        text = f"[{text}]({_link_destination(href)})"
    return text


_UNSAFE_BARE_HREF = re.compile(r"[ \t\n<>]")


def _link_destination(href: str) -> str:
    """Angle-bracket form for destinations CommonMark won't take bare.

    CommonMark only accepts an unescaped (bare) link destination when it has
    no ASCII whitespace/"<"/">" and balanced parens; otherwise the bare form
    isn't a link at all and re-parses as literal text, silently rewriting the
    student's essay. Falling back to the angle-bracket form for exactly the
    hrefs that would fail keeps every other href's rendering unchanged.
    """
    if _UNSAFE_BARE_HREF.search(href) or not _parens_balanced(href):
        return "<" + href.replace("\\", "\\\\").replace("<", "\\<").replace(">", "\\>") + ">"
    return href


def _parens_balanced(href: str) -> bool:
    depth = 0
    for ch in href:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _code_span(text: str) -> str:
    max_run = 0
    run = 0
    for ch in text:
        if ch == "`":
            run += 1
            max_run = max(max_run, run)
        else:
            run = 0
    fence = "`" * (max_run + 1)
    if (
        not text
        or text.startswith("`")
        or text.endswith("`")
        or text.startswith(" ")
        or text.endswith(" ")
    ):
        return f"{fence} {text} {fence}"
    return f"{fence}{text}{fence}"


def _serialize_list(node: dict[str, Any], *, ordered: bool) -> str:
    items = node.get("content") or []
    start = node.get("attrs", {}).get("start", 1) if ordered else None
    lines: list[str] = []
    for i, item in enumerate(items):
        marker = f"{(start or 1) + i}." if ordered else "-"
        content = _serialize_list_item(item)
        content_lines = content.split("\n") if content else [""]
        indent = " " * (len(marker) + 1)
        first = f"{marker} {content_lines[0]}".rstrip() if content_lines[0] else marker
        rest = [indent + line if line else "" for line in content_lines[1:]]
        lines.append("\n".join([first, *rest]))
    return "\n".join(lines)


def _serialize_list_item(item: dict[str, Any]) -> str:
    children = item.get("content") or []
    return "\n\n".join(_serialize_block(c) for c in children)


def _serialize_blockquote(node: dict[str, Any]) -> str:
    children = node.get("content") or []
    inner = "\n\n".join(_serialize_block(c) for c in children)
    return "\n".join(f"> {line}" if line else ">" for line in inner.split("\n"))


def _serialize_code_block(node: dict[str, Any]) -> str:
    text = "".join(c.get("text", "") for c in node.get("content") or [])
    lang = (node.get("attrs") or {}).get("language") or ""
    max_run = max((len(m) for m in re.findall(r"`+", text)), default=0)
    fence = "`" * max(3, max_run + 1)
    return f"{fence}{lang}\n{text}\n{fence}"


def _escape_inline(text: str) -> str:
    """Escape characters that would otherwise be reinterpreted as markup.

    Underscore gets the CommonMark intraword-emphasis exception (``_`` is
    only special when at least one side is a non-alphanumeric boundary) so
    ``snake_case_words`` stay readable; every other markup character is
    always escaped since CommonMark has no equivalent exception for them.
    """
    out: list[str] = []
    n = len(text)
    for i, ch in enumerate(text):
        if ch in _ALWAYS_ESCAPE:
            out.append("\\" + ch)
        elif ch == "_":
            prev_alnum = i > 0 and text[i - 1].isalnum()
            next_alnum = i + 1 < n and text[i + 1].isalnum()
            out.append("_" if prev_alnum and next_alnum else "\\_")
        else:
            out.append(ch)
    return "".join(out)


def _escape_block_leading(text: str) -> str:
    """Escape each line's leading char if it would parse as a block marker.

    Applied after inline escaping, per rendered line, so a paragraph whose
    text happens to start with ``"# "`` or ``"1. "`` round-trips as plain
    text instead of becoming a heading or list on re-parse.
    """
    return "\n".join(_escape_leading_line(line) for line in text.split("\n"))


def _escape_leading_line(line: str) -> str:
    if not line:
        return line
    ordered = _ORDERED_RE.match(line)
    if ordered:
        digits, delim = ordered.group(1), ordered.group(2)
        # A backslash can't escape a digit (CommonMark only allows escaping
        # ASCII punctuation), so escape the delimiter instead: "1\. text".
        return f"{digits}\\{delim}{line[ordered.end(2) :]}"
    if (
        _ATX_RE.match(line)
        or _BULLET_RE.match(line)
        or _BLOCKQUOTE_RE.match(line)
        or _looks_like_fence_open(line)
        or _THEMATIC_BREAK_RE.match(line)
        or _SETEXT_RE.match(line)
        or _SETEXT_DASH_RE.match(line)
    ):
        return "\\" + line
    return line


def _looks_like_fence_open(line: str) -> bool:
    """Whether ``line`` risks being parsed as a fenced-code-block opener.

    A backtick fence's info string can't itself contain a backtick
    (CommonMark), so a line like "```code``` more text" — which is exactly
    what a leading inline code span with a 3-backtick fence renders as —
    already can't be misread as a fence opener and must NOT be escaped: the
    naive "any line starting with 3+ backticks" check used to prepend a
    backslash here too, which broke the inline code span's own fence
    matching instead of protecting anything (there was nothing to protect
    against). Tilde fences have no such disqualifying rule, so they stay
    conservative.
    """
    backtick_match = _BACKTICK_FENCE_RE.match(line)
    if backtick_match:
        return "`" not in backtick_match.group(2)
    return bool(_TILDE_FENCE_RE.match(line))


# --------------------------------------------------------------------------
# Parser: markdown -> Tiptap doc
# --------------------------------------------------------------------------


def to_tiptap(markdown: str) -> dict[str, Any]:
    blocks = _parse_markdown_blocks(markdown)
    return {"type": "doc", "content": blocks or [{"type": "paragraph"}]}


def _parse_markdown_blocks(markdown: str) -> list[dict[str, Any]]:
    if not markdown.strip():
        return []
    return _parse_blocks(_MD.parse(markdown))


def _parse_blocks(tokens: list[Token]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok.type == "paragraph_open":
            content = _parse_inline(tokens[i + 1])
            node: dict[str, Any] = {"type": "paragraph"}
            if content:
                node["content"] = content
            blocks.append(node)
            i += 3
        elif tok.type == "heading_open":
            level = int(tok.tag[1])
            content = _parse_inline(tokens[i + 1])
            node = {"type": "heading", "attrs": {"level": level}}
            if content:
                node["content"] = content
            blocks.append(node)
            i += 3
        elif tok.type == "bullet_list_open":
            end = _find_close(tokens, i, "bullet_list_close")
            blocks.append(_parse_list(tokens[i : end + 1], ordered=False))
            i = end + 1
        elif tok.type == "ordered_list_open":
            end = _find_close(tokens, i, "ordered_list_close")
            blocks.append(_parse_list(tokens[i : end + 1], ordered=True))
            i = end + 1
        elif tok.type == "blockquote_open":
            end = _find_close(tokens, i, "blockquote_close")
            blocks.append({"type": "blockquote", "content": _parse_blocks(tokens[i + 1 : end])})
            i = end + 1
        elif tok.type in ("fence", "code_block"):
            blocks.append(_parse_code_block(tok))
            i += 1
        elif tok.type == "hr":
            blocks.append({"type": "horizontalRule"})
            i += 1
        else:
            # Unknown/unsupported block token (e.g. html_block never fires
            # since html is disabled): skip rather than lose the run silently.
            i += 1
    return blocks


def _parse_code_block(tok: Token) -> dict[str, Any]:
    text = tok.content.rstrip("\n")
    node: dict[str, Any] = {"type": "codeBlock"}
    if text:
        node["content"] = [{"type": "text", "text": text}]
    lang = tok.info.strip() if tok.type == "fence" else ""
    if lang:
        node["attrs"] = {"language": lang}
    return node


def _parse_list(tokens: list[Token], *, ordered: bool) -> dict[str, Any]:
    open_tok = tokens[0]
    items: list[dict[str, Any]] = []
    i = 1
    end = len(tokens) - 1
    while i < end:
        if tokens[i].type == "list_item_open":
            close = _find_close(tokens, i, "list_item_close")
            items.append({"type": "listItem", "content": _parse_blocks(tokens[i + 1 : close])})
            i = close + 1
        else:
            i += 1
    node: dict[str, Any] = {"type": "orderedList" if ordered else "bulletList", "content": items}
    if ordered:
        start = int((open_tok.attrs or {}).get("start", 1))
        if start != 1:
            node["attrs"] = {"start": start}
    return node


def _find_close(tokens: list[Token], open_idx: int, close_type: str) -> int:
    level = tokens[open_idx].level
    for j in range(open_idx + 1, len(tokens)):
        if tokens[j].type == close_type and tokens[j].level == level:
            return j
    raise ValueError(f"unbalanced token stream: no {close_type} for index {open_idx}")


def _parse_inline(inline_token: Token) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    active_marks: list[dict[str, Any]] = []
    for child in inline_token.children or []:
        if child.type == "text":
            if child.content:
                nodes.append(_text_node(child.content, active_marks))
        elif child.type == "softbreak":
            nodes.append(_text_node(" ", active_marks))
        elif child.type == "hardbreak":
            nodes.append({"type": "hardBreak"})
        elif child.type == "code_inline":
            nodes.append(_text_node(child.content, [*active_marks, {"type": "code"}]))
        elif child.type.endswith("_open"):
            mark_type = _INLINE_MARK_MAP.get(child.tag)
            if mark_type == "link":
                active_marks.append(
                    {"type": "link", "attrs": {"href": (child.attrs or {}).get("href", "")}}
                )
            elif mark_type is not None and mark_type not in {m["type"] for m in active_marks}:
                # CommonMark's delimiter matching can nest two "**" runs
                # instead of treating them as sibling spans (e.g.
                # "**a**b**c**" can pair as open-open-close-close rather
                # than open-close-open-close); without this guard that
                # nesting would push a duplicate {"type": "bold"} mark.
                active_marks.append({"type": mark_type})
        elif child.type.endswith("_close"):
            mark_type = _INLINE_MARK_MAP.get(child.tag)
            if mark_type is not None:
                for idx in range(len(active_marks) - 1, -1, -1):
                    if active_marks[idx]["type"] == mark_type:
                        active_marks.pop(idx)
                        break
        # Other inline token types (none expected with html disabled) are dropped.
    return _merge_adjacent_text(nodes)


def _text_node(text: str, marks: list[dict[str, Any]]) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def _merge_adjacent_text(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for node in nodes:
        if (
            merged
            and node.get("type") == "text"
            and merged[-1].get("type") == "text"
            and _marks_key(merged[-1]) == _marks_key(node)
        ):
            merged[-1] = {**merged[-1], "text": merged[-1]["text"] + node["text"]}
        else:
            merged.append(node)
    return merged


_RENDER_MARK_TYPES = frozenset({*_WRAP_MARKS, "code", "link"})


def _marks_key(node: dict[str, Any]) -> tuple[Any, ...]:
    """Merge-equality key for adjacent text atoms — deliberately scoped to
    only the marks this module actually renders (bold/italic/strike/code/
    link), not the raw mark list. Marks it drops (underline, textStyle,
    ...) must never block a merge: two atoms distinguishable only by a mark
    neither serializer nor parser renders would otherwise stay separate
    leaves and each pick its own delimiter/fence independently — e.g. two
    adjacent ``code`` atoms, one carrying an extra unsupported mark, fusing
    their backtick fences into "``" and leaking literal backticks into the
    reparsed text (the exact bug ``_merge_text_atoms`` exists to prevent).
    """
    marks = node.get("marks") or []
    relevant = [m for m in marks if m["type"] in _RENDER_MARK_TYPES]
    return tuple(
        sorted((m["type"], tuple(sorted((m.get("attrs") or {}).items()))) for m in relevant)
    )


# --------------------------------------------------------------------------
# Block-preserving edits
# --------------------------------------------------------------------------


def apply_edits(doc: dict[str, Any], edits: list[Edit]) -> EditResult:
    old_blocks: list[dict[str, Any]] = doc.get("content") or []
    old_mds = [_serialize_block(b) for b in old_blocks]
    current = "\n\n".join(old_mds)

    applied = 0
    for index, edit in enumerate(edits):
        count = current.count(edit.old_text)
        if count == 0:
            raise EssayEditError(index, "not_found", _not_found_detail(current, edit.old_text))
        if count > 1:
            raise EssayEditError(
                index,
                "ambiguous",
                f"found {count} occurrences — include more surrounding text to make it unique",
            )
        current = current.replace(edit.old_text, edit.new_text, 1)
        applied += 1

    new_blocks = _parse_markdown_blocks(current)
    reused = _align_container(old_blocks, new_blocks, _serialize_block)
    return EditResult(
        new_doc={"type": "doc", "content": reused or [{"type": "paragraph"}]}, applied=applied
    )


def _not_found_detail(current: str, old_text: str) -> str:
    normalized_target = re.sub(r"\s+", " ", old_text).strip().lower()
    normalized_current = re.sub(r"\s+", " ", current).lower()
    if normalized_target and normalized_target in normalized_current:
        return (
            "text not found verbatim, but a case- or whitespace-normalized match exists — "
            "did the text change? re-read the essay"
        )
    return (
        "text not found in the essay — re-read the essay and rebuild the edit against the "
        "current text"
    )


def _align_container(
    old_children: list[dict[str, Any]],
    new_children: list[dict[str, Any]],
    render: Callable[[dict[str, Any]], str],
) -> list[dict[str, Any]]:
    """Diff one container's own children (top-level doc blocks, a
    blockquote's blocks, a list's items, or a list item's blocks) by their
    rendered markdown and reuse old objects for unchanged children.

    Recursing this per-container — rather than only at the top level — is
    what makes attrs survive an edit *inside* a list or blockquote: editing
    one list item changes that whole list's rendered markdown, so the diff
    against ``doc.content`` alone would see one big "replace" on the list
    and rebuild every item from scratch, losing attrs on the untouched
    ones. Diffing the list's own item sequence isolates the change to just
    the edited item.

    Alignment keys are rendered markdown, not any node identity — two
    distinct children that happen to render identically (e.g. two one-line
    paragraphs both reading "Conclusion", one centered) are indistinguishable
    to the matcher. An edit elsewhere that shifts child positions could then
    pair the wrong old child with a new position. Rare in practice (essays
    don't tend to repeat an exact line), and never a text-correctness issue
    — at worst a block-attrs mismatch for that specific repeated line.

    Same caveat applies to the same-length "replace" branch below: when an
    edit batch changes several adjacent siblings with zero textual overlap
    to their old versions in one call, positional pairing is a heuristic
    (attach old child N's attrs to new child N), not a content-based
    correspondence — e.g. an edit batch that effectively swaps two
    paragraphs' text in one call would pair each new paragraph with the
    *other* one's old attrs. Still never text-corrupting, only ever a
    formatting-attribution risk.
    """
    old_mds = [render(c) for c in old_children]
    new_mds = [render(c) for c in new_children]
    matcher = SequenceMatcher(a=old_mds, b=new_mds, autojunk=False)
    result: list[dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            result.extend(old_children[i1:i2])
        elif tag == "replace" and i2 - i1 == j2 - j1:
            # Same count on both sides: an edit batch touching several
            # adjacent siblings in one call (e.g. two list items edited in
            # the same `apply_edits` call) makes SequenceMatcher return one
            # multi-item "replace" block instead of several 1-1 blocks.
            # Pairing positionally still carries each old sibling's own
            # attrs onto its corresponding new sibling, same as the
            # single-item case below (which this now subsumes).
            result.extend(
                _carry_node(old_children[i1 + k], new_children[j1 + k]) for k in range(i2 - i1)
            )
        else:
            result.extend(new_children[j1:j2])
    return result


def _carry_node(old_node: dict[str, Any], new_node: dict[str, Any]) -> dict[str, Any]:
    """1-node -> 1-node replacement of the same type: keep the old node's
    attrs (e.g. ``textAlign``) that the markdown grammar can't re-derive,
    letting the new node's own attrs (e.g. a changed heading ``level``)
    override where it actually specified one — then, for containers, recurse
    into children instead of taking them wholesale from the fresh parse."""
    if old_node.get("type") != new_node.get("type"):
        return new_node
    node_type = new_node.get("type")
    merged_attrs = {**(old_node.get("attrs") or {}), **(new_node.get("attrs") or {})}
    merged = dict(new_node)
    if merged_attrs:
        merged["attrs"] = merged_attrs
    else:
        merged.pop("attrs", None)

    if node_type in ("blockquote", "listItem"):
        merged["content"] = _align_container(
            old_node.get("content") or [], new_node.get("content") or [], _serialize_block
        )
    elif node_type in ("bulletList", "orderedList"):
        merged["content"] = _align_container(
            old_node.get("content") or [], new_node.get("content") or [], _serialize_list_item
        )
    return merged
