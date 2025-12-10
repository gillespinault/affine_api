import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import * as Y from 'yjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { File, FormData } from 'undici';
import type { AffineClientOptions } from './types.js';
import { createDocYStructure, nanoid } from './doc-structure.js';
import { createDocYStructureFromMarkdown } from '../markdown/markdown-to-yjs.js';
import { applyElementDefaults, transformPropsToYjs } from './element-defaults.js';

export const DEFAULT_BASE_URL =
  process.env.AFFINE_BASE_URL || 'https://affine.robotsinlove.be';
export const SOCKET_PATH = '/socket.io/';

export type IOFactory = (
  uri: string,
  options?: Partial<ManagerOptions & SocketOptions>,
) => Socket;

type BodyInitLike = string | Buffer | Uint8Array | FormData;

interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInitLike;
  redirect?: 'manual' | 'follow' | 'error' | string;
}

interface HeadersLike {
  get(name: string): string | null;
  getSetCookie?: () => string[];
  raw?: () => Record<string, string[]>;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers: HeadersLike;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (
  input: URL | string,
  init?: RequestInitLike,
) => Promise<FetchResponseLike>;

type SocketAck<T = unknown> = {
  error?: unknown;
  data?: T;
} & T;

type LoadDocAckPayload = {
  missing?: string;
  state?: string;
};

export interface LoadDocResult {
  doc: Y.Doc;
  stateVector: Buffer | null;
}

export interface DocumentSummary {
  docId: string;
  title: string | null;
  createDate: number | null;
  updatedDate: number | null;
  tags: string[];
  folderId: string | null;
  folderNodeId: string | null;
  primaryMode?: 'page' | 'edgeless' | null;
  public?: boolean;
  publicMode?: 'page' | 'edgeless' | null;
  defaultRole?: string | null;
}

export interface DocumentSnapshot extends DocumentSummary {
  update: string;
}

export interface BlockContent {
  id: string;
  flavour: string;
  props: Record<string, unknown>;
  children: string[];
  text?: string;
}

export interface DocumentContent extends DocumentSummary {
  blocks: BlockContent[];
}

export interface CopilotDocChunk {
  docId: string;
  chunk: number;
  content: string;
  distance: number | null;
}

export interface CopilotFileChunk {
  fileId: string | null;
  blobId: string | null;
  name?: string | null;
  mimeType?: string | null;
  chunk: number;
  content: string;
  distance: number | null;
}

export interface WorkspaceEmbeddingStatus {
  total: number;
  embedded: number;
}

export interface WorkspaceIgnoredDoc {
  docId: string;
  createdAt: string;
  docCreatedAt?: string | null;
  docUpdatedAt?: string | null;
  title?: string | null;
  createdBy?: string | null;
  createdByAvatar?: string | null;
  updatedBy?: string | null;
}

export interface WorkspaceEmbeddingFile {
  workspaceId: string;
  fileId: string;
  blobId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface DocumentHistoryEntry {
  id: string;
  timestamp: string;
  editor: {
    name: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface TagInfo {
  id: string;
  name: string;
  count: number;
}

export interface CommentUser {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface CommentReply {
  id: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
  user: CommentUser | null;
}

export interface DocumentComment extends CommentReply {
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentConnection {
  totalCount: number;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  comments: DocumentComment[];
}

export interface AffineNotification {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationList {
  totalCount: number;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  notifications: AffineNotification[];
  unreadCount: number;
}

export interface AccessTokenInfo {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  token?: string | null;
}

export interface DocumentPublicationInfo {
  docId: string;
  workspaceId: string;
  public: boolean;
  mode: 'page' | 'edgeless' | null;
}

export interface BlobInfo {
  key: string;
  mime: string;
  size: number;
  createdAt: string;
}

/**
 * A favorite record stored in AFFiNE userdata.
 * Favorites are per-user and synced to the server.
 */
export type FavoriteType = 'doc' | 'collection' | 'tag' | 'folder';

export interface FavoriteRecord {
  type: FavoriteType;
  id: string;
  index: string; // Sort order (lexicographic)
}

export interface FavoriteInfo extends FavoriteRecord {
  workspaceId: string;
}

export function parseSetCookies(headers: Array<string | undefined> = []) {
  const jar = new Map<string, string>();
  for (const header of headers) {
    if (!header) continue;
    const [cookiePart] = header.split(';');
    if (!cookiePart) continue;
    const [name, ...rest] = cookiePart.split('=');
    jar.set(name.trim(), rest.join('=').trim());
  }
  return jar;
}

export function serializeCookies(jar: Map<string, string>) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export function randomLexoRank() {
  return `Z${randomBytes(18).toString('base64url')}`;
}

function toGraphqlDocMode(mode?: 'page' | 'edgeless'): 'Page' | 'Edgeless' | undefined {
  if (!mode) {
    return undefined;
  }
  return mode === 'edgeless' ? 'Edgeless' : 'Page';
}

function fromGraphqlDocMode(mode?: string | null): 'page' | 'edgeless' | null {
  if (!mode) {
    return null;
  }
  const normalized = mode.trim().toLowerCase();
  if (normalized === 'edgeless') {
    return 'edgeless';
  }
  if (normalized === 'page') {
    return 'page';
  }
  return null;
}

export function decodeLoadResponse(res?: SocketAck<LoadDocAckPayload>): LoadDocResult {
  const payload = ((res?.data ?? res) ?? {}) as LoadDocAckPayload;
  const missing = payload.missing ? Buffer.from(payload.missing, 'base64') : null;
  const state = payload.state ? Buffer.from(payload.state, 'base64') : null;
  const doc = new Y.Doc();
  if (missing) {
    Y.applyUpdate(doc, missing);
  }
  return { doc, stateVector: state };
}

export function encodeUpdateToBase64(doc: Y.Doc, stateVector?: Buffer | null) {
  const binary = Y.encodeStateAsUpdate(doc, stateVector ?? undefined);
  return Buffer.from(binary).toString('base64');
}

const defaultIoFactory: IOFactory = (uri, options) => io(uri, options);

function resolveFetch(fetchFn?: FetchLike): FetchLike {
  if (fetchFn) {
    return fetchFn;
  }

  const maybeFetch = (globalThis as { fetch?: unknown }).fetch;
  if (typeof maybeFetch === 'function') {
    return (maybeFetch as (...args: Parameters<FetchLike>) => ReturnType<FetchLike>).bind(
      globalThis,
    ) as FetchLike;
  }

  throw new Error('A fetch implementation must be provided.');
}

function extractSetCookie(headers: HeadersLike): string[] {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (raw['set-cookie']) {
      return raw['set-cookie'];
    }
  }

  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

export class AffineClient {
  private readonly baseUrl: string;

  private readonly fetchFn: FetchLike;

  private readonly ioFactory: IOFactory;

  private readonly timeoutMs: number;

  private cookieJar: Map<string, string>;

  private userId: string | null;

  private socket: Socket | null;

  private readonly joinedWorkspaces: Set<string>;
  private readonly joinedUserspaces: Set<string>;

  constructor(options: AffineClientOptions = {}) {
    const { baseUrl = DEFAULT_BASE_URL, fetchFn, ioFactory, timeoutMs } = options;

    this.baseUrl = baseUrl;
    this.fetchFn = resolveFetch(fetchFn as FetchLike | undefined);
    this.ioFactory = ioFactory ?? defaultIoFactory;
    this.timeoutMs = timeoutMs ?? 10_000;

    this.cookieJar = new Map();
    this.userId = null;
    this.socket = null;
    this.joinedWorkspaces = new Set();
    this.joinedUserspaces = new Set();
  }

  private assignOptionalVariable(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
  ) {
    if (value !== undefined) {
      target[key] = value;
    }
  }

  private buildPaginationInput(
    first?: number,
    offset?: number,
  ): { first: number; offset: number } {
    const safeFirst = typeof first === 'number' && !Number.isNaN(first) ? first : 20;
    const safeOffset =
      typeof offset === 'number' && !Number.isNaN(offset) ? offset : 0;
    return { first: safeFirst, offset: safeOffset };
  }

  private getOrCreateSummary(
    summaries: Map<string, DocumentSummary>,
    docId: string,
  ): DocumentSummary {
    let summary = summaries.get(docId);
    if (!summary) {
      summary = {
        docId,
        title: null,
        createDate: null,
        updatedDate: null,
        tags: [],
        folderId: null,
        folderNodeId: null,
      };
      summaries.set(docId, summary);
    }
    return summary;
  }

  private toStringArray(value: unknown): string[] {
    if (value instanceof Y.Array) {
      return value
        .toArray()
        .map(item => (Array.isArray(item) ? item[0] : item))
        .filter((item): item is string => typeof item === 'string');
    }
    return [];
  }

  private asYMap(value: unknown): Y.Map<unknown> | null {
    if (value instanceof Y.Map) {
      return value;
    }
    if (value && typeof (value as { get?: unknown }).get === 'function') {
      return value as Y.Map<unknown>;
    }
    return null;
  }

  private async syncDocumentFolder(
    workspaceId: string,
    {
      docId,
      targetFolderId,
      preferredNodeId,
    }: { docId: string; targetFolderId: string | null; preferredNodeId?: string },
  ): Promise<string | null> {
    const foldersId = `db$${workspaceId}$folders`;
    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, foldersId);
    let primaryNodeId: string | null = preferredNodeId ?? null;
    let primaryNode: Y.Map<unknown> | null = null;
    const duplicates: string[] = [];

    for (const key of doc.share.keys()) {
      if (key === 'meta') {
        continue;
      }
      const entry = doc.getMap<unknown>(key);
      if (entry.get('type') !== 'doc') {
        continue;
      }
      if (entry.get('data') !== docId) {
        continue;
      }
      if (primaryNodeId == null || key === preferredNodeId) {
        if (primaryNodeId && primaryNodeId !== key) {
          duplicates.push(primaryNodeId);
        }
        primaryNodeId = key;
        primaryNode = entry;
      } else {
        duplicates.push(key);
      }
    }

    let mutated = false;
    if (duplicates.length) {
      doc.transact(() => {
        for (const dup of duplicates) {
          doc.share.delete(dup);
        }
      });
      mutated = true;
    }

    if (targetFolderId == null) {
      let removed = false;
      doc.transact(() => {
        if (primaryNodeId && primaryNode) {
          primaryNode.set('parentId', null);
          primaryNode.set('deleted', true);
          primaryNode.set('data', docId);
          removed = true;
        }
        if (duplicates.length) {
          for (const dup of duplicates) {
            const entry = doc.getMap<unknown>(dup);
            entry.forEach((_value, key) => {
              if (typeof key === 'string') {
                entry.delete(key);
              }
            });
            doc.share.delete(dup);
            removed = true;
          }
        }
      });
      if (removed) {
        await this.pushWorkspaceDocUpdate(workspaceId, foldersId, doc, stateVector);
      }
      return primaryNodeId;
    }

    if (!primaryNodeId) {
      const nodeId = preferredNodeId ?? nanoid();
      const nodeMap = doc.getMap<unknown>(nodeId);
      nodeMap.set('id', nodeId);
      nodeMap.set('parentId', targetFolderId);
      nodeMap.set('type', 'doc');
      nodeMap.set('data', docId);
      if (!nodeMap.has('index')) {
        nodeMap.set('index', randomLexoRank());
      }
      primaryNodeId = nodeId;
      mutated = true;
    } else if (primaryNode) {
      const currentParent = primaryNode.get('parentId');
      if (currentParent !== targetFolderId) {
        primaryNode.set('parentId', targetFolderId);
        mutated = true;
      }
      if (primaryNode.get('data') !== docId) {
        primaryNode.set('data', docId);
        mutated = true;
      }
    }

    if (mutated) {
      await this.pushWorkspaceDocUpdate(workspaceId, foldersId, doc, stateVector);
    }

    return primaryNodeId;
  }

  setCookiesFromHeader(cookieHeader = '') {
    this.cookieJar.clear();
    for (const cookie of cookieHeader.split(';')) {
      if (!cookie.trim()) continue;
      const [name, ...rest] = cookie.trim().split('=');
      this.cookieJar.set(name, rest.join('='));
    }
    this.userId = this.cookieJar.get('affine_user_id') || null;
  }

  private getCookieHeader() {
    return serializeCookies(this.cookieJar);
  }

  async signIn(email: string, password: string) {
    if (!email || !password) {
      throw new Error('Email and password are required for sign-in.');
    }

    const response = await this.fetchFn(
      new URL('/api/auth/sign-in', this.baseUrl).toString(),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ email, password }),
        redirect: 'manual',
      },
    );

    if (!response.ok) {
      let text = '<unreadable>';
      try {
        text = await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        `Sign-in failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    const rawCookies = extractSetCookie(response.headers);
    const jar = parseSetCookies(rawCookies);

    if (!jar.has('affine_session') || !jar.has('affine_user_id')) {
      throw new Error('Missing affine_session or affine_user_id cookie.');
    }

    this.cookieJar = jar;
    this.userId = jar.get('affine_user_id') || null;
    return { cookies: new Map(jar), userId: this.userId };
  }

  async connectSocket() {
    if (this.socket) {
      return this.socket;
    }

    if (!this.cookieJar.size) {
      throw new Error('Cannot open socket without signing in first.');
    }

    const socket = this.ioFactory(this.baseUrl, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      extraHeaders: { Cookie: this.getCookieHeader() },
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', err => reject(err));
    });

    this.socket = socket;
    return socket;
  }

  private async emitWithAck<T = unknown>(
    event: string,
    payload: unknown,
    timeout = this.timeoutMs,
  ): Promise<T> {
    const socket = await this.connectSocket();
    try {
      return await socket.timeout(timeout).emitWithAck(event, payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[${event}] ${message}`);
    }
  }

  async joinWorkspace(workspaceId: string) {
    if (this.joinedWorkspaces.has(workspaceId)) {
      return;
    }

    const res = await this.emitWithAck<SocketAck>(
      'space:join',
      {
        spaceType: 'workspace',
        spaceId: workspaceId,
        clientVersion: `affine-client-${randomUUID()}`,
      },
    );

    if (res && typeof res === 'object' && 'error' in res && res.error) {
      throw new Error(`space:join rejected: ${JSON.stringify(res.error)}`);
    }

    this.joinedWorkspaces.add(workspaceId);
  }

  async leaveWorkspace(workspaceId: string) {
    if (!this.joinedWorkspaces.has(workspaceId)) {
      return;
    }

    try {
      await this.emitWithAck('space:leave', {
        spaceType: 'workspace',
        spaceId: workspaceId,
      });
    } catch (err) {
      console.warn('space:leave failed:', err);
    } finally {
      this.joinedWorkspaces.delete(workspaceId);
    }
  }

  /**
   * Join the current user's userspace to access per-user data (favorites, settings, etc.)
   * Userspace must be joined before loading or pushing userdata docs.
   *
   * IMPORTANT: Userspace spaceId must be the userId, not workspaceId!
   * AFFiNE server validates: spaceId === userId for userspace access.
   */
  async joinUserspace() {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before joinUserspace.');
    }

    if (this.joinedUserspaces.has(this.userId)) {
      return;
    }

    const res = await this.emitWithAck<SocketAck>(
      'space:join',
      {
        spaceType: 'userspace',
        spaceId: this.userId,  // Must be userId, not workspaceId!
        clientVersion: `affine-client-${randomUUID()}`,
      },
    );

    if (res && typeof res === 'object' && 'error' in res && res.error) {
      throw new Error(`space:join (userspace) rejected: ${JSON.stringify(res.error)}`);
    }

    this.joinedUserspaces.add(this.userId);
  }

  async leaveUserspace() {
    if (!this.userId || !this.joinedUserspaces.has(this.userId)) {
      return;
    }

    try {
      await this.emitWithAck('space:leave', {
        spaceType: 'userspace',
        spaceId: this.userId,
      });
    } catch (err) {
      console.warn('space:leave (userspace) failed:', err);
    } finally {
      this.joinedUserspaces.delete(this.userId);
    }
  }

  async disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  async loadWorkspaceDoc(workspaceId: string, docId: string) {
    const res = await this.emitWithAck<SocketAck<LoadDocAckPayload>>(
      'space:load-doc',
      {
        spaceType: 'workspace',
        spaceId: workspaceId,
        docId,
      },
    );
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      throw new Error(
        `space:load-doc failed for ${docId}: ${JSON.stringify(res.error)}`,
      );
    }
    return decodeLoadResponse(res);
  }

