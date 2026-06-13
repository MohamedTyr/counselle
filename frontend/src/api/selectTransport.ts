/**
 * The active-transport switch (B5a) — `VITE_TRANSPORT` selects the seam impl.
 *
 *   'http' (default) → HttpTransport, fetch-streaming SSE against /v1.
 *   'mock'           → MockTransport, the fixture-replay contract harness.
 *
 * ChatContext imports `transport` from here, never a concrete impl directly.
 */
import type { Transport } from './transport';
import { httpTransport } from './http/transport';
import { mockTransport } from './mock/transport';

type TransportMode = 'http' | 'mock';

function resolveMode(): TransportMode {
  const raw = import.meta.env.VITE_TRANSPORT;
  return raw === 'mock' ? 'mock' : 'http';
}

export const transportMode: TransportMode = resolveMode();

export const transport: Transport = transportMode === 'mock' ? mockTransport : httpTransport;
