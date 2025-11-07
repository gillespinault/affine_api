import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { AffineClient, DEFAULT_BASE_URL } from '../client/index.js';

type JsonSchema = Record<string, unknown>;
type Args = Record<string, unknown>;

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Args) => Promise<CallToolResult>;
};

const server = new Server({
  name: 'affine-notebooks-mcp',
  version: '0.1.0',
});

server.registerCapabilities({
  tools: {
    listChanged: false,
  },
});

const EMPTY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function workspaceSchema(
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties: {
      workspaceId: {
        type: 'string',
        description: 'AFFiNE workspace identifier.',
      },
      ...properties,
    },
    required: ['workspaceId', ...required],
    additionalProperties: false,
  };
}

function docSchema(
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): JsonSchema {
  return workspaceSchema(
    {
      docId: {
        type: 'string',
        description: 'AFFiNE document identifier.',
      },
      ...properties,
    },
    ['docId', ...required],
  );
}

let client: AffineClient | null = null;
let clientPromise: Promise<AffineClient> | null = null;

async function initializeClient(): Promise<AffineClient> {
  const email = process.env.AFFINE_EMAIL;
  const password = process.env.AFFINE_PASSWORD;

  if (!email || !password) {
    throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD must be set in the environment.');
  }

  const baseUrl = process.env.AFFINE_BASE_URL || DEFAULT_BASE_URL;
  const instance = new AffineClient({ baseUrl });
  await instance.signIn(email, password);
  await instance.connectSocket();
  console.error('✓ Connected to AFFiNE');
  return instance;
}

async function getClient(): Promise<AffineClient> {
  if (client) {
    return client;
  }

  if (!clientPromise) {
    clientPromise = initializeClient()
      .then(instance => {
        client = instance;
        return instance;
      })
      .catch(error => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
}

async function shutdownClient() {
  if (!client) {
    return;
  }

  try {
    await client.disconnect();
  } catch (error) {
    console.error('Error while disconnecting from AFFiNE:', error);
  } finally {
    client = null;
    clientPromise = null;
  }
}

process.on('SIGINT', () => {
  void shutdownClient().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdownClient().finally(() => process.exit(0));
});

process.on('exit', () => {
  if (client) {
    void client.disconnect();
  }
});

function ensureObject(value: unknown): Args {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be an object.');
  }
  return value as Args;
}

function getString(
  args: Args,
  key: string,
  options: { required?: boolean; allowEmpty?: boolean; trim?: boolean } = {},
): string | undefined {
  if (!(key in args) || args[key] === undefined || args[key] === null) {
    if (options.required) {
      throw new Error(`${key} is required and must be a string.`);
    }
    return undefined;
  }

  if (typeof args[key] !== 'string') {
    throw new Error(`${key} must be a string.`);
  }

  const rawValue = args[key] as string;
  const shouldTrim = options.trim ?? true;
  const processed = shouldTrim ? rawValue.trim() : rawValue;

  if (!options.allowEmpty && processed.length === 0) {
    if (options.required) {
      throw new Error(`${key} cannot be empty.`);
    }
    return undefined;
  }

  return shouldTrim ? processed : rawValue;
}

function optionalStringOrNull(args: Args, key: string): string | null | undefined {
  if (!(key in args)) {
    return undefined;
  }

  const value = args[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getStringArray(
  args: Args,
  key: string,
  options: { required?: boolean } = {},
): string[] | undefined {
  if (!(key in args) || args[key] === undefined || args[key] === null) {
    if (options.required) {
      throw new Error(`${key} is required and must be an array of strings.`);
    }
    return undefined;
  }

  const value = args[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings.`);
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`${key} must be an array of strings.`);
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      result.push(trimmed);
    }
  }

  return result;
}

function decodeBase64Input(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('content cannot be empty');
  }
  const normalized = trimmed.includes(';base64,')
    ? trimmed.slice(trimmed.indexOf(';base64,') + ';base64,'.length)
    : trimmed;
  return Buffer.from(normalized, 'base64');
}

function getNumber(
  args: Args,
  key: string,
  options: { required?: boolean; min?: number; max?: number; defaultValue?: number } = {},
): number | undefined {
  if (!(key in args) || args[key] === undefined || args[key] === null) {
    if (options.required) {
      throw new Error(`${key} is required and must be a number.`);
    }
    return options.defaultValue;
  }

  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number.`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${key} must be greater than or equal to ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${key} must be less than or equal to ${options.max}.`);
  }

  return value;
}

function getBoolean(
  args: Args,
  key: string,
  options: { required?: boolean; defaultValue?: boolean } = {},
): boolean | undefined {
  if (!(key in args) || args[key] === undefined || args[key] === null) {
    if (options.required) {
      throw new Error(`${key} is required and must be a boolean.`);
    }
    return options.defaultValue;
  }

  const value = args[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}

function getRecord(
  args: Args,
  key: string,
  options: { required?: boolean; allowEmpty?: boolean } = {},
): Record<string, unknown> | undefined {
  if (!(key in args) || args[key] === undefined || args[key] === null) {
    if (options.required) {
      throw new Error(`${key} is required and must be an object.`);
    }
    return undefined;
  }

  const value = args[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${key} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  if (!options.allowEmpty && Object.keys(record).length === 0) {
    if (options.required) {
      throw new Error(`${key} cannot be empty.`);
    }
    return undefined;
  }

  return record;
}

function parsePosition(value: unknown): 'start' | 'end' | number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === 'start' || value === 'end') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new Error('position must be "start", "end", or a number.');
}

function normalizeDocModeInput(value?: string | null): 'page' | 'edgeless' | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'page') {
    return 'page';
  }
  if (normalized === 'edgeless') {
    return 'edgeless';
  }
  throw new Error('docMode must be either "page" or "edgeless".');
}

function success(structured: Record<string, unknown>, message?: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: message ?? JSON.stringify(structured, null, 2),
      },
    ],
    structuredContent: structured,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${message}`,
      },
    ],
    isError: true,
  };
}

type Handler = (args: Args) => Promise<CallToolResult>;

const handleHealthCheck: Handler = async () => {
  await getClient();
  const baseUrl = process.env.AFFINE_BASE_URL || DEFAULT_BASE_URL;
  return success({
    status: 'ok',
    baseUrl,
    authenticated: true,
  });
};

const handleListWorkspaces: Handler = async () => {
  const affine = await getClient();
  const workspaces = await affine.listWorkspaces();
  return success({
    count: workspaces.length,
    workspaces,
  });
};

const handleGetWorkspace: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);
  const workspace = await affine.getWorkspaceDetails(workspaceId);
  return success({
    workspace,
  });
};

