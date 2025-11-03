// Legacy CJS entrypoint. TypeScript port lives in src/client/runtime/affine-client.ts
const { io } = require('socket.io-client');
const Y = require('yjs');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const DEFAULT_BASE_URL =
  process.env.AFFINE_BASE_URL || 'https://affine.robotsinlove.be';
const SOCKET_PATH = '/socket.io/';

function parseSetCookies(headers = []) {
  const jar = new Map();
  for (const header of headers) {
    if (!header) continue;
    const [cookiePart] = header.split(';');
    const [name, ...rest] = cookiePart.split('=');
    jar.set(name.trim(), rest.join('=').trim());
  }
  return jar;
}

function serializeCookies(jar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function nanoid(size = 21) {
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < size; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function randomLexoRank() {
  return `Z${crypto.randomBytes(18).toString('base64url')}`;
}

function decodeLoadResponse(res) {
  const payload = res?.data ?? {};
  const missing = payload.missing ? Buffer.from(payload.missing, 'base64') : null;
  const state = payload.state ? Buffer.from(payload.state, 'base64') : null;
  const doc = new Y.Doc();
  if (missing) {
    Y.applyUpdate(doc, missing);
  }
  return { doc, stateVector: state };
}

function encodeUpdateToBase64(doc, stateVector) {
  const binary = Y.encodeStateAsUpdate(doc, stateVector || undefined);
  return Buffer.from(binary).toString('base64');
}

function createDocYStructure({ docId, title, content, userId, timestamp }) {
  const now = timestamp ?? Date.now();
  const pageId = nanoid();
  const surfaceId = nanoid();
  const noteId = nanoid();
  const paragraphId = nanoid();

  const ydoc = new Y.Doc({ guid: docId });
  const blocks = ydoc.getMap('blocks');
  const meta = ydoc.getMap('meta');

  const titleText = new Y.Text();
  titleText.insert(0, title);

  const pageChildren = new Y.Array();
  pageChildren.push([surfaceId, noteId]);

  const pageMap = new Y.Map();
  pageMap.set('sys:id', pageId);
  pageMap.set('sys:flavour', 'affine:page');
  pageMap.set('prop:title', titleText);
  pageMap.set('sys:children', pageChildren);
  blocks.set(pageId, pageMap);

  const surfaceChildren = new Y.Array();
  const surfaceMap = new Y.Map();
  surfaceMap.set('sys:id', surfaceId);
  surfaceMap.set('sys:flavour', 'affine:surface');
  surfaceMap.set('sys:parent', pageId);
  surfaceMap.set('sys:children', surfaceChildren);
  surfaceMap.set('prop:elements', { type: '$blocksuite:internal:native$', value: {} });
  blocks.set(surfaceId, surfaceMap);

  const noteChildren = new Y.Array();
  noteChildren.push([paragraphId]);

  const noteMap = new Y.Map();
  noteMap.set('sys:id', noteId);
  noteMap.set('sys:flavour', 'affine:note');
  noteMap.set('sys:parent', pageId);
  noteMap.set('sys:children', noteChildren);
  noteMap.set('prop:background', { dark: '#252525', light: '#ffffff' });
  noteMap.set('prop:hidden', false);
  noteMap.set('prop:displayMode', 'DocAndEdgeless');
  noteMap.set('prop:xywh', '[0,0,800,600]');
  noteMap.set('prop:index', 'a0');
  noteMap.set('prop:lockedBySelf', false);
  noteMap.set('prop:edgeless', {
    style: {
      borderRadius: 8,
      borderSize: 4,
      borderStyle: 'none',
      shadowType: '--affine-note-shadow-box',
    },
  });
  blocks.set(noteId, noteMap);

  const paragraphMap = new Y.Map();
  paragraphMap.set('sys:id', paragraphId);
  paragraphMap.set('sys:flavour', 'affine:paragraph');
  paragraphMap.set('sys:parent', noteId);
  paragraphMap.set('sys:children', new Y.Array());
  paragraphMap.set('prop:type', 'text');
  const paragraphText = new Y.Text();
  paragraphText.insert(0, content || '');
  paragraphMap.set('prop:text', paragraphText);
  const metaPrefix = 'prop:meta:';
  paragraphMap.set(`${metaPrefix}createdAt`, now);
  paragraphMap.set(`${metaPrefix}createdBy`, userId);
  paragraphMap.set(`${metaPrefix}updatedAt`, now);
  paragraphMap.set(`${metaPrefix}updatedBy`, userId);
  paragraphMap.set('prop:collapsed', false);
  blocks.set(paragraphId, paragraphMap);

  const tags = new Y.Array();
  meta.set('id', docId);
  meta.set('title', title);
  meta.set('createDate', now);
  meta.set('tags', tags);

  return { ydoc, timestamp: now };
}

class AffineClient {
  constructor(options = {}) {
    const { baseUrl = DEFAULT_BASE_URL, fetchFn = global.fetch } = options;
    if (typeof fetchFn !== 'function') {
      throw new Error('A fetch implementation must be provided.');
    }
    this.baseUrl = baseUrl;
    this.fetch = fetchFn;
    this.cookieJar = new Map();
    this.userId = null;
    this.socket = null;
    this.joinedWorkspaces = new Set();
    this.ioFactory = options.ioFactory || io;
    this.timeoutMs = options.timeoutMs ?? 10_000;
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

  getCookieHeader() {
    return serializeCookies(this.cookieJar);
  }

  async signIn(email, password) {
    if (!email || !password) {
      throw new Error('Email and password are required for sign-in.');
    }

    const response = await this.fetch(new URL('/api/auth/sign-in', this.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '<unreadable>');
      throw new Error(
        `Sign-in failed (${response.status} ${response.statusText}): ${text}`
      );
    }

    const rawCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')];
    const jar = parseSetCookies(rawCookies.filter(Boolean));

    if (!jar.has('affine_session') || !jar.has('affine_user_id')) {
      throw new Error('Missing affine_session or affine_user_id cookie.');
    }

    this.cookieJar = jar;
    this.userId = jar.get('affine_user_id');
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

    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    this.socket = socket;
    return socket;
  }

  async emitWithAck(event, payload, timeout = this.timeoutMs) {
    const socket = await this.connectSocket();
    try {
      return await socket.timeout(timeout).emitWithAck(event, payload);
    } catch (err) {
      err.message = `[${event}] ${err.message}`;
      throw err;
    }
  }

  async joinWorkspace(workspaceId) {
    if (this.joinedWorkspaces.has(workspaceId)) {
      return;
    }

    const res = await this.emitWithAck('space:join', {
      spaceType: 'workspace',
      spaceId: workspaceId,
      clientVersion: `affine-client-${crypto.randomUUID()}`,
    });

    if (res?.error) {
      throw new Error(`space:join rejected: ${JSON.stringify(res.error)}`);
    }

    this.joinedWorkspaces.add(workspaceId);
  }

  async leaveWorkspace(workspaceId) {
    if (!this.joinedWorkspaces.has(workspaceId)) {
      return;
    }

    try {
      await this.emitWithAck('space:leave', {
        spaceType: 'workspace',
        spaceId: workspaceId,
      });
    } catch (err) {
      // We log at console level; callers typically run this during shutdown.
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

  async loadWorkspaceDoc(workspaceId, docId) {
    const res = await this.emitWithAck('space:load-doc', {
      spaceType: 'workspace',
      spaceId: workspaceId,
      docId,
    });
    if (res?.error) {
      throw new Error(
        `space:load-doc failed for ${docId}: ${JSON.stringify(res.error)}`
      );
    }
    return decodeLoadResponse(res);
  }

  async pushWorkspaceDocUpdate(workspaceId, docId, doc, stateVector) {
    const update = encodeUpdateToBase64(doc, stateVector);
    const res = await this.emitWithAck('space:push-doc-update', {
      spaceType: 'workspace',
      spaceId: workspaceId,
      docId,
      update,
    });
    if (res?.error) {
      throw new Error(
        `space:push-doc-update failed for ${docId}: ${JSON.stringify(res.error)}`
      );
    }
    return res;
  }

  async updateWorkspaceMeta(workspaceId, { docId, title, timestamp }) {
    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, workspaceId);
    const workspaceMeta = doc.getMap('meta');
    let pages = workspaceMeta.get('pages');
    if (!(pages instanceof Y.Array)) {
      pages = new Y.Array();
      workspaceMeta.set('pages', pages);
    }

    const entry = new Y.Map();
    entry.set('id', docId);
    entry.set('title', title);
    entry.set('createDate', timestamp);
    entry.set('updatedDate', timestamp);
    entry.set('tags', new Y.Array());
    pages.push([entry]);

    await this.pushWorkspaceDocUpdate(workspaceId, workspaceId, doc, stateVector);
  }

  async upsertDocProperties(workspaceId, { docId, timestamp }) {
    const docPropsId = `db$${workspaceId}$docProperties`;
    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, docPropsId);

    let propsEntry = doc.getMap(docId);
    if (!(propsEntry instanceof Y.Map)) {
      propsEntry = new Y.Map();
      doc.share.set(docId, propsEntry);
    }

    propsEntry.set('id', docId);
    propsEntry.set('primaryMode', 'page');
    propsEntry.set('edgelessColorTheme', 'light');
    if (this.userId) {
      propsEntry.set('createdBy', this.userId);
      propsEntry.set('updatedBy', this.userId);
    }
    propsEntry.set('updatedAt', timestamp);

    await this.pushWorkspaceDocUpdate(workspaceId, docPropsId, doc, stateVector);
  }

  async upsertFolderNode(workspaceId, {
    nodeId,
    parentId,
    type,
    data,
    index,
  }) {
    const foldersId = `db$${workspaceId}$folders`;
    const { doc, stateVector } = await this.loadWorkspaceDoc(workspaceId, foldersId);

    let nodeMap = doc.getMap(nodeId);
    if (!(nodeMap instanceof Y.Map)) {
      nodeMap = new Y.Map();
      doc.share.set(nodeId, nodeMap);
    }

    nodeMap.set('id', nodeId);
    nodeMap.set('parentId', parentId ?? null);
    nodeMap.set('type', type);
    nodeMap.set('data', data);
    nodeMap.set('index', index || randomLexoRank());

    await this.pushWorkspaceDocUpdate(workspaceId, foldersId, doc, stateVector);
    return nodeId;
  }

  async createFolder(workspaceId, {
    name = 'New folder',
    parentId = null,
    nodeId = nanoid(),
    index,
  } = {}) {
    const finalNodeId = await this.upsertFolderNode(workspaceId, {
      nodeId,
      parentId,
      type: 'folder',
      data: name,
      index,
    });
    return { nodeId: finalNodeId };
  }

  async registerDocInFolder(workspaceId, {
    parentFolderId,
    docId,
    nodeId = nanoid(),
    index,
  }) {
    const finalNodeId = await this.upsertFolderNode(workspaceId, {
      nodeId,
      parentId: parentFolderId,
      type: 'doc',
      data: docId,
      index,
    });
    return { nodeId: finalNodeId };
  }

  async createDocument(workspaceId, {
    docId = nanoid(),
    title = `Programmatic doc ${new Date().toISOString()}`,
    content = 'Document generated via AffineClient.',
    folderId = null,
    folderNodeId = null,
  }) {
    if (!this.userId) {
      throw new Error('User id unavailable: signIn must complete before createDocument.');
    }

    await this.joinWorkspace(workspaceId);

    const { ydoc, timestamp } = createDocYStructure({
      docId,
      title,
      content,
      userId: this.userId,
    });

    await this.pushWorkspaceDocUpdate(workspaceId, docId, ydoc);
    await this.updateWorkspaceMeta(workspaceId, { docId, title, timestamp });
    await this.upsertDocProperties(workspaceId, { docId, timestamp });

    let registeredNodeId = null;
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
      title,
    };
  }
}

module.exports = {
  AffineClient,
  DEFAULT_BASE_URL,
  createDocYStructure,
  decodeLoadResponse,
  nanoid,
  parseSetCookies,
  randomLexoRank,
  serializeCookies,
};
