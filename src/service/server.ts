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

  return app;
}