const handleGetFolderTree: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);
  const folders = await affine.getFolderTree(workspaceId);
  return success({
    workspaceId,
    folders,
  });
};

const handleGetWorkspaceHierarchy: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);
  const hierarchy = await affine.getHierarchy(workspaceId);
  return success({
    workspaceId,
    hierarchy,
  });
};

const handleGetFolderContents: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const folderId = getString(args, 'folderId', { required: true })!;
  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);
  const folder = await affine.getFolderContents(workspaceId, folderId);
  return success({
    workspaceId,
    folder,
  });
};

const handleListDocuments: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const affine = await getClient();
  const documents = await affine.listDocuments(workspaceId);
  return success({
    workspaceId,
    count: documents.length,
    documents,
  });
};

const handleGetDocument: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const affine = await getClient();
  const document = await affine.getDocument(workspaceId, docId);
  return success({
    workspaceId,
    document,
  });
};

const handleGetDocumentContent: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const affine = await getClient();
  const document = await affine.getDocumentContent(workspaceId, docId);
  return success({
    workspaceId,
    document,
  });
};

const handleCreateDocument: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId');
  const title = getString(args, 'title');
  const content = getString(args, 'content', { trim: false, allowEmpty: true });
  const markdown = getString(args, 'markdown', { trim: false, allowEmpty: true });
  const folderId = optionalStringOrNull(args, 'folderId');
  const folderNodeId = optionalStringOrNull(args, 'folderNodeId');
  const tags = getStringArray(args, 'tags');

  const affine = await getClient();
  const payload: {
    docId?: string;
    title?: string;
    content?: string;
    markdown?: string;
    folderId?: string | null;
    folderNodeId?: string | null;
    tags?: string[];
  } = {};

  if (docId) {
    payload.docId = docId;
  }
  if (title) {
    payload.title = title;
  }
  if (content !== undefined) {
    payload.content = content;
  }
  if (markdown !== undefined) {
    payload.markdown = markdown;
  }
  if (folderId !== undefined) {
    payload.folderId = folderId;
  }
  if (folderNodeId !== undefined) {
    payload.folderNodeId = folderNodeId;
  }
  if (tags) {
    payload.tags = tags;
  }

  const document = await affine.createDocument(workspaceId, payload);
  return success({
    workspaceId,
    document,
  });
};

const handleUpdateDocument: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const title = getString(args, 'title');
  const content = getString(args, 'content', { trim: false, allowEmpty: true });
  const markdown = getString(args, 'markdown', { trim: false, allowEmpty: true });
  const folderId = optionalStringOrNull(args, 'folderId');
  const folderNodeId = optionalStringOrNull(args, 'folderNodeId');
  const tags = getStringArray(args, 'tags');
  const rawPrimaryMode = getString(args, 'primaryMode');

  let primaryMode: 'page' | 'edgeless' | undefined;
  if (rawPrimaryMode !== undefined) {
    if (rawPrimaryMode !== 'page' && rawPrimaryMode !== 'edgeless') {
      throw new Error('primaryMode must be either "page" or "edgeless".');
    }
    primaryMode = rawPrimaryMode;
  }

  const affine = await getClient();
  const payload: {
    title?: string;
    content?: string;
    markdown?: string;
    folderId?: string | null;
    folderNodeId?: string | null;
    tags?: string[];
    primaryMode?: 'page' | 'edgeless';
  } = {};

  if (title) {
    payload.title = title;
  }
  if (content !== undefined) {
    payload.content = content;
  }
  if (markdown !== undefined) {
    payload.markdown = markdown;
  }
  if (folderId !== undefined) {
    payload.folderId = folderId;
  }
  if (folderNodeId !== undefined) {
    payload.folderNodeId = folderNodeId;
  }
  if (tags) {
    payload.tags = tags;
  }
  if (primaryMode) {
    payload.primaryMode = primaryMode;
  }

  const document = await affine.updateDocument(workspaceId, docId, payload);
  return success({
    workspaceId,
    document,
  });
};

const handleDeleteDocument: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const affine = await getClient();
  await affine.deleteDocument(workspaceId, docId);
  return success({
    workspaceId,
    docId,
    deleted: true,
  });
};

const handleMoveDocument: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const folderId = optionalStringOrNull(args, 'folderId');
  const folderNodeId = getString(args, 'folderNodeId');

  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);

  const result = await affine.registerDocInFolder(workspaceId, {
    parentFolderId: folderId ?? null,
    docId,
    nodeId: folderNodeId,
  });

  return success({
    workspaceId,
    docId,
    folderId: folderId ?? null,
    folderNodeId: result.nodeId,
  });
};

