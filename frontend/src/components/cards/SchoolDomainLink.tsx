/**
 * SchoolDomainLink — the quiet "school.edu ↗" outbound link to a school's site.
 *
 * One implementation shared by every place a school's website is offered (the
 * dossier identity, the comparison column's hover panel) so the affordance —
 * truncation, the nudging arrow, the new-tab semantics — is identical
 * everywhere. Renders nothing when the school has no known domain.
 */
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@librechat/client/utils';

interface SchoolDomainLinkProps {
  domain?: string | null;
  className?: string;
}

export default function SchoolDomainLink({ domain, className }: SchoolDomainLinkProps) {
  if (!domain) return null;
  return (
    <a
      href={`https://${domain}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group/link inline-flex max-w-full items-center gap-1 text-xs font-medium',
        'text-text-secondary transition-colors hover:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
        className,
      )}
    >
      <span className="truncate">{domain}</span>
      <ArrowUpRight
        className="h-3.5 w-3.5 shrink-0 transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 motion-reduce:transition-none"
        aria-hidden="true"
      />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}
