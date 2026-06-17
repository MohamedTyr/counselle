/** Minimal logging seam — routes diagnostics so they can be silenced/collected.
 *  In DEV it forwards to console; in prod it is a no-op (swap for a real sink later). */
const isDev = import.meta.env.DEV;
export const logger = {
  warn: (msg: string, ...rest: unknown[]): void => {
    if (isDev) console.warn(msg, ...rest);
  },
  error: (msg: string, ...rest: unknown[]): void => {
    if (isDev) console.error(msg, ...rest);
  },
};