const handleUpdateDocumentProperties: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const tags = getStringArray(args, 'tags', { required: true })!;

  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);

  const timestamp = Date.now();
  const snapshot = await affine.getDocument(workspaceId, docId);
  const title = snapshot.title && snapshot.title.length > 0 ? snapshot.title : 'Untitled';

  await Promise.all([
    affine.upsertDocProperties(workspaceId, {
      docId,
      timestamp,
      tags,
    }),
    affine.updateWorkspaceMeta(workspaceId, {
      docId,
      title,
      timestamp,
      tags,
    }),
  ]);

  return success({
    workspaceId,
    docId,
    tags,
    timestamp,
    updated: true,
  });
};

const handleSearchDocuments: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const query = getString(args, 'query', { required: true })!;
  const limit = getNumber(args, 'limit', { defaultValue: 20, min: 1, max: 100 }) ?? 20;

  const affine = await getClient();
  const documents = await affine.listDocuments(workspaceId);

  const normalized = query.toLowerCase();
  const filtered = documents.filter(doc => {
    const title = doc.title ? doc.title.toLowerCase() : '';
    if (title.includes(normalized)) {
      return true;
    }
    if (doc.docId.toLowerCase().includes(normalized)) {
      return true;
    }
    return doc.tags.some(tag => tag.toLowerCase().includes(normalized));
  });

  const results = filtered.slice(0, limit);

  return success({
    workspaceId,
    query,
    limit,
    totalMatches: filtered.length,
    results,
  });
};

const handleListDocumentHistory: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const limit = getNumber(args, 'limit', { min: 1, max: 100 });
  const before = getString(args, 'before');

  const affine = await getClient();
  const history = await affine.listDocumentHistory(workspaceId, docId, {
    limit: limit ?? undefined,
    before: before && before.length ? before : undefined,
  });

  return success({
    workspaceId,
    docId,
    count: history.length,
    entries: history,
  });
};

const handleRecoverDocumentVersion: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const timestamp = getString(args, 'timestamp', { required: true })!;

  const affine = await getClient();
  const recovered = await affine.recoverDocumentVersion(workspaceId, docId, timestamp);
  return success({
    workspaceId,
    docId,
    timestamp,
    recovered,
  });
};

const handleListComments: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const first = getNumber(args, 'first', { min: 1, max: 100 });
  const offset = getNumber(args, 'offset', { min: 0 });
  const after = getString(args, 'after');

  const affine = await getClient();
  const comments = await affine.listComments(workspaceId, docId, {
    first: first ?? undefined,
    offset: offset ?? undefined,
    after: after && after.length ? after : undefined,
  });

  return success({
    workspaceId,
    docId,
    ...comments,
  });
};

const handleCreateComment: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const docTitle = getString(args, 'docTitle');
  const docMode = normalizeDocModeInput(getString(args, 'docMode'));
  const mentions = getStringArray(args, 'mentions');
  const content = (args as Record<string, unknown>).content;

  if (content === undefined) {
    throw new Error('content is required.');
  }

  const affine = await getClient();
  const comment = await affine.createComment(workspaceId, {
    docId,
    content,
    docTitle: docTitle ?? undefined,
    docMode,
    mentions: mentions?.length ? mentions : undefined,
  });

  return success({
    workspaceId,
    docId,
    comment,
  });
};

const handleUpdateComment: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const commentId = getString(args, 'commentId', { required: true })!;
  const content = (args as Record<string, unknown>).content;
  if (content === undefined) {
    throw new Error('content is required.');
  }

  const affine = await getClient();
  const updated = await affine.updateComment(commentId, content);
  return success({
    workspaceId,
    commentId,
    updated,
  });
};

const handleDeleteComment: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const commentId = getString(args, 'commentId', { required: true })!;

  const affine = await getClient();
  const deleted = await affine.deleteComment(commentId);
  return success({
    workspaceId,
    commentId,
    deleted,
  });
};

const handleResolveComment: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const commentId = getString(args, 'commentId', { required: true })!;
  const resolved = getBoolean(args, 'resolved', { defaultValue: true }) ?? true;

  const affine = await getClient();
  const outcome = await affine.resolveComment(commentId, resolved);
  return success({
    workspaceId,
    commentId,
    resolved,
    updated: outcome,
  });
};

const handleListNotifications: Handler = async args => {
  const first = getNumber(args, 'first', { min: 1, max: 100 });
  const unreadOnly = getBoolean(args, 'unreadOnly');

  const affine = await getClient();
  const notifications = await affine.listNotifications({
    first: first ?? undefined,
    unreadOnly: unreadOnly ?? undefined,
  });

  return success({
    ...notifications,
  });
};

const handleReadNotification: Handler = async args => {
  const notificationId = getString(args, 'notificationId', { required: true })!;
  const affine = await getClient();
  const updated = await affine.markNotificationRead(notificationId);
  return success({
    notificationId,
    read: updated,
  });
};

const handleReadAllNotifications: Handler = async () => {
  const affine = await getClient();
  const updated = await affine.markAllNotificationsRead();
  return success({
    updated,
  });
};

const handleListAccessTokens: Handler = async () => {
  const affine = await getClient();
  const tokens = await affine.listAccessTokens();
  return success({
    count: tokens.length,
    tokens,
  });
};

const handleCreateAccessToken: Handler = async args => {
  const name = getString(args, 'name', { required: true })!;
  const rawExpires = (args as Record<string, unknown>).expiresAt;

  let expiresAt: string | null | undefined;
  if (rawExpires === null) {
    expiresAt = null;
  } else if (rawExpires === undefined) {
    expiresAt = undefined;
  } else if (typeof rawExpires === 'string') {
    const trimmed = rawExpires.trim();
    if (!trimmed) {
      throw new Error('expiresAt cannot be empty.');
    }
    expiresAt = trimmed;
  } else {
    throw new Error('expiresAt must be a string or null.');
  }

  const affine = await getClient();
  const token = await affine.createAccessToken({ name, expiresAt });
  return success({
    token,
  });
};

