/**
 * vizTitle — pure helpers for deriving header text from a RenderSpec title.
 *
 * The agent (or the default builder) hands us a sentence-style title like
 * "Stanford University — key facts". When the school is already named by a
 * logo-led identity, repeating it in an eyebrow reads as noise — so we lift just
 * the descriptive remainder ("Key facts") as the section label.
 */

const SEPARATORS = [' — ', ' – ', ' - ', ': '];

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The eyebrow for a single-school card: the title with a leading
 * "{school}<sep>" prefix stripped (so the identity doesn't echo the name), or
 * the full title when it carries no such prefix. Empty when the title is just
 * the school name (nothing left to say).
 */
export function sectionLabel(title: string, schoolName: string): string {
  const trimmed = title.trim();
  const name = schoolName.trim();
  for (const sep of SEPARATORS) {
    const prefix = `${name}${sep}`.toLowerCase();
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return capitalize(trimmed.slice(prefix.length).trim());
    }
  }
  return trimmed.toLowerCase() === name.toLowerCase() ? '' : trimmed;
}
