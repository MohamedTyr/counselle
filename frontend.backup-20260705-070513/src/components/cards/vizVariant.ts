/**
 * How a viz card is rendered:
 *  - `card`  — inline in the chat stream: own chrome (border, title), compact.
 *  - `panel` — chromeless, inside the right-side artifact panel which already
 *              owns the title + border; the card just fills the space.
 */
export type VizVariant = 'card' | 'panel';