const handleDeleteAccessToken: Handler = async args => {
  const tokenId = getString(args, 'tokenId', { required: true })!;
  const affine = await getClient();
  const revoked = await affine.revokeAccessToken(tokenId);
  return success({
    tokenId,
    revoked,
  });
};

const handleCopilotSearch: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const query = getString(args, 'query', { required: true })!;
  const scopeRaw = (getString(args, 'scope') ?? 'all').toLowerCase();
  if (!['docs', 'files', 'all'].includes(scopeRaw)) {
    throw new Error('scope must be one of docs, files, all');
  }
  const limit = getNumber(args, 'limit', { min: 1, max: 100 });
  const threshold = getNumber(args, 'threshold', { min: 0, max: 1 });
  const scopedThreshold = getNumber(args, 'scopedThreshold', { min: 0, max: 1 });
  const contextId = getString(args, 'contextId');

  const affine = await getClient();
  const options = {
    limit,
    threshold,
    scopedThreshold,
    contextId: contextId && contextId.length > 0 ? contextId : undefined,
  };

  const docs =
    scopeRaw === 'files' ? [] : await affine.matchWorkspaceDocs(workspaceId, query, options);
  const files =
    scopeRaw === 'docs' ? [] : await affine.matchWorkspaceFiles(workspaceId, query, options);

  return success({
    workspaceId,
    query,
    scope: scopeRaw,
    limit: limit ?? null,
    threshold: threshold ?? null,
    scopedThreshold: scopedThreshold ?? null,
    contextId: contextId ?? null,
    docCount: docs.length,
    fileCount: files.length,
    docs,
    files,
  });
};

const handleCopilotEmbeddingStatus: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const affine = await getClient();
  const status = await affine.queryWorkspaceEmbeddingStatus(workspaceId);
  return success({ workspaceId, ...status });
};

const handleListIgnoredDocs: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const limit = getNumber(args, 'limit', { defaultValue: 20, min: 1, max: 100 }) ?? 20;
  const offset = getNumber(args, 'offset', { defaultValue: 0, min: 0 }) ?? 0;

  const affine = await getClient();
  const data = await affine.listWorkspaceIgnoredDocs(workspaceId, {
    first: limit,
    offset,
  });

  return success({
    workspaceId,
    totalCount: data.totalCount,
    pageInfo: data.pageInfo,
    docs: data.items,
  });
};

const handleUpdateIgnoredDocs: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const add = getStringArray(args, 'add') ?? [];
  const remove = getStringArray(args, 'remove') ?? [];
  if (!add.length && !remove.length) {
    throw new Error('provide docIds to add and/or remove');
  }

  const affine = await getClient();
  const count = await affine.updateWorkspaceIgnoredDocs(workspaceId, {
    add: add.length ? add : undefined,
    remove: remove.length ? remove : undefined,
  });

  return success({
    workspaceId,
    updated: count,
    add,
    remove,
  });
};

const handleQueueDocEmbeddings: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docIds = getStringArray(args, 'docIds', { required: true })!;
  if (!docIds.length) {
    throw new Error('docIds array cannot be empty');
  }
  const affine = await getClient();
  await affine.queueWorkspaceEmbedding(workspaceId, docIds);
  return success({
    workspaceId,
    queued: docIds,
  });
};

const handleListEmbeddingFiles: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const limit = getNumber(args, 'limit', { defaultValue: 20, min: 1, max: 100 }) ?? 20;
  const offset = getNumber(args, 'offset', { defaultValue: 0, min: 0 }) ?? 0;

  const affine = await getClient();
  const data = await affine.listWorkspaceEmbeddingFiles(workspaceId, {
    first: limit,
    offset,
  });

  return success({
    workspaceId,
    totalCount: data.totalCount,
    pageInfo: data.pageInfo,
    files: data.items,
  });
};

const handleAddEmbeddingFile: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const fileName = getString(args, 'fileName', { required: true })!;
  const mimeType = getString(args, 'mimeType');
  const content = getString(args, 'content', { required: true })!;

  const buffer = decodeBase64Input(content);
  if (!buffer.length) {
    throw new Error('decoded file content is empty');
  }

  const affine = await getClient();
  const file = await affine.addWorkspaceEmbeddingFile(workspaceId, {
    fileName,
    content: buffer,
    mimeType: mimeType ?? undefined,
  });

  return success({
    workspaceId,
    file,
  });
};

const handleRemoveEmbeddingFile: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const fileId = getString(args, 'fileId', { required: true })!;
  const affine = await getClient();
  await affine.removeWorkspaceEmbeddingFile(workspaceId, fileId);
  return success({
    workspaceId,
    fileId,
    removed: true,
  });
};
const handleAddBlock: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const flavour = getString(args, 'flavour', { required: true })!;
  const parentBlockId = getString(args, 'parentBlockId', { required: true })!;
  const props = getRecord(args, 'props', { allowEmpty: true }) ?? {};
  const position = parsePosition(args.position);

  const affine = await getClient();
  const block = await affine.addBlock(workspaceId, docId, {
    flavour,
    parentBlockId,
    props,
    position,
  });

  return success({
    workspaceId,
    docId,
    block,
  });
};

const handleUpdateBlock: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const blockId = getString(args, 'blockId', { required: true })!;
  const props = getRecord(args, 'props', { required: true, allowEmpty: false })!;

  const affine = await getClient();
  const block = await affine.updateBlock(workspaceId, docId, blockId, props);
  return success({
    workspaceId,
    docId,
    block,
  });
};

const handleDeleteBlock: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const blockId = getString(args, 'blockId', { required: true })!;

  const affine = await getClient();
  const block = await affine.deleteBlock(workspaceId, docId, blockId);
  return success({
    workspaceId,
    docId,
    block,
  });
};

