/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/MarkdownComponents.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions:
 * - math / mermaid language branches (both features dropped; those langs fall
 *   through to the normal CodeBlock render)
 * - run-code permission (useHasAccess) — `canRunCode` frozen false
 * - `a`: the file-download branch (file uploads dropped) — plain anchor with
 *   target="_blank" (their no-file path), plus rel for external links
 * - `img`: apiBaseUrl prefixing for their /images uploads — src rendered as-is
 * Kept byte-identical: isSingleLineCode, block-index bookkeeping, p/table classes.
 */
import React, { memo, useRef, useEffect } from 'react';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import { useCodeBlockContext } from '~/Providers';
import { handleDoubleClick } from '~/utils';

type TCodeProps = {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
};

const isSingleLineCode = (children: React.ReactNode): boolean => {
  if (typeof children === 'string') {
    return !children.includes('\n');
  }
  if (Array.isArray(children)) {
    return children.every((child) => typeof child === 'string' && !child.includes('\n'));
  }
  return false;
};

export const code: React.ElementType = memo(function MarkdownCode({
  className,
  children,
}: TCodeProps) {
  /** Run-code dropped in MVP2 — execution is never allowed. */
  const canRunCode = false;
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];
  const isSingleLine = isSingleLineCode(children);

  const { getNextIndex, resetCounter } = useCodeBlockContext();
  const blockIndex = useRef(getNextIndex(isSingleLine)).current;

  useEffect(() => {
    resetCounter();
  }, [children, resetCounter]);

  if (isSingleLine) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return (
      <CodeBlock
        lang={lang ?? 'text'}
        codeChildren={children}
        blockIndex={blockIndex}
        allowExecution={canRunCode}
      />
    );
  }
});
code.displayName = 'MarkdownCode';

export const codeNoExecution: React.ElementType = memo(function MarkdownCodeNoExecution({
  className,
  children,
}: TCodeProps) {
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];

  if (isSingleLineCode(children)) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return <CodeBlock lang={lang ?? 'text'} codeChildren={children} allowExecution={false} />;
  }
});
codeNoExecution.displayName = 'MarkdownCodeNoExecution';

type TAnchorProps = {
  href: string;
  children: React.ReactNode;
};

export const a: React.ElementType = memo(function MarkdownAnchor({ href, children }: TAnchorProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
});
a.displayName = 'MarkdownAnchor';

type TParagraphProps = {
  children: React.ReactNode;
};

export const p: React.ElementType = memo(function MarkdownParagraph({ children }: TParagraphProps) {
  return <p className="mb-2 whitespace-pre-wrap">{children}</p>;
});
p.displayName = 'MarkdownParagraph';

type TTableProps = {
  children: React.ReactNode;
};

export const table: React.ElementType = memo(function MarkdownTable({ children }: TTableProps) {
  return (
    <div className="markdown-table-wrapper w-full max-w-full">
      <table>{children}</table>
    </div>
  );
});
table.displayName = 'MarkdownTable';

type TImageProps = {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

export const img: React.ElementType = memo(function MarkdownImage({
  src,
  alt,
  title,
  className,
  style,
}: TImageProps) {
  return <img src={src} alt={alt} title={title} className={className} style={style} />;
});
img.displayName = 'MarkdownImage';
