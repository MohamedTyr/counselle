/**
 * Shared fetch wrapper (B5c) — turns a connection failure into a typed
 * 'network' TransportError so callers never see a raw fetch reject.
 */
import { TransportError } from './errors';

/** Wrap a fetch so connection failures surface as a typed 'network' error. */
export async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    throw new TransportError('network', 'Could not reach the server.', { cause });
  }
}