const handleListEdgelessElements: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;

  const affine = await getClient();
  const elements = await affine.getEdgelessElements(workspaceId, docId);
  return success({
    workspaceId,
    docId,
    count: elements.length,
    elements,
  });
};

const handleCreateEdgelessElement: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const element = getRecord(args, 'element', { required: true, allowEmpty: false })!;

  if (!('type' in element)) {
    throw new Error('element.type is required when creating an edgeless element.');
  }

  const affine = await getClient();
  const created = await affine.addEdgelessElement(workspaceId, docId, element);
  return success({
    workspaceId,
    docId,
    element: created,
  });
};

const handleGetEdgelessElement: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const elementId = getString(args, 'elementId', { required: true })!;

  const affine = await getClient();
  const elements = await affine.getEdgelessElements(workspaceId, docId);
  const element = elements.find(entry => entry.id === elementId);

  if (!element) {
    throw new Error(`Element ${elementId} not found.`);
  }

  return success({
    workspaceId,
    docId,
    element,
  });
};

const handleUpdateEdgelessElement: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const elementId = getString(args, 'elementId', { required: true })!;
  const patch = getRecord(args, 'patch', { required: true, allowEmpty: false })!;

  const affine = await getClient();
  const element = await affine.updateEdgelessElement(workspaceId, docId, elementId, patch);
  return success({
    workspaceId,
    docId,
    element,
  });
};

const handleDeleteEdgelessElement: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const elementId = getString(args, 'elementId', { required: true })!;

  const affine = await getClient();
  const result = await affine.deleteEdgelessElement(workspaceId, docId, elementId);
  return success({
    workspaceId,
    docId,
    element: result,
  });
};

const handleCreateFolder: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const name = getString(args, 'name');
  const parentId = optionalStringOrNull(args, 'parentId');

  const affine = await getClient();
  const payload: { name?: string; parentId?: string | null } = {};
  if (name) {
    payload.name = name;
  }
  if (parentId !== undefined) {
    payload.parentId = parentId;
  }

  const result = await affine.createFolder(workspaceId, payload);
  return success({
    workspaceId,
    nodeId: result.nodeId,
    name: payload.name ?? null,
    parentId: payload.parentId ?? null,
  });
};

const handleListTags: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const affine = await getClient();
  const tags = await affine.listTags(workspaceId);
  return success({
    workspaceId,
    count: tags.length,
    tags,
  });
};

const handleCreateTag: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const name = getString(args, 'name', { required: true })!;

  const affine = await getClient();
  const tags = await affine.listTags(workspaceId);
  const exists = tags.some(tag => tag.id === name);

  if (exists) {
    throw new Error(`Tag "${name}" already exists.`);
  }

  const tag = {
    id: name,
    name,
    count: 0,
  };

  return success({
    workspaceId,
    tag,
  });
};

const handleDeleteTag: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const tagId = getString(args, 'tagId', { required: true })!;

  const affine = await getClient();
  const result = await affine.deleteTag(workspaceId, tagId);

  if (!result.deleted) {
    throw new Error(`Tag "${tagId}" was not found or is not used by any document.`);
  }

  return success({
    workspaceId,
    tagId,
    deleted: true,
    documentsUpdated: result.documentsUpdated,
  });
};

const handleUpdateWorkspaceMeta: Handler = async args => {
  const workspaceId = getString(args, 'workspaceId', { required: true })!;
  const docId = getString(args, 'docId', { required: true })!;
  const title = getString(args, 'title', { required: true })!;
  const tags = getStringArray(args, 'tags');
  const timestamp = getNumber(args, 'timestamp');

  const affine = await getClient();
  await affine.joinWorkspace(workspaceId);

  const effectiveTimestamp = timestamp ?? Date.now();

  await affine.updateWorkspaceMeta(workspaceId, {
    docId,
    title,
    timestamp: effectiveTimestamp,
    tags,
  });

  return success({
    workspaceId,
    docId,
    title,
    tags: tags ?? null,
    timestamp: effectiveTimestamp,
    updated: true,
  });
};

function makeTool(
  name: string,
  title: string,
  description: string,
  inputSchema: JsonSchema,
  handler: Handler,
): ToolDefinition {
  return { name, title, description, inputSchema, handler };
}

