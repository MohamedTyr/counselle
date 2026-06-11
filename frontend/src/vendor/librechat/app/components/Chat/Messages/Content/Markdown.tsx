/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/Markdown.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions:
 * - LaTeXParsing (recoil) / preprocessLaTeX — LaTeX dropped; content rendered as-is
 * Kept byte-identical: the isInitializing `result-thinking` cursor placeholder,
 * the MarkdownErrorBoundary + MarkdownBlocks composition over markdownConfig.
 */
import { memo } from 'react';
import { getRemarkPlugins, getRehypePlugins, getMarkdownComponents } from './markdownConfig';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import MarkdownBlocks from './MarkdownBlocks';

type TContentProps = {
  content: string;
  isLatestMessage: boolean;
};

const Markdown = memo(function Markdown({ content = '', isLatestMessage }: TContentProps) {
  const isInitializing = content === '';

  if (isInitializing) {
    return (
      <div className="absolute">
        <p className="relative">
          <span className={isLatestMessage ? 'result-thinking' : ''} />
        </p>
      </div>
    );
  }

  return (
    <MarkdownErrorBoundary content={content} codeExecution={true}>
      <MarkdownBlocks
        content={content}
        remarkPlugins={getRemarkPlugins()}
        rehypePlugins={getRehypePlugins()}
        components={getMarkdownComponents()}
      />
    </MarkdownErrorBoundary>
  );
});
Markdown.displayName = 'Markdown';

export default Markdown;
