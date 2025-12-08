import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AffineClient, createDocYStructure } from '../../src/client';

type EmitPayload = { event: string; payload: unknown };

type EmitSpy = (event: string, payload: unknown, timeout?: number) => Promise<unknown>;

function createMockFetch({ userId }: { userId: string }) {
  return async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: () => null,
      getSetCookie: () => [
        `affine_session=s%3Aintegration.session.token; Path=/`,
        `affine_user_id=${userId}; Path=/`,
      ],
    },
    text: async () => '',
  });
}

function interceptEmits(client: AffineClient) {
  const joinPayloads: EmitPayload['payload'][] = [];
  const loadPayloads: Array<{ spaceId: string; docId: string }> = [];
  const pushPayloads: Array<{ spaceId: string; docId: string; update: string }> = [];

  vi
    .spyOn(client as unknown as { emitWithAck: EmitSpy }, 'emitWithAck')
    .mockImplementation(async (event, payload) => {
      switch (event) {
        case 'space:join': {
          joinPayloads.push(payload);
          return {};
        }
        case 'space:load-doc': {
          loadPayloads.push(payload as { spaceId: string; docId: string });
          return {};
        }
        case 'space:push-doc-update': {
          pushPayloads.push(
            payload as {
              spaceId: string;
              docId: string;
              update: string;
            },
          );
          return {};
        }
        case 'space:leave':
          return {};
        default:
          throw new Error(`Unexpected event emitted: ${event}`);
      }
    });

  return { joinPayloads, loadPayloads, pushPayloads };
}

function createWorkspaceState({
  workspaceId,
  docId,
  folderNodeId = 'folder-node-initial',
  folderId = 'folder-initial',
}: {
  workspaceId: string;
  docId: string;
  folderNodeId?: string;
  folderId?: string | null;
}) {
  const docs = new Map<string, Y.Doc>();

  const workspaceDoc = new Y.Doc();
  const workspaceMeta = workspaceDoc.getMap('meta');
  const pages = new Y.Array<unknown>();
  const pageEntry = new Y.Map<unknown>();
  pageEntry.set('id', docId);
  pageEntry.set('title', 'Initial title');
  pageEntry.set('createDate', 1_700_000_000_000);
  pageEntry.set('updatedDate', 1_700_000_000_000);
  const workspaceTags = new Y.Array<unknown>();
  workspaceTags.push(['initial']);
  pageEntry.set('tags', workspaceTags);
  pages.push([pageEntry]);
  workspaceMeta.set('pages', pages);
  docs.set(workspaceId, workspaceDoc);

  const docPropsId = `db$${workspaceId}$docProperties`;
  const docPropsDoc = new Y.Doc();
  const propsEntry = docPropsDoc.getMap(docId);
  propsEntry.set('id', docId);
  propsEntry.set('updatedAt', 1_700_000_000_000);
  const propsTags = new Y.Array<unknown>();
  propsTags.push(['initial']);
  propsEntry.set('tags', propsTags);
  docs.set(docPropsId, docPropsDoc);

  const foldersId = `db$${workspaceId}$folders`;
  const foldersDoc = new Y.Doc();
  if (folderId !== null) {
    const folderNode = foldersDoc.getMap(folderNodeId);
    folderNode.set('id', folderNodeId);
    folderNode.set('type', 'doc');
    folderNode.set('data', docId);
    folderNode.set('parentId', folderId);
  }
  docs.set(foldersId, foldersDoc);

  const { ydoc } = createDocYStructure({
    docId,
    title: 'Initial title',
    content: 'Original content',
    userId: 'user-123',
    timestamp: 1_700_000_000_000,
  });
  docs.set(docId, ydoc);

  return { docs, docPropsId, foldersId, folderNodeId };
}

