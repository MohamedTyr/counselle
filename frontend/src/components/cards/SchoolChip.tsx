/**
 * SchoolChip — a compact "logo + name" inline tag identifying one school.
 *
 * The quiet counterpart to SchoolIdentity (which leads a whole card): used where
 * one or more schools annotate a card whose subject is something else — the
 * score band, whose hero is the test, not the school. Decorative logo; the name
 * is the text, so the chip stays readable when the logo can't resolve.
 */
import type { SchoolRef } from '@/api/protocol';
import SchoolLogo from '@/components/cards/SchoolLogo';

export default function SchoolChip({ school }: { school: SchoolRef }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <SchoolLogo name={school.name} domain={school.domain} size={18} />
      <span className="truncate text-xs font-medium text-text-secondary">{school.name}</span>
    </span>
  );
}
