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

export interface TagInfo {
  id: string;
  name: string;
  count: number;
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
    }: { docId: string; timestamp: number; tags?: string[]; primaryMode?: 'page' | 'edgeless' },
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

    await this.pushWorkspaceDocUpdate(
      workspaceId,
      docPropsId,
      doc,
      stateVector,
    );
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
        if (typeof value === 'string' && (key === 'text' || key === 'title')) {
          const ytext = new Y.Text();
          ytext.insert(0, value);
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
        const element = { ...(elementData as Record<string, unknown>) };

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

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

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
}