function mockSocketWithDocs(
  client: AffineClient,
  docs: Map<string, Y.Doc>,
) {
  const pushPayloads: Array<{ spaceId: string; docId: string; update: string }> = [];
  vi.spyOn(client as unknown as { emitWithAck: EmitSpy }, 'emitWithAck').mockImplementation(
    async (event, payload) => {
      switch (event) {
        case 'space:join':
          return {};
        case 'space:leave':
          return {};
        case 'space:load-doc': {
          const { docId } = payload as { docId: string };
          const existing = docs.get(docId) ?? new Y.Doc({ guid: docId });
          docs.set(docId, existing);
          return {
            data: {
              missing: Buffer.from(Y.encodeStateAsUpdate(existing)).toString('base64'),
              state: Buffer.from(Y.encodeStateVector(existing)).toString('base64'),
            },
          };
        }
        case 'space:push-doc-update': {
          const { docId, update, spaceId } = payload as {
            docId: string;
            update: string;
            spaceId: string;
          };
          const target = docs.get(docId) ?? new Y.Doc({ guid: docId });
          docs.set(docId, target);
          Y.applyUpdate(target, Buffer.from(update, 'base64'));
          pushPayloads.push({ spaceId, docId, update });
          return {};
        }
        default:
          throw new Error(`Unexpected event emitted: ${event}`);
      }
    },
  );
  return { pushPayloads };
}

function extractTags(value: unknown): string[] {
  if (value instanceof Y.Array) {
    return value
      .toArray()
      .map(item => (Array.isArray(item) ? item[0] : item))
      .filter((item): item is string => typeof item === 'string');
  }
  return [];
}

describe('AffineClient socket integration (mocked)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a document and pushes updates across all workspace channels', async () => {
    const workspaceId = 'workspace-test';
    const docId = 'doc-test';
    const folderId = 'folder-parent';
    const requestedNodeId = 'folder-node-explicit';

    const client = new AffineClient({
      fetchFn: createMockFetch({ userId: 'user-123' }),
    });

    await client.signIn('integration@example.com', 'test-password');
    const { joinPayloads, loadPayloads, pushPayloads } = interceptEmits(client);

    const result = await client.createDocument(workspaceId, {
      docId,
      title: 'Integration spec',
      content: 'Hello from mocked socket.',
      folderId,
      folderNodeId: requestedNodeId,
    });

    expect(result.docId).toBe(docId);
    expect(result.folderNodeId).toBe(requestedNodeId);
    expect(result.title).toBe('Integration spec');
    expect(typeof result.timestamp).toBe('number');

    expect(joinPayloads).toHaveLength(1);
    expect(joinPayloads[0]).toMatchObject({
      spaceId: workspaceId,
      spaceType: 'workspace',
    });

    expect(loadPayloads.map(payload => payload.docId)).toEqual([
      workspaceId,
      `db$${workspaceId}$docProperties`,
      `db$${workspaceId}$folders`,
    ]);

    expect(pushPayloads.map(payload => payload.docId)).toEqual([
      docId,
      workspaceId,
      `db$${workspaceId}$docProperties`,
      `db$${workspaceId}$folders`,
    ]);

    const firstUpdate = Buffer.from(pushPayloads[0].update, 'base64');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, firstUpdate);
    const blocks = doc.getMap<unknown>('blocks');
    const paragraph = Array.from(blocks.values()).find(
      value => value instanceof Y.Map && value.get('sys:flavour') === 'affine:paragraph',
    ) as Y.Map<unknown> | undefined;
    expect(paragraph).toBeDefined();
    const text = paragraph?.get('prop:text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toContain('Hello from mocked socket.');
  });

  it('does not rejoin a workspace that is already tracked', async () => {
    const workspaceId = 'workspace-reuse';
    const client = new AffineClient({
      fetchFn: createMockFetch({ userId: 'user-456' }),
    });

    await client.signIn('reuse@example.com', 'password');
    const { joinPayloads } = interceptEmits(client);

    await client.joinWorkspace(workspaceId);
    await client.joinWorkspace(workspaceId);

    expect(joinPayloads).toHaveLength(1);
  });
});

