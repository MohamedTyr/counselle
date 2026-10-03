import type { ScholarshipView } from "@/api/scholarships/types";
import table from "@/features/scholarships/sponsor-colours.json";

/*
 * Each sponsor logo's colour, derived once by
 * `scripts/build_scholarship_colours.py` the way school colours are: the
 * fill the card is tinted with, and the same hue darkened until it reads as
 * text on white. Keyed by what the logo shows first (an admin-set logo URL,
 * else the sponsor's then the application site's hostname, the order
 * `SponsorLogo` tries). A logo with no dominant colour is absent and its card
 * renders in neutral grey.
 */
const COLOURS: Record<string, string[] | undefined> = table.colours;

/*
 * Hostnames the favicon service has no icon for. It answers them with a 404
 * that still carries a generic globe, which the browser loads as a logo, so
 * SponsorLogo skips the service for these and tries the site's own favicon.
 */
const NO_SERVICE_FAVICON = new Set<string>(table.noFavicon);

export function hasServiceFavicon(hostname: string): boolean {
  return !NO_SERVICE_FAVICON.has(hostname);
}

export type SponsorColour = { fill: string; ink: string };

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function lookup(key: string | null): SponsorColour | null {
  const [fill, ink] = (key && COLOURS[key]) || [];
  return fill && ink ? { fill, ink } : null;
}

export function sponsorColour(
  scholarship: Pick<ScholarshipView, "logo_url" | "source_url" | "apply_url">,
): SponsorColour | null {
  const logo = scholarship.logo_url.trim();
  if (logo) return lookup(logo);
  return (
    lookup(hostname(scholarship.source_url)) ??
    lookup(hostname(scholarship.apply_url))
  );
}
