/**
 * Vendored from upstream client/src/components/Chat/Footer.tsx (pinned 197a1dc4).
 *
 * Subtractions: GTM analytics, ReactMarkdown rendering, startup-config fetch,
 * privacy/terms external links (none in MVP2 yet). Content is static brand copy
 * (B5c: `/v1/config` does NOT serve the footer); the container classes and the
 * `|`-separated segment rendering with the divider element are byte-identical
 * to upstream.
 */
import React from 'react';
import { APP_FOOTER } from '@/api/appFooter';

function Footer({ className }: { className?: string }) {
  const footerElements = APP_FOOTER
    .split('|')
    .map((text) => text.trim())
    .filter(Boolean);

  return (
    <div className="relative w-full">
      <div
        className={
          className ??
          'absolute bottom-0 left-0 right-0 hidden items-center justify-center gap-2 px-2 py-2 text-center text-xs text-text-primary sm:flex md:px-[60px]'
        }
        role="contentinfo"
      >
        {footerElements.map((text, index) => {
          const isLastElement = index === footerElements.length - 1;
          return (
            <React.Fragment key={`footer-element-${index}`}>
              <span>{text}</span>
              {!isLastElement && (
                <div
                  key={`separator-${index}`}
                  className="h-2 border-r-[1px] border-border-medium"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default Footer;
