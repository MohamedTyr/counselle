/**
 * CounselleMark — the small branded badge that stands in for our own data
 * wherever a source "logo" would go (the sources strip stack, the Counselle
 * card). A verified-check glyph in the brand accent, so a figure from our
 * database reads as "us, verified", never as a gray unknown tile.
 */
import { BadgeCheck } from 'lucide-react';
import { cn } from '@librechat/client/utils';

interface CounselleMarkProps {
  /** Tailwind size box (e.g. 'h-6 w-6'). */
  sizeClass?: string;
  className?: string;
}

export default function CounselleMark({ sizeClass = 'h-6 w-6', className }: CounselleMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', sizeClass, className)}
      style={{ backgroundColor: 'color-mix(in oklab, var(--brand-purple) 16%, transparent)' }}
    >
      <BadgeCheck className="h-2/3 w-2/3" style={{ color: 'var(--brand-purple)' }} />
    </span>
  );
}
