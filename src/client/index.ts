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
} from './runtime/affine-client.js';
export { createDocYStructure, nanoid } from './runtime/doc-structure.js';
export { createDocYStructureFromMarkdown } from './markdown/markdown-to-yjs.js';
export type { AffineClientOptions } from './runtime/types.js';
