import { randomUUID } from 'node:crypto';
import { AffineClient } from '../dist/client/index.js';

const WORKSPACE_NAME = process.env.AFFINE_WORKSPACE_NAME ?? 'Robots in Love';
const TEST_FOLDER_PATH = (process.env.AFFINE_TEST_FOLDER_PATH ?? 'Affine_API/Tests API')
  .split('/')
  .map(part => part.trim())
  .filter(Boolean);

function findFolderId(nodes, path) {
  if (!nodes || !path.length) {
    return null;
  }
  const [segment, ...rest] = path;
  const folder = nodes.find(node => node.type === 'folder' && node.name === segment);
  if (!folder) {
    return null;
  }
  if (!rest.length) {
    return folder.id;
  }
  return findFolderId(folder.children, rest);
}

async function ensureFolderChain(client, workspaceId, path) {
  if (!path.length) {
    return null;
  }
  const fetchHierarchy = async () => client.getHierarchy(workspaceId);

  let hierarchy = await fetchHierarchy();
  let targetId = findFolderId(hierarchy, path);
  if (targetId) {
    return targetId;
  }

  let parentId = null;
  for (let index = 0; index < path.length; index += 1) {
    const partial = path.slice(0, index + 1);
    hierarchy = await fetchHierarchy();
    const existing = findFolderId(hierarchy, partial);
    if (existing) {
      parentId = existing;
      continue;
    }
    const created = await client.createFolder(workspaceId, {
      name: path[index],
      parentId,
    });
    parentId = created.nodeId;
  }
  return parentId;
}

async function main() {
  const email = process.env.AFFINE_EMAIL;
  const password = process.env.AFFINE_PASSWORD;
  if (!email || !password) {
    throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD must be set.');
  }

  const client = new AffineClient();
  await client.signIn(email, password);
  await client.connectSocket();

  const workspaces = await client.listWorkspaces();
  if (!workspaces.length) {
    throw new Error('No workspaces returned by AFFiNE.');
  }
  const workspace = workspaces.find(entry => entry.name === WORKSPACE_NAME) ?? workspaces[0];

  const folderId = await ensureFolderChain(client, workspace.id, TEST_FOLDER_PATH);

  const token = `live-collab-${Date.now().toString(36)}`;
  const title = `Live Collaboration Smoke ${new Date().toISOString()}`;
  const markdown = `# Live Collaboration Smoke Test\n\nToken: **${token}**\n\n- Workspace: ${workspace.name ?? workspace.id}`;

  const document = await client.createDocument(workspace.id, {
    title,
    markdown,
    folderId,
    tags: ['tests', 'collab-live'],
  });

  const comment = await client.createComment(workspace.id, {
    docId: document.docId,
    docTitle: title,
    docMode: 'page',
    content: { text: `Initial comment for ${token}` },
  });

  await client.updateComment(comment.id, { text: `Updated at ${new Date().toISOString()}` });
  await client.resolveComment(comment.id, true);
  await client.resolveComment(comment.id, false);
  const commentList = await client.listComments(workspace.id, document.docId, { first: 10 });
  await client.deleteComment(comment.id);

  const notificationsBefore = await client.listNotifications({ first: 10, unreadOnly: true });
  await client.markAllNotificationsRead();
  const notificationsAfter = await client.listNotifications({ first: 10, unreadOnly: true });

  const tokensBefore = await client.listAccessTokens();
  const tokenName = `live-collab-${Date.now()}`;
  const createdToken = await client.createAccessToken({ name: tokenName });
  await client.revokeAccessToken(createdToken.id);
  const tokensAfter = await client.listAccessTokens();

  const keepDoc = process.env.AFFINE_KEEP_TEST_DOC === '1';
  if (!keepDoc) {
    await client.deleteDocument(workspace.id, document.docId);
  }
  await client.disconnect();

  const summary = {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    folderId,
    document: {
      docId: document.docId,
      title,
      token,
      kept: keepDoc,
    },
    comments: {
      createdId: comment.id,
      initialCount: commentList.comments.length,
    },
    notifications: {
      beforeUnread: notificationsBefore.unreadCount,
      afterUnread: notificationsAfter.unreadCount,
    },
    accessTokens: {
      before: tokensBefore.length,
      tempTokenId: createdToken.id,
      after: tokensAfter.length,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
