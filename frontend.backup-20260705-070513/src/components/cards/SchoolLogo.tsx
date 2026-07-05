/**
 * SchoolLogo — a school's logo avatar, sourced from its website host.
 *
 * Walks the favicon-CDN candidate chain on each <img> error and, when every
 * source fails (or no domain is known), renders a generated monogram so the slot
 * is never empty and never a broken image. Decorative by default: the school name
 * stays as visible text beside it, so the logo carries no semantic weight (the
 * accessible label is the name, not the crest).
 */
import { useMemo, useState } from 'react';
import { cn } from '@librechat/client/utils';
import { initials, logoCandidates } from '@/components/cards/schoolLogo';

interface SchoolLogoProps {
  name: string;
  domain?: string | null;
  /** Rendered box size in px. The CDN is asked for 2× for crisp retina logos. */
  size?: number;
  className?: string;
}

// One fixed source resolution for every instance, so the header (26px) and the
// popover (36px) request the SAME URL — one fetch, shared cache, no blank flash.
// 128px is crisp for any size we render at.
const SOURCE_PX = 128;

export default function SchoolLogo({ name, domain, size = 24, className }: SchoolLogoProps) {
  const candidates = useMemo(() => (domain ? logoCandidates(domain, SOURCE_PX) : []), [domain]);
  const [index, setIndex] = useState(0);

  const exhausted = index >= candidates.length;
  const box = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md',
    'border border-border-light',
    className,
  );
  const style = { width: size, height: size } as const;

  if (exhausted) {
    // Monogram blends with the theme; an image needs a stable light field.
    return (
      <span
        aria-hidden="true"
        style={style}
        className={cn(
          box,
          'bg-surface-primary-alt text-[0.62em] font-semibold tracking-tight text-text-secondary',
        )}
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <span aria-hidden="true" style={style} className={cn(box, 'bg-white p-0.5')}>
      <img
        key={candidates[index]}
        src={candidates[index]}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
        onError={() => setIndex((i) => i + 1)}
      />
    </span>
  );
}
