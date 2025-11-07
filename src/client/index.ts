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
  type BlockContent,
  type DocumentContent,
  type CopilotDocChunk,
  type CopilotFileChunk,
  type WorkspaceEmbeddingStatus,
  type WorkspaceIgnoredDoc,
  type WorkspaceEmbeddingFile,
} from './runtime/affine-client.js';
export { createDocYStructure, nanoid } from './runtime/doc-structure.js';
export { createDocYStructureFromMarkdown } from './markdown/markdown-to-yjs.js';
export type { AffineClientOptions } from './runtime/types.js';
