import type { FetchLike, IOFactory } from './affine-client';

export interface AffineClientOptions {
  /** Base URL of the AFFiNE instance. */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch in Node >= 18). */
  fetchFn?: FetchLike;
  /** Override the socket.io-client factory (useful for testing). */
  ioFactory?: IOFactory;
  /** Ack timeout in milliseconds for Socket.IO calls (default: 10_000). */
  timeoutMs?: number;
}
