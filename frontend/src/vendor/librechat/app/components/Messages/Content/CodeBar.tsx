/**
 * Vendored from upstream client/src/components/Messages/Content/CodeBar.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions:
 * - RunCode button (code execution dropped; `allowExecution` is always false)
 * - plugin InfoIcon branch (plugins dropped; `plugin` is never true)
 * Kept byte-identical: bar container classes, LangIcon + lang label, CopyButton.
 */
import React from 'react';
import type { CodeBarProps } from '~/common';
import useCopyCode from '~/components/Messages/Content/useCopyCode';
import CopyButton from '~/components/Messages/Content/CopyButton';
import LangIcon from '~/components/Messages/Content/LangIcon';
import { useLocalize } from '~/hooks';

const CodeBar: React.FC<CodeBarProps> = React.memo(({ lang, error, codeRef }) => {
  const localize = useLocalize();
  const { isCopied, handleCopy } = useCopyCode(codeRef);

  return (
    <div className="flex items-center justify-between bg-surface-primary-alt px-1.5 py-1.5 font-sans text-xs text-text-secondary dark:bg-transparent">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <LangIcon lang={lang} className="size-3.5" />
        {lang}
      </span>
      <div className="flex items-center justify-center gap-2">
        {error !== true && (
          <CopyButton
            isCopied={isCopied}
            onClick={handleCopy}
            label={localize('com_ui_copy_code')}
          />
        )}
      </div>
    </div>
  );
});

export default CodeBar;
