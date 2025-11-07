import Fastify, { type FastifyInstance } from 'fastify';
import { AffineClient } from '../client/index.js';
import type { AffineClientOptions } from '../client/index.js';

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
  });
  const credentialProvider = config.credentialProvider ?? new EnvCredentialProvider();

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
  // Edgeless Mode Endpoints
  // ============================================================================

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

      let docs = [];
      let files = [];
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
      ? body.add.filter((value): value is string => typeof value === 'string' && value.trim().length)
      : [];
    const remove = Array.isArray(body.remove)
      ? body.remove.filter(
          (value): value is string => typeof value === 'string' && value.trim().length,
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
          .filter((value): value is string => typeof value === 'string' && value.trim().length)
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

  return app;
}
