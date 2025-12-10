import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { AffineClient, type CopilotDocChunk, type CopilotFileChunk } from '../client/index.js';
import type { AffineClientOptions } from '../client/index.js';
import { registerKarakeepWebhook, type KarakeepWebhookConfig } from './webhooks/index.js';
import { registerWebSocketRoute } from './websocket.js';

type DocumentPayload = {
  title?: string;
  content?: string;
  markdown?: string;
  folderId?: string | null;
  folderNodeId?: string | null;
  docId?: string;
  tags?: string[];
  primaryMode?: 'page' | 'edgeless';
};

type CommentMode = 'page' | 'edgeless';

export interface CredentialProvider {
  getCredentials(workspaceId: string): Promise<{ email: string; password: string }>;
}

export class EnvCredentialProvider implements CredentialProvider {
  async getCredentials(): Promise<{ email: string; password: string }> {
    const email = process.env.AFFINE_EMAIL;
    const password = process.env.AFFINE_PASSWORD;
    if (!email || !password) {
      throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD must be set in the environment');
    }
    return { email, password };
  }
}

export interface ServerConfig {
  baseUrl?: string;
  credentialProvider?: CredentialProvider;
  clientOptions?: Pick<AffineClientOptions, 'fetchFn' | 'ioFactory' | 'timeoutMs'>;
  logger?: boolean;
  karakeepWebhook?: KarakeepWebhookConfig;
}

function createClient(config: ServerConfig) {
  const options: AffineClientOptions = {
    baseUrl: config.baseUrl,
    fetchFn: config.clientOptions?.fetchFn,
    ioFactory: config.clientOptions?.ioFactory,
    timeoutMs: config.clientOptions?.timeoutMs,
  };
  return new AffineClient(options);
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
  return tags;
}

function normalizeDocMode(value: unknown): CommentMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'page') {
    return 'page';
  }
  if (normalized === 'edgeless') {
    return 'edgeless';
  }
  return undefined;
}

function sanitizeMentions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const mentions = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  if (!mentions.length) {
    return [];
  }
  return Array.from(new Set(mentions));
}

function parseBooleanInput(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function decodeBase64Payload(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('content payload cannot be empty');
  }
  const base64 = trimmed.includes(';base64,')
    ? trimmed.slice(trimmed.indexOf(';base64,') + ';base64,'.length)
    : trimmed;
  return Buffer.from(base64, 'base64');
}

const MAX_EMBEDDING_FILE_BYTES = 10 * 1024 * 1024;

