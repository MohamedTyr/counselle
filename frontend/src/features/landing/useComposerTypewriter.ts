import { useEffect, type RefObject } from "react";
import { REDUCED_MOTION, useDocumentHidden, useMediaQuery } from "./hooks";

/** What a student might ask first; the markup carries the first one. */
export const PROMPTS = [
  "Get me into Harvard",
  "Find scholarships I qualify for",
  "Review my Why Michigan essay",
  "Build my college list",
  "What is due this week?",
];
const HOLD_MS = 2400;
/** How long the finished request stays selected before it is replaced. */
const SELECT_MS = 420;
const GAP_MS = 320;

/**
 * A human cadence: uneven keystrokes, a beat before each new word, and a
 * longer one after punctuation.
 */
export function cadence(text: string, typed: number): number {
  const last = text[typed - 1];
  const pause = last === " " ? 90 : /[,.?!]/.test(last) ? 160 : 0;
  return 40 + ((typed * 7) % 5) * 11 + pause;
}

/**
 * Types each prompt into the composer and holds it; the next one replaces
 * it the way a person would, by selecting the old request and typing over
 * it; `data-selected` on the composer marks the selection.
 * Reduced motion leaves the first prompt in place, and a background tab
 * puts it back until the page is seen again.
 */
export function useComposerTypewriter(text: RefObject<HTMLElement | null>) {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const hidden = useDocumentHidden();
  useEffect(() => {
    const node = text.current;
    if (!node || reduced || hidden) return;
    const composer = node.closest(".lp-composer");
    let timer = 0;
    let prompt = 0;
    let length = PROMPTS[0].length;
    const flag = (name: string, on: boolean) =>
      composer?.setAttribute(`data-${name}`, String(on));
    const schedule = (step: () => void, ms: number) => {
      timer = window.setTimeout(step, ms);
    };
    function select() {
      flag("selected", true);
      schedule(replace, SELECT_MS);
    }
    function replace() {
      flag("selected", false);
      node!.textContent = "";
      length = 0;
      prompt = (prompt + 1) % PROMPTS.length;
      schedule(type, GAP_MS);
    }
    function type() {
      const current = PROMPTS[prompt];
      if (length === current.length) {
        schedule(select, HOLD_MS);
        return;
      }
      const letter = document.createElement("span");
      letter.className = "lp-char";
      letter.textContent = current[length];
      node!.append(letter);
      length += 1;
      schedule(type, cadence(current, length));
    }
    const settle = () => {
      window.clearTimeout(timer);
      node.textContent = PROMPTS[0];
      flag("selected", false);
    };
    schedule(select, HOLD_MS);
    return settle;
  }, [text, reduced, hidden]);
}
