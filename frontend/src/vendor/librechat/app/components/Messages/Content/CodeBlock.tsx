/**
 * Vendored from upstream client/src/components/Messages/Content/CodeBlock.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions:
 * - Run-code tool-call results (toolCallsMap, LogContent, ResultSwitcher) —
 *   code execution dropped; `allowExecution` is always false
 * - FloatingCodeBar + its IntersectionObserver / hover tracking (only purpose
 *   was the floating run/copy bar on tall executed blocks)
 * - plugin / error "json" branch (plugins dropped)
 * Kept byte-identical: container + CodeBar + code element structure and classes.
 */
import React, { useRef } from 'react';
import type { CodeBarProps } from '~/common';
import CodeBar from '~/components/Messages/Content/CodeBar';
import cn from '~/utils/cn';

type CodeBlockProps = Pick<
  CodeBarProps,
  'lang' | 'plugin' | 'error' | 'allowExecution' | 'blockIndex'
> & {
  codeChildren: React.ReactNode;
  classProp?: string;
};

const CodeBlock: React.FC<CodeBlockProps> = ({
  lang,
  blockIndex,
  codeChildren,
  classProp = '',
  allowExecution = false,
  error,
}) => {
  const codeRef = useRef<HTMLElement>(null);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border-light text-xs">
      <div>
        <CodeBar
          lang={lang}
          error={error}
          codeRef={codeRef}
          blockIndex={blockIndex}
          allowExecution={allowExecution}
        />
      </div>
      <div
        className={cn(classProp, 'overflow-y-auto bg-surface-chat p-4 dark:bg-surface-primary-alt')}
      >
        <code ref={codeRef} className={cn(`hljs language-${lang} !whitespace-pre`)}>
          {codeChildren}
        </code>
      </div>
    </div>
  );
};

export default CodeBlock;
