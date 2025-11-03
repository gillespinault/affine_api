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
        await client.upsertDocProperties(workspaceId, {
          docId,
          timestamp,
          tags: body.tags,
        });

        reply.send({ docId, timestamp, updated: true });
      } finally {
        await client.disconnect();
      }
    },
  );

  return app;
}
