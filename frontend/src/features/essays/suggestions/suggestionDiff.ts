/*
 * The prefix/suffix trim: what a tracked change actually paints.
 *
 * PRESENTATION ONLY. Its output is never sent anywhere — accept and reject
 * carry no body at all, and the server resolves from its own stored markdown.
 * Nobody should "optimise" a trimmed value into a request.
 *
 * It exists because the server cannot store a pure insertion: an empty
 * `old_text` fails `apply_edits`'s ambiguity check, so "add a sentence after
 * this one" arrives as a replacement whose new text extends the old. Painted
 * naively that strikes through a sentence nobody is removing. Trimming the
 * shared head and tail leaves only the words that genuinely differ, so an
 * extending replacement reads as a clean green insertion and a shortening one
 * reads as a clean red deletion.
 *
 * Both inputs are PLAIN document-text space (`oldTextPlain`/`newTextPlain`),
 * never the markdown fields.
 */

export type SuggestionDiffShape = "deletion" | "insertion" | "replacement";

export type SuggestionDiff = {
  /** Characters of `newTextPlain` between the shared head and tail. */
  newMiddle: string;
  /** Characters of `oldTextPlain` between the shared head and tail. */
  oldMiddle: string;
  /** Shared leading characters, common to both texts. */
  prefixLength: number;
  /** What this renders as once trimmed — not the stored `kind`. */
  shape: SuggestionDiffShape;
  /** Shared trailing characters, common to both texts. */
  suffixLength: number;
};

// Unicode-aware so a trim inside an accented or non-Latin word is treated the
// same as one inside an ASCII word.
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function isWordCharacter(character: string | undefined) {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/*
 * A cut is legal unless it would fall between two word characters. Cutting
 * "the cat" / "this dog" after their shared "th" would strike a ragged half
 * word; cutting "I like pizza" before ", which…" / "." would not, because a
 * comma and a full stop are not word characters. That distinction is why the
 * trim runs on characters and then retracts to a boundary, rather than
 * tokenising up front: token-level trimming loses the shared full stop that
 * makes "delete a clause" render as a deletion instead of a replacement.
 */
function isWordBoundary(text: string, index: number) {
  return !(isWordCharacter(text[index - 1]) && isWordCharacter(text[index]));
}

export function diffSuggestionText(
  oldTextPlain: string,
  newTextPlain: string,
): SuggestionDiff {
  const shorter = Math.min(oldTextPlain.length, newTextPlain.length);

  let prefixLength = 0;
  while (
    prefixLength < shorter &&
    oldTextPlain[prefixLength] === newTextPlain[prefixLength]
  ) {
    prefixLength += 1;
  }
  while (
    prefixLength > 0 &&
    !(
      isWordBoundary(oldTextPlain, prefixLength) &&
      isWordBoundary(newTextPlain, prefixLength)
    )
  ) {
    prefixLength -= 1;
  }

  // Capped so the head and tail can never overlap on the shorter string.
  const suffixCeiling = shorter - prefixLength;
  let suffixLength = 0;
  while (
    suffixLength < suffixCeiling &&
    oldTextPlain[oldTextPlain.length - 1 - suffixLength] ===
      newTextPlain[newTextPlain.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  while (
    suffixLength > 0 &&
    !(
      isWordBoundary(oldTextPlain, oldTextPlain.length - suffixLength) &&
      isWordBoundary(newTextPlain, newTextPlain.length - suffixLength)
    )
  ) {
    suffixLength -= 1;
  }

  const oldMiddle = oldTextPlain.slice(
    prefixLength,
    oldTextPlain.length - suffixLength,
  );
  const newMiddle = newTextPlain.slice(
    prefixLength,
    newTextPlain.length - suffixLength,
  );

  return {
    newMiddle,
    oldMiddle,
    prefixLength,
    shape:
      oldMiddle === ""
        ? "insertion"
        : newMiddle === ""
          ? "deletion"
          : "replacement",
    suffixLength,
  };
}
