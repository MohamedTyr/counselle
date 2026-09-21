import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import {
  addRange,
  coveredLength,
  type Offset,
  subtractRange,
  totalLength,
  unionRanges,
} from "./sat-highlighter";

/** The two highlightable fields (plan §6.3, Q33a) — never options, rationale,
 * history or chrome. */
export type SatHighlightField = "stimulus" | "stem";

export interface SatHighlightFieldRef {
  field: SatHighlightField;
  ref: RefObject<HTMLElement | null>;
}

export interface UseSatHighlighterOptions {
  /** Highlights are dropped on question change (Q34) — never persisted. */
  questionId: string | number;
  /** Highlight mode: R&W questions only, and only while the toolbar toggle
   * is on. The flag itself is the caller's session state (Q33a); this hook
   * only reacts to whatever value it is given. */
  active: boolean;
  fields: readonly SatHighlightFieldRef[];
}

export interface UseSatHighlighterApi {
  /** False when `CSS.highlights` is missing — the toolbar button disables
   * itself and shows why (§6.3). */
  supported: boolean;
}

const HIGHLIGHT_NAME = "sat";
const MAJORITY_COVERAGE_THRESHOLD = 0.5;

function isHighlightApiSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/** Converts an offset pair into a `Range` by walking `root`'s text nodes —
 * the inverse of `textOffsetInRoot` below. A `<br>` or `<img>` contributes
 * no text node, so it is skipped automatically; a `<math>` token element's
 * text is counted like any other text, matching how the offsets were
 * recorded (plan §6.3). */
export function rangeFromOffsets(root: Node, [start, end]: Offset): Range | null {
  if (end <= start) {
    return null;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOffsetInNode = 0;
  let endNode: Text | null = null;
  let endOffsetInNode = 0;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    const nodeStart = pos;
    const nodeEnd = pos + length;

    if (startNode === null && start >= nodeStart && start <= nodeEnd) {
      startNode = node;
      startOffsetInNode = start - nodeStart;
    }
    if (end >= nodeStart && end <= nodeEnd) {
      endNode = node;
      endOffsetInNode = end - nodeStart;
    }
    if (startNode && endNode) {
      break;
    }

    pos = nodeEnd;
    node = walker.nextNode() as Text | null;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffsetInNode);
  range.setEnd(endNode, endOffsetInNode);
  return range;
}

/** The character offset of a Range boundary point `(container, offset)`
 * within `root`'s flattened text, delegated to the Range stringifier —
 * which the DOM spec defines the same way a text-node walk would, for both
 * a text-node boundary (mid-string) and an element boundary (child index). */
function textOffsetInRoot(root: Node, container: Node, offset: number): number {
  const probe = document.createRange();
  probe.selectNodeContents(root);
  try {
    probe.setEnd(container, offset);
  } catch {
    return 0;
  }
  return probe.toString().length;
}

/** Clips `range` to `container`'s extent, or `null` if they do not overlap
 * (plan §6.3: "clip every selection range to each highlightable field it
 * touches").
 *
 * Deliberately avoids `compareBoundaryPoints` against a `container`-typed
 * boundary (`Range.selectNodeContents`'s start/end are child-index points
 * on `container` itself): comparing that against a text-node boundary deep
 * inside `container` — which is what a real Selection's Range almost
 * always has — does not reliably resolve to "equal" even at the same
 * logical position, verified in both jsdom and real Firefox. That made
 * this always report no overlap for an interior selection whose start sits
 * at a field's very first character, and inverted for a selection that
 * starts inside the field and extends past its end (e.g. a triple-click
 * that browsers commonly extend a hair into the next sibling). `Range`'s
 * own `intersectsNode`/node containment give a boundary-type-agnostic,
 * spec-defined answer instead. */
export function clipRangeToElement(range: Range, container: Element): Range | null {
  if (!range.intersectsNode(container)) {
    return null;
  }

  const clipped = range.cloneRange();
  if (!container.contains(range.startContainer)) {
    clipped.setStart(container, 0);
  }
  if (!container.contains(range.endContainer)) {
    clipped.setEnd(container, container.childNodes.length);
  }
  return clipped;
}

