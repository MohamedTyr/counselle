/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/MarkdownLite.tsx
 * (pinned 197a1dc4). Renders user-message markdown (no per-block memoization —
 * user messages don't stream).
 *
 * Subtractions:
 * - remark-math / rehype-katex (LaTeX dropped)
 * - ArtifactProvider wrapper (artifacts dropped)
 * - `img` component mapping kept (plain passthrough in our MarkdownComponents)
 */
import React, { memo } from 'react';
import remarkGfm from 'remark-gfm';
import supersub from 'remark-supersub';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import type { PluggableList } from 'unified';
import { code, codeNoExecution, a, p, img, table } from './MarkdownComponents';
import { CodeBlockProvider } from '~/Providers';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import { langSubset } from '~/utils';

const MarkdownLite = memo(
  ({ content = '', codeExecution = true }: { content?: string; codeExecution?: boolean }) => {
    // Type-level cast (recorded in UPSTREAM.md): rehype-highlight@6 nests its
    // own vfile, so its Plugin type mismatches unified's under TS 5.9.
    const rehypePlugins = [
      [
        rehypeHighlight,
        {
          detect: true,
          ignoreMissing: true,
          subset: langSubset,
        },
      ],
    ] as PluggableList;

    return (
      <MarkdownErrorBoundary content={content} codeExecution={codeExecution}>
        <CodeBlockProvider>
          <ReactMarkdown
            remarkPlugins={[
              /** @ts-ignore */
              supersub,
              remarkGfm,
            ]}
            /** @ts-ignore */
            rehypePlugins={rehypePlugins}
            components={
              {
                code: codeExecution ? code : codeNoExecution,
                a,
                p,
                img,
                table,
              } as {
                [nodeType: string]: React.ElementType;
              }
            }
          >
            {content}
          </ReactMarkdown>
        </CodeBlockProvider>
      </MarkdownErrorBoundary>
    );
  },
);

export default MarkdownLite;
