/**
 * SchoolIdentity — the dossier's identity line: a school's logo leading its
 * name, with an optional section eyebrow above and its website beneath.
 *
 * This is the header for a single-school card (the stat block). The logo carries
 * the recognition; the eyebrow says *what* the block is about ("Key facts"); the
 * name is the heading; the domain link is the quiet provenance. Built new on the
 * cloned tokens — a differentiating honesty surface, not a commodity (ADR 0020).
 */
import type { SchoolRef } from '@/api/protocol';
import SchoolDomainLink from '@/components/cards/SchoolDomainLink';
import SchoolLogo from '@/components/cards/SchoolLogo';

interface SchoolIdentityProps {
  school: SchoolRef;
  /** Small uppercase label above the name — the "what" of the block. */
  eyebrow?: string;
  /** Logo box size in px. */
  logoSize?: number;
}

export default function SchoolIdentity({ school, eyebrow, logoSize = 40 }: SchoolIdentityProps) {
  return (
    <div className="flex items-center gap-3.5">
      <SchoolLogo name={school.name} domain={school.domain} size={logoSize} className="shadow-sm" />
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            {eyebrow}
          </div>
        )}
        <h3 className="text-sm font-semibold leading-snug text-text-primary [overflow-wrap:anywhere]">
          {school.name}
        </h3>
        <SchoolDomainLink domain={school.domain} className="mt-0.5" />
      </div>
    </div>
  );
}
