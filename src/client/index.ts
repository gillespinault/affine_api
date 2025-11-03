export {
  AffineClient,
  decodeLoadResponse,
  encodeUpdateToBase64,
  parseSetCookies,
  randomLexoRank,
  serializeCookies,
  DEFAULT_BASE_URL,
  SOCKET_PATH,
  type DocumentSummary,
  type DocumentSnapshot,
} from './runtime/affine-client';
export { createDocYStructure, nanoid } from './runtime/doc-structure';
export { createDocYStructureFromMarkdown } from './markdown/markdown-to-yjs';
export type { AffineClientOptions } from './runtime/types';
