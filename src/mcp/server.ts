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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✓ MCP Server ready');

  // Wait until the client closes the transport or an error occurs.
  await new Promise<void>(resolve => {
    const previousOnClose = transport.onclose;
    const previousOnError = transport.onerror;

    transport.onclose = () => {
      previousOnClose?.();
      resolve();
    };

    transport.onerror = error => {
      previousOnError?.(error);
      console.error('Transport error:', error);
      resolve();
    };
  });
}