const toolDefinitions: ToolDefinition[] = [
  // Health
  makeTool(
    'health_check',
    'Health Check',
    'Verify MCP server readiness and AFFiNE connectivity.',
    EMPTY_SCHEMA,
    handleHealthCheck,
  ),

  // Workspace navigation
  makeTool(
    'list_workspaces',
    'List Workspaces',
    'List all accessible AFFiNE workspaces with metadata.',
    EMPTY_SCHEMA,
    handleListWorkspaces,
  ),
  makeTool(
    'get_workspace',
    'Get Workspace',
    'Retrieve metadata for a specific workspace.',
    workspaceSchema(),
    handleGetWorkspace,
  ),
  makeTool(
    'get_folder_tree',
    'Get Folder Tree',
    'Retrieve the folder hierarchy for a workspace.',
    workspaceSchema(),
    handleGetFolderTree,
  ),
  makeTool(
    'get_workspace_hierarchy',
    'Get Workspace Hierarchy',
    'Retrieve the complete workspace hierarchy, including folders, documents, and subdocuments.',
    workspaceSchema(),
    handleGetWorkspaceHierarchy,
  ),
  makeTool(
    'get_folder_contents',
    'Get Folder Contents',
    'List documents and subfolders for a specific folder.',
    workspaceSchema(
      {
        folderId: {
          type: 'string',
          description: 'Folder node identifier.',
        },
      },
      ['folderId'],
    ),
    handleGetFolderContents,
  ),

  // Documents
  makeTool(
    'list_documents',
    'List Documents',
    'List documents within a workspace.',
    workspaceSchema(),
    handleListDocuments,
  ),
  makeTool(
    'get_document',
    'Get Document Snapshot',
    'Fetch a document snapshot including metadata and encoded update.',
    docSchema(),
    handleGetDocument,
  ),
  makeTool(
    'get_document_content',
    'Get Document Content',
    'Fetch document content as structured blocks.',
    docSchema(),
    handleGetDocumentContent,
  ),
  makeTool(
    'create_document',
    'Create Document',
    'Create a new document in the specified workspace.',
    workspaceSchema({
      docId: { type: 'string', description: 'Optional document identifier to reuse.' },
      title: { type: 'string', description: 'Document title.' },
      content: { type: 'string', description: 'Plain text content for the document.' },
      markdown: { type: 'string', description: 'GitHub Flavored Markdown to import.' },
      folderId: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Folder identifier where the doc should live.',
      },
      folderNodeId: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Existing folder node to reuse.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags to assign to the document.',
      },
    }),
    handleCreateDocument,
  ),
  makeTool(
    'update_document',
    'Update Document',
    'Update document content, metadata, or location.',
    docSchema(
      {
        title: { type: 'string', description: 'New title for the document.' },
        content: { type: 'string', description: 'Plain text content to replace existing content.' },
        markdown: { type: 'string', description: 'Markdown content to replace existing content.' },
        folderId: {
          oneOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Folder identifier where the doc should live.',
        },
        folderNodeId: {
          oneOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Preferred folder node identifier.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply to the document.',
        },
        primaryMode: {
          type: 'string',
          enum: ['page', 'edgeless'],
          description: 'Primary display mode for the document.',
        },
      },
    ),
    handleUpdateDocument,
  ),
  makeTool(
    'delete_document',
    'Delete Document',
    'Delete a document and remove it from workspace metadata.',
    docSchema(),
    handleDeleteDocument,
  ),
  makeTool(
    'move_document',
    'Move Document',
    'Move a document between folders or to the workspace root.',
    docSchema(
      {
        folderId: {
          oneOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Target folder identifier (null for root).',
        },
        folderNodeId: {
          type: 'string',
          description: 'Optional folder node identifier to reuse.',
        },
      },
    ),
    handleMoveDocument,
  ),
  makeTool(
    'update_document_properties',
    'Update Document Properties',
    'Update document tags and synchronize metadata.',
    docSchema(
      {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to apply to the document.',
        },
      },
      ['tags'],
    ),
    handleUpdateDocumentProperties,
  ),
  makeTool(
    'search_documents',
    'Search Documents',
    'Search documents by title, identifier, or tags.',
    workspaceSchema(
      {
        query: { type: 'string', description: 'Search keyword.' },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return (default 20).',
        },
      },
      ['query'],
    ),
    handleSearchDocuments,
  ),
  makeTool(
    'list_document_history',
    'List Document History',
    'Retrieve the version history of a document.',
    docSchema({
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Max number of history entries to return.',
      },
      before: {
        type: 'string',
        description: 'Optional ISO timestamp to paginate backwards.',
      },
    }),
    handleListDocumentHistory,
  ),
  makeTool(
    'recover_document_version',
    'Recover Document Version',
    'Restore a document to a specific timestamp from its history.',
    docSchema(
      {
        timestamp: {
          type: 'string',
          description: 'ISO timestamp pointing to the target version.',
        },
      },
      ['timestamp'],
    ),
    handleRecoverDocumentVersion,
  ),

  // Comments
  makeTool(
    'list_comments',
    'List Comments',
    'List comments (and replies) for a document.',
    docSchema({
      first: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of comments to return.',
      },
      offset: {
        type: 'number',
        minimum: 0,
        description: 'Offset to start listing from.',
      },
      after: {
        type: 'string',
        description: 'Cursor for pagination.',
      },
    }),
    handleListComments,
  ),
  makeTool(
    'create_comment',
    'Create Comment',
    'Create a comment on a document.',
    docSchema(
      {
        docTitle: {
          type: 'string',
          description: 'Optional document title for notification context.',
        },
        docMode: {
          type: 'string',
          enum: ['page', 'edgeless'],
          description: 'Document mode (page or edgeless).',
        },
        content: {
          type: ['object', 'string'],
          description: 'Comment payload (rich text delta or plain string).',
        },
        mentions: {
          type: 'array',
          items: { type: 'string' },
          description: 'User IDs to mention.',
        },
      },
      ['content'],
    ),
    handleCreateComment,
  ),
  makeTool(
    'update_comment',
    'Update Comment',
    'Update an existing comment.',
    workspaceSchema(
      {
        commentId: {
          type: 'string',
          description: 'Identifier of the comment to update.',
        },
        content: {
          type: ['object', 'string'],
          description: 'Replacement content for the comment.',
        },
      },
      ['commentId', 'content'],
    ),
    handleUpdateComment,
  ),
  makeTool(
    'delete_comment',
    'Delete Comment',
    'Delete a comment by identifier.',
    workspaceSchema(
      {
        commentId: {
          type: 'string',
          description: 'Identifier of the comment to delete.',
        },
      },
      ['commentId'],
    ),
    handleDeleteComment,
  ),
  makeTool(
    'resolve_comment',
    'Resolve Comment',
    'Resolve or reopen a comment thread.',
    workspaceSchema(
      {
        commentId: {
          type: 'string',
          description: 'Identifier of the comment to resolve.',
        },
        resolved: {
          type: 'boolean',
          description: 'True to resolve, false to reopen (default true).',
        },
      },
      ['commentId'],
    ),
    handleResolveComment,
  ),
  makeTool(
    'copilot_search',
    'Copilot Semantic Search',
    'Run AFFiNE Copilot semantic search across workspace documents and files.',
    workspaceSchema(
      {
        query: { type: 'string', description: 'Full-text or semantic query string.' },
        scope: {
          type: 'string',
          enum: ['docs', 'files', 'all'],
          description: 'Which indexes to query (default: all).',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of matches per index.',
        },
        threshold: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Similarity threshold for global matches.',
        },
        scopedThreshold: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Stricter threshold applied to scoped/doc-specific matches.',
        },
        contextId: {
          type: 'string',
          description: 'Optional Copilot context ID to scope the search.',
        },
      },
      ['query'],
    ),
    handleCopilotSearch,
  ),
  makeTool(
    'copilot_embedding_status',
    'Copilot Embedding Status',
    'Return the total vs indexed count for workspace embeddings.',
    workspaceSchema(),
    handleCopilotEmbeddingStatus,
  ),
  makeTool(
    'list_embedding_ignored_docs',
    'List Ignored Docs (Embeddings)',
    'List documents that are excluded from Copilot embeddings.',
    workspaceSchema({
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Page size (default 20).',
      },
      offset: {
        type: 'number',
        minimum: 0,
        description: 'Pagination offset (default 0).',
      },
    }),
    handleListIgnoredDocs,
  ),
  makeTool(
    'update_embedding_ignored_docs',
    'Update Ignored Docs (Embeddings)',
    'Add or remove documents from the ignored set.',
    workspaceSchema({
      add: {
        type: 'array',
        items: { type: 'string' },
        description: 'Doc IDs to add to the ignored list.',
      },
      remove: {
        type: 'array',
        items: { type: 'string' },
        description: 'Doc IDs to remove from the ignored list.',
      },
    }),
    handleUpdateIgnoredDocs,
  ),
  makeTool(
    'queue_doc_embedding',
    'Queue Doc Embedding',
    'Enqueue documents for re-embedding.',
    workspaceSchema(
      {
        docIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Document IDs to enqueue.',
        },
      },
      ['docIds'],
    ),
    handleQueueDocEmbeddings,
  ),
  makeTool(
    'list_embedding_files',
    'List Embedding Files',
    'List uploaded files that feed Copilot embeddings.',
    workspaceSchema({
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        description: 'Page size (default 20).',
      },
      offset: {
        type: 'number',
        minimum: 0,
        description: 'Pagination offset (default 0).',
      },
    }),
    handleListEmbeddingFiles,
  ),
  makeTool(
    'add_embedding_file',
    'Add Embedding File',
    'Upload a file (base64) to enrich workspace embeddings.',
    workspaceSchema(
      {
        fileName: {
          type: 'string',
          description: 'File name as it should appear in AFFiNE.',
        },
        content: {
          type: 'string',
          description: 'Base64 encoded file content (data URLs supported).',
        },
        mimeType: {
          type: 'string',
          description: 'Optional MIME type override (defaults to application/octet-stream).',
        },
      },
      ['fileName', 'content'],
    ),
    handleAddEmbeddingFile,
  ),
  makeTool(
    'remove_embedding_file',
    'Remove Embedding File',
    'Delete an uploaded embedding file (embeddings will be cascaded).',
    workspaceSchema(
      {
        fileId: {
          type: 'string',
          description: 'Identifier of the file to delete.',
        },
      },
      ['fileId'],
    ),
    handleRemoveEmbeddingFile,
  ),

  // Blocks
  makeTool(
    'add_block',
    'Add Block',
    'Insert a new block into a document.',
    docSchema(
      {
        flavour: {
          type: 'string',
          description: 'Block flavour identifier (e.g., affine:paragraph).',
        },
        parentBlockId: {
          type: 'string',
          description: 'Identifier of the parent block.',
        },
        props: {
          type: 'object',
          description: 'Properties to assign to the block.',
        },
        position: {
          oneOf: [
            { type: 'string', enum: ['start', 'end'] },
            { type: 'number' },
          ],
          description: 'Insert position among siblings.',
        },
      },
      ['flavour', 'parentBlockId'],
    ),
    handleAddBlock,
  ),
  makeTool(
    'update_block',
    'Update Block',
    'Patch properties on an existing block.',
    docSchema(
      {
        blockId: {
          type: 'string',
          description: 'Identifier of the block to update.',
        },
        props: {
          type: 'object',
          description: 'Properties to merge into the block.',
        },
      },
      ['blockId', 'props'],
    ),
    handleUpdateBlock,
  ),
  makeTool(
    'delete_block',
    'Delete Block',
    'Remove a block and its descendants.',
    docSchema(
      {
        blockId: {
          type: 'string',
          description: 'Identifier of the block to delete.',
        },
      },
      ['blockId'],
    ),
    handleDeleteBlock,
  ),

  // Edgeless
  makeTool(
    'list_edgeless_elements',
    'List Edgeless Elements',
    'List canvas elements for a document in edgeless mode.',
    docSchema(),
    handleListEdgelessElements,
  ),
  makeTool(
    'create_edgeless_element',
    'Create Edgeless Element',
    'Create a new element on the edgeless canvas.',
    docSchema(
      {
        element: {
          type: 'object',
          description: 'Element definition including type and geometry.',
        },
      },
      ['element'],
    ),
    handleCreateEdgelessElement,
  ),
  makeTool(
    'get_edgeless_element',
    'Get Edgeless Element',
    'Retrieve a single edgeless element.',
    docSchema(
      {
        elementId: {
          type: 'string',
          description: 'Identifier of the element to retrieve.',
        },
      },
      ['elementId'],
    ),
    handleGetEdgelessElement,
  ),
  makeTool(
    'update_edgeless_element',
    'Update Edgeless Element',
    'Patch properties on an existing edgeless element.',
    docSchema(
      {
        elementId: {
          type: 'string',
          description: 'Identifier of the element to update.',
        },
        patch: {
          type: 'object',
          description: 'Properties to merge into the element.',
        },
      },
      ['elementId', 'patch'],
    ),
    handleUpdateEdgelessElement,
  ),
  makeTool(
    'delete_edgeless_element',
    'Delete Edgeless Element',
    'Remove an element from the edgeless canvas.',
    docSchema(
      {
        elementId: {
          type: 'string',
          description: 'Identifier of the element to delete.',
        },
      },
      ['elementId'],
    ),
    handleDeleteEdgelessElement,
  ),

  // Folders
  makeTool(
    'create_folder',
    'Create Folder',
    'Create a folder in the workspace hierarchy.',
    workspaceSchema({
      name: { type: 'string', description: 'Folder name (defaults to "New folder").' },
      parentId: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Optional parent folder identifier.',
      },
    }),
    handleCreateFolder,
  ),

  // Tags
  makeTool(
    'list_tags',
    'List Tags',
    'List tags derived from document metadata.',
    workspaceSchema(),
    handleListTags,
  ),
  makeTool(
    'create_tag',
    'Create Tag',
    'Register a tag name for future use.',
    workspaceSchema(
      {
        name: {
          type: 'string',
          description: 'Tag identifier to create.',
        },
      },
      ['name'],
    ),
    handleCreateTag,
  ),
  makeTool(
    'delete_tag',
    'Delete Tag',
    'Remove a tag from all documents.',
    workspaceSchema(
      {
        tagId: {
          type: 'string',
          description: 'Tag identifier to delete.',
        },
      },
      ['tagId'],
    ),
    handleDeleteTag,
  ),

  // Notifications
  makeTool(
    'list_notifications',
    'List Notifications',
    'List recent AFFiNE notifications for the current user.',
    {
      type: 'object',
      properties: {
        first: {
          type: 'number',
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of notifications to fetch.',
        },
        unreadOnly: {
          type: 'boolean',
          description: 'Filter to unread notifications only.',
        },
      },
      additionalProperties: false,
    },
    handleListNotifications,
  ),
  makeTool(
    'read_notification',
    'Mark Notification Read',
    'Mark a notification as read.',
    {
      type: 'object',
      properties: {
        notificationId: {
          type: 'string',
          description: 'Notification identifier.',
        },
      },
      required: ['notificationId'],
      additionalProperties: false,
    },
    handleReadNotification,
  ),
  makeTool(
    'read_all_notifications',
    'Mark All Notifications Read',
    'Mark every notification as read.',
    EMPTY_SCHEMA,
    handleReadAllNotifications,
  ),

  // Access tokens
  makeTool(
    'list_access_tokens',
    'List Access Tokens',
    'List personal access tokens for the current user.',
    EMPTY_SCHEMA,
    handleListAccessTokens,
  ),
  makeTool(
    'create_access_token',
    'Create Access Token',
    'Generate a personal access token (returns the token string).',
    {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Friendly token name.',
        },
        expiresAt: {
          oneOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Optional ISO8601 expiration date.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handleCreateAccessToken,
  ),
  makeTool(
    'revoke_access_token',
    'Revoke Access Token',
    'Revoke a personal access token by identifier.',
    {
      type: 'object',
      properties: {
        tokenId: {
          type: 'string',
          description: 'Identifier of the token to revoke.',
        },
      },
      required: ['tokenId'],
      additionalProperties: false,
    },
    handleDeleteAccessToken,
  ),

  // Workspace meta
  makeTool(
    'update_workspace_meta',
    'Update Workspace Meta',
    'Update workspace metadata entry for a document.',
    workspaceSchema(
      {
        docId: {
          type: 'string',
          description: 'Document identifier to update.',
        },
        title: {
          type: 'string',
          description: 'Title to store in workspace metadata.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags to persist.',
        },
        timestamp: {
          type: 'number',
          description: 'Unix timestamp to use (defaults to now).',
        },
      },
      ['docId', 'title'],
    ),
    handleUpdateWorkspaceMeta,
  ),
];

