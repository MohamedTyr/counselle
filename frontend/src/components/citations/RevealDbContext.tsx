/**
 * RevealDbContext — drives the opt-in "show what's from Counselle" affordance.
 *
 * Default OFF: the answer reads clean, database figures credited once in the
 * action-row strip + the card badge (the dejargon grammar). When the reader
 * flips the toggle under a message, every DB-grounded claim in the prose lights
 * up in place — no chip, no number, no "IPEDS/CDS", just the text itself marked
 * as resting on our verified data.
 *
 * `style` is a preview-only knob so we can compare highlight treatments from
 * real pixels; production will lock one and drop the switch.
 */
import { createContext, useContext } from 'react';

export type HighlightStyle = 'underline' | 'wash' | 'both';

export interface RevealDbState {
  revealed: boolean;
  style: HighlightStyle;
}

const RevealDbContext = createContext<RevealDbState>({ revealed: false, style: 'wash' });

export const RevealDbProvider = RevealDbContext.Provider;

export function useRevealDb(): RevealDbState {
  return useContext(RevealDbContext);
}
