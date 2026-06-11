/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/markdownConfig.ts
 * (pinned 197a1dc4).
 *
 * Subtractions (features MVP2 doesn't have):
 * - remark-math / rehype-katex (LaTeX), remark-directive
 * - artifactPlugin / Artifact, unicodeCitation / their Citation components,
 *   mcpUIResourcePlugin / MCP-UI components
 * Kept byte-identical: the lazy-cached getter pattern (circular-import-safe,
 * stable references so react-markdown does not rebuild its processor).
 */
import remarkGfm from 'remark-gfm';
import supersub from 'remark-supersub';
import rehypeHighlight from 'rehype-highlight';
import type { PluggableList } from 'unified';
import type { ElementType } from 'react';
import { code, a, p, img, table } from './MarkdownComponents';
import { langSubset } from '~/utils';

/**
 * Single source of truth for the markdown rendering pipeline, shared by the
 * whole-message renderer and the per-block memoized renderer so both produce
 * identical output.
 *
 * These are exposed as lazily-initialized, cached getters rather than top-level
 * consts on purpose: `MarkdownComponents` participates in a circular import
 * (`MarkdownComponents` → `CodeBlock` → … → here → `MarkdownComponents`).
 * Reading `code`/`a`/… at module-evaluation time throws
 * `Cannot access 'code' before initialization` under native ESM. Deferring the
 * read to first call (render time) sidesteps the temporal dead zone, and caching
 * keeps a stable reference so react-markdown does not rebuild its processor.
 */
let remarkPluginsCache: PluggableList | null = null;
let rehypePluginsCache: PluggableList | null = null;
let markdownComponentsCache: { [nodeType: string]: ElementType } | null = null;

export const getRemarkPlugins = (): PluggableList => {
  if (remarkPluginsCache === null) {
    remarkPluginsCache = [supersub, remarkGfm];
  }
  return remarkPluginsCache;
};

export const getRehypePlugins = (): PluggableList => {
  if (rehypePluginsCache === null) {
    rehypePluginsCache = [
      [rehypeHighlight, { detect: true, ignoreMissing: true, subset: langSubset }],
    ] as PluggableList;
  }
  return rehypePluginsCache;
};

export const getMarkdownComponents = (): { [nodeType: string]: ElementType } => {
  if (markdownComponentsCache === null) {
    markdownComponentsCache = {
      code,
      a,
      p,
      img,
      table,
    };
  }
  return markdownComponentsCache;
};