describe('AffineClient document management', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const workspaceId = 'workspace-docs';
  const docId = 'doc-abc';

  it('aggregates metadata, properties, and folder info when listing documents', async () => {
    const { docs, folderNodeId } = createWorkspaceState({ workspaceId, docId });
    const client = new AffineClient({
      fetchFn: createMockFetch({ userId: 'user-789' }),
    });

    await client.signIn('list@example.com', 'password');
    mockSocketWithDocs(client, docs);

    const documents = await client.listDocuments(workspaceId);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      docId,
      title: 'Initial title',
      folderId: 'folder-initial',
      folderNodeId,
      tags: ['initial'],
    });
  });

  it('updates document markdown, tags, and folder placement', async () => {
    const { docs, docPropsId, foldersId, folderNodeId } = createWorkspaceState({
      workspaceId,
      docId,
    });
    const client = new AffineClient({
      fetchFn: createMockFetch({ userId: 'user-999' }),
    });

    await client.signIn('update@example.com', 'password');
    const { pushPayloads } = mockSocketWithDocs(client, docs);

    const result = await client.updateDocument(workspaceId, docId, {
      markdown: '# New Heading\n\nRewritten content.',
      tags: ['updated', 'test'],
      folderId: 'folder-updated',
      folderNodeId,
    });

    expect(result.docId).toBe(docId);
    expect(result.title).toContain('New Heading');
    expect(result.tags).toEqual(['updated', 'test']);
    expect(result.folderId).toBe('folder-updated');
    expect(result.folderNodeId).toBe(folderNodeId);

    const workspaceDoc = docs.get(workspaceId)!;
    const pages = workspaceDoc.getMap('meta').get('pages') as Y.Array<unknown>;
    const entry = pages.get(0) as Y.Map<unknown>;
    expect(entry.get('title')).toContain('New Heading');
    expect(extractTags(entry.get('tags'))).toEqual(['updated', 'test']);

    const docPropsDoc = docs.get(docPropsId)!;
    const propsEntry = docPropsDoc.getMap(docId);
    expect(extractTags(propsEntry.get('tags'))).toEqual(['updated', 'test']);

    const foldersDoc = docs.get(foldersId)!;
    const folderEntry = foldersDoc.getMap(result.folderNodeId!);
    expect(folderEntry.get('parentId')).toBe('folder-updated');

    expect(pushPayloads.map(payload => payload.docId)).toEqual(
      expect.arrayContaining([
        docId,
        workspaceId,
        docPropsId,
        foldersId,
      ]),
    );
  });

  it('deletes a document and cleans up workspace metadata', async () => {
    const { docs, docPropsId, foldersId, folderNodeId } = createWorkspaceState({
      workspaceId,
      docId,
    });
    const client = new AffineClient({
      fetchFn: createMockFetch({ userId: 'user-000' }),
    });

    await client.signIn('delete@example.com', 'password');
    mockSocketWithDocs(client, docs);

    await client.deleteDocument(workspaceId, docId);

    const workspaceDoc = docs.get(workspaceId)!;
    const pages = workspaceDoc.getMap('meta').get('pages') as Y.Array<unknown>;
    expect(pages.length).toBe(0);

    const docPropsDoc = docs.get(docPropsId)!;
    const propsEntry = docPropsDoc.getMap(docId);
    expect(propsEntry.get('deleted')).toBe(true);
    expect(extractTags(propsEntry.get('tags'))).toEqual([]);

    const foldersDoc = docs.get(foldersId)!;
    const removedFolderEntry = foldersDoc.getMap(folderNodeId);
    expect(removedFolderEntry.get('deleted')).toBe(true);
    expect(removedFolderEntry.get('parentId')).toBeNull();

    const deletedDoc = docs.get(docId)!;
    const deletedMeta = deletedDoc.getMap('meta');
    expect(deletedMeta.get('deleted')).toBe(true);
  });
});
