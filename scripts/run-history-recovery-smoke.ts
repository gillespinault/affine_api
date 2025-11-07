import { AffineClient } from '../src/client/index.js';
import { createServer } from '../src/service/index.js';

const WORKSPACE_NAME = process.env.AFFINE_WORKSPACE_NAME ?? 'Robots in Love';
const TEST_FOLDER_PATH = (process.env.AFFINE_TEST_FOLDER_PATH ?? 'Affine_API/Tests API')
  .split('/')
  .map(part => part.trim())
  .filter(Boolean);

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

type FolderNode = {
  type: 'folder' | 'doc';
  id: string;
  name: string;
  children?: FolderNode[];
};

function findFolderNode(nodes: FolderNode[], name: string) {
  return nodes.find(node => node.type === 'folder' && node.name === name);
}

async function ensureFolderChain(
  client: AffineClient,
  workspaceId: string,
  path: string[],
): Promise<string | null> {
  if (!path.length) {
    return null;
  }
  const hierarchy = (await client.getHierarchy(workspaceId)) as FolderNode[];
  let currentLevel = hierarchy;
  let parentId: string | null = null;

  for (const segment of path) {
    let folder = findFolderNode(currentLevel, segment);
    if (!folder) {
      const { nodeId } = await client.createFolder(workspaceId, {
        name: segment,
        parentId,
      });
      folder = { type: 'folder', id: nodeId, name: segment, children: [] };
      currentLevel.push(folder);
    }
    parentId = folder.id;
    currentLevel = (folder.children as FolderNode[] | undefined) ?? [];
  }

  return parentId;
}

async function main() {
  const email = process.env.AFFINE_EMAIL;
  const password = process.env.AFFINE_PASSWORD;
  if (!email || !password) {
    throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD must be set to run this script.');
  }

  const client = new AffineClient();
  await client.signIn(email, password);
  await client.connectSocket();

  const workspaces = await client.listWorkspaces();
  const workspace =
    workspaces.find(ws => ws.name === WORKSPACE_NAME) ?? workspaces.at(0);
  if (!workspace) {
    throw new Error('Unable to find any workspace for the provided account.');
  }

  const folderNodeId = await ensureFolderChain(client, workspace.id, TEST_FOLDER_PATH);
  const uniqueToken = `history-${Date.now().toString(36)}`;
  const title = `History Smoke ${new Date().toISOString()}`;

  const baseContent = `Version A (initial)\nToken: ${uniqueToken}`;
  const firstUpdate = `Version B (edited once)\nToken: ${uniqueToken}`;
  const secondUpdate = `Version C (final)\nToken: ${uniqueToken}`;

  const created = await client.createDocument(workspace.id, {
    title,
    content: baseContent,
    folderId: folderNodeId,
  });

  await sleep(1500);
  await client.updateDocument(workspace.id, created.docId, {
    content: firstUpdate,
  });

  await sleep(1500);
  await client.updateDocument(workspace.id, created.docId, {
    content: secondUpdate,
  });

  const server = createServer({ logger: false });
  await server.ready();

  await sleep(2000);
  const historyResponse = await server.inject({
    method: 'GET',
    url: `/workspaces/${workspace.id}/documents/${created.docId}/history?limit=10`,
  });
  if (historyResponse.statusCode >= 300) {
    throw new Error(`GET history failed: ${historyResponse.statusCode} ${historyResponse.body}`);
  }

  const historyPayload = historyResponse.json() as {
    entries: Array<{ id: string; timestamp: string }>;
  };
  if (!historyPayload.entries.length) {
    throw new Error('History endpoint returned no entries.');
  }

  // Newest first, so grab the oldest timestamp to recover.
  const targetEntry = historyPayload.entries[historyPayload.entries.length - 1];

  const recoverResponse = await server.inject({
    method: 'POST',
    url: `/workspaces/${workspace.id}/documents/${created.docId}/history/recover`,
    payload: { timestamp: targetEntry.timestamp },
  });
  if (recoverResponse.statusCode >= 300) {
    throw new Error(
      `POST recover failed: ${recoverResponse.statusCode} ${recoverResponse.body}`,
    );
  }

  await sleep(1500);
  const content = await client.getDocumentContent(workspace.id, created.docId);
  const paragraphTexts = content.blocks
    .filter(block => block.flavour === 'affine:paragraph' && typeof block.props?.text === 'string')
    .map(block => block.props?.text as string);
  const restoredMatches = paragraphTexts.some(text => text.includes('Version A (initial)'));

  await server.close();
  await client.disconnect();

  const summary = {
    workspace: { id: workspace.id, name: workspace.name },
    folderNodeId,
    document: {
      docId: created.docId,
      title,
      token: uniqueToken,
    },
    historyEntries: historyPayload.entries.map(entry => ({
      id: entry.id,
      timestamp: entry.timestamp,
    })),
    recoveredTimestamp: targetEntry.timestamp,
    restoredMatches,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
