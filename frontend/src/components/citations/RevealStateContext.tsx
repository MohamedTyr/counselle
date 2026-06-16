/**
 * RevealStateContext — per-message owner of the "show what's from Counselle"
 * reveal flag.
 *
 * `MessageRender` owns the flag as plain React state and shares it, via this
 * context, with BOTH its message body (→ MessageContent → RevealDbProvider) and
 * its action-row SubRow (→ RevealDbToggle). A `setState` re-renders MessageRender
 * from the inside, so the prop-only `areMessageRenderPropsEqual` memo never gets
 * in the way — no Jotai, no per-message atom accumulation.
 *
 * The default is a safe no-op (revealed off), so a consumer rendered outside a
 * provider reads clean prose.
 */
import { createContext, useContext } from 'react';

export interface RevealState {
  revealed: boolean;
  setRevealed: (v: boolean) => void;
}

const RevealStateContext = createContext<RevealState>({
  revealed: false,
  setRevealed: () => {},
});

export const RevealStateProvider = RevealStateContext.Provider;

export function useRevealState(): RevealState {
  return useContext(RevealStateContext);
}

export default RevealStateContext;