function domRangeToOffset(root: Node, range: Range): Offset {
  return [
    textOffsetInRoot(root, range.startContainer, range.startOffset),
    textOffsetInRoot(root, range.endContainer, range.endOffset),
  ];
}

/**
 * The CSS Custom Highlight API layer over `sat-highlighter.ts`'s pure
 * offset arithmetic (plan §6.3; Q33, Q33a, Q34). Offsets live in a ref, not
 * component state — a highlighter gesture never triggers a React render on
 * its own; it repaints the `Highlight` object directly.
 */
export function useSatHighlighter({
  questionId,
  active,
  fields,
}: UseSatHighlighterOptions): UseSatHighlighterApi {
  const supported = useMemo(() => isHighlightApiSupported(), []);
  const offsetsRef = useRef<Map<SatHighlightField, Offset[]>>(new Map());

  const repaint = useCallback(() => {
    if (!supported) {
      return;
    }
    const highlight = new Highlight();
    for (const { field, ref } of fields) {
      const el = ref.current;
      const offsets = offsetsRef.current.get(field);
      if (!el || !offsets) {
        continue;
      }
      for (const offset of offsets) {
        const range = rangeFromOffsets(el, offset);
        if (range) {
          highlight.add(range);
        }
      }
    }
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  }, [fields, supported]);

  // Dropped on question change (Q34) and rebuilt from offsets on every
  // mount, so the §5.4 skeleton swap and the ≤860px passage copy lose
  // nothing.
  useEffect(() => {
    offsetsRef.current = new Map();
    repaint();
  }, [questionId, repaint]);

  useEffect(() => {
    return () => {
      if (supported) {
        CSS.highlights.delete(HIGHLIGHT_NAME);
      }
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !active) {
      return;
    }

    function handlePointerUp(event: PointerEvent) {
      // Mouse or pen only (§6.3) — upstream's mouse-only `mouseup` handler
      // is kept, on purpose, rather than widened to touch, which would
      // fight native selection handles.
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }

      const selectionRanges: Range[] = [];
      for (let i = 0; i < selection.rangeCount; i += 1) {
        selectionRanges.push(selection.getRangeAt(i));
      }

      const perFieldClipped = new Map<SatHighlightField, Offset[]>();
      for (const { field, ref } of fields) {
        const el = ref.current;
        if (!el) {
          continue;
        }
        const clipped: Offset[] = [];
        for (const domRange of selectionRanges) {
          const c = clipRangeToElement(domRange, el);
          if (c) {
            clipped.push(domRangeToOffset(el, c));
          }
        }
        if (clipped.length > 0) {
          perFieldClipped.set(field, clipped);
        }
      }

      if (perFieldClipped.size === 0) {
        return;
      }

      // Coverage is measured over the union across every touched field
      // (plan §6.3), not per field — a multi-range selection cannot add and
      // subtract in one gesture.
      let totalUnion = 0;
      let totalCovered = 0;
      const perFieldUnion = new Map<SatHighlightField, Offset[]>();
      for (const [field, ranges] of perFieldClipped) {
        const union = unionRanges(ranges);
        perFieldUnion.set(field, union);
        totalUnion += totalLength(union);
        const existing = offsetsRef.current.get(field) ?? [];
        totalCovered += union.reduce((sum, range) => sum + coveredLength(existing, range), 0);
      }
      if (totalUnion === 0) {
        return;
      }
      const subtract = totalCovered / totalUnion > MAJORITY_COVERAGE_THRESHOLD;

      for (const [field, union] of perFieldUnion) {
        const existing = offsetsRef.current.get(field) ?? [];
        const next = union.reduce(
          (ranges, range) => (subtract ? subtractRange(ranges, range) : addRange(ranges, range)),
          existing,
        );
        offsetsRef.current.set(field, next);
      }

      repaint();
      selection.removeAllRanges();
    }

    document.addEventListener("pointerup", handlePointerUp);
    return () => document.removeEventListener("pointerup", handlePointerUp);
  }, [active, fields, repaint, supported]);

  return { supported };
}