  /**
   * Load a workspace doc, or create an empty one if it doesn't exist.
   * Useful for system docs like docCustomPropertyInfo that may not exist yet.
   */
  async loadOrCreateWorkspaceDoc(workspaceId: string, docId: string) {
    const res = await this.emitWithAck<SocketAck<LoadDocAckPayload>>(
      'space:load-doc',
      {
        spaceType: 'workspace',
        spaceId: workspaceId,
        docId,
      },
    );

    // Check if doc doesn't exist (404)
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      const error = res.error as { code?: string };
      if (error.code === 'DOC_NOT_FOUND') {
        // Create a new empty Y.Doc
        const doc = new Y.Doc();
        return { doc, stateVector: null, isNew: true };
      }
      throw new Error(
        `space:load-doc failed for ${docId}: ${JSON.stringify(res.error)}`,
      );
    }

    const result = decodeLoadResponse(res);
    return { ...result, isNew: false };
  }

  async pushWorkspaceDocUpdate(
    workspaceId: string,
    docId: string,
    doc: Y.Doc,
    stateVector?: Buffer | null,
  ) {
    const update = encodeUpdateToBase64(doc, stateVector);
    const res = await this.emitWithAck<SocketAck>(
      'space:push-doc-update',
      {
        spaceType: 'workspace',
        spaceId: workspaceId,
        docId,
        update,
      },
    );
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      throw new Error(
        `space:push-doc-update failed for ${docId}: ${JSON.stringify(res.error)}`,
      );
    }
    return res;
  }

  /**
   * Load a userspace doc (userdata like favorites, settings).
   * Userspace uses spaceType: 'userspace' which stores per-user data.
   * DocId format: userdata$userId$tableName (e.g., userdata$abc123$favorite)
   *
   * Note: Automatically joins the userspace if not already joined.
   *
   * IMPORTANT: For userspace, the spaceId is always the userId, not workspaceId!
   * The workspaceId may be encoded in the docId for workspace-specific userdata.
   */
  async loadOrCreateUserspaceDoc(docId: string) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before loadOrCreateUserspaceDoc.');
    }

    // Must join userspace before accessing userdata docs
    await this.joinUserspace();

    const res = await this.emitWithAck<SocketAck<LoadDocAckPayload>>(
      'space:load-doc',
      {
        spaceType: 'userspace',
        spaceId: this.userId,  // Always userId for userspace!
        docId,
      },
    );

    // Check if doc doesn't exist (404)
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      const error = res.error as { code?: string };
      if (error.code === 'DOC_NOT_FOUND') {
        // Create a new empty Y.Doc
        const doc = new Y.Doc();
        return { doc, stateVector: null, isNew: true };
      }
      throw new Error(
        `space:load-doc (userspace) failed for ${docId}: ${JSON.stringify(res.error)}`,
      );
    }

    const result = decodeLoadResponse(res);
    return { ...result, isNew: false };
  }

  /**
   * Push updates to a userspace doc.
   *
   * IMPORTANT: For userspace, the spaceId is always the userId, not workspaceId!
   */
  async pushUserspaceDocUpdate(
    docId: string,
    doc: Y.Doc,
    stateVector?: Buffer | null,
  ) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before pushUserspaceDocUpdate.');
    }

    const update = encodeUpdateToBase64(doc, stateVector);
    const res = await this.emitWithAck<SocketAck>(
      'space:push-doc-update',
      {
        spaceType: 'userspace',
        spaceId: this.userId,  // Always userId for userspace!
        docId,
        update,
      },
    );
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      throw new Error(
        `space:push-doc-update (userspace) failed for ${docId}: ${JSON.stringify(res.error)}`,
      );
    }
    return res;
  }

  async updateWorkspaceMeta(
    workspaceId: string,
    {
      docId,
      title,
      timestamp,
      tags,
    }: { docId: string; title: string; timestamp: number; tags?: string[] },
  ) {
    const { doc, stateVector } = await this.loadWorkspaceDoc(
      workspaceId,
      workspaceId,
    );
    const workspaceMeta = doc.getMap<unknown>('meta');
    let pages = workspaceMeta.get('pages') as Y.Array<unknown> | undefined;
    if (!(pages instanceof Y.Array)) {
      pages = new Y.Array();
      workspaceMeta.set('pages', pages);
    }

    let entry: Y.Map<unknown> | null = null;
    for (let index = 0; index < pages.length; index += 1) {
      const value = pages.get(index);
      if (value instanceof Y.Map && value.get('id') === docId) {
        entry = value;
        break;
      }
    }

    if (!entry) {
      entry = new Y.Map<unknown>();
      entry.set('id', docId);
      entry.set('createDate', timestamp);
      entry.set('tags', new Y.Array());
      pages.push([entry]);
    } else if (typeof entry.get('createDate') !== 'number') {
      entry.set('createDate', timestamp);
    }

    entry.set('title', title);
    entry.set('updatedDate', timestamp);
    if (Array.isArray(tags)) {
      const existingTags = entry.get('tags');
      let tagsList: Y.Array<unknown>;
      if (existingTags instanceof Y.Array) {
        existingTags.delete(0, existingTags.length);
        tagsList = existingTags;
      } else {
        tagsList = new Y.Array();
        entry.set('tags', tagsList);
      }
      for (const tag of tags) {
        tagsList.push([tag]);
      }
    }

    await this.pushWorkspaceDocUpdate(
      workspaceId,
      workspaceId,
      doc,
      stateVector,
    );
  }

  async upsertDocProperties(
    workspaceId: string,
    {
      docId,
      timestamp,
      tags,
      primaryMode,
      customProperties,
    }: {
      docId: string;
      timestamp: number;
      tags?: string[];
      primaryMode?: 'page' | 'edgeless';
      customProperties?: Record<string, string | number | boolean | null>;
    },
  ) {
    const docPropsId = `db$${workspaceId}$docProperties`;
    const { doc, stateVector } = await this.loadWorkspaceDoc(
      workspaceId,
      docPropsId,
    );

    const propsEntry = doc.getMap<unknown>(docId);
    propsEntry.set('id', docId);
    if (primaryMode !== undefined) {
      propsEntry.set('primaryMode', primaryMode);
    }
    propsEntry.set('edgelessColorTheme', 'light');
    if (this.userId) {
      propsEntry.set('createdBy', this.userId);
      propsEntry.set('updatedBy', this.userId);
    }
    propsEntry.set('updatedAt', timestamp);
    if (Array.isArray(tags)) {
      const existing = propsEntry.get('tags');
      let tagsList: Y.Array<unknown>;
      if (existing instanceof Y.Array) {
        existing.delete(0, existing.length);
        tagsList = existing;
      } else {
        tagsList = new Y.Array();
        propsEntry.set('tags', tagsList);
      }
      for (const tag of tags) {
        tagsList.push([tag]);
      }
    }

    // Set custom properties (custom:{propertyId} = value)
    if (customProperties) {
      for (const [propertyId, value] of Object.entries(customProperties)) {
        const key = propertyId.startsWith('custom:') ? propertyId : `custom:${propertyId}`;
        if (value === null) {
          propsEntry.delete(key);
        } else {
          propsEntry.set(key, String(value));
        }
      }
    }

    await this.pushWorkspaceDocUpdate(
      workspaceId,
      docPropsId,
      doc,
      stateVector,
    );
  }

  /**
   * Create or update a custom property definition for the workspace.
   * This defines the property type, name, and display settings that appear in the Info panel.
   */
  async upsertDocCustomPropertyInfo(
    workspaceId: string,
    {
      id,
      type,
      name,
      icon,
      show = 'always-show',
      index,
    }: {
      id: string;
      type: 'text' | 'number' | 'date' | 'checkbox';
      name: string;
      icon?: string;
      show?: 'always-show' | 'always-hide' | 'hide-when-empty';
      index?: string;
    },
  ) {
    const docCustomPropsId = `db$${workspaceId}$docCustomPropertyInfo`;
    const { doc, stateVector } = await this.loadOrCreateWorkspaceDoc(
      workspaceId,
      docCustomPropsId,
    );

    const propsEntry = doc.getMap<unknown>(id);
    propsEntry.set('id', id);
    propsEntry.set('type', type);
    propsEntry.set('name', name);
    propsEntry.set('show', show);
    if (icon) {
      propsEntry.set('icon', icon);
    }
    if (index) {
      propsEntry.set('index', index);
    } else {
      // Generate a sortable index if not provided
      propsEntry.set('index', `a${Date.now()}`);
    }

    await this.pushWorkspaceDocUpdate(
      workspaceId,
      docCustomPropsId,
      doc,
      stateVector,
    );

    return { id, type, name, show };
  }

  /**
   * List all custom property definitions for the workspace.
   */
  async listDocCustomPropertyInfo(workspaceId: string): Promise<Array<{
    id: string;
    type: string;
    name?: string;
    icon?: string;
    show?: string;
    index?: string;
    isDeleted?: boolean;
  }>> {
    const docCustomPropsId = `db$${workspaceId}$docCustomPropertyInfo`;
    const { doc, isNew } = await this.loadOrCreateWorkspaceDoc(workspaceId, docCustomPropsId);

    // If the doc was just created, it's empty - return empty array
    if (isNew) {
      return [];
    }

    const properties: Array<{
      id: string;
      type: string;
      name?: string;
      icon?: string;
      show?: string;
      index?: string;
      isDeleted?: boolean;
    }> = [];

    for (const key of doc.share.keys()) {
      if (key === 'meta') continue;
      const entry = doc.getMap<unknown>(key);
      const id = entry.get('id');
      const type = entry.get('type');
      if (typeof id === 'string' && typeof type === 'string') {
        properties.push({
          id,
          type,
          name: typeof entry.get('name') === 'string' ? entry.get('name') as string : undefined,
          icon: typeof entry.get('icon') === 'string' ? entry.get('icon') as string : undefined,
          show: typeof entry.get('show') === 'string' ? entry.get('show') as string : undefined,
          index: typeof entry.get('index') === 'string' ? entry.get('index') as string : undefined,
          isDeleted: entry.get('isDeleted') === true,
        });
      }
    }

    return properties.filter(p => !p.isDeleted);
  }

  async upsertFolderNode(
    workspaceId: string,
    {
      nodeId,
      parentId,
      type,
      data,
      index,
    }: {
      nodeId: string;
      parentId: string | null;
      type: 'folder' | 'doc';
      data: string | null;
      index?: string;
    },
  ) {
    const foldersId = `db$${workspaceId}$folders`;
    const { doc, stateVector } = await this.loadWorkspaceDoc(
      workspaceId,
      foldersId,
    );

    const nodeMap = doc.getMap<unknown>(nodeId);
    nodeMap.set('id', nodeId);
    nodeMap.set('parentId', parentId ?? null);
    nodeMap.set('type', type);
    nodeMap.set('data', data);
    nodeMap.set('index', index || randomLexoRank());

    await this.pushWorkspaceDocUpdate(
      workspaceId,
      foldersId,
      doc,
      stateVector,
    );
    return nodeId;
  }

  async createFolder(
    workspaceId: string,
    {
      name = 'New folder',
      parentId = null,
      nodeId = nanoid(),
      index,
    }: {
      name?: string;
      parentId?: string | null;
      nodeId?: string;
      index?: string;
    } = {},
  ) {
    await this.joinWorkspace(workspaceId);

    const finalNodeId = await this.upsertFolderNode(workspaceId, {
      nodeId,
      parentId,
      type: 'folder',
      data: name,
      index,
    });
    return { nodeId: finalNodeId };
  }

  async registerDocInFolder(
    workspaceId: string,
    {
      parentFolderId,
      docId,
      nodeId = nanoid(),
      index,
    }: {
      parentFolderId: string | null;
      docId: string;
      nodeId?: string;
      index?: string;
    },
  ) {
    await this.joinWorkspace(workspaceId);

    const finalNodeId = await this.upsertFolderNode(workspaceId, {
      nodeId,
      parentId: parentFolderId,
      type: 'doc',
      data: docId,
      index,
    });
    return { nodeId: finalNodeId };
  }

  async createDocument(
    workspaceId: string,
    {
      docId = nanoid(),
      title = `Programmatic doc ${new Date().toISOString()}`,
      content = 'Document generated via AffineClient.',
      markdown,
      folderId = null,
      folderNodeId = null,
      tags,
    }: {
      docId?: string;
      title?: string;
      content?: string;
      markdown?: string;
      folderId?: string | null;
      folderNodeId?: string | null;
      tags?: string[];
    } = {},
  ) {
    if (!this.userId) {
      throw new Error(
        'User id unavailable: signIn must complete before createDocument.',
      );
    }

    await this.joinWorkspace(workspaceId);

    const docCreation = markdown
      ? createDocYStructureFromMarkdown({
          docId,
          title,
          markdown,
          userId: this.userId,
        })
      : { ...createDocYStructure({ docId, title, content, userId: this.userId }), title };
    const { ydoc, timestamp } = docCreation;
    const effectiveTitle = docCreation.title ?? title;

    if (Array.isArray(tags) && tags.length) {
      const metaMap = ydoc.getMap('meta');
      const metaTags = metaMap.get('tags');
      if (metaTags instanceof Y.Array) {
        for (const tag of tags) {
          metaTags.push([tag]);
        }
      }
    }

    await this.pushWorkspaceDocUpdate(workspaceId, docId, ydoc);
    await this.updateWorkspaceMeta(workspaceId, {
      docId,
      title: effectiveTitle,
      timestamp,
      tags,
    });
    await this.upsertDocProperties(workspaceId, { docId, timestamp, tags });

    let registeredNodeId: string | null = null;
    if (folderId !== null) {
      const { nodeId } = await this.registerDocInFolder(workspaceId, {
        parentFolderId: folderId,
        docId,
        nodeId: folderNodeId ?? nanoid(),
      });
      registeredNodeId = nodeId;
    }

    return {
      docId,
      folderNodeId: registeredNodeId,
      timestamp,
      title: effectiveTitle,
    };
  }

  async listDocuments(workspaceId: string): Promise<DocumentSummary[]> {
    await this.joinWorkspace(workspaceId);

    const docPropsId = `db$${workspaceId}$docProperties`;
    const foldersId = `db$${workspaceId}$folders`;

    const [workspaceDoc, docPropsDoc, foldersDoc] = await Promise.all([
      this.loadWorkspaceDoc(workspaceId, workspaceId),
      this.loadWorkspaceDoc(workspaceId, docPropsId),
      this.loadWorkspaceDoc(workspaceId, foldersId),
    ]);

    const summaries = new Map<string, DocumentSummary>();
    const order: string[] = [];

    const workspaceMeta = workspaceDoc.doc.getMap<unknown>('meta');
    const pages = workspaceMeta.get('pages');
    if (pages instanceof Y.Array) {
      for (let index = 0; index < pages.length; index += 1) {
        const rawEntry = pages.get(index);
        const pageEntry = this.asYMap(rawEntry);
        if (!pageEntry) {
          continue;
        }
        const docId = pageEntry.get('id');
        if (typeof docId !== 'string') {
          continue;
        }
        const summary = this.getOrCreateSummary(summaries, docId);
        const title = pageEntry.get('title');
        if (typeof title === 'string') {
          summary.title = title;
        }
        const createDate = pageEntry.get('createDate');
        if (typeof createDate === 'number') {
          summary.createDate = createDate;
        }
        const updatedDate = pageEntry.get('updatedDate');
        if (typeof updatedDate === 'number') {
          summary.updatedDate = updatedDate;
        }
        const tags = this.toStringArray(pageEntry.get('tags'));
        if (tags.length) {
          summary.tags = tags;
        }
        order.push(docId);
      }
    }

    for (const key of docPropsDoc.doc.share.keys()) {
      if (key === 'meta') {
        continue;
      }
      const entry = docPropsDoc.doc.getMap<unknown>(key);
      const entryDocId = typeof entry.get('id') === 'string' ? (entry.get('id') as string) : key;
      if (typeof entryDocId !== 'string') {
        continue;
      }
      const summary = this.getOrCreateSummary(summaries, entryDocId);
      const updatedAt = entry.get('updatedAt');
      if (typeof updatedAt === 'number') {
        summary.updatedDate = updatedAt;
      }
      const tags = this.toStringArray(entry.get('tags'));
      if (tags.length) {
        summary.tags = tags;
      }
      // Read primaryMode from docProperties
      const primaryMode = entry.get('primaryMode');
      if (primaryMode === 'page' || primaryMode === 'edgeless') {
        summary.primaryMode = primaryMode;
      }
    }

    for (const key of foldersDoc.doc.share.keys()) {
      if (key === 'meta') {
        continue;
      }
      const entry = foldersDoc.doc.getMap<unknown>(key);
      if (entry.get('type') !== 'doc') {
        continue;
      }
      const docId = entry.get('data');
      if (typeof docId !== 'string') {
        continue;
      }
      if (entry.get('deleted') === true) {
        continue;
      }
      const summary = this.getOrCreateSummary(summaries, docId);
      summary.folderNodeId = key;
      const parentId = entry.get('parentId');
      summary.folderId = typeof parentId === 'string' ? parentId : null;
    }

    const seen = new Set<string>();
    const results: DocumentSummary[] = [];
    for (const docId of order) {
      const summary = summaries.get(docId);
      if (summary && !seen.has(docId)) {
        seen.add(docId);
        results.push({ ...summary, tags: [...summary.tags] });
      }
    }

    summaries.forEach((summary, docId) => {
      if (!seen.has(docId)) {
        seen.add(docId);
        results.push({ ...summary, tags: [...summary.tags] });
      }
    });

    return results;
  }

  async listTags(workspaceId: string): Promise<TagInfo[]> {
    const documents = await this.listDocuments(workspaceId);

    // Count tag usage across all documents
    const tagCounts = new Map<string, number>();
    for (const doc of documents) {
      for (const tagId of doc.tags) {
        tagCounts.set(tagId, (tagCounts.get(tagId) || 0) + 1);
      }
    }

    // Convert to TagInfo array
    const tags: TagInfo[] = [];
    for (const [tagId, count] of tagCounts.entries()) {
      tags.push({
        id: tagId,
        name: tagId, // For now, ID and name are the same
        count,
      });
    }

    // Sort by count (descending) then by name
    tags.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    return tags;
  }

  async deleteTag(workspaceId: string, tagId: string): Promise<{ deleted: boolean; documentsUpdated: number }> {
    await this.joinWorkspace(workspaceId);

    const documents = await this.listDocuments(workspaceId);
    const docsWithTag = documents.filter(doc => doc.tags.includes(tagId));

    if (docsWithTag.length === 0) {
      return { deleted: false, documentsUpdated: 0 };
    }

    // Remove tag from all documents that have it
    const timestamp = Date.now();
    await Promise.all(
      docsWithTag.map(doc => {
        const newTags = doc.tags.filter(t => t !== tagId);
        return Promise.all([
          this.upsertDocProperties(workspaceId, {
            docId: doc.docId,
            timestamp,
            tags: newTags,
          }),
          this.updateWorkspaceMeta(workspaceId, {
            docId: doc.docId,
            title: doc.title || 'Untitled',
            timestamp,
            tags: newTags,
          }),
        ]);
      })
    );

    return { deleted: true, documentsUpdated: docsWithTag.length };
  }

  async getDocument(workspaceId: string, docId: string): Promise<DocumentSnapshot> {
    await this.joinWorkspace(workspaceId);
    const [summaryList, docResult] = await Promise.all([
      this.listDocuments(workspaceId),
      this.loadWorkspaceDoc(workspaceId, docId),
    ]);

    const summary =
      summaryList.find(entry => entry.docId === docId) ??
      this.getOrCreateSummary(new Map<string, DocumentSummary>(), docId);

    const meta = docResult.doc.getMap<unknown>('meta');
    const metaTitle = meta.get('title');
    if (typeof metaTitle === 'string') {
      summary.title = metaTitle;
    }
    const createDate = meta.get('createDate');
    if (typeof createDate === 'number') {
      summary.createDate = createDate;
    }
    const updatedDate = meta.get('updatedDate');
    if (typeof updatedDate === 'number') {
      summary.updatedDate = updatedDate;
    }
    const metaTags = this.toStringArray(meta.get('tags'));
    if (metaTags.length) {
      summary.tags = metaTags;
    }

    return {
      ...summary,
      tags: [...summary.tags],
      update: encodeUpdateToBase64(docResult.doc, docResult.stateVector),
    };
  }

  async getDocumentContent(
    workspaceId: string,
    docId: string,
  ): Promise<DocumentContent> {
    await this.joinWorkspace(workspaceId);
    const [summaryList, docResult] = await Promise.all([
      this.listDocuments(workspaceId),
      this.loadWorkspaceDoc(workspaceId, docId),
    ]);

    const summary =
      summaryList.find(entry => entry.docId === docId) ??
      this.getOrCreateSummary(new Map<string, DocumentSummary>(), docId);

    const meta = docResult.doc.getMap<unknown>('meta');
    const metaTitle = meta.get('title');
    if (typeof metaTitle === 'string') {
      summary.title = metaTitle;
    }
    const createDate = meta.get('createDate');
    if (typeof createDate === 'number') {
      summary.createDate = createDate;
    }
    const updatedDate = meta.get('updatedDate');
    if (typeof updatedDate === 'number') {
      summary.updatedDate = updatedDate;
    }
    const metaTags = this.toStringArray(meta.get('tags'));
    if (metaTags.length) {
      summary.tags = metaTags;
    }

    // Extract blocks structure
    const blocks: BlockContent[] = [];
    const blocksMap = docResult.doc.getMap<Y.Map<unknown>>('blocks');

    blocksMap.forEach((blockData, blockId) => {
      if (!(blockData instanceof Y.Map)) {
        return;
      }

      const flavour = blockData.get('sys:flavour');
      if (typeof flavour !== 'string') {
        return;
      }

      const block: BlockContent = {
        id: blockId,
        flavour,
        props: {},
        children: [],
      };

      // Extract all properties
      blockData.forEach((value, key) => {
        if (key.startsWith('prop:')) {
          const propName = key.slice(5); // Remove 'prop:' prefix
          if (value instanceof Y.Text) {
            block.props[propName] = value.toString();
            // Also store as text field for convenience
            if (propName === 'text' || propName === 'title') {
              block.text = value.toString();
            }
          } else if (value instanceof Y.Array) {
            block.props[propName] = value.toArray();
          } else if (value instanceof Y.Map) {
            // Convert Y.Map to plain object
            const obj: Record<string, unknown> = {};
            value.forEach((v, k) => {
              obj[k] = v;
            });
            block.props[propName] = obj;
          } else {
            block.props[propName] = value;
          }
        } else if (key === 'sys:children') {
          if (value instanceof Y.Array) {
            block.children = value.toArray().filter((v): v is string => typeof v === 'string');
          }
        }
      });

      blocks.push(block);
    });

    return {
      ...summary,
      tags: [...summary.tags],
      blocks,
    };
  }

  async updateDocument(
    workspaceId: string,
    docId: string,
    {
      title,
      content,
      markdown,
      folderId,
      folderNodeId,
      tags,
      primaryMode,
    }: {
      title?: string;
      content?: string;
      markdown?: string;
      folderId?: string | null;
      folderNodeId?: string | null;
      tags?: string[];
      primaryMode?: 'page' | 'edgeless';
    } = {},
  ) {
    if (!this.userId) {
      throw new Error(
        'User id unavailable: signIn must complete before updateDocument.',
      );
    }

    await this.joinWorkspace(workspaceId);

    const summaries = await this.listDocuments(workspaceId);
    const currentSummary = summaries.find(entry => entry.docId === docId);

    const existingTitle = currentSummary?.title ?? null;
    const existingTags = currentSummary ? [...currentSummary.tags] : [];
    const existingFolderId = currentSummary?.folderId ?? null;
    const existingFolderNodeId = currentSummary?.folderNodeId ?? null;
    const existingCreateDate = currentSummary?.createDate ?? null;

    const tagsToApply = Array.isArray(tags) ? tags : existingTags;
    const desiredFolderId =
      folderId !== undefined ? folderId : existingFolderId ?? null;
    const desiredFolderNodeId =
      folderNodeId !== undefined ? folderNodeId : existingFolderNodeId;

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const timestamp = Date.now();
    const createDate =
      typeof existingCreateDate === 'number' ? existingCreateDate : timestamp;

    let effectiveTitle =
      title ?? existingTitle ?? `Programmatic doc ${new Date(timestamp).toISOString()}`;

    if (markdown !== undefined || content !== undefined) {
      let docCreation:
        | ReturnType<typeof createDocYStructureFromMarkdown>
        | ReturnType<typeof createDocYStructure>;
      if (markdown !== undefined) {
        const markdownOptions: {
          docId: string;
          markdown: string;
          userId: string;
          timestamp: number;
          title?: string;
        } = {
          docId,
          markdown,
          userId: this.userId,
          timestamp,
        };
        if (title !== undefined) {
          markdownOptions.title = title;
        }
        docCreation = createDocYStructureFromMarkdown(markdownOptions);
      } else {
        docCreation = createDocYStructure({
          docId,
          title: effectiveTitle,
          content: content ?? '',
          userId: this.userId,
          timestamp,
        });
      }
      if ('title' in docCreation && typeof docCreation.title === 'string') {
        effectiveTitle = docCreation.title;
      }
      doc.transact(() => {
        const keys = Array.from(doc.share.keys());
        for (const key of keys) {
          doc.share.delete(key);
        }
      });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(docCreation.ydoc));
    }

    const meta = doc.getMap<unknown>('meta');
    meta.set('id', docId);
    meta.set('title', effectiveTitle);
    meta.set('createDate', createDate);
    meta.set('updatedDate', timestamp);
    const tagsValue = meta.get('tags');
    let tagsList: Y.Array<unknown>;
    if (tagsValue instanceof Y.Array) {
      tagsValue.delete(0, tagsValue.length);
      tagsList = tagsValue;
    } else {
      tagsList = new Y.Array();
      meta.set('tags', tagsList);
    }
    for (const tag of tagsToApply) {
      tagsList.push([tag]);
    }

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    await this.updateWorkspaceMeta(workspaceId, {
      docId,
      title: effectiveTitle,
      timestamp,
      tags: tagsToApply,
    });
    await this.upsertDocProperties(workspaceId, {
      docId,
      timestamp,
      tags: tagsToApply,
      primaryMode,
    });

    const folderNode = await this.syncDocumentFolder(workspaceId, {
      docId,
      targetFolderId: desiredFolderId,
      preferredNodeId: desiredFolderNodeId ?? undefined,
    });

    return {
      docId,
      title: effectiveTitle,
      tags: tagsToApply,
      folderId: desiredFolderId,
      folderNodeId: folderNode,
      timestamp,
    };
  }

  async deleteDocument(workspaceId: string, docId: string) {
    await this.joinWorkspace(workspaceId);

    await this.syncDocumentFolder(workspaceId, {
      docId,
      targetFolderId: null,
    });

    const docPropsId = `db$${workspaceId}$docProperties`;
    const { doc: docProps, stateVector: docPropsState } = await this.loadWorkspaceDoc(
      workspaceId,
      docPropsId,
    );
    const docPropsEntry = docProps.getMap<unknown>(docId);
    docProps.transact(() => {
      docPropsEntry.set('id', docId);
      docPropsEntry.set('deleted', true);
      docPropsEntry.set('updatedAt', Date.now());
      const tagsValue = docPropsEntry.get('tags');
      if (tagsValue instanceof Y.Array) {
        tagsValue.delete(0, tagsValue.length);
      }
    });
    await this.pushWorkspaceDocUpdate(workspaceId, docPropsId, docProps, docPropsState);

    const { doc: workspaceDoc, stateVector: workspaceState } = await this.loadWorkspaceDoc(
      workspaceId,
      workspaceId,
    );
    let workspaceMutated = false;
    const workspaceMeta = workspaceDoc.getMap<unknown>('meta');
    const pages = workspaceMeta.get('pages');
    if (pages instanceof Y.Array) {
      for (let index = pages.length - 1; index >= 0; index -= 1) {
        const value = pages.get(index);
        if (value instanceof Y.Map && value.get('id') === docId) {
          pages.delete(index, 1);
          workspaceMutated = true;
        }
      }
    }
    if (workspaceMutated) {
      await this.pushWorkspaceDocUpdate(workspaceId, workspaceId, workspaceDoc, workspaceState);
    }

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const keys = Array.from(doc.share.keys());
    if (keys.length) {
      doc.transact(() => {
        for (const key of keys) {
          doc.share.delete(key);
        }
      });
      const meta = doc.getMap<unknown>('meta');
      meta.set('id', docId);
      meta.set('deleted', true);
      meta.set('updatedDate', Date.now());
      await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);
    }
  }

  async addBlock(
    workspaceId: string,
    docId: string,
    {
      flavour,
      parentBlockId,
      props = {},
      position,
    }: {
      flavour: string;
      parentBlockId: string;
      props?: Record<string, unknown>;
      position?: 'start' | 'end' | number;
    },
  ) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before addBlock.');
    }

    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const parentBlock = blocks.get(parentBlockId);

    if (!(parentBlock instanceof Y.Map)) {
      throw new Error(`Parent block ${parentBlockId} not found`);
    }

    const blockId = nanoid();
    const now = Date.now();

    doc.transact(() => {
      // Create new block
      const blockMap = new Y.Map<unknown>();
      blockMap.set('sys:id', blockId);
      blockMap.set('sys:flavour', flavour);
      blockMap.set('sys:parent', parentBlockId);
      blockMap.set('sys:children', new Y.Array());

      // Set properties
      Object.entries(props).forEach(([key, value]) => {
        const propKey = key.startsWith('prop:') ? key : `prop:${key}`;
        if (key === 'text' || key === 'title') {
          const ytext = new Y.Text();
          if (typeof value === 'string') {
            // Simple string
            ytext.insert(0, value);
          } else if (
            value &&
            typeof value === 'object' &&
            '$blocksuite:internal:text$' in value &&
            'delta' in value &&
            Array.isArray((value as { delta: unknown[] }).delta)
          ) {
            // BlockSuite delta format with potential attributes (e.g., LinkedPage)
            const delta = (value as { delta: Array<{ insert: string; attributes?: Record<string, unknown> }> }).delta;
            let offset = 0;
            for (const op of delta) {
              if (op.insert) {
                // Reference nodes (LinkedPage, etc.) must be exactly one space character
                // BlockSuite expects: insert=' ' + attributes={reference:{type,pageId}}
                // The displayed text is resolved dynamically from the pageId
                if (op.attributes && 'reference' in op.attributes) {
                  ytext.insert(offset, ' ', op.attributes);
                  offset += 1;
                } else {
                  ytext.insert(offset, op.insert, op.attributes);
                  offset += op.insert.length;
                }
              }
            }
          } else if (value && typeof value === 'object') {
            // Unknown object format, try to stringify
            ytext.insert(0, JSON.stringify(value));
          }
          blockMap.set(propKey, ytext);
        } else {
          blockMap.set(propKey, value);
        }
      });

      // Add metadata
      blockMap.set('prop:meta:createdAt', now);
      blockMap.set('prop:meta:createdBy', this.userId);
      blockMap.set('prop:meta:updatedAt', now);
      blockMap.set('prop:meta:updatedBy', this.userId);

      blocks.set(blockId, blockMap);

      // Update parent's children
      const parentChildren = parentBlock.get('sys:children');
      if (parentChildren instanceof Y.Array) {
        if (position === 'start') {
          parentChildren.unshift([blockId]);
        } else if (typeof position === 'number') {
          parentChildren.insert(position, [blockId]);
        } else {
          // 'end' or undefined
          parentChildren.push([blockId]);
        }
      }
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { blockId, timestamp: now };
  }

  /**
   * Add a paragraph block that contains a LinkedPage reference to another document.
   * This creates bidirectional links that appear as backlinks in AFFiNE.
   *
   * @param workspaceId - The workspace ID
   * @param docId - The document to add the block to
   * @param options - Block options including linked document info
   * @returns The created block ID and timestamp
   */
  async addParagraphWithDocLink(
    workspaceId: string,
    docId: string,
    {
      parentBlockId,
      linkedDocId,
      linkText,
      prefixText = '',
      suffixText = '',
      position,
      type = 'text',
    }: {
      parentBlockId: string;
      linkedDocId: string;
      linkText: string;
      prefixText?: string;
      suffixText?: string;
      position?: 'start' | 'end' | number;
      type?: 'text' | 'h1' | 'h2' | 'h3';
    },
  ) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before addParagraphWithDocLink.');
    }

    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const parentBlock = blocks.get(parentBlockId);

    if (!(parentBlock instanceof Y.Map)) {
      throw new Error(`Parent block ${parentBlockId} not found`);
    }

    const blockId = nanoid();
    const now = Date.now();

    doc.transact(() => {
      // Create new paragraph block
      const blockMap = new Y.Map<unknown>();
      blockMap.set('sys:id', blockId);
      blockMap.set('sys:flavour', 'affine:paragraph');
      blockMap.set('sys:parent', parentBlockId);
      blockMap.set('sys:children', new Y.Array());
      blockMap.set('prop:type', type);
      blockMap.set('prop:collapsed', false);

      // Create Y.Text with LinkedPage reference
      const ytext = new Y.Text();
      let currentPos = 0;

      // Insert prefix text (if any)
      if (prefixText) {
        ytext.insert(currentPos, prefixText);
        currentPos += prefixText.length;
      }

      // Insert linked document reference with special attributes
      // Using '\u0000' (null char) or the link text as the actual character
      // AFFiNE uses the reference attribute to render the link
      ytext.insert(currentPos, linkText, {
        reference: {
          type: 'LinkedPage',
          pageId: linkedDocId,
        },
      });
      currentPos += linkText.length;

      // Insert suffix text (if any)
      if (suffixText) {
        ytext.insert(currentPos, suffixText);
      }

      blockMap.set('prop:text', ytext);

      // Add metadata
      blockMap.set('prop:meta:createdAt', now);
      blockMap.set('prop:meta:createdBy', this.userId);
      blockMap.set('prop:meta:updatedAt', now);
      blockMap.set('prop:meta:updatedBy', this.userId);

      blocks.set(blockId, blockMap);

      // Update parent's children
      const parentChildren = parentBlock.get('sys:children');
      if (parentChildren instanceof Y.Array) {
        if (position === 'start') {
          parentChildren.unshift([blockId]);
        } else if (typeof position === 'number') {
          parentChildren.insert(position, [blockId]);
        } else {
          parentChildren.push([blockId]);
        }
      }
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { blockId, timestamp: now };
  }

  /**
   * Add multiple LinkedPage references as a list in a document.
   * Useful for creating "Related documents" or "Insights" sections.
   */
  async addDocLinksList(
    workspaceId: string,
    docId: string,
    {
      parentBlockId,
      linkedDocs,
      ordered = false,
      position,
    }: {
      parentBlockId: string;
      linkedDocs: Array<{ docId: string; title: string }>;
      ordered?: boolean;
      position?: 'start' | 'end' | number;
    },
  ) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before addDocLinksList.');
    }

    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const parentBlock = blocks.get(parentBlockId);

    if (!(parentBlock instanceof Y.Map)) {
      throw new Error(`Parent block ${parentBlockId} not found`);
    }

    const blockIds: string[] = [];
    const now = Date.now();

    doc.transact(() => {
      linkedDocs.forEach((linkedDoc, index) => {
        const blockId = nanoid();
        blockIds.push(blockId);

        // Create list item block
        const blockMap = new Y.Map<unknown>();
        blockMap.set('sys:id', blockId);
        blockMap.set('sys:flavour', 'affine:list');
        blockMap.set('sys:parent', parentBlockId);
        blockMap.set('sys:children', new Y.Array());
        blockMap.set('prop:type', ordered ? 'numbered' : 'bulleted');
        blockMap.set('prop:checked', false);
        blockMap.set('prop:collapsed', false);
        if (ordered) {
          blockMap.set('prop:order', index + 1);
        }

        // Create Y.Text with LinkedPage reference
        const ytext = new Y.Text();
        ytext.insert(0, linkedDoc.title, {
          reference: {
            type: 'LinkedPage',
            pageId: linkedDoc.docId,
          },
        });

        blockMap.set('prop:text', ytext);

        // Add metadata
        blockMap.set('prop:meta:createdAt', now);
        blockMap.set('prop:meta:createdBy', this.userId);
        blockMap.set('prop:meta:updatedAt', now);
        blockMap.set('prop:meta:updatedBy', this.userId);

        blocks.set(blockId, blockMap);

        // Update parent's children
        const parentChildren = parentBlock.get('sys:children');
        if (parentChildren instanceof Y.Array) {
          if (position === 'start' && index === 0) {
            parentChildren.unshift([blockId]);
          } else if (typeof position === 'number' && index === 0) {
            parentChildren.insert(position, [blockId]);
          } else {
            parentChildren.push([blockId]);
          }
        }
      });
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { blockIds, timestamp: now };
  }

  /**
   * Add embedded synced document blocks (affine:embed-synced-doc).
   * These show the actual content of referenced documents inline,
   * synchronized in real-time. Much richer than simple LinkedPage links.
   *
   * @param workspaceId - The workspace ID
   * @param docId - The document to add the embedded blocks to
   * @param options - Options including the documents to embed
   * @returns The created block IDs and timestamp
   */
  async addEmbeddedSyncedDocsList(
    workspaceId: string,
    docId: string,
    {
      parentBlockId,
      embeddedDocs,
      position,
    }: {
      parentBlockId: string;
      embeddedDocs: Array<{ docId: string; title?: string }>;
      position?: 'start' | 'end' | number;
    },
  ) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before addEmbeddedSyncedDocsList.');
    }

    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const parentBlock = blocks.get(parentBlockId);

    if (!(parentBlock instanceof Y.Map)) {
      throw new Error(`Parent block ${parentBlockId} not found`);
    }

    const blockIds: string[] = [];
    const now = Date.now();

    doc.transact(() => {
      embeddedDocs.forEach((embeddedDoc, index) => {
        const blockId = nanoid();
        blockIds.push(blockId);

        // Create embedded synced doc block
        const blockMap = new Y.Map<unknown>();
        blockMap.set('sys:id', blockId);
        blockMap.set('sys:flavour', 'affine:embed-synced-doc');
        blockMap.set('sys:parent', parentBlockId);
        blockMap.set('sys:children', new Y.Array());

        // Set the pageId to reference the embedded document
        blockMap.set('prop:pageId', embeddedDoc.docId);

        // Optional: Set caption if title is provided
        if (embeddedDoc.title) {
          const caption = new Y.Text();
          caption.insert(0, embeddedDoc.title);
          blockMap.set('prop:caption', caption);
        }

        // Add metadata
        blockMap.set('prop:meta:createdAt', now);
        blockMap.set('prop:meta:createdBy', this.userId);
        blockMap.set('prop:meta:updatedAt', now);
        blockMap.set('prop:meta:updatedBy', this.userId);

        blocks.set(blockId, blockMap);

        // Update parent's children
        const parentChildren = parentBlock.get('sys:children');
        if (parentChildren instanceof Y.Array) {
          if (position === 'start' && index === 0) {
            parentChildren.unshift([blockId]);
          } else if (typeof position === 'number' && index === 0) {
            parentChildren.insert(position, [blockId]);
          } else {
            parentChildren.push([blockId]);
          }
        }
      });
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { blockIds, timestamp: now };
  }

  /**
   * Get the noteId (main content block) of a document.
   * This is needed to add blocks to the document's content area.
   */
  async getDocumentNoteId(workspaceId: string, docId: string): Promise<string> {
    const { doc } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');

    for (const [blockId, blockMap] of blocks.entries()) {
      if (blockMap instanceof Y.Map && blockMap.get('sys:flavour') === 'affine:note') {
        return blockId;
      }
    }

    throw new Error(`No note block found in document ${docId}`);
  }

  /**
   * Create a document with full content structure including LinkedPage references.
   * Returns both the docId and noteId for further block additions.
   */
  async createDocumentWithStructure(
    workspaceId: string,
    {
      title,
      markdown,
      folderId = null,
      tags,
    }: {
      title: string;
      markdown?: string;
      folderId?: string | null;
      tags?: string[];
    },
  ): Promise<{ docId: string; noteId: string; folderNodeId: string | null; timestamp: number }> {
    const result = await this.createDocument(workspaceId, {
      title,
      markdown,
      folderId,
      tags,
    });

    const noteId = await this.getDocumentNoteId(workspaceId, result.docId);

    return {
      docId: result.docId,
      noteId,
      folderNodeId: result.folderNodeId,
      timestamp: result.timestamp,
    };
  }

  async updateBlock(
    workspaceId: string,
    docId: string,
    blockId: string,
    props: Record<string, unknown>,
  ) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before updateBlock.');
    }

    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const block = blocks.get(blockId);

    if (!(block instanceof Y.Map)) {
      throw new Error(`Block ${blockId} not found`);
    }

    const now = Date.now();

    doc.transact(() => {
      Object.entries(props).forEach(([key, value]) => {
        const propKey = key.startsWith('prop:') ? key : `prop:${key}`;

        if (typeof value === 'string' && (key === 'text' || key === 'title')) {
          // Update Y.Text
          const existing = block.get(propKey);
          if (existing instanceof Y.Text) {
            existing.delete(0, existing.length);
            existing.insert(0, value);
          } else {
            const ytext = new Y.Text();
            ytext.insert(0, value);
            block.set(propKey, ytext);
          }
        } else {
          block.set(propKey, value);
        }
      });

      block.set('prop:meta:updatedAt', now);
      block.set('prop:meta:updatedBy', this.userId);
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { blockId, timestamp: now };
  }

  async deleteBlock(workspaceId: string, docId: string, blockId: string) {
    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const block = blocks.get(blockId);

    if (!(block instanceof Y.Map)) {
      throw new Error(`Block ${blockId} not found`);
    }

    const parentId = block.get('sys:parent');
    if (typeof parentId !== 'string') {
      throw new Error(`Block ${blockId} has no parent (cannot delete root block)`);
    }

    doc.transact(() => {
      // Remove from parent's children
      const parentBlock = blocks.get(parentId);
      if (parentBlock instanceof Y.Map) {
        const parentChildren = parentBlock.get('sys:children');
        if (parentChildren instanceof Y.Array) {
          for (let i = parentChildren.length - 1; i >= 0; i--) {
            if (parentChildren.get(i) === blockId) {
              parentChildren.delete(i, 1);
              break;
            }
          }
        }
      }

      // Delete the block itself
      blocks.delete(blockId);

      // Recursively delete children
      const children = block.get('sys:children');
      if (children instanceof Y.Array) {
        children.toArray().forEach((childId) => {
          if (typeof childId === 'string') {
            blocks.delete(childId);
          }
        });
      }
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { blockId, deleted: true };
  }

  // ============================================================================
  // Edgeless Mode Operations
  // ============================================================================

  /**
   * Get all elements from the Edgeless canvas.
   * @param workspaceId Workspace ID
   * @param docId Document ID
   * @returns Array of Edgeless elements
   */
  async getEdgelessElements(
    workspaceId: string,
    docId: string,
  ): Promise<Array<Record<string, unknown>>> {
    await this.joinWorkspace(workspaceId);

    const { doc } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');

    // Find surface block
    let surfaceBlockFound: Y.Map<unknown> | undefined;
    let surfaceId: string | null = null;

    blocks.forEach((blockData, blockId) => {
      if (blockData instanceof Y.Map && blockData.get('sys:flavour') === 'affine:surface') {
        surfaceBlockFound = blockData;
        surfaceId = blockId;
      }
    });

    if (!surfaceBlockFound || !surfaceId) {
      return [];
    }

    const surfaceBlock = surfaceBlockFound; // Type narrowing

    // Extract elements using helper
    let elementsMap: Y.Map<unknown> | Record<string, unknown>;
    try {
      elementsMap = this.getElementsMap(surfaceBlock);
    } catch (error) {
      return []; // Surface block not properly initialized for edgeless mode
    }

    // Convert to array, parsing xywh strings
    const elements: Array<Record<string, unknown>> = [];
    this.forEachElement(elementsMap, (elementData: unknown) => {
      if (typeof elementData === 'object' && elementData !== null) {
        // Convert Y.js objects to plain JavaScript objects
        // Y.Map and other Y.js types have a toJSON() method
        let element: Record<string, unknown>;
        if (elementData instanceof Y.Map || elementData instanceof Y.Array) {
          element = elementData.toJSON() as Record<string, unknown>;
        } else if ('toJSON' in elementData && typeof (elementData as { toJSON: () => unknown }).toJSON === 'function') {
          element = (elementData as { toJSON: () => unknown }).toJSON() as Record<string, unknown>;
        } else {
          element = { ...(elementData as Record<string, unknown>) };
        }

        // Parse xywh if it's a string
        if ('xywh' in element && typeof element.xywh === 'string') {
          try {
            element.xywh = JSON.parse(element.xywh as string);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }

        elements.push(element);
      }
    });

    return elements;
  }

  /**
   * Add a new element to the Edgeless canvas.
   * @param workspaceId Workspace ID
   * @param docId Document ID
   * @param elementData Element data (will be processed by factory)
   * @returns Created element with generated ID
   */
  async addEdgelessElement(
    workspaceId: string,
    docId: string,
    elementData: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');

    // Find surface block
    let surfaceBlockFound: Y.Map<unknown> | undefined;
    let surfaceId: string | null = null;

    blocks.forEach((blockData, blockId) => {
      if (blockData instanceof Y.Map && blockData.get('sys:flavour') === 'affine:surface') {
        surfaceBlockFound = blockData;
        surfaceId = blockId;
      }
    });

    if (!surfaceBlockFound || !surfaceId) {
      throw new Error('Surface block not found in document');
    }

    const surfaceBlock = surfaceBlockFound; // Type narrowing
    const elementsMap = this.getElementsMap(surfaceBlock);

    // Generate element ID if not provided
    const elementId = (elementData.id as string) || nanoid();

    // Apply BlockSuite defaults based on element type
    // This mimics the @field() decorator behavior
    const withDefaults = applyElementDefaults(elementData);

    // Serialize xywh if it's an array
    const processedElement: Record<string, unknown> = { ...withDefaults, id: elementId };
    if ('xywh' in processedElement && Array.isArray(processedElement.xywh)) {
      processedElement.xywh = JSON.stringify(processedElement.xywh);
    }

    // Generate index if not provided
    if (!processedElement.index) {
      const existingIndices: string[] = [];
      this.forEachElement(elementsMap, (el: unknown) => {
        if (typeof el === 'object' && el !== null && 'index' in el) {
          const idx = (el as { index: unknown }).index;
          if (typeof idx === 'string') {
            existingIndices.push(idx);
          }
        }
      });

      processedElement.index = this.generateNextIndex(existingIndices);
    }

    // Generate seed if not provided
    if (!processedElement.seed) {
      processedElement.seed = Math.floor(Math.random() * 2147483647);
    }

    // Apply Yjs transformations (e.g., text → Y.Text)
    const finalElement = transformPropsToYjs(processedElement);

    // Add element to surface
    doc.transact(() => {
      this.setElement(elementsMap, elementId, finalElement);
    });

    console.log(`[AffineClient] Pushing doc update for element ${elementId}...`);
    const pushResult = await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);
    console.log(`[AffineClient] Push result:`, JSON.stringify(pushResult));

    // Return element with parsed xywh
    const returnElement = { ...processedElement };
    if (typeof returnElement.xywh === 'string') {
      try {
        returnElement.xywh = JSON.parse(returnElement.xywh);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    return returnElement;
  }

  /**
   * Update an existing Edgeless element.
   * @param workspaceId Workspace ID
   * @param docId Document ID
   * @param elementId Element ID
   * @param updates Properties to update
   * @returns Updated element
   */
  async updateEdgelessElement(
    workspaceId: string,
    docId: string,
    elementId: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');

    // Find surface block
    let surfaceBlockFound: Y.Map<unknown> | undefined;

    blocks.forEach((blockData) => {
      if (blockData instanceof Y.Map && blockData.get('sys:flavour') === 'affine:surface') {
        surfaceBlockFound = blockData;
      }
    });

    if (!surfaceBlockFound) {
      throw new Error('Surface block not found in document');
    }

    const surfaceBlock = surfaceBlockFound; // Type narrowing
    const elementsMap = this.getElementsMap(surfaceBlock);

    // Get existing element
    const existingElement = this.getElement(elementsMap, elementId);
    if (!existingElement) {
      throw new Error(`Element ${elementId} not found`);
    }

    // Merge updates
    const processedUpdates: Record<string, unknown> = { ...updates };
    if ('xywh' in processedUpdates && Array.isArray(processedUpdates.xywh)) {
      processedUpdates.xywh = JSON.stringify(processedUpdates.xywh);
    }

    const updatedElement = {
      ...existingElement,
      ...processedUpdates,
    };

    // Update element
    doc.transact(() => {
      this.setElement(elementsMap, elementId, updatedElement);
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    // Return element with parsed xywh
    const returnElement = { ...updatedElement };
    if (typeof returnElement.xywh === 'string') {
      try {
        returnElement.xywh = JSON.parse(returnElement.xywh);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }

    return returnElement;
  }

  /**
   * Delete an element from the Edgeless canvas.
   * @param workspaceId Workspace ID
   * @param docId Document ID
   * @param elementId Element ID
   * @returns Deletion confirmation
   */
  async deleteEdgelessElement(
    workspaceId: string,
    docId: string,
    elementId: string,
  ): Promise<{ elementId: string; deleted: boolean }> {
    await this.joinWorkspace(workspaceId);

    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docId);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');

    // Find surface block
    let surfaceBlockFound: Y.Map<unknown> | undefined;

    blocks.forEach((blockData) => {
      if (blockData instanceof Y.Map && blockData.get('sys:flavour') === 'affine:surface') {
        surfaceBlockFound = blockData;
      }
    });

    if (!surfaceBlockFound) {
      throw new Error('Surface block not found in document');
    }

    const surfaceBlock = surfaceBlockFound; // Type narrowing

    // Get elements map (handles both YMap and plain object)
    const elementsMap = this.getElementsMap(surfaceBlock);

    // Check if element exists
    if (!this.hasElement(elementsMap, elementId)) {
      throw new Error(`Element ${elementId} not found`);
    }

    // Delete element (handles both YMap and plain object)
    doc.transact(() => {
      this.deleteElement(elementsMap, elementId);
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { elementId, deleted: true };
  }

  /**
   * Helper: Extract elements map from surface block (handles both YMap and plain object).
   */
  private getElementsMap(
    surfaceBlock: Y.Map<unknown>,
  ): Y.Map<unknown> | Record<string, unknown> {
    const elementsWrapper = surfaceBlock.get('prop:elements');
    if (!elementsWrapper || typeof elementsWrapper !== 'object') {
      throw new Error('Elements property not found in surface block');
    }

    // Handle YMap structure
    if (elementsWrapper instanceof Y.Map) {
      if (elementsWrapper.get('type') !== '$blocksuite:internal:native$') {
        throw new Error('Elements property missing native type marker');
      }
      const value = elementsWrapper.get('value');
      if (value instanceof Y.Map) {
        return value;
      } else if (typeof value === 'object' && value !== null) {
        return value as Record<string, unknown>;
      }
      throw new Error('Elements value is invalid');
    }

    // Handle plain object structure
    const wrapper = elementsWrapper as { type?: string; value?: unknown };
    if (wrapper.type !== '$blocksuite:internal:native$') {
      throw new Error('Elements property missing native type marker');
    }
    if (wrapper.value && typeof wrapper.value === 'object') {
      return wrapper.value as Record<string, unknown>;
    }
    throw new Error('Elements value is invalid');
  }

  /**
   * Helper: Set element in map (handles both YMap and plain object).
   */
  private setElement(
    elementsMap: Y.Map<unknown> | Record<string, unknown>,
    elementId: string,
    elementData: Record<string, unknown>,
  ): void {
    if (elementsMap instanceof Y.Map) {
      // Store element as Y.Map for proper CRDT synchronization
      const elementMap = new Y.Map<unknown>();
      Object.entries(elementData).forEach(([key, value]) => {
        elementMap.set(key, value);
      });
      elementsMap.set(elementId, elementMap);
    } else {
      elementsMap[elementId] = elementData;
    }
  }

  /**
   * Helper: Get element from map (handles both YMap and plain object).
   */
  private getElement(
    elementsMap: Y.Map<unknown> | Record<string, unknown>,
    elementId: string,
  ): Record<string, unknown> | null {
    if (elementsMap instanceof Y.Map) {
      const el = elementsMap.get(elementId);
      return el && typeof el === 'object' ? (el as Record<string, unknown>) : null;
    } else {
      const el = elementsMap[elementId];
      return el && typeof el === 'object' ? (el as Record<string, unknown>) : null;
    }
  }

  /**
   * Helper: Delete element from map (handles both YMap and plain object).
   */
  private deleteElement(
    elementsMap: Y.Map<unknown> | Record<string, unknown>,
    elementId: string,
  ): void {
    if (elementsMap instanceof Y.Map) {
      elementsMap.delete(elementId);
    } else {
      delete elementsMap[elementId];
    }
  }

  /**
   * Helper: Check if element exists in map (handles both YMap and plain object).
   */
  private hasElement(
    elementsMap: Y.Map<unknown> | Record<string, unknown>,
    elementId: string,
  ): boolean {
    if (elementsMap instanceof Y.Map) {
      return elementsMap.has(elementId);
    } else {
      return elementId in elementsMap;
    }
  }

  /**
   * Helper: Iterate elements map (handles both YMap and plain object).
   */
  private forEachElement(
    elementsMap: Y.Map<unknown> | Record<string, unknown>,
    callback: (element: unknown) => void,
  ): void {
    if (elementsMap instanceof Y.Map) {
      elementsMap.forEach(callback);
    } else {
      Object.values(elementsMap).forEach(callback);
    }
  }

  /**
   * Helper: Generate next fractional index for layering.
   */
  private generateNextIndex(existingIndices: string[]): string {
    if (existingIndices.length === 0) {
      return 'a0';
    }

    const sorted = existingIndices.sort().reverse();
    const maxIndex = sorted[0];

    const match = maxIndex.match(/^([a-z]+)(\d+)$/i);
    if (!match) return 'a0';

    const [, letters, numbers] = match;
    const num = parseInt(numbers, 10);

    return `${letters}${num + 1}`;
  }

  // ============================================================================
  // Workspace Navigation API
  // ============================================================================

  /**
   * Helper: Execute GraphQL query against AFFiNE API.
   */
  private async graphqlQuery<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.cookieJar.size) {
      throw new Error('Must sign in before making GraphQL requests');
    }

    const response = await this.fetchFn(new URL('/graphql', this.baseUrl).toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        cookie: this.getCookieHeader(),
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      let text = '<unreadable>';
      try {
        text = await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        `GraphQL request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    const json = JSON.parse(await response.text()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (json.errors && json.errors.length > 0) {
      throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
    }

    if (!json.data) {
      throw new Error('GraphQL response missing data field');
    }

    return json.data;
  }

  private async graphqlMultipart<T = unknown>(
    query: string,
    variables: Record<string, unknown>,
    files: Array<{
      variableName: string;
      fileName: string;
      content: Buffer;
      mimeType?: string;
    }>,
  ): Promise<T> {
    if (!this.cookieJar.size) {
      throw new Error('Must sign in before making GraphQL requests');
    }

    const url = new URL('/graphql', this.baseUrl).toString();
    const safeVariables: Record<string, unknown> = { ...variables };
    for (const file of files) {
      safeVariables[file.variableName] = null;
    }

    const form = new FormData();
    form.set(
      'operations',
      JSON.stringify({
        query,
        variables: safeVariables,
      }),
    );

    const map: Record<string, string[]> = {};
    files.forEach((file, index) => {
      map[String(index)] = [`variables.${file.variableName}`];
    });
    form.set('map', JSON.stringify(map));

    files.forEach((file, index) => {
      const payload = new File([file.content], file.fileName, {
        type: file.mimeType ?? 'application/octet-stream',
      });
      form.set(String(index), payload, file.fileName);
    });

    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        cookie: this.getCookieHeader(),
      },
      body: form,
    });

    if (!response.ok) {
      let text = '<unreadable>';
      try {
        text = await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        `GraphQL request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    const json = JSON.parse(await response.text()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };

    if (json.errors && json.errors.length > 0) {
      throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
    }

    if (!json.data) {
      throw new Error('GraphQL response missing data field');
    }

    return json.data;
  }

  /**
   * List all accessible workspaces with names and metadata.
   *
   * Returns workspaces with:
   * - id: Workspace ID
   * - name: Workspace name (from Yjs meta)
   * - public: Public workspace flag
   * - enableAi: AI features enabled
   * - createdAt: Creation timestamp
   */
  async listWorkspaces(): Promise<
    Array<{
      id: string;
      name: string | null;
      public: boolean;
      enableAi: boolean;
      createdAt: string;
    }>
  > {
    const query = `
      query {
        workspaces {
          id
          public
          enableAi
          createdAt
        }
      }
    `;

    const result = await this.graphqlQuery<{
      workspaces: Array<{
        id: string;
        public: boolean;
        enableAi: boolean;
        createdAt: string;
      }>;
    }>(query);

    // Fetch workspace names from Yjs meta for each workspace
    const workspacesWithNames = await Promise.all(
      result.workspaces.map(async ws => {
        let name: string | null = null;
        try {
          // Must join workspace before loading its documents
          await this.joinWorkspace(ws.id);
          const { doc } = await this.loadWorkspaceDoc(ws.id, ws.id);
          const meta = doc.getMap<unknown>('meta');
          const nameValue = meta.get('name');
          if (typeof nameValue === 'string') {
            name = nameValue;
          }
        } catch (error) {
          // If we can't load workspace meta, name stays null
          console.warn(`Failed to load workspace meta for ${ws.id}:`, error);
        }

        return {
          ...ws,
          name,
        };
      }),
    );

    return workspacesWithNames;
  }

  async queryWorkspaceEmbeddingStatus(workspaceId: string): Promise<WorkspaceEmbeddingStatus> {
    const query = `
      query getWorkspaceEmbeddingStatus($workspaceId: String!) {
        queryWorkspaceEmbeddingStatus(workspaceId: $workspaceId) {
          total
          embedded
        }
      }
    `;
    const result = await this.graphqlQuery<{
      queryWorkspaceEmbeddingStatus: WorkspaceEmbeddingStatus;
    }>(query, { workspaceId });
    return result.queryWorkspaceEmbeddingStatus;
  }

  async matchWorkspaceDocs(
    workspaceId: string,
    content: string,
    options: {
      limit?: number;
      threshold?: number;
      scopedThreshold?: number;
      contextId?: string;
    } = {},
  ): Promise<CopilotDocChunk[]> {
    const query = `
      query matchWorkspaceDocs($contextId: String, $workspaceId: String!, $content: String!, $limit: SafeInt, $scopedThreshold: Float, $threshold: Float) {
        currentUser {
          copilot(workspaceId: $workspaceId) {
            contexts(contextId: $contextId) {
              matchWorkspaceDocs(content: $content, limit: $limit, scopedThreshold: $scopedThreshold, threshold: $threshold) {
                docId
                chunk
                content
                distance
              }
            }
          }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      workspaceId,
      content,
    };
    this.assignOptionalVariable(variables, 'contextId', options.contextId);
    this.assignOptionalVariable(variables, 'limit', options.limit);
    this.assignOptionalVariable(variables, 'threshold', options.threshold);
    this.assignOptionalVariable(variables, 'scopedThreshold', options.scopedThreshold);

    const result = await this.graphqlQuery<{
      currentUser: {
        copilot: {
          contexts: Array<{
            matchWorkspaceDocs?: CopilotDocChunk[];
          }>;
        } | null;
      } | null;
    }>(query, variables);

    const contexts = result.currentUser?.copilot?.contexts ?? [];
    return contexts.flatMap(ctx => ctx.matchWorkspaceDocs ?? []);
  }

  async matchWorkspaceFiles(
    workspaceId: string,
    content: string,
    options: {
      limit?: number;
      threshold?: number;
      scopedThreshold?: number;
      contextId?: string;
    } = {},
  ): Promise<CopilotFileChunk[]> {
    const query = `
      query matchFiles($contextId: String, $workspaceId: String!, $content: String!, $limit: SafeInt, $scopedThreshold: Float, $threshold: Float) {
        currentUser {
          copilot(workspaceId: $workspaceId) {
            contexts(contextId: $contextId) {
              matchFiles(content: $content, limit: $limit, scopedThreshold: $scopedThreshold, threshold: $threshold) {
                fileId
                blobId
                name
                mimeType
                chunk
                content
                distance
              }
            }
          }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      workspaceId,
      content,
    };
    this.assignOptionalVariable(variables, 'contextId', options.contextId);
    this.assignOptionalVariable(variables, 'limit', options.limit);
    this.assignOptionalVariable(variables, 'threshold', options.threshold);
    this.assignOptionalVariable(variables, 'scopedThreshold', options.scopedThreshold);

    const result = await this.graphqlQuery<{
      currentUser: {
        copilot: {
          contexts: Array<{
            matchFiles?: CopilotFileChunk[];
          }>;
        } | null;
      } | null;
    }>(query, variables);

    const contexts = result.currentUser?.copilot?.contexts ?? [];
    return contexts.flatMap(ctx => ctx.matchFiles ?? []);
  }

  async listWorkspaceIgnoredDocs(
    workspaceId: string,
    options: { first?: number; offset?: number } = {},
  ): Promise<{
    totalCount: number;
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
    items: WorkspaceIgnoredDoc[];
  }> {
    const pagination = this.buildPaginationInput(options.first, options.offset);
    const query = `
      query getWorkspaceEmbeddingIgnoredDocs($workspaceId: String!, $pagination: PaginationInput!) {
        workspace(id: $workspaceId) {
          embedding {
            ignoredDocs(pagination: $pagination) {
              totalCount
              pageInfo {
                endCursor
                hasNextPage
              }
              edges {
                node {
                  docId
                  createdAt
                  docCreatedAt
                  docUpdatedAt
                  title
                  createdBy
                  createdByAvatar
                  updatedBy
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphqlQuery<{
      workspace: {
        embedding: {
          ignoredDocs: {
            totalCount: number;
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            edges: Array<{ node: WorkspaceIgnoredDoc }>;
          };
        } | null;
      } | null;
    }>(query, { workspaceId, pagination });

    const connection = result.workspace?.embedding?.ignoredDocs;
    if (!connection) {
      return {
        totalCount: 0,
        pageInfo: { endCursor: null, hasNextPage: false },
        items: [],
      };
    }

    return {
      totalCount: connection.totalCount,
      pageInfo: connection.pageInfo,
      items: connection.edges.map(edge => edge.node),
    };
  }

  async updateWorkspaceIgnoredDocs(
    workspaceId: string,
    options: { add?: string[]; remove?: string[] },
  ): Promise<number> {
    const query = `
      mutation updateWorkspaceEmbeddingIgnoredDocs($workspaceId: String!, $add: [String!], $remove: [String!]) {
        updateWorkspaceEmbeddingIgnoredDocs(workspaceId: $workspaceId, add: $add, remove: $remove)
      }
    `;
    const variables: Record<string, unknown> = { workspaceId };
    this.assignOptionalVariable(variables, 'add', options.add?.length ? options.add : undefined);
    this.assignOptionalVariable(
      variables,
      'remove',
      options.remove?.length ? options.remove : undefined,
    );

    const result = await this.graphqlQuery<{
      updateWorkspaceEmbeddingIgnoredDocs: number;
    }>(query, variables);
    return result.updateWorkspaceEmbeddingIgnoredDocs;
  }

  async queueWorkspaceEmbedding(workspaceId: string, docIds: string[]): Promise<boolean> {
    const query = `
      mutation queueWorkspaceEmbedding($workspaceId: String!, $docId: [String!]!) {
        queueWorkspaceEmbedding(workspaceId: $workspaceId, docId: $docId)
      }
    `;
    const result = await this.graphqlQuery<{
      queueWorkspaceEmbedding: boolean;
    }>(query, { workspaceId, docId: docIds });
    return result.queueWorkspaceEmbedding;
  }

  async listWorkspaceEmbeddingFiles(
    workspaceId: string,
    options: { first?: number; offset?: number } = {},
  ): Promise<{
    totalCount: number;
    pageInfo: { endCursor: string | null; hasNextPage: boolean };
    items: WorkspaceEmbeddingFile[];
  }> {
    const pagination = this.buildPaginationInput(options.first, options.offset);
    const query = `
      query getWorkspaceEmbeddingFiles($workspaceId: String!, $pagination: PaginationInput!) {
        workspace(id: $workspaceId) {
          embedding {
            files(pagination: $pagination) {
              totalCount
              pageInfo {
                endCursor
                hasNextPage
              }
              edges {
                node {
                  workspaceId
                  fileId
                  blobId
                  fileName
                  mimeType
                  size
                  createdAt
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphqlQuery<{
      workspace: {
        embedding: {
          files: {
            totalCount: number;
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
            edges: Array<{ node: WorkspaceEmbeddingFile }>;
          };
        } | null;
      } | null;
    }>(query, { workspaceId, pagination });

    const connection = result.workspace?.embedding?.files;
    if (!connection) {
      return {
        totalCount: 0,
        pageInfo: { endCursor: null, hasNextPage: false },
        items: [],
      };
    }

    return {
      totalCount: connection.totalCount,
      pageInfo: connection.pageInfo,
      items: connection.edges.map(edge => edge.node),
    };
  }

  async addWorkspaceEmbeddingFile(
    workspaceId: string,
    file: { fileName: string; content: Buffer; mimeType?: string },
  ): Promise<WorkspaceEmbeddingFile> {
    const query = `
      mutation addWorkspaceEmbeddingFiles($workspaceId: String!, $blob: Upload!) {
        addWorkspaceEmbeddingFiles(workspaceId: $workspaceId, blob: $blob) {
          workspaceId
          fileId
          blobId
          fileName
          mimeType
          size
          createdAt
        }
      }
    `;

    const result = await this.graphqlMultipart<{
      addWorkspaceEmbeddingFiles: WorkspaceEmbeddingFile;
    }>(query, { workspaceId, blob: null }, [
      {
        variableName: 'blob',
        fileName: file.fileName,
        content: file.content,
        mimeType: file.mimeType,
      },
    ]);
    return result.addWorkspaceEmbeddingFiles;
  }

  async removeWorkspaceEmbeddingFile(
    workspaceId: string,
    fileId: string,
  ): Promise<boolean> {
    const query = `
      mutation removeWorkspaceEmbeddingFiles($workspaceId: String!, $fileId: String!) {
        removeWorkspaceEmbeddingFiles(workspaceId: $workspaceId, fileId: $fileId)
      }
    `;

    const result = await this.graphqlQuery<{
      removeWorkspaceEmbeddingFiles: boolean;
    }>(query, { workspaceId, fileId });
    return result.removeWorkspaceEmbeddingFiles;
  }

  async listDocumentHistory(
    workspaceId: string,
    docId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<DocumentHistoryEntry[]> {
    const query = `
      query listHistory($workspaceId: String!, $pageDocId: String!, $take: Int, $before: DateTime) {
        workspace(id: $workspaceId) {
          histories(guid: $pageDocId, take: $take, before: $before) {
            id
            timestamp
            editor {
              name
              avatarUrl
            }
          }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      workspaceId,
      pageDocId: docId,
    };
    this.assignOptionalVariable(
      variables,
      'take',
      typeof options.limit === 'number' ? options.limit : undefined,
    );
    this.assignOptionalVariable(variables, 'before', options.before);

    const result = await this.graphqlQuery<{
      workspace: {
        histories: DocumentHistoryEntry[];
      } | null;
    }>(query, variables);

    return result.workspace?.histories ?? [];
  }

  async recoverDocumentVersion(
    workspaceId: string,
    docId: string,
    timestamp: string,
  ): Promise<boolean> {
    const query = `
      mutation recoverDoc($workspaceId: String!, $docId: String!, $timestamp: DateTime!) {
        recoverDoc(workspaceId: $workspaceId, guid: $docId, timestamp: $timestamp)
      }
    `;

    const result = await this.graphqlQuery<{
      recoverDoc: boolean;
    }>(query, { workspaceId, docId, timestamp });
    return result.recoverDoc;
  }

  // ============================================================================
  // Collaboration API (comments, notifications, tokens)
  // ============================================================================

  async listComments(
    workspaceId: string,
    docId: string,
    options: { first?: number; offset?: number; after?: string } = {},
  ): Promise<CommentConnection> {
    const pagination: Record<string, unknown> = {};
    if (typeof options.first === 'number' && Number.isFinite(options.first)) {
      pagination.first = options.first;
    }
    if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
      pagination.offset = options.offset;
    }
    const trimmedAfter = options.after?.trim();
    if (trimmedAfter) {
      pagination.after = trimmedAfter;
    }

    const query = `
      query listComments(
        $workspaceId: String!
        $docId: String!
        $pagination: PaginationInput
      ) {
        workspace(id: $workspaceId) {
          comments(docId: $docId, pagination: $pagination) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              cursor
              node {
                id
                content
                createdAt
                updatedAt
                resolved
                user {
                  id
                  name
                  avatarUrl
                }
                replies {
                  id
                  content
                  createdAt
                  updatedAt
                  user {
                    id
                    name
                    avatarUrl
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variables: Record<string, unknown> = {
      workspaceId,
      docId,
    };
    if (Object.keys(pagination).length > 0) {
      variables.pagination = pagination;
    }

    const result = await this.graphqlQuery<{
      workspace: {
        comments: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: DocumentComment | null }>;
        };
      } | null;
    }>(query, variables);

    const connection = result.workspace?.comments;
    if (!connection) {
      return {
        totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        comments: [],
      };
    }

    const comments = connection.edges
      .map(edge => edge.node)
      .filter((node): node is DocumentComment => Boolean(node));

    return {
      totalCount: connection.totalCount,
      pageInfo: connection.pageInfo,
      comments,
    };
  }

  async createComment(
    workspaceId: string,
    input: {
      docId: string;
      content: unknown;
      docTitle?: string;
      docMode?: 'page' | 'edgeless';
      mentions?: string[];
    },
  ): Promise<DocumentComment> {
    const query = `
      mutation createComment($input: CommentCreateInput!) {
        createComment(input: $input) {
          id
          content
          createdAt
          updatedAt
          resolved
          user {
            id
            name
            avatarUrl
          }
          replies {
            id
            content
            createdAt
            updatedAt
            user {
              id
              name
              avatarUrl
            }
          }
        }
      }
    `;

    const payload = {
      workspaceId,
      docId: input.docId,
      content: input.content,
      docTitle: input.docTitle ?? '',
      docMode: input.docMode ?? 'page',
      mentions: input.mentions,
    };

    const result = await this.graphqlQuery<{
      createComment: DocumentComment;
    }>(query, { input: payload });
    return result.createComment;
  }

  async updateComment(commentId: string, content: unknown): Promise<boolean> {
    const query = `
      mutation updateComment($input: CommentUpdateInput!) {
        updateComment(input: $input)
      }
    `;

    const result = await this.graphqlQuery<{
      updateComment: boolean;
    }>(query, { input: { id: commentId, content } });
    return result.updateComment;
  }

  async deleteComment(commentId: string): Promise<boolean> {
    const query = `
      mutation deleteComment($id: String!) {
        deleteComment(id: $id)
      }
    `;

    const result = await this.graphqlQuery<{
      deleteComment: boolean;
    }>(query, { id: commentId });
    return result.deleteComment;
  }

  async resolveComment(commentId: string, resolved: boolean): Promise<boolean> {
    const query = `
      mutation resolveComment($input: CommentResolveInput!) {
        resolveComment(input: $input)
      }
    `;

    const result = await this.graphqlQuery<{
      resolveComment: boolean;
    }>(query, { input: { id: commentId, resolved } });
    return result.resolveComment;
  }

  async listNotifications(options: {
    first?: number;
    offset?: number;
    unreadOnly?: boolean;
  } = {}): Promise<NotificationList> {
    const limit =
      typeof options.first === 'number' && Number.isFinite(options.first)
        ? options.first
        : 20;
    const offset =
      typeof options.offset === 'number' && Number.isFinite(options.offset)
        ? options.offset
        : 0;

    const query = `
      query listNotifications($pagination: PaginationInput!) {
        currentUser {
          notifications(pagination: $pagination) {
            edges {
              node {
                id
                type
                read
                createdAt
              }
            }
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;

    const result = await this.graphqlQuery<{
      currentUser: {
        notifications: {
          edges: Array<{ node: AffineNotification | null }>;
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    }>(query, {
      pagination: {
        first: limit,
        offset,
      },
    });

    const connection = result.currentUser?.notifications;
    if (!connection) {
      return {
        totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        notifications: [],
        unreadCount: 0,
      };
    }

    const nodes = connection.edges
      .map(edge => edge.node)
      .filter((node): node is AffineNotification => Boolean(node));

    const filtered = options.unreadOnly ? nodes.filter(entry => !entry.read) : nodes;

    return {
      totalCount: connection.totalCount,
      pageInfo: connection.pageInfo,
      notifications: filtered,
      unreadCount: nodes.filter(entry => !entry.read).length,
    };
  }

  async markNotificationRead(notificationId: string): Promise<boolean> {
    const query = `
      mutation readNotification($id: String!) {
        readNotification(id: $id)
      }
    `;

    const result = await this.graphqlQuery<{
      readNotification: boolean;
    }>(query, { id: notificationId });
    return result.readNotification;
  }

  async markAllNotificationsRead(): Promise<boolean> {
    const query = `
      mutation readAllNotifications {
        readAllNotifications
      }
    `;

    const result = await this.graphqlQuery<{
      readAllNotifications: boolean;
    }>(query);
    return result.readAllNotifications;
  }

  async listAccessTokens(): Promise<AccessTokenInfo[]> {
    const query = `
      query listAccessTokens {
        accessTokens {
          id
          name
          createdAt
          expiresAt
        }
      }
    `;

    const result = await this.graphqlQuery<{
      accessTokens: AccessTokenInfo[] | null;
    }>(query);
    return result.accessTokens ?? [];
  }

  async createAccessToken(input: {
    name: string;
    expiresAt?: string | null;
  }): Promise<AccessTokenInfo> {
    const query = `
      mutation generateAccessToken($input: GenerateAccessTokenInput!) {
        generateUserAccessToken(input: $input) {
          id
          name
          createdAt
          expiresAt
          token
        }
      }
    `;

    const result = await this.graphqlQuery<{
      generateUserAccessToken: AccessTokenInfo;
    }>(query, {
      input: {
        name: input.name,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return result.generateUserAccessToken;
  }

  async revokeAccessToken(tokenId: string): Promise<boolean> {
    const query = `
      mutation revokeAccessToken($id: String!) {
        revokeUserAccessToken(id: $id)
      }
    `;

    const result = await this.graphqlQuery<{
      revokeUserAccessToken: boolean;
    }>(query, { id: tokenId });
    return result.revokeUserAccessToken;
  }

  async publishDocument(
    workspaceId: string,
    docId: string,
    options: { mode?: 'page' | 'edgeless' } = {},
  ): Promise<DocumentPublicationInfo> {
    const query = `
      mutation publishDoc($workspaceId: String!, $docId: String!, $mode: PublicDocMode) {
        publishDoc(workspaceId: $workspaceId, docId: $docId, mode: $mode) {
          id
          workspaceId
          public
          mode
        }
      }
    `;

    const result = await this.graphqlQuery<{
      publishDoc: { id: string; workspaceId: string; public: boolean; mode?: string | null };
    }>(query, {
      workspaceId,
      docId,
      mode: toGraphqlDocMode(options.mode),
    });

    const payload = result.publishDoc;
    return {
      docId: payload.id,
      workspaceId: payload.workspaceId,
      public: payload.public,
      mode: fromGraphqlDocMode(payload.mode),
    };
  }

  async revokeDocumentPublication(workspaceId: string, docId: string): Promise<DocumentPublicationInfo> {
    const query = `
      mutation revokeDoc($workspaceId: String!, $docId: String!) {
        revokePublicDoc(workspaceId: $workspaceId, docId: $docId) {
          id
          workspaceId
          public
          mode
        }
      }
    `;

    const result = await this.graphqlQuery<{
      revokePublicDoc: { id: string; workspaceId: string; public: boolean; mode?: string | null };
    }>(query, { workspaceId, docId });

    const payload = result.revokePublicDoc;
    return {
      docId: payload.id,
      workspaceId: payload.workspaceId,
      public: payload.public,
      mode: fromGraphqlDocMode(payload.mode) ?? null,
    };
  }

  /**
   * Get detailed information about a specific workspace.
   *
   * Returns:
   * - id: Workspace ID
   * - name: Workspace name (from Yjs meta)
   * - public: Public workspace flag
   * - enableAi: AI features enabled
   * - createdAt: Creation timestamp
   * - memberCount: Number of members
   * - docCount: Number of documents (estimate from pages array)
   */
  async getWorkspaceDetails(workspaceId: string): Promise<{
    id: string;
    name: string | null;
    public: boolean;
    enableAi: boolean;
    createdAt: string;
    memberCount: number;
    docCount: number;
  }> {
    const query = `
      query($workspaceId: String!) {
        workspace(id: $workspaceId) {
          id
          public
          enableAi
          createdAt
          members {
            id
          }
        }
      }
    `;

    const result = await this.graphqlQuery<{
      workspace: {
        id: string;
        public: boolean;
        enableAi: boolean;
        createdAt: string;
        members: Array<{ id: string }>;
      };
    }>(query, { workspaceId });

    // Load workspace meta for name and doc count
    const { doc } = await this.loadWorkspaceDoc(workspaceId, workspaceId);
    const meta = doc.getMap<unknown>('meta');

    let name: string | null = null;
    const nameValue = meta.get('name');
    if (typeof nameValue === 'string') {
      name = nameValue;
    }

    let docCount = 0;
    const pages = meta.get('pages');
    if (pages instanceof Y.Array) {
      docCount = pages.length;
    }

    return {
      id: result.workspace.id,
      name,
      public: result.workspace.public,
      enableAi: result.workspace.enableAi,
      createdAt: result.workspace.createdAt,
      memberCount: result.workspace.members.length,
      docCount,
    };
  }

  /**
   * Get the complete folder tree hierarchy for a workspace.
   *
   * Returns nested folder structure with:
   * - id: Folder ID
   * - name: Folder name
   * - children: Array of child folders (recursive)
   * - documents: Array of document IDs in this folder
   */
  async getFolderTree(workspaceId: string): Promise<
    Array<{
      id: string;
      name: string;
      children: Array<unknown>; // Recursive type
      documents: string[];
    }>
  > {
    const foldersId = `db$${workspaceId}$folders`;
    const { doc } = await this.loadWorkspaceDoc(workspaceId, foldersId);

    const tree: Array<{
      id: string;
      name: string;
      children: Array<unknown>;
      documents: string[];
    }> = [];

    // Build folder map
    const folderMap = new Map<
      string,
      { id: string; name: string; children: unknown[]; documents: string[]; parentId?: string }
    >();

    // Iterate over doc.share keys and use getMap() for each nodeId
    doc.share.forEach((_, nodeId) => {
      // Get the Y.Map for this node
      const nodeMap = doc.getMap(nodeId);
      if (!nodeMap || nodeMap.size === 0) return;

      const type = nodeMap.get('type');
      const data = nodeMap.get('data');
      const parentId = nodeMap.get('parentId');

      // Only process folder nodes (not doc nodes)
      if (type !== 'folder') return;

      folderMap.set(nodeId, {
        id: nodeId,
        name: typeof data === 'string' ? data : 'Untitled',
        children: [],
        documents: [],
        parentId: typeof parentId === 'string' ? parentId : undefined,
      });
    });

    // Load document list to assign documents to folders
    const summaries = await this.listDocuments(workspaceId);
    for (const doc of summaries) {
      // Use folderId (parentId of doc node) instead of folderNodeId (doc node itself)
      if (doc.folderId) {
        const folder = folderMap.get(doc.folderId);
        if (folder) {
          folder.documents.push(doc.docId);
        }
      }
    }

    // Build tree structure
    folderMap.forEach(folder => {
      if (!folder.parentId) {
        // Root folder
        tree.push({
          id: folder.id,
          name: folder.name,
          children: folder.children,
          documents: folder.documents,
        });
      } else {
        // Child folder - add to parent
        const parent = folderMap.get(folder.parentId);
        if (parent) {
          parent.children.push({
            id: folder.id,
            name: folder.name,
            children: folder.children,
            documents: folder.documents,
          });
        }
      }
    });

    return tree;
  }

  /**
   * Get linked documents from a document by parsing its blocks for LinkedPage references.
   *
   * Returns an array of document IDs that are referenced in the document's content.
   */
  async getLinkedDocs(workspaceId: string, docId: string): Promise<string[]> {
    const { doc } = await this.loadWorkspaceDoc(workspaceId, docId);

    const linkedDocIds = new Set<string>();

    // Get the blocks Map
    const blocksMap = doc.getMap('blocks');
    if (!blocksMap) {
      return [];
    }

    // Iterate through all blocks
    blocksMap.forEach((blockValue, _blockId) => {
      if (!(blockValue instanceof Y.Map)) return;

      const propsMap = blockValue.get('prop:text');

      if (propsMap && propsMap instanceof Y.Text) {
        const delta = propsMap.toDelta();

        // Check if delta contains LinkedPage references
        delta.forEach((op: any) => {
          if (op.attributes?.reference?.type === 'LinkedPage') {
            const pageId = op.attributes.reference.pageId;
            if (typeof pageId === 'string') {
              linkedDocIds.add(pageId);
            }
          }
        });
      }
    });

    return Array.from(linkedDocIds);
  }

  /**
   * Get complete workspace hierarchy including folders, documents, and subdocuments.
   *
   * Returns a tree structure where:
   * - Folders are nodes with type='folder'
   * - Documents can be children of folders or other documents (subdocs)
   * - Documents at root level have no parentId
   *
   * Subdocuments are documents that are referenced via LinkedPage in their parent document.
   * This method parses each document's content to find these references and builds the complete tree.
   */
  async getHierarchy(workspaceId: string): Promise<
    Array<{
      type: 'folder' | 'doc';
      id: string;
      name: string;
      docId?: string; // Only for type='doc'
      children: Array<unknown>; // Recursive type
    }>
  > {
    const foldersId = `db$${workspaceId}$folders`;
    const { doc } = await this.loadWorkspaceDoc(workspaceId, foldersId);

    // Load all documents to get their titles
    const summaries = await this.listDocuments(workspaceId);
    const docTitles = new Map<string, string>();
    for (const summary of summaries) {
      docTitles.set(summary.docId, summary.title || 'Untitled');
    }

    // Build complete node map (folders AND docs from folders structure)
    const nodeMap = new Map<
      string,
      {
        type: 'folder' | 'doc';
        id: string;
        name: string;
        docId?: string;
        children: unknown[];
        parentId?: string;
      }
    >();

    // Track which docIds are already in the folders structure
    const docsInFolders = new Set<string>();

    // Iterate over all nodes in folders doc
    doc.share.forEach((_, nodeId) => {
      const nodeYMap = doc.getMap(nodeId);
      if (!nodeYMap || nodeYMap.size === 0) return;

      const type = nodeYMap.get('type');
      const data = nodeYMap.get('data');
      const parentId = nodeYMap.get('parentId');

      if (type === 'folder') {
        // Folder node
        nodeMap.set(nodeId, {
          type: 'folder',
          id: nodeId,
          name: typeof data === 'string' ? data : 'Untitled',
          children: [],
          parentId: typeof parentId === 'string' ? parentId : undefined,
        });
      } else if (type === 'doc') {
        // Document node
        const docId = typeof data === 'string' ? data : '';
        docsInFolders.add(docId);
        nodeMap.set(nodeId, {
          type: 'doc',
          id: nodeId,
          name: docTitles.get(docId) || 'Untitled',
          docId: docId,
          children: [],
          parentId: typeof parentId === 'string' ? parentId : undefined,
        });
      }
    });

    // Now load linked docs for each document in the folders structure
    // This will add subdocs that are referenced via LinkedPage
    const docNodesToProcess = Array.from(nodeMap.values()).filter(
      node => node.type === 'doc' && node.docId
    );

    for (const docNode of docNodesToProcess) {
      if (!docNode.docId) continue;

      try {
        const linkedDocIds = await this.getLinkedDocs(workspaceId, docNode.docId);

        for (const linkedDocId of linkedDocIds) {
          // Only add if not already in folders structure
          if (!docsInFolders.has(linkedDocId)) {
            // Create a synthetic node for this linked doc
            const linkedNodeId = `linked-${linkedDocId}`;
            docNode.children.push({
              type: 'doc',
              id: linkedNodeId,
              name: docTitles.get(linkedDocId) || 'Untitled',
              docId: linkedDocId,
              children: [], // Could recurse here for nested linked docs
            });
            docsInFolders.add(linkedDocId);
          }
        }
      } catch (error) {
        // Silently skip documents that fail to load
        console.error(`Failed to load linked docs for ${docNode.docId}:`, error);
      }
    }

    // Build tree structure
    const tree: Array<{
      type: 'folder' | 'doc';
      id: string;
      name: string;
      docId?: string;
      children: Array<unknown>;
    }> = [];

    nodeMap.forEach(node => {
      if (!node.parentId) {
        // Root node (folders only at root, or orphaned docs)
        tree.push({
          type: node.type,
          id: node.id,
          name: node.name,
          docId: node.docId,
          children: node.children,
        });
      } else {
        // Child node - add to parent
        const parent = nodeMap.get(node.parentId);
        if (parent) {
          parent.children.push({
            type: node.type,
            id: node.id,
            name: node.name,
            docId: node.docId,
            children: node.children,
          });
        }
      }
    });

    return tree;
  }

  /**
   * Get contents of a specific folder.
   *
   * Returns:
   * - folderId: Folder ID
   * - name: Folder name
   * - documents: Array of DocumentSummary objects in this folder
   * - subfolders: Array of child folder IDs with names
   */
  async getFolderContents(
    workspaceId: string,
    folderId: string,
  ): Promise<{
    folderId: string;
    name: string;
    documents: DocumentSummary[];
    subfolders: Array<{ id: string; name: string }>;
  }> {
    const foldersId = `db$${workspaceId}$folders`;
    const { doc } = await this.loadWorkspaceDoc(workspaceId, foldersId);

    // Get the folder node using doc.getMap()
    const folderData = doc.getMap(folderId);

    if (!folderData || folderData.size === 0) {
      throw new Error(`Folder ${folderId} not found`);
    }

    const data = folderData.get('data');
    const folderName = typeof data === 'string' ? data : 'Untitled';

    // Get all documents in workspace
    const allDocs = await this.listDocuments(workspaceId);

    // Filter documents belonging to this folder
    const documents = allDocs.filter(doc => doc.folderNodeId === folderId);

    // Find subfolders by iterating root keys
    const subfolders: Array<{ id: string; name: string }> = [];
    doc.share.forEach((_, nodeId) => {
      const nodeMap = doc.getMap(nodeId);
      if (!nodeMap || nodeMap.size === 0) return;

      const type = nodeMap.get('type');
      if (type !== 'folder') return;

      const parentId = nodeMap.get('parentId');
      if (parentId === folderId) {
        const subData = nodeMap.get('data');
        subfolders.push({
          id: nodeId,
          name: typeof subData === 'string' ? subData : 'Untitled',
        });
      }
    });

    return {
      folderId,
      name: folderName,
      documents,
      subfolders,
    };
  }

  // ============================================================================
  // Blob & Image Operations
  // ============================================================================

  /**
   * List all blobs in a workspace with metadata.
   */
  async listBlobs(
    workspaceId: string,
  ): Promise<BlobInfo[]> {
    const query = `
      query workspace($id: String!) {
        workspace(id: $id) {
          blobs {
            key
            mime
            size
            createdAt
          }
        }
      }
    `;

    const result = await this.graphqlQuery<{
      workspace: {
        blobs: Array<{
          key: string;
          mime: string;
          size: number;
          createdAt: string;
        }>;
      };
    }>(query, { id: workspaceId });

    return result.workspace.blobs.map(b => ({
      key: b.key,
      mime: b.mime,
      size: b.size,
      createdAt: b.createdAt,
    }));
  }

  /**
   * Download blob content from workspace.
   * Returns the blob as a Buffer along with metadata.
   */
  async getBlob(
    workspaceId: string,
    blobKey: string,
  ): Promise<{ content: Buffer; mime: string; size: number }> {
    if (!this.cookieJar.size) {
      throw new Error('Must sign in before downloading blobs');
    }

    const url = new URL(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/${encodeURIComponent(blobKey)}`,
      this.baseUrl,
    ).toString();

    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: {
        cookie: this.getCookieHeader(),
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(
        `Blob download failed (${response.status} ${response.statusText})`,
      );
    }

    const mime = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    return {
      content,
      mime,
      size: content.length,
    };
  }

  /**
   * Upload a file to workspace blob storage.
   * Returns the blob key (used as sourceId for image blocks).
   */
  async uploadBlob(
    workspaceId: string,
    file: { fileName: string; content: Buffer; mimeType?: string },
  ): Promise<string> {
    const query = `
      mutation setBlob($workspaceId: String!, $blob: Upload!) {
        setBlob(workspaceId: $workspaceId, blob: $blob)
      }
    `;

    const result = await this.graphqlMultipart<{
      setBlob: string;
    }>(query, { workspaceId, blob: null }, [
      {
        variableName: 'blob',
        fileName: file.fileName,
        content: file.content,
        mimeType: file.mimeType ?? 'application/octet-stream',
      },
    ]);

    return result.setBlob;
  }

  /**
   * Add an image block to a document.
   * First uploads the image to blob storage, then creates the image block.
   *
   * @param workspaceId - Workspace identifier
   * @param docId - Document identifier
   * @param options.parentBlockId - Parent block ID (usually the note block)
   * @param options.image - Image data (fileName, content buffer, mimeType)
   * @param options.caption - Optional image caption
   * @param options.width - Optional width in pixels
   * @param options.height - Optional height in pixels
   * @param options.position - Position among siblings ('start', 'end', or index)
   */
  async addImageBlock(
    workspaceId: string,
    docId: string,
    options: {
      parentBlockId: string;
      image: { fileName: string; content: Buffer; mimeType?: string };
      caption?: string;
      width?: number;
      height?: number;
      position?: 'start' | 'end' | number;
    },
  ): Promise<{ blockId: string; blobId: string }> {
    // Step 1: Upload image to blob storage
    const blobId = await this.uploadBlob(workspaceId, options.image);

    // Step 2: Create image block with sourceId pointing to blob
    const props: Record<string, unknown> = {
      sourceId: blobId,
    };

    if (options.caption) {
      props.caption = options.caption;
    }
    if (typeof options.width === 'number') {
      props.width = options.width;
    }
    if (typeof options.height === 'number') {
      props.height = options.height;
    }

    const result = await this.addBlock(workspaceId, docId, {
      flavour: 'affine:image',
      parentBlockId: options.parentBlockId,
      props,
      position: options.position,
    });

    return {
      blockId: result.blockId,
      blobId,
    };
  }

  // ============================================================================
  // Real-time Document Observation (for Android sync)
  // ============================================================================

  /**
   * Callback type for document changes.
   */
  public onDocumentChange?: (change: DocumentChange) => void;

  /**
   * Cache of loaded documents for change detection.
   */
  private docCache = new Map<string, {
    doc: Y.Doc;
    lastElements: Map<string, Record<string, unknown>>;
  }>();

  /**
   * Set of documents being observed.
   */
  private observedDocs = new Set<string>();

  /**
   * Start observing a document for real-time changes from AFFiNE.
   * Call this after joining a workspace and loading the document.
   *
   * @param workspaceId Workspace ID
   * @param docId Document ID
   * @param callback Callback for document changes
   */
  async observeDocument(
    workspaceId: string,
    docId: string,
    callback: (change: DocumentChange) => void,
  ): Promise<void> {
    const cacheKey = `${workspaceId}:${docId}`;

    if (this.observedDocs.has(cacheKey)) {
      console.log(`[AffineClient] Already observing ${cacheKey}`);
      return;
    }

    // Ensure socket is connected
    const socket = await this.connectSocket();
    await this.joinWorkspace(workspaceId);

    // Load initial document state
    const { doc } = await this.loadWorkspaceDoc(workspaceId, docId);

    // Extract initial elements for comparison
    const initialElements = this.extractEdgelessElementsFromDoc(doc);

    // Cache the document state
    this.docCache.set(cacheKey, {
      doc,
      lastElements: initialElements,
    });

    this.observedDocs.add(cacheKey);
    this.onDocumentChange = callback;

    // Listen for broadcast updates from AFFiNE server
    const handleBroadcast = (data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      update: string;
      timestamp?: number;
    }) => {
      // Check if this update is for our document
      if (data.spaceId !== workspaceId || data.docId !== docId) {
        return;
      }

      console.log(`[AffineClient] Broadcast update received for ${cacheKey}`);

      try {
        // Decode the base64 update
        const updateBuffer = Buffer.from(data.update, 'base64');

        // Get cached doc
        const cached = this.docCache.get(cacheKey);
        if (!cached) {
          console.warn(`[AffineClient] No cached doc for ${cacheKey}`);
          return;
        }

        // Apply the Y.js update to our local doc
        Y.applyUpdate(cached.doc, updateBuffer);

        // Extract new elements
        const newElements = this.extractEdgelessElementsFromDoc(cached.doc);

        // Compute diff and emit changes
        this.computeAndEmitChanges(cached.lastElements, newElements, callback);

        // Update cache
        cached.lastElements = newElements;
      } catch (error) {
        console.error(`[AffineClient] Error processing broadcast:`, error);
      }
    };

    // Register the broadcast listener
    socket.on('space:broadcast-doc-update', handleBroadcast);

    console.log(`[AffineClient] Now observing document ${cacheKey}`);
  }

  /**
   * Stop observing a document.
   */
  stopObserving(workspaceId: string, docId: string): void {
    const cacheKey = `${workspaceId}:${docId}`;
    this.observedDocs.delete(cacheKey);
    this.docCache.delete(cacheKey);
    this.onDocumentChange = undefined;
    console.log(`[AffineClient] Stopped observing ${cacheKey}`);
  }

  /**
   * Extract edgeless elements from a Y.Doc.
   * Returns a Map of elementId -> element data for easy comparison.
   */
  private extractEdgelessElementsFromDoc(doc: Y.Doc): Map<string, Record<string, unknown>> {
    const result = new Map<string, Record<string, unknown>>();

    try {
      const blocks = doc.getMap<Y.Map<unknown>>('blocks');

      // Find surface block
      let surfaceBlock: Y.Map<unknown> | null = null;
      blocks.forEach((blockData) => {
        if (blockData instanceof Y.Map && blockData.get('sys:flavour') === 'affine:surface') {
          surfaceBlock = blockData;
        }
      });

      if (!surfaceBlock) {
        return result;
      }

      // Get elements map
      const elementsMap = this.getElementsMap(surfaceBlock);

      // Convert to Map with proper JSON conversion
      this.forEachElement(elementsMap, (elementData: unknown) => {
        if (typeof elementData === 'object' && elementData !== null) {
          let element: Record<string, unknown>;

          if (elementData instanceof Y.Map || elementData instanceof Y.Array) {
            element = elementData.toJSON() as Record<string, unknown>;
          } else if ('toJSON' in elementData && typeof (elementData as { toJSON: () => unknown }).toJSON === 'function') {
            element = (elementData as { toJSON: () => unknown }).toJSON() as Record<string, unknown>;
          } else {
            element = { ...(elementData as Record<string, unknown>) };
          }

          // Parse xywh if needed
          if ('xywh' in element && typeof element.xywh === 'string') {
            try {
              element.xywh = JSON.parse(element.xywh as string);
            } catch {
              // Keep as string
            }
          }

          const id = element.id as string;
          if (id) {
            result.set(id, element);
          }
        }
      });
    } catch (error) {
      console.error('[AffineClient] Error extracting elements:', error);
    }

    return result;
  }

  /**
   * Compare old and new element states, emit appropriate change events.
   */
  private computeAndEmitChanges(
    oldElements: Map<string, Record<string, unknown>>,
    newElements: Map<string, Record<string, unknown>>,
    callback: (change: DocumentChange) => void,
  ): void {
    // Check for added elements
    for (const [id, element] of newElements) {
      if (!oldElements.has(id)) {
        console.log(`[AffineClient] Element added: ${id}`);
        callback({
          type: 'add',
          element,
        });
      }
    }

    // Check for removed elements
    for (const [id] of oldElements) {
      if (!newElements.has(id)) {
        console.log(`[AffineClient] Element removed: ${id}`);
        callback({
          type: 'remove',
          elementId: id,
        });
      }
    }

    // Check for updated elements
    for (const [id, newElement] of newElements) {
      const oldElement = oldElements.get(id);
      if (oldElement) {
        // Simple JSON comparison (could be optimized)
        const oldJson = JSON.stringify(oldElement);
        const newJson = JSON.stringify(newElement);

        if (oldJson !== newJson) {
          console.log(`[AffineClient] Element updated: ${id}`);
          callback({
            type: 'update',
            elementId: id,
            element: newElement,
          });
        }
      }
    }
  }

  // ========================================================================
  // FAVORITES (per-user, synced to server)
  // ========================================================================

  /**
   * Get all favorites for the current user in a workspace.
   *
   * IMPORTANT: Favorites are stored PER WORKSPACE in AFFiNE!
   * The server stores userdata with the workspaceId embedded in the docId.
   *
   * Client format: userdata$userId$favorite (internal use)
   * Server format: userdata$userId$workspaceId$favorite (sent to server)
   *
   * @param workspaceId The workspace ID
   * @returns Array of favorite records with type, id, and sort index
   */
  async getFavorites(workspaceId: string): Promise<FavoriteInfo[]> {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before getFavorites.');
    }

    // CRITICAL: Favorites are stored PER WORKSPACE on the server!
    // The server expects format: userdata$userId$workspaceId$tableName
    // This is the "old ID" format that the AFFiNE server uses internally
    const favoriteDocId = `userdata$${this.userId}$${workspaceId}$favorite`;

    try {
      const { doc } = await this.loadOrCreateUserspaceDoc(favoriteDocId);

      // The favorite YDoc uses YjsDBAdapter structure:
      // Each entry is stored as a YMap in doc.share with key = primaryKey value
      // Structure: doc.share.get("doc:abc123") -> YMap({ key: "doc:abc123", index: "a0" })
      const favorites: FavoriteInfo[] = [];

      // Debug: log the share keys
      console.log(`[AffineClient] getFavorites: doc.share keys:`, Array.from(doc.share.keys()));

      // Iterate over all shared types in the doc
      doc.share.forEach((ymap, shareKey) => {
        // Skip special keys and deleted entries
        if (shareKey.startsWith('$$') || shareKey === 'data') return;

        // Get the entry data
        const entry = ymap.toJSON() as Record<string, unknown>;
        if (!entry || typeof entry !== 'object') return;

        // Debug: log the entry
        console.log(`[AffineClient] getFavorites: entry for key ${shareKey}:`, entry);

        // Check for deletion flag (YjsDBAdapter uses $DELETED)
        if (entry['$DELETED']) return;

        // The key field contains the actual key (e.g., "doc:abc123")
        const keyValue = (entry.key as string) || shareKey;
        const indexValue = (entry.index as string) || 'a0';

        const parsed = this.parseFavoriteKey(keyValue);
        if (parsed) {
          favorites.push({
            workspaceId,
            type: parsed.type,
            id: parsed.id,
            index: indexValue,
          });
        }
      });

      // Sort by index (lexicographic order)
      favorites.sort((a, b) => a.index.localeCompare(b.index));

      console.log(`[AffineClient] getFavorites: found ${favorites.length} favorites`);
      return favorites;
    } catch (error) {
      // If document doesn't exist, return empty array
      console.log(`[AffineClient] getFavorites: Error loading favorites:`, error);
      return [];
    }
  }

  /**
   * Check if a specific document is favorited by the current user.
   *
   * @param workspaceId The workspace ID
   * @param docId The document ID to check
   * @returns true if the document is favorited
   */
  async isDocFavorited(workspaceId: string, docId: string): Promise<boolean> {
    const favorites = await this.getFavorites(workspaceId);
    return favorites.some(f => f.type === 'doc' && f.id === docId);
  }

  /**
   * Add a document to favorites.
   *
   * IMPORTANT: Favorites are stored PER WORKSPACE on the server!
   * Server format: userdata$userId$workspaceId$favorite
   *
   * @param workspaceId The workspace ID
   * @param docId The document ID to favorite
   * @returns The created favorite record
   */
  async addDocToFavorites(workspaceId: string, docId: string): Promise<FavoriteInfo> {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before addDocToFavorites.');
    }

    // CRITICAL: Favorites are stored PER WORKSPACE on the server!
    const favoriteDocId = `userdata$${this.userId}$${workspaceId}$favorite`;
    const { doc, stateVector } = await this.loadOrCreateUserspaceDoc(favoriteDocId);

    const key = `doc:${docId}`;

    // Generate a sort index (simple: use 'a' prefix + timestamp)
    const index = `a${Date.now().toString(36)}`;

    // YjsDBAdapter stores entries as YMaps in doc.share with key = primaryKey value
    // The YMap structure is: { key: "doc:docId", index: "a..." }
    const entryMap = doc.getMap(key);
    doc.transact(() => {
      entryMap.set('key', key);
      entryMap.set('index', index);
      // Remove deletion flag if present (YjsDBAdapter uses $DELETED)
      entryMap.delete('$DELETED');
    });

    await this.pushUserspaceDocUpdate(favoriteDocId, doc, stateVector);

    return {
      workspaceId,
      type: 'doc',
      id: docId,
      index,
    };
  }

  /**
   * Remove a document from favorites.
   *
   * IMPORTANT: Favorites are stored PER WORKSPACE on the server!
   * Server format: userdata$userId$workspaceId$favorite
   *
   * @param workspaceId The workspace ID
   * @param docId The document ID to unfavorite
   */
  async removeDocFromFavorites(workspaceId: string, docId: string): Promise<void> {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before removeDocFromFavorites.');
    }

    // CRITICAL: Favorites are stored PER WORKSPACE on the server!
    const favoriteDocId = `userdata$${this.userId}$${workspaceId}$favorite`;
    const { doc, stateVector } = await this.loadOrCreateUserspaceDoc(favoriteDocId);

    const key = `doc:${docId}`;

    // YjsDBAdapter marks entries as deleted with a $DELETED flag
    // rather than actually removing them from doc.share
    if (doc.share.has(key)) {
      const entryMap = doc.getMap(key);
      doc.transact(() => {
        entryMap.set('$DELETED', true);
      });
    }

    await this.pushUserspaceDocUpdate(favoriteDocId, doc, stateVector);
  }

  /**
   * Toggle favorite status for a document.
   *
   * @param workspaceId The workspace ID
   * @param docId The document ID
   * @returns The new favorite status (true if now favorited)
   */
  async toggleDocFavorite(workspaceId: string, docId: string): Promise<boolean> {
    const isFavorited = await this.isDocFavorited(workspaceId, docId);

    if (isFavorited) {
      await this.removeDocFromFavorites(workspaceId, docId);
      return false;
    } else {
      await this.addDocToFavorites(workspaceId, docId);
      return true;
    }
  }

  /**
   * Parse a favorite key into type and id.
   * Key format: ${type}:${id}
   */
  private parseFavoriteKey(key: string): { type: FavoriteType; id: string } | null {
    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) return null;

    const type = key.substring(0, colonIndex);
    const id = key.substring(colonIndex + 1);

    if (!type || !id) return null;
    if (!['doc', 'collection', 'tag', 'folder'].includes(type)) return null;

    return { type: type as FavoriteType, id };
  }
}

/**
 * Types for document change events.
 */
export type DocumentChange =
  | { type: 'add'; element: Record<string, unknown> }
  | { type: 'remove'; elementId: string }
  | { type: 'update'; elementId: string; element: Record<string, unknown> };
