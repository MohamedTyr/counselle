/**
 * remarkCitationRefs — splits positive-integer `[n]` markers out of mdast text
 * nodes into standalone `citation-ref` hast elements carrying the marker
 * `index` as a prop, so a components map can render each marker as an inline
 * citation control (or nothing when the marker is unresolved — see CitationRenderer).
 *
 * Only `text` nodes are visited/replaced. `code` / `inlineCode` mdast nodes
 * hold their content in a `value` string, not a `children` array of text
 * nodes, so this transform's recursion (which only descends into
 * `children` arrays) never reaches into them — a `[7]` inside a code span or
 * fence is never converted into a citation ref. This mirrors (and reuses the
 * exact regex from) `citedIndexesIn` in `../citations`, so the renderer and
 * the citation-detection scan used by MessageSources can never disagree
 * about what counts as a citation marker.
 */
import type { Parent, Root, Text } from "mdast";
import type { Node } from "unist";

import { CITATION_PATTERN } from "../citations";

type CitationRefNode = Node & {
  type: "citationRef";
  data: {
    hName: "citation-ref";
    hProperties: { index: number };
  };
};

function makeCitationRefNode(index: number): CitationRefNode {
  return {
    type: "citationRef",
    data: { hName: "citation-ref", hProperties: { index } },
  };
}

function splitTextNode(node: Text): Node[] | null {
  const value = node.value;
  const pattern = new RegExp(CITATION_PATTERN);

  if (!pattern.test(value)) {
    return null;
  }

  const out: Node[] = [];
  let cursor = 0;

  for (const match of value.matchAll(new RegExp(CITATION_PATTERN))) {
    const start = match.index ?? 0;

    if (start > cursor) {
      out.push({ type: "text", value: value.slice(cursor, start) } as Text);
    }

    out.push(makeCitationRefNode(Number(match[1])));
    cursor = start + match[0].length;
  }

  if (cursor < value.length) {
    out.push({ type: "text", value: value.slice(cursor) } as Text);
  }

  return out;
}

function transform(node: Node): void {
  const parent = node as Parent;

  if (!Array.isArray(parent.children)) {
    return;
  }

  const next: Node[] = [];

  for (const child of parent.children) {
    if (child.type === "text") {
      const replaced = splitTextNode(child as Text);
      if (replaced) {
        next.push(...replaced);
        continue;
      }
    } else {
      transform(child);
    }

    next.push(child);
  }

  parent.children = next as Parent["children"];
}

export function remarkCitationRefs() {
  return (tree: Root) => {
    transform(tree);
  };
}
