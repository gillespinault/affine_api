import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import * as Y from 'yjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import type { AffineClientOptions } from './types.js';
import { createDocYStructure, nanoid } from './doc-structure.js';
import { createDocYStructureFromMarkdown } from '../markdown/markdown-to-yjs.js';

export const DEFAULT_BASE_URL =
  process.env.AFFINE_BASE_URL || 'https://affine.robotsinlove.be';
export const SOCKET_PATH = '/socket.io/';

export type IOFactory = (
  uri: string,
  options?: Partial<ManagerOptions & SocketOptions>,
) => Socket;

interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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
    }: { docId: string; timestamp: number; tags?: string[] },
  ) {
    const docPropsId = `db$${workspaceId}$docProperties`;
    const { doc, stateVector } = await this.loadWorkspaceDoc(
      workspaceId,
      docPropsId,
    );

    const propsEntry = doc.getMap<unknown>(docId);
    propsEntry.set('id', docId);
    propsEntry.set('primaryMode', 'page');
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
    }: {
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

    // Extract elements (YMap structure)
    const elementsWrapper = surfaceBlock.get('prop:elements');
    if (!(elementsWrapper instanceof Y.Map)) {
      return [];
    }

    if (elementsWrapper.get('type') !== '$blocksuite:internal:native$') {
      return [];
    }

    const elementsMap = elementsWrapper.get('value');
    if (!(elementsMap instanceof Y.Map)) {
      return [];
    }

    // Convert to array, parsing xywh strings
    const elements: Array<Record<string, unknown>> = [];
    elementsMap.forEach((elementData: unknown) => {
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

    // Get elements container (YMap structure)
    const elementsWrapper = surfaceBlock.get('prop:elements');
    if (!(elementsWrapper instanceof Y.Map)) {
      throw new Error('Elements property not found or invalid in surface block');
    }

    // Check for native type marker
    if (elementsWrapper.get('type') !== '$blocksuite:internal:native$') {
      throw new Error('Elements property is not a native BlockSuite type');
    }

    const elementsMap = elementsWrapper.get('value');
    if (!(elementsMap instanceof Y.Map)) {
      throw new Error('Elements value is not a YMap');
    }

    // Generate element ID if not provided
    const elementId = (elementData.id as string) || nanoid();

    // Serialize xywh if it's an array
    const processedElement: Record<string, unknown> = { ...elementData, id: elementId };
    if ('xywh' in processedElement && Array.isArray(processedElement.xywh)) {
      processedElement.xywh = JSON.stringify(processedElement.xywh);
    }

    // Generate index if not provided
    if (!processedElement.index) {
      const existingIndices: string[] = [];
      elementsMap.forEach((el: unknown) => {
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

    // Add element to surface using YMap.set()
    doc.transact(() => {
      elementsMap.set(elementId, processedElement);
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

    // Get elements container (YMap structure)
    const elementsWrapper = surfaceBlock.get('prop:elements');
    if (!(elementsWrapper instanceof Y.Map)) {
      throw new Error('Elements property not found or invalid in surface block');
    }

    if (elementsWrapper.get('type') !== '$blocksuite:internal:native$') {
      throw new Error('Elements property is not a native BlockSuite type');
    }

    const elementsMap = elementsWrapper.get('value');
    if (!(elementsMap instanceof Y.Map)) {
      throw new Error('Elements value is not a YMap');
    }

    // Get existing element
    const existingElement = elementsMap.get(elementId);
    if (!existingElement || typeof existingElement !== 'object') {
      throw new Error(`Element ${elementId} not found`);
    }

    // Merge updates
    const processedUpdates: Record<string, unknown> = { ...updates };
    if ('xywh' in processedUpdates && Array.isArray(processedUpdates.xywh)) {
      processedUpdates.xywh = JSON.stringify(processedUpdates.xywh);
    }

    const updatedElement = {
      ...(existingElement as Record<string, unknown>),
      ...processedUpdates,
    };

    // Update element using YMap.set()
    doc.transact(() => {
      elementsMap.set(elementId, updatedElement);
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

    // Get elements container (YMap structure)
    const elementsWrapper = surfaceBlock.get('prop:elements');
    if (!(elementsWrapper instanceof Y.Map)) {
      throw new Error('Elements property not found or invalid in surface block');
    }

    if (elementsWrapper.get('type') !== '$blocksuite:internal:native$') {
      throw new Error('Elements property is not a native BlockSuite type');
    }

    const elementsMap = elementsWrapper.get('value');
    if (!(elementsMap instanceof Y.Map)) {
      throw new Error('Elements value is not a YMap');
    }

    // Check if element exists
    if (!elementsMap.has(elementId)) {
      throw new Error(`Element ${elementId} not found`);
    }

    // Delete element using YMap.delete()
    doc.transact(() => {
      elementsMap.delete(elementId);
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector);

    return { elementId, deleted: true };
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
}