export function createServer(config: ServerConfig = {}): FastifyInstance {
  const app = Fastify({
    logger: config.logger ?? true,
    // Allow large base64 payloads for file uploads (base64 adds ~33% overhead)
    bodyLimit: 15 * 1024 * 1024, // 15MB to accommodate 10MB files in base64
  });
  const credentialProvider = config.credentialProvider ?? new EnvCredentialProvider();

  // Register WebSocket plugin and wait for it to be ready before registering WS routes
  // Using app.after() ensures the plugin is fully initialized
  app.register(fastifyWebsocket).after((err) => {
    if (err) {
      app.log.error({ err }, 'Failed to register @fastify/websocket');
      return;
    }

    // Register WebSocket route AFTER plugin is ready
    registerWebSocketRoute(app, {
      credentialProvider,
      baseUrl: config.baseUrl,
    });
    app.log.info('WebSocket route registered at GET /canvas (after plugin ready)');
  });

  app.get('/healthz', async (_request, reply) => {
    reply.send({ status: 'ok' });
  });

  app.post('/workspaces/:workspaceId/documents', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as DocumentPayload;

    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();

      const tags = normalizeTags(body.tags);
      const result = await client.createDocument(workspaceId, {
        title: body.title,
        content: body.content,
        markdown: body.markdown,
        folderId: body.folderId ?? null,
        folderNodeId: body.folderNodeId ?? null,
        docId: body.docId,
        tags: tags ?? undefined,
      });

      reply.code(201).send(result);
    } finally {
      await client.disconnect();
    }
  });

  app.get('/workspaces/:workspaceId/documents', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      const documents = await client.listDocuments(workspaceId);
      reply.send({ documents });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /recent-documents
   * Get recently updated documents across ALL workspaces, sorted by updatedDate descending.
   * Query params:
   *   - limit: max number of documents (default 10, max 50)
   *   - mode: filter by primaryMode ('edgeless' or 'page')
   * Returns: { documents: Array<DocumentSummary & {workspaceId, workspaceName}>, limit, mode, count }
   */
  app.get('/recent-documents', async (request, reply) => {
    const query = (request.query ?? {}) as { limit?: string; mode?: string };

    // Parse limit (default 10, max 50)
    let limit = 10;
    if (query.limit) {
      const parsed = Number.parseInt(query.limit, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 50);
      }
    }

    // Parse mode filter (optional, default to 'edgeless' for Boox client)
    const modeFilter = query.mode?.trim().toLowerCase();
    const validModes = ['edgeless', 'page'];
    const filterByMode = modeFilter && validModes.includes(modeFilter) ? modeFilter : null;

    const client = createClient(config);
    try {
      // Get credentials for first workspace (they're all the same user)
      const { email, password } = await credentialProvider.getCredentials('default');
      await client.signIn(email, password);
      await client.connectSocket();

      // Get all workspaces
      const workspaces = await client.listWorkspaces();

      // Collect documents from all workspaces
      const allDocuments: Array<{
        workspaceId: string;
        workspaceName: string | null;
        docId: string;
        title: string | null;
        createDate: number | null;
        updatedDate: number | null;
        tags: string[];
        folderId: string | null;
        folderNodeId: string | null;
        primaryMode?: 'page' | 'edgeless' | null;
      }> = [];

      for (const ws of workspaces) {
        try {
          const documents = await client.listDocuments(ws.id);
          for (const doc of documents) {
            allDocuments.push({
              ...doc,
              workspaceId: ws.id,
              workspaceName: ws.name ?? null,
            });
          }
        } catch (e) {
          // Skip workspaces that fail to load
          console.error(`Failed to load documents from workspace ${ws.id}:`, e);
        }
      }

      // Filter by mode if specified
      let filtered = filterByMode
        ? allDocuments.filter(d => d.primaryMode === filterByMode)
        : allDocuments;

      // Sort by updatedDate descending (most recent first)
      filtered.sort((a, b) => {
        const dateA = a.updatedDate ?? 0;
        const dateB = b.updatedDate ?? 0;
        return dateB - dateA;
      });

      // Apply limit
      const result = filtered.slice(0, limit);

      reply.send({
        limit,
        mode: filterByMode,
        count: result.length,
        totalWorkspaces: workspaces.length,
        documents: result,
      });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /workspaces/:workspaceId/recent-documents
   * Get recently updated documents, sorted by updatedDate descending.
   * Query params:
   *   - limit: max number of documents (default 10, max 50)
   *   - mode: filter by primaryMode ('edgeless' or 'page')
   * Returns: { documents: DocumentSummary[], workspaceId, limit, mode, count }
   */
  app.get('/workspaces/:workspaceId/recent-documents', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = (request.query ?? {}) as { limit?: string; mode?: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    // Parse limit (default 10, max 50)
    let limit = 10;
    if (query.limit) {
      const parsed = Number.parseInt(query.limit, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 50);
      }
    }

    // Parse mode filter (optional)
    const modeFilter = query.mode?.trim().toLowerCase();
    const validModes = ['edgeless', 'page'];
    const filterByMode = modeFilter && validModes.includes(modeFilter) ? modeFilter : null;

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();

      // Get all documents (now includes primaryMode from docProperties)
      const documents = await client.listDocuments(workspaceId);

      // Filter by mode if specified
      let filtered = filterByMode
        ? documents.filter(d => d.primaryMode === filterByMode)
        : documents;

      // Sort by updatedDate descending (most recent first)
      // Documents without updatedDate go to the end
      filtered.sort((a, b) => {
        const dateA = a.updatedDate ?? 0;
        const dateB = b.updatedDate ?? 0;
        return dateB - dateA;
      });

      // Apply limit
      const result = filtered.slice(0, limit);

      reply.send({
        workspaceId,
        limit,
        mode: filterByMode,
        count: result.length,
        documents: result,
      });
    } finally {
      await client.disconnect();
    }
  });

  app.get('/workspaces/:workspaceId/documents/:docId', async (request, reply) => {
    const { workspaceId, docId } = request.params as { workspaceId: string; docId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      const snapshot = await client.getDocument(workspaceId, docId);
      reply.send(snapshot);
    } finally {
      await client.disconnect();
    }
  });

  app.get(
    '/workspaces/:workspaceId/documents/:docId/content',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();
        const content = await client.getDocumentContent(workspaceId, docId);
        reply.send(content);
      } finally {
        await client.disconnect();
      }
    },
  );

  app.get(
    '/workspaces/:workspaceId/documents/:docId/history',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const { limit, before } = request.query as { limit?: string; before?: string };
      const parsedLimit =
        typeof limit === 'string' && limit.length ? Number.parseInt(limit, 10) : undefined;

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const entries = await client.listDocumentHistory(workspaceId, docId, {
          limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
          before: before?.trim() || undefined,
        });

        reply.send({
          workspaceId,
          docId,
          count: entries.length,
          entries,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents/:docId/history/recover',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as { timestamp?: string };
      const timestamp = body.timestamp?.trim();
      if (!timestamp) {
        reply.code(400).send({ error: 'timestamp is required (ISO 8601)' });
        return;
      }

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const recovered = await client.recoverDocumentVersion(workspaceId, docId, timestamp);
        reply.send({
          workspaceId,
          docId,
          timestamp,
          recovered,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents/:docId/blocks',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as {
        flavour: string;
        parentBlockId: string;
        props?: Record<string, unknown>;
        position?: 'start' | 'end' | number;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      if (!body.flavour || !body.parentBlockId) {
        reply.code(400).send({ error: 'flavour and parentBlockId are required' });
        return;
      }

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();

        const result = await client.addBlock(workspaceId, docId, {
          flavour: body.flavour,
          parentBlockId: body.parentBlockId,
          props: body.props,
          position: body.position,
        });

        reply.code(201).send(result);
      } finally {
        await client.disconnect();
      }
    },
  );

  app.patch(
    '/workspaces/:workspaceId/documents/:docId/blocks/:blockId',
    async (request, reply) => {
      const { workspaceId, docId, blockId } = request.params as {
        workspaceId: string;
        docId: string;
        blockId: string;
      };
      const body = (request.body ?? {}) as {
        props: Record<string, unknown>;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      if (!body.props || Object.keys(body.props).length === 0) {
        reply.code(400).send({ error: 'props object is required and cannot be empty' });
        return;
      }

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();

        const result = await client.updateBlock(workspaceId, docId, blockId, body.props);

        reply.send(result);
      } finally {
        await client.disconnect();
      }
    },
  );

  app.delete(
    '/workspaces/:workspaceId/documents/:docId/blocks/:blockId',
    async (request, reply) => {
      const { workspaceId, docId, blockId } = request.params as {
        workspaceId: string;
        docId: string;
        blockId: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();

        const result = await client.deleteBlock(workspaceId, docId, blockId);

        reply.code(200).send(result);
      } finally {
        await client.disconnect();
      }
    },
  );

  // ============================================================================
  // Blob & Image Endpoints
  // ============================================================================

  /**
   * List all blobs in a workspace.
   * GET /workspaces/:workspaceId/blobs
   * Returns: { blobs: Array<{ key, mime, size, createdAt }> }
   */
  app.get('/workspaces/:workspaceId/blobs', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const blobs = await client.listBlobs(workspaceId);
      reply.send({ blobs, workspaceId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * Download a blob from workspace storage.
   * GET /workspaces/:workspaceId/blobs/:blobKey
   * Query params: format=base64 (optional, default returns binary)
   * Returns: binary data or { content: base64, mime, size }
   */
  app.get('/workspaces/:workspaceId/blobs/:blobKey', async (request, reply) => {
    const { workspaceId, blobKey } = request.params as {
      workspaceId: string;
      blobKey: string;
    };
    const query = (request.query ?? {}) as { format?: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const blob = await client.getBlob(workspaceId, blobKey);

      if (query.format === 'base64') {
        // Return as JSON with base64 content
        reply.send({
          content: blob.content.toString('base64'),
          mime: blob.mime,
          size: blob.size,
          key: blobKey,
        });
      } else {
        // Return binary with proper content type
        reply
          .header('content-type', blob.mime)
          .header('content-length', blob.size)
          .header('cache-control', 'public, max-age=2592000, immutable')
          .send(blob.content);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404') || message.includes('not found')) {
        reply.code(404).send({ error: 'Blob not found' });
      } else {
        reply.code(500).send({ error: message });
      }
    } finally {
      await client.disconnect();
    }
  });

  /**
   * Upload a blob to workspace storage.
   * POST /workspaces/:workspaceId/blobs
   * Body: { fileName: string, content: string (base64), mimeType?: string }
   * Returns: { blobId: string }
   */
  app.post('/workspaces/:workspaceId/blobs', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as {
      fileName?: string;
      content?: string;
      mimeType?: string;
    };

    const fileName = body.fileName?.trim();
    if (!fileName) {
      reply.code(400).send({ error: 'fileName is required' });
      return;
    }

    if (typeof body.content !== 'string') {
      reply.code(400).send({ error: 'content (base64) is required' });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = decodeBase64Payload(body.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid base64 payload';
      reply.code(400).send({ error: message });
      return;
    }

    if (buffer.length > MAX_EMBEDDING_FILE_BYTES) {
      reply.code(413).send({
        error: `file too large: max ${MAX_EMBEDDING_FILE_BYTES} bytes`,
      });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const blobId = await client.uploadBlob(workspaceId, {
        fileName,
        content: buffer,
        mimeType: body.mimeType,
      });
      reply.code(201).send({ blobId, workspaceId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * Upload an image and add it as an image block to a document.
   * POST /workspaces/:workspaceId/documents/:docId/images
   * Body: {
   *   parentBlockId: string,
   *   fileName: string,
   *   content: string (base64),
   *   mimeType?: string,
   *   caption?: string,
   *   width?: number,
   *   height?: number,
   *   position?: 'start' | 'end' | number
   * }
   * Returns: { blockId: string, blobId: string }
   */
  app.post(
    '/workspaces/:workspaceId/documents/:docId/images',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as {
        parentBlockId?: string;
        fileName?: string;
        content?: string;
        mimeType?: string;
        caption?: string;
        width?: number;
        height?: number;
        position?: 'start' | 'end' | number;
      };

      // Validate required fields
      if (!body.parentBlockId?.trim()) {
        reply.code(400).send({ error: 'parentBlockId is required' });
        return;
      }
      const fileName = body.fileName?.trim();
      if (!fileName) {
        reply.code(400).send({ error: 'fileName is required' });
        return;
      }
      if (typeof body.content !== 'string') {
        reply.code(400).send({ error: 'content (base64) is required' });
        return;
      }

      let buffer: Buffer;
      try {
        buffer = decodeBase64Payload(body.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid base64 payload';
        reply.code(400).send({ error: message });
        return;
      }

      if (buffer.length > MAX_EMBEDDING_FILE_BYTES) {
        reply.code(413).send({
          error: `file too large: max ${MAX_EMBEDDING_FILE_BYTES} bytes`,
        });
        return;
      }

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        await client.connectSocket();

        const result = await client.addImageBlock(workspaceId, docId, {
          parentBlockId: body.parentBlockId.trim(),
          image: {
            fileName,
            content: buffer,
            mimeType: body.mimeType,
          },
          caption: body.caption,
          width: body.width,
          height: body.height,
          position: body.position,
        });

        reply.code(201).send({
          blockId: result.blockId,
          blobId: result.blobId,
          workspaceId,
          docId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.patch('/workspaces/:workspaceId/documents/:docId', async (request, reply) => {
    const { workspaceId, docId } = request.params as { workspaceId: string; docId: string };
    const body = (request.body ?? {}) as DocumentPayload;
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();

      const tags = normalizeTags(body.tags);
      const result = await client.updateDocument(workspaceId, docId, {
        title: body.title,
        content: body.content,
        markdown: body.markdown,
        folderId: body.folderId,
        folderNodeId: body.folderNodeId,
        tags,
        primaryMode: body.primaryMode,
      });

      reply.send(result);
    } finally {
      await client.disconnect();
    }
  });

  app.delete('/workspaces/:workspaceId/documents/:docId', async (request, reply) => {
    const { workspaceId, docId } = request.params as { workspaceId: string; docId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      await client.deleteDocument(workspaceId, docId);
      reply.code(204).send();
    } finally {
      await client.disconnect();
    }
  });

  app.post('/workspaces/:workspaceId/folders', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as { name?: string; parentId?: string | null };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(workspaceId);

      const result = await client.createFolder(workspaceId, {
        name: body.name ?? 'New folder',
        parentId: body.parentId ?? null,
      });

      reply.code(201).send(result);
    } finally {
      await client.disconnect();
    }
  });

  app.post(
    '/workspaces/:workspaceId/documents/:docId/move',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as {
        folderId?: string | null;
        folderNodeId?: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();
        await client.joinWorkspace(workspaceId);

        const result = await client.registerDocInFolder(workspaceId, {
          parentFolderId: body.folderId ?? null,
          docId,
          nodeId: body.folderNodeId,
        });

        reply.send(result);
      } finally {
        await client.disconnect();
      }
    },
  );

  // ============================================================================
  // Collaboration: Comments
  // ============================================================================

  app.get(
    '/workspaces/:workspaceId/documents/:docId/comments',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const { first, offset, after } = request.query as {
        first?: string;
        offset?: string;
        after?: string;
      };

      const limit = first ? Number.parseInt(first, 10) : undefined;
      const skip = offset ? Number.parseInt(offset, 10) : undefined;
      const cursor =
        typeof after === 'string' && after.trim().length > 0 ? after.trim() : undefined;

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const result = await client.listComments(workspaceId, docId, {
          first: Number.isFinite(limit) ? limit : undefined,
          offset: Number.isFinite(skip) ? skip : undefined,
          after: cursor,
        });
        reply.send({
          workspaceId,
          docId,
          totalCount: result.totalCount,
          pageInfo: result.pageInfo,
          comments: result.comments,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents/:docId/comments',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as {
        content?: unknown;
        docTitle?: string;
        docMode?: string;
        mentions?: unknown;
      };

      if (body.content === undefined) {
        reply.code(400).send({ error: 'content is required' });
        return;
      }

      if (body.mentions !== undefined && !Array.isArray(body.mentions)) {
        reply.code(400).send({ error: 'mentions must be an array of user IDs' });
        return;
      }

      const docTitle = typeof body.docTitle === 'string' ? body.docTitle : undefined;
      const docMode = normalizeDocMode(body.docMode);
      if (body.docMode !== undefined && !docMode) {
        reply.code(400).send({ error: 'docMode must be either "page" or "edgeless"' });
        return;
      }
      const mentions = sanitizeMentions(body.mentions);

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const comment = await client.createComment(workspaceId, {
          docId,
          content: body.content,
          docTitle,
          docMode,
          mentions: mentions && mentions.length > 0 ? mentions : undefined,
        });
        reply.code(201).send(comment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.patch(
    '/workspaces/:workspaceId/documents/:docId/comments/:commentId',
    async (request, reply) => {
      const { workspaceId, commentId } = request.params as {
        workspaceId: string;
        docId: string;
        commentId: string;
      };
      const body = (request.body ?? {}) as { content?: unknown };

      if (body.content === undefined) {
        reply.code(400).send({ error: 'content is required' });
        return;
      }

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const updated = await client.updateComment(commentId, body.content);
        if (!updated) {
          reply.code(404).send({ error: 'comment not found' });
          return;
        }

        reply.send({ id: commentId, updated: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.delete(
    '/workspaces/:workspaceId/documents/:docId/comments/:commentId',
    async (request, reply) => {
      const { workspaceId, commentId } = request.params as {
        workspaceId: string;
        docId: string;
        commentId: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const deleted = await client.deleteComment(commentId);
        if (!deleted) {
          reply.code(404).send({ error: 'comment not found' });
          return;
        }
        reply.code(204).send();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents/:docId/comments/:commentId/resolve',
    async (request, reply) => {
      const { workspaceId, commentId } = request.params as {
        workspaceId: string;
        docId: string;
        commentId: string;
      };
      const body = (request.body ?? {}) as { resolved?: unknown };
      const resolvedInput =
        body.resolved === undefined ? true : parseBooleanInput(body.resolved);
      if (resolvedInput === undefined) {
        reply.code(400).send({ error: 'resolved must be a boolean' });
        return;
      }

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const outcome = await client.resolveComment(commentId, resolvedInput);
        if (!outcome) {
          reply.code(404).send({ error: 'comment not found' });
          return;
        }
        reply.send({ id: commentId, resolved: resolvedInput });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents/:docId/publish',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as { mode?: string };
      const normalizedMode =
        body.mode === undefined ? undefined : normalizeDocMode(body.mode);
      if (body.mode !== undefined && !normalizedMode) {
        reply.code(400).send({ error: 'mode must be either "page" or "edgeless"' });
        return;
      }

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const result = await client.publishDocument(workspaceId, docId, {
          mode: normalizedMode,
        });
        reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents/:docId/revoke',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        const result = await client.revokeDocumentPublication(workspaceId, docId);
        reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  // ============================================================================
  // Workspace Navigation Endpoints
  // ============================================================================

  /**
   * GET /workspaces
   * List all accessible workspaces with names and metadata
   */
  app.get('/workspaces', async (request, reply) => {
    const client = createClient(config);
    try {
      // Sign in with default credentials (assumes shared access)
      const { email, password } = await credentialProvider.getCredentials('default');
      await client.signIn(email, password);
      await client.connectSocket();

      const workspaces = await client.listWorkspaces();
      reply.send({ workspaces });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /workspaces/:id
   * Get detailed information about a specific workspace
   */
  app.get('/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = createClient(config);

    try {
      const { email, password } = await credentialProvider.getCredentials(id);
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(id);

      const workspace = await client.getWorkspaceDetails(id);
      reply.send(workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /workspaces/:id/folders
   * Get complete folder tree hierarchy for a workspace
   */
  app.get('/workspaces/:id/folders', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = createClient(config);

    try {
      const { email, password } = await credentialProvider.getCredentials(id);
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(id);

      const tree = await client.getFolderTree(id);
      reply.send({ workspaceId: id, folders: tree });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /workspaces/:id/hierarchy
   * Get complete workspace hierarchy including folders, documents, and subdocuments
   */
  app.get('/workspaces/:id/hierarchy', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = createClient(config);

    try {
      const { email, password } = await credentialProvider.getCredentials(id);
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(id);

      const hierarchy = await client.getHierarchy(id);
      reply.send({ workspaceId: id, hierarchy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /workspaces/:id/debug/folders-nodes
   * DEBUG: Dump all nodes from db$workspace$folders
   */
  app.get('/workspaces/:id/debug/folders-nodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = createClient(config);

    try {
      const { email, password } = await credentialProvider.getCredentials(id);
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(id);

      const foldersId = `db$${id}$folders`;
      const { doc } = await client.loadWorkspaceDoc(id, foldersId);

      const nodes: any[] = [];
      doc.share.forEach((_, nodeId) => {
        const nodeMap = doc.getMap(nodeId);
        if (!nodeMap || nodeMap.size === 0) {
          nodes.push({ nodeId, empty: true });
          return;
        }

        nodes.push({
          nodeId,
          type: nodeMap.get('type'),
          data: nodeMap.get('data'),
          parentId: nodeMap.get('parentId') || null,
          index: nodeMap.get('index'),
        });
      });

      reply.send({ workspaceId: id, totalNodes: nodes.length, nodes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * GET /workspaces/:workspaceId/folders/:folderId
   * Get contents of a specific folder
   */
  app.get('/workspaces/:workspaceId/folders/:folderId', async (request, reply) => {
    const { workspaceId, folderId } = request.params as {
      workspaceId: string;
      folderId: string;
    };
    const client = createClient(config);

    try {
      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(workspaceId);

      const contents = await client.getFolderContents(workspaceId, folderId);
      reply.send(contents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not found')) {
        reply.code(404).send({ error: message });
      } else {
        reply.code(500).send({ error: message });
      }
    } finally {
      await client.disconnect();
    }
  });

  app.patch('/workspaces/:workspaceId/meta', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as {
      docId: string;
      title: string;
      timestamp?: number;
      tags?: string[];
    };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    if (!body.docId || !body.title) {
      reply.code(400).send({ error: 'docId and title are required' });
      return;
    }

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(workspaceId);

      await client.updateWorkspaceMeta(workspaceId, {
        docId: body.docId,
        title: body.title,
        timestamp: body.timestamp ?? Date.now(),
        tags: body.tags,
      });

      reply.send({ workspaceId, updated: true });
    } finally {
      await client.disconnect();
    }
  });

  app.patch(
    '/workspaces/:workspaceId/documents/:docId/properties',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as {
        tags?: string[];
        customProperties?: Record<string, string | number | boolean | null>;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();
        await client.joinWorkspace(workspaceId);

        const timestamp = Date.now();

        // Get current document to retrieve title
        const docSnapshot = await client.getDocument(workspaceId, docId);

        // Update both docProperties AND workspace meta for tags to be visible in UI
        await Promise.all([
          client.upsertDocProperties(workspaceId, {
            docId,
            timestamp,
            tags: body.tags,
            customProperties: body.customProperties,
          }),
          client.updateWorkspaceMeta(workspaceId, {
            docId,
            title: docSnapshot.title || 'Untitled',
            timestamp,
            tags: body.tags,
          }),
        ]);

        reply.send({ docId, timestamp, updated: true });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.get('/workspaces/:workspaceId/tags', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      const tags = await client.listTags(workspaceId);
      reply.send({ tags });
    } finally {
      await client.disconnect();
    }
  });

  app.post('/workspaces/:workspaceId/tags', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as { name: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    if (!body.name || body.name.trim().length === 0) {
      reply.code(400).send({ error: 'Tag name is required and cannot be empty' });
      return;
    }

    const client = createClient(config);
    try {
      await client.signIn(email, password);

      // Check if tag already exists
      const existingTags = await client.listTags(workspaceId);
      const tagExists = existingTags.some(t => t.id === body.name.trim());

      if (tagExists) {
        reply.code(409).send({ error: 'Tag already exists', tagId: body.name.trim() });
        return;
      }

      // Tag is created simply by using it (no separate storage)
      const tagId = body.name.trim();
      reply.code(201).send({
        id: tagId,
        name: tagId,
        count: 0,
      });
    } finally {
      await client.disconnect();
    }
  });

  app.delete('/workspaces/:workspaceId/tags/:tagId', async (request, reply) => {
    const { workspaceId, tagId } = request.params as { workspaceId: string; tagId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      const result = await client.deleteTag(workspaceId, tagId);

      if (!result.deleted) {
        reply.code(404).send({ error: 'Tag not found or not used by any document' });
        return;
      }

      reply.send({
        tagId,
        deleted: true,
        documentsUpdated: result.documentsUpdated,
      });
    } finally {
      await client.disconnect();
    }
  });

  // ============================================================================
  // Custom Properties (Document Info Panel)
  // ============================================================================

  /**
   * GET /workspaces/:workspaceId/custom-properties
   * List all custom property definitions for the workspace.
   * Returns: { properties: Array<{ id, type, name, icon?, show, index }> }
   */
  app.get('/workspaces/:workspaceId/custom-properties', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(workspaceId);

      const properties = await client.listDocCustomPropertyInfo(workspaceId);
      reply.send({ workspaceId, properties });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  /**
   * POST /workspaces/:workspaceId/custom-properties
   * Create or update a custom property definition for the workspace.
   * Body: { id: string, type: 'text'|'number'|'date'|'checkbox', name: string, icon?: string, show?: 'always-show'|'always-hide'|'hide-when-empty' }
   * Returns: { id, type, name, show }
   */
  app.post('/workspaces/:workspaceId/custom-properties', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as {
      id?: string;
      type?: string;
      name?: string;
      icon?: string;
      show?: string;
    };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    // Validate required fields
    if (!body.id || !body.id.trim()) {
      reply.code(400).send({ error: 'id is required' });
      return;
    }
    if (!body.type || !['text', 'number', 'date', 'checkbox'].includes(body.type)) {
      reply.code(400).send({ error: 'type must be one of: text, number, date, checkbox' });
      return;
    }
    if (!body.name || !body.name.trim()) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }
    const showValue = body.show ?? 'always-show';
    if (!['always-show', 'always-hide', 'hide-when-empty'].includes(showValue)) {
      reply.code(400).send({ error: 'show must be one of: always-show, always-hide, hide-when-empty' });
      return;
    }

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      await client.joinWorkspace(workspaceId);

      const result = await client.upsertDocCustomPropertyInfo(workspaceId, {
        id: body.id.trim(),
        type: body.type as 'text' | 'number' | 'date' | 'checkbox',
        name: body.name.trim(),
        icon: body.icon,
        show: showValue as 'always-show' | 'always-hide' | 'hide-when-empty',
      });

      reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  // ============================================================================
  // Notifications
  // ============================================================================

  app.get('/notifications', async (request, reply) => {
    const { first, unreadOnly } = request.query as {
      first?: string;
      unreadOnly?: string;
    };

    const limit = first ? Number.parseInt(first, 10) : undefined;
    const unreadFlag =
      unreadOnly !== undefined ? parseBooleanInput(unreadOnly) : undefined;
    if (unreadOnly !== undefined && unreadFlag === undefined) {
      reply.code(400).send({ error: 'unreadOnly must be a boolean' });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials('default');
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const notifications = await client.listNotifications({
        first: Number.isFinite(limit) ? limit : undefined,
        unreadOnly: unreadFlag,
      });
      reply.send(notifications);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.post('/notifications/:notificationId/read', async (request, reply) => {
    const { notificationId } = request.params as { notificationId: string };
    const id = notificationId?.trim();
    if (!id) {
      reply.code(400).send({ error: 'notificationId is required' });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials('default');
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const updated = await client.markNotificationRead(id);
      if (!updated) {
        reply.code(404).send({ error: 'notification not found' });
        return;
      }
      reply.send({ notificationId: id, read: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.post('/notifications/read-all', async (_request, reply) => {
    const { email, password } = await credentialProvider.getCredentials('default');
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const updated = await client.markAllNotificationsRead();
      reply.send({ updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  // ============================================================================
  // Personal Access Tokens
  // ============================================================================

  app.get('/users/me/tokens', async (_request, reply) => {
    const { email, password } = await credentialProvider.getCredentials('default');
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const tokens = await client.listAccessTokens();
      reply.send({ count: tokens.length, tokens });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.post('/users/me/tokens', async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: string;
      expiresAt?: string | null;
    };
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }
    const trimmedName = body.name.trim();

    let expiresAt: string | null | undefined;
    if (body.expiresAt === null) {
      expiresAt = null;
    } else if (body.expiresAt === undefined) {
      expiresAt = undefined;
    } else if (typeof body.expiresAt === 'string') {
      const trimmed = body.expiresAt.trim();
      if (!trimmed) {
        reply.code(400).send({ error: 'expiresAt cannot be empty' });
        return;
      }
      expiresAt = trimmed;
    } else {
      reply.code(400).send({ error: 'expiresAt must be a string or null' });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials('default');
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const token = await client.createAccessToken({
        name: trimmedName,
        expiresAt,
      });
      reply.code(201).send(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.delete('/users/me/tokens/:tokenId', async (request, reply) => {
    const { tokenId } = request.params as { tokenId: string };
    const id = tokenId?.trim();
    if (!id) {
      reply.code(400).send({ error: 'tokenId is required' });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials('default');
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const revoked = await client.revokeAccessToken(id);
      if (!revoked) {
        reply.code(404).send({ error: 'token not found' });
        return;
      }
      reply.code(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  // ============================================================================
  // Edgeless Mode Endpoints
  // ============================================================================

  /**
   * POST /workspaces/:workspaceId/documents/:docId/edgeless/brush
   * Add a brush stroke to the document.
   * Body: { points: [[x,y,pressure?],...], color?: string, lineWidth?: number }
   * Returns: { id, type, xywh, points, color, lineWidth, index }
   */
  app.post(
    '/workspaces/:workspaceId/documents/:docId/edgeless/brush',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as {
        points?: unknown;
        color?: string;
        lineWidth?: number;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      // Validate points
      if (!Array.isArray(body.points) || body.points.length === 0) {
        reply.code(400).send({ error: 'points array is required and cannot be empty' });
        return;
      }

      // Validate each point
      const points: number[][] = [];
      for (const pt of body.points) {
        if (!Array.isArray(pt) || pt.length < 2) {
          reply.code(400).send({
            error: 'each point must be an array of at least 2 numbers [x,y] or [x,y,pressure]',
          });
          return;
        }
        const [x, y, pressure] = pt;
        if (typeof x !== 'number' || typeof y !== 'number') {
          reply.code(400).send({ error: 'point coordinates must be numbers' });
          return;
        }
        if (pressure !== undefined && typeof pressure !== 'number') {
          reply.code(400).send({ error: 'pressure must be a number' });
          return;
        }
        points.push(pressure !== undefined ? [x, y, pressure] : [x, y]);
      }

      // Calculate bounding box from points
      const xs = points.map(p => p[0]);
      const ys = points.map(p => p[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const w = maxX - minX;
      const h = maxY - minY;

      // Convert points to relative coordinates (relative to bounding box)
      const lineWidth = body.lineWidth ?? 4;
      const relativePoints = points.map(([x, y, pressure]) => {
        const relX = x - minX;
        const relY = y - minY;
        return pressure !== undefined ? [relX, relY, pressure] : [relX, relY];
      });

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();

        const element = await client.addEdgelessElement(workspaceId, docId, {
          type: 'brush',
          xywh: [minX, minY, w, h],
          points: relativePoints,
          color: body.color ?? '--affine-palette-line-black',
          lineWidth,
        });

        reply.code(201).send(element);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  app.get('/workspaces/:workspaceId/documents/:docId/edgeless', async (request, reply) => {
    const { workspaceId, docId } = request.params as { workspaceId: string; docId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);

    const client = createClient(config);
    try {
      await client.signIn(email, password);
      await client.connectSocket();
      const elements = await client.getEdgelessElements(workspaceId, docId);

      reply.send({
        docId,
        elements,
        count: elements.length,
      });
    } finally {
      await client.disconnect();
    }
  });

  app.post(
    '/workspaces/:workspaceId/documents/:docId/edgeless/elements',
    async (request, reply) => {
      const { workspaceId, docId } = request.params as {
        workspaceId: string;
        docId: string;
      };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      if (!body.type) {
        reply.code(400).send({ error: 'Element type is required' });
        return;
      }

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();
        const element = await client.addEdgelessElement(workspaceId, docId, body);

        reply.code(201).send(element);
      } finally {
        await client.disconnect();
      }
    },
  );

  app.get(
    '/workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId',
    async (request, reply) => {
      const { workspaceId, docId, elementId } = request.params as {
        workspaceId: string;
        docId: string;
        elementId: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        const elements = await client.getEdgelessElements(workspaceId, docId);
        const element = elements.find((el) => el.id === elementId);

        if (!element) {
          reply.code(404).send({ error: 'Element not found' });
          return;
        }

        reply.send(element);
      } finally {
        await client.disconnect();
      }
    },
  );

  app.patch(
    '/workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId',
    async (request, reply) => {
      const { workspaceId, docId, elementId } = request.params as {
        workspaceId: string;
        docId: string;
        elementId: string;
      };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      if (!body || Object.keys(body).length === 0) {
        reply.code(400).send({ error: 'Update data is required' });
        return;
      }

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();
        const element = await client.updateEdgelessElement(workspaceId, docId, elementId, body);

        reply.send(element);
      } finally {
        await client.disconnect();
      }
    },
  );

  app.delete(
    '/workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId',
    async (request, reply) => {
      const { workspaceId, docId, elementId } = request.params as {
        workspaceId: string;
        docId: string;
        elementId: string;
      };
      const { email, password } = await credentialProvider.getCredentials(workspaceId);

      const client = createClient(config);
      try {
        await client.signIn(email, password);
        await client.connectSocket();
        const result = await client.deleteEdgelessElement(workspaceId, docId, elementId);

        reply.code(200).send(result);
      } finally {
        await client.disconnect();
      }
    },
  );

  // ============================================================================
  // Copilot / Embeddings API
  // ============================================================================

  app.post('/workspaces/:workspaceId/copilot/search', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as {
      query?: string;
      scope?: 'docs' | 'files' | 'all';
      limit?: number;
      threshold?: number;
      scopedThreshold?: number;
      contextId?: string;
    };

    const query = body.query?.trim();
    if (!query) {
      reply.code(400).send({ error: 'query is required' });
      return;
    }

    const scope = (body.scope ?? 'all').toLowerCase();
    if (!['docs', 'files', 'all'].includes(scope)) {
      reply.code(400).send({ error: 'scope must be one of docs, files, all' });
      return;
    }

    const options = {
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      threshold: typeof body.threshold === 'number' ? body.threshold : undefined,
      scopedThreshold:
        typeof body.scopedThreshold === 'number' ? body.scopedThreshold : undefined,
      contextId:
        typeof body.contextId === 'string' && body.contextId.trim().length > 0
          ? body.contextId.trim()
          : undefined,
    };

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);

      let docs: CopilotDocChunk[] = [];
      let files: CopilotFileChunk[] = [];
      if (scope === 'docs' || scope === 'all') {
        docs = await client.matchWorkspaceDocs(workspaceId, query, options);
      }
      if (scope === 'files' || scope === 'all') {
        files = await client.matchWorkspaceFiles(workspaceId, query, options);
      }

      reply.send({
        workspaceId,
        query,
        scope,
        limit: options.limit ?? null,
        threshold: options.threshold ?? null,
        scopedThreshold: options.scopedThreshold ?? null,
        contextId: options.contextId ?? null,
        docCount: docs.length,
        fileCount: files.length,
        docs,
        files,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.get('/workspaces/:workspaceId/copilot/status', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const status = await client.queryWorkspaceEmbeddingStatus(workspaceId);
      reply.send({ workspaceId, ...status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.get('/workspaces/:workspaceId/copilot/ignored-docs', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { first, offset } = request.query as {
      first?: string;
      offset?: string;
    };
    const limit = first ? Number.parseInt(first, 10) : undefined;
    const skip = offset ? Number.parseInt(offset, 10) : undefined;

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const data = await client.listWorkspaceIgnoredDocs(workspaceId, {
        first: limit,
        offset: skip,
      });
      reply.send({ workspaceId, ...data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.patch('/workspaces/:workspaceId/copilot/ignored-docs', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as { add?: unknown; remove?: unknown };

    const add = Array.isArray(body.add)
      ? body.add.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        )
      : [];
    const remove = Array.isArray(body.remove)
      ? body.remove.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        )
      : [];

    if (!add.length && !remove.length) {
      reply
        .code(400)
        .send({ error: 'provide at least one docId to add or remove from ignored docs' });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const updated = await client.updateWorkspaceIgnoredDocs(workspaceId, {
        add: add.length ? add : undefined,
        remove: remove.length ? remove : undefined,
      });
      reply.send({ workspaceId, updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.post('/workspaces/:workspaceId/copilot/queue', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as { docIds?: unknown };

    const docIds = Array.isArray(body.docIds)
      ? body.docIds
          .filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
          .map(value => value.trim())
      : [];

    if (!docIds.length) {
      reply.code(400).send({ error: 'docIds array with at least one entry is required' });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      await client.queueWorkspaceEmbedding(workspaceId, docIds);
      reply.send({ workspaceId, queued: docIds });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.get('/workspaces/:workspaceId/copilot/files', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { first, offset } = request.query as {
      first?: string;
      offset?: string;
    };
    const limit = first ? Number.parseInt(first, 10) : undefined;
    const skip = offset ? Number.parseInt(offset, 10) : undefined;

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const data = await client.listWorkspaceEmbeddingFiles(workspaceId, {
        first: limit,
        offset: skip,
      });
      reply.send({ workspaceId, ...data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.post('/workspaces/:workspaceId/copilot/files', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const body = (request.body ?? {}) as {
      fileName?: string;
      content?: string;
      contentBase64?: string;
      mimeType?: string;
    };

    const fileName = body.fileName?.trim();
    if (!fileName) {
      reply.code(400).send({ error: 'fileName is required' });
      return;
    }

    const payload = body.content ?? body.contentBase64;
    if (typeof payload !== 'string') {
      reply.code(400).send({ error: 'content (base64) is required' });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = decodeBase64Payload(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid base64 payload';
      reply.code(400).send({ error: message });
      return;
    }

    if (buffer.length > MAX_EMBEDDING_FILE_BYTES) {
      reply.code(413).send({
        error: `file too large: max ${MAX_EMBEDDING_FILE_BYTES} bytes`,
      });
      return;
    }

    const { email, password } = await credentialProvider.getCredentials(workspaceId);
    const client = createClient(config);

    try {
      await client.signIn(email, password);
      const file = await client.addWorkspaceEmbeddingFile(workspaceId, {
        fileName,
        content: buffer,
        mimeType: body.mimeType,
      });
      reply.code(201).send(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.code(500).send({ error: message });
    } finally {
      await client.disconnect();
    }
  });

  app.delete(
    '/workspaces/:workspaceId/copilot/files/:fileId',
    async (request, reply) => {
      const { workspaceId, fileId } = request.params as {
        workspaceId: string;
        fileId: string;
      };
      if (!fileId || !fileId.trim()) {
        reply.code(400).send({ error: 'fileId is required' });
        return;
      }

      const { email, password } = await credentialProvider.getCredentials(workspaceId);
      const client = createClient(config);

      try {
        await client.signIn(email, password);
        await client.removeWorkspaceEmbeddingFile(workspaceId, fileId);
        reply.code(204).send();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.code(500).send({ error: message });
      } finally {
        await client.disconnect();
      }
    },
  );

  // ============================================================================
  // Karakeep Webhook Integration
  // ============================================================================

  if (config.karakeepWebhook) {
    registerKarakeepWebhook(app, config.karakeepWebhook);
    app.log.info('Karakeep webhook registered at /webhooks/karakeep');
  }

  // WebSocket route is registered in the .after() callback of fastifyWebsocket plugin
  // This ensures the plugin is fully initialized before route registration

  return app;
}
