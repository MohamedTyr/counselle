import { useState } from "react";

import type { ScholarshipView } from "@/api/scholarships/types";
import { cn } from "@/lib/utils";

/*
 * The sponsor's mark: the admin-set logo, else the icon of the sponsor's
 * site, else initials. Google's favicon service answers an unknown site with
 * a 16px globe and some sites only publish a 16px icon, so anything under
 * MIN_ICON_PX is treated as no logo rather than upscaled into a blur. A logo
 * fills its tile edge to edge.
 */

const MIN_ICON_PX = 32;
const FAVICON_PX = 128;

const SIZE_CLASS = {
  sm: "size-7 rounded-md text-[0.625rem]",
  md: "size-9 rounded-lg text-xs",
  lg: "size-11 rounded-[10px] text-sm",
} as const;

function faviconFor(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${FAVICON_PX}`;
  } catch {
    return null;
  }
}

function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter((word) => word && !/^(the|of|and|for)$/i.test(word));
  return words.length ? words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() : "?";
}

function logoSource(scholarship: Pick<ScholarshipView, "logo_url" | "source_url" | "apply_url">): string | null {
  if (scholarship.logo_url.trim()) return scholarship.logo_url.trim();
  return faviconFor(scholarship.source_url) ?? faviconFor(scholarship.apply_url);
}

export function SponsorLogo({
  scholarship,
  size = "md",
  className,
}: {
  scholarship: Pick<ScholarshipView, "logo_url" | "source_url" | "apply_url" | "sponsor" | "name">;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const src = logoSource(scholarship);
  // Keyed by src, so typing a new URL in the editor starts over cleanly.
  const [state, setState] = useState<{ src: string | null; status: "loading" | "ok" | "failed" }>({
    src,
    status: "loading",
  });
  const status = state.src === src ? state.status : "loading";
  if (state.src !== src) setState({ src, status: "loading" });
  const showImage = src !== null && status === "ok";

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
      {src !== null && status !== "failed" ? (
        <img
          alt=""
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            showImage ? "opacity-100" : "opacity-0",
          )}
          decoding="async"
          onError={() => setState({ src, status: "failed" })}
          onLoad={(event) =>
            setState({ src, status: event.currentTarget.naturalWidth < MIN_ICON_PX ? "failed" : "ok" })
          }
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : null}
    </span>
  );
}