const toolMap = new Map(toolDefinitions.map(tool => [tool.name, tool]));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions.map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const tool = toolMap.get(request.params.name);
  if (!tool) {
    return errorResult(`Unknown tool: ${request.params.name}`);
  }

  let args: Args;
  try {
    args = ensureObject(request.params.arguments);
  } catch (error) {
    console.error(`[${tool.name}] Invalid arguments:`, error);
    return errorResult(error);
  }

  try {
    return await tool.handler(args);
  } catch (error) {
    console.error(`[${tool.name}] Execution failed:`, error);
    return errorResult(error);
  }
});

export async function startMcpServer() {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (
    chunk: Buffer | string,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    let actualEncoding: BufferEncoding | undefined;
    let actualCallback: ((error?: Error | null) => void) | undefined;
    if (typeof encoding === 'function') {
      actualCallback = encoding;
    } else {
      actualEncoding = encoding;
      actualCallback = callback;
    }

    let stringChunk: string;
    if (typeof chunk === 'string') {
      stringChunk = chunk;
    } else {
      const enc = actualEncoding ?? 'utf8';
      stringChunk = chunk.toString(enc);
    }

    const trimmed = stringChunk.trim();
    const isJsonRpc =
      trimmed.length === 0 ||
      trimmed.startsWith('Content-Length:') ||
      trimmed.includes('"jsonrpc"');

    if (isJsonRpc) {
      return originalWrite(chunk, actualEncoding, actualCallback);
    }

    // Redirect any non-JSONRPC stdout emission to stderr to avoid breaking MCP clients.
    process.stderr.write(stringChunk);
    if (typeof actualCallback === 'function') {
      actualCallback();
    }
    return true;
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✓ MCP Server ready');
}
