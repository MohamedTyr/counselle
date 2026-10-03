import { useState } from "react";

import type { ScholarshipView } from "@/api/scholarships/types";
import { cn } from "@/lib/utils";

/*
 * Try the admin-set logo, then cached and direct favicons for the sponsor
 * and application sites. Any successfully loaded size is usable; initials
 * remain only when every available source fails.
 */

const FAVICON_PX = 128;

const SIZE_CLASS = {
  sm: "size-7 rounded-md text-[0.625rem]",
  md: "size-9 rounded-lg text-xs",
  lg: "size-11 rounded-[10px] text-sm",
} as const;

function faviconsFor(url: string): string[] {
  try {
    const site = new URL(url);
    if (site.protocol !== "https:" && site.protocol !== "http:") return [];
    site.protocol = "https:";
    return [
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site.hostname)}&sz=${FAVICON_PX}`,
      `${site.origin}/favicon.ico`,
    ];
  } catch {
    return [];
  }
}

function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter((word) => word && !/^(the|of|and|for)$/i.test(word));
  return words.length
    ? words
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase()
    : "?";
}

function logoSources(
  scholarship: Pick<ScholarshipView, "logo_url" | "source_url" | "apply_url">,
): string[] {
  return [
    ...new Set(
      [
        scholarship.logo_url.trim(),
        ...faviconsFor(scholarship.source_url),
        ...faviconsFor(scholarship.apply_url),
      ].filter(Boolean),
    ),
  ];
}

type SponsorLogoProps = {
  scholarship: Pick<
    ScholarshipView,
    "logo_url" | "source_url" | "apply_url" | "sponsor" | "name"
  >;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
};

export function SponsorLogo(props: SponsorLogoProps) {
  const sources = logoSources(props.scholarship);
  return (
    <SponsorMark {...props} key={JSON.stringify(sources)} sources={sources} />
  );
}

function SponsorMark({
  scholarship,
  size = "md",
  className,
  sources,
}: SponsorLogoProps & { sources: string[] }) {
  const [state, setState] = useState({ index: 0, loaded: false });
  const src = sources[state.index];
  const showImage = src !== undefined && state.loaded;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold tracking-tight transition-colors duration-200 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--image-outline)]",
        showImage
          ? "bg-[var(--surface-raised)] text-transparent"
          : "bg-[var(--label-surface)] text-[var(--label-ink)]",
        SIZE_CLASS[size],
        className,
      )}
    >
      {initials(scholarship.sponsor || scholarship.name)}
      {src ? (
        <img
          key={src}
          alt=""
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            showImage ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          onError={() => setState({ index: state.index + 1, loaded: false })}
          onLoad={() => setState({ index: state.index, loaded: true })}
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : null}
    </span>
  );
}
