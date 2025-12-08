import { AffineClient } from '../src/client/index.js';
import { createServer } from '../src/service/index.js';

const WORKSPACE_NAME = process.env.AFFINE_WORKSPACE_NAME ?? 'Robots in Love';
const TEST_FOLDER_PATH = (process.env.AFFINE_TEST_FOLDER_PATH ?? 'Affine_API/Tests API')
  .split('/')
  .map(segment => segment.trim())
  .filter(Boolean);
const POLL_INTERVAL_MS = 5_000;
const MAX_ATTEMPTS = 12;

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

type FolderNode = {
  type: 'folder' | 'doc';
  id: string;
  name: string;
  children?: FolderNode[];
};

function findFolderNode(nodes: FolderNode[], segment: string): FolderNode | undefined {
  return nodes.find(node => node.type === 'folder' && node.name === segment);
}

async function ensureFolderPath(
  client: AffineClient,
  workspaceId: string,
  segments: string[],
): Promise<string | null> {
  if (!segments.length) {
    return null;
  }
  const hierarchy = (await client.getHierarchy(workspaceId)) as FolderNode[];
  let currentLevel = hierarchy;
  let parentId: string | null = null;

  for (const segment of segments) {
    let match = findFolderNode(currentLevel, segment);
    if (!match) {
      const created = await client.createFolder(workspaceId, {
        name: segment,
        parentId,
      });
      match = {
        type: 'folder',
        id: created.nodeId,
        name: segment,
        children: [],
      };
      currentLevel.push(match);
    }
    parentId = match.id;
    currentLevel = (match.children as FolderNode[] | undefined) ?? [];
  }

  return parentId;
}

async function pollCopilotSearch(
  server: ReturnType<typeof createServer>,
  workspaceId: string,
  query: string,
  docId: string,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
    const response = await server.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/copilot/search`,
      payload: {
        query,
        scope: 'docs',
        limit: 5,
      },
    });

    if (response.statusCode >= 300) {
      throw new Error(`Copilot search failed: ${response.statusCode} ${response.body}`);
    }

    const payload = response.json() as {
      docs?: Array<{ docId: string; [key: string]: unknown }>;
    };
    const hit = payload.docs?.find(entry => entry.docId === docId);
    if (hit) {
      return hit;
    }
  }
  return null;
}

async function main() {
  const email = process.env.AFFINE_EMAIL;
  const password = process.env.AFFINE_PASSWORD;
  if (!email || !password) {
    throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD must be set in the environment.');
  }

  const client = new AffineClient();
  await client.signIn(email, password);
  await client.connectSocket();

  const workspaces = await client.listWorkspaces();
  const workspace =
    workspaces.find(ws => ws.name === WORKSPACE_NAME) ?? workspaces.at(0);
  if (!workspace) {
    throw new Error('No accessible workspace found for the current credentials.');
  }

  const folderNodeId = await ensureFolderPath(client, workspace.id, TEST_FOLDER_PATH);
  const uniqueToken = `copilot-${Date.now().toString(36)}`;
  const title = `Copilot Embedding Smoke ${new Date().toISOString()}`;
  const bodyContent = `This document validates the Copilot embedding pipeline.\n\nUnique token: ${uniqueToken}`;

  const created = await client.createDocument(workspace.id, {
    title,
    content: bodyContent,
    folderId: folderNodeId,
  });

  const server = createServer({ logger: false });
  await server.ready();

  const queueResponse = await server.inject({
    method: 'POST',
    url: `/workspaces/${workspace.id}/copilot/queue`,
    payload: { docIds: [created.docId] },
  });

  if (queueResponse.statusCode >= 300) {
    throw new Error(
      `Failed to queue doc for embedding (${queueResponse.statusCode}): ${queueResponse.body}`,
    );
  }

  const searchHit = await pollCopilotSearch(server, workspace.id, uniqueToken, created.docId);
  if (!searchHit) {
    throw new Error('Copilot search did not return the new document within the timeout window.');
  }

  const statusResponse = await server.inject({
    method: 'GET',
    url: `/workspaces/${workspace.id}/copilot/status`,
  });
  if (statusResponse.statusCode >= 300) {
    throw new Error(
      `Failed to query embedding status (${statusResponse.statusCode}): ${statusResponse.body}`,
    );
  }
  const embeddingStatus = statusResponse.json();

  await server.close();
  await client.disconnect();

  const summary = {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    folderNodeId,
    document: {
      docId: created.docId,
      title,
      token: uniqueToken,
    },
    embeddingStatus,
    searchHit,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
