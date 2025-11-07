import { randomUUID } from 'node:crypto';

const API_BASE_URL = process.env.AFFINE_API_BASE_URL ?? 'https://affine-api.robotsinlove.be';
const WORKSPACE_NAME = process.env.AFFINE_WORKSPACE_NAME ?? 'Robots in Love';
const TEST_FOLDER_PATH = (process.env.AFFINE_TEST_FOLDER_PATH ?? 'Affine_API/Tests API')
  .split('/')
  .map(part => part.trim())
  .filter(Boolean);

async function apiRequest(method, path, body) {
  const url = new URL(path, API_BASE_URL);
  const headers = { accept: 'application/json' };
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, { method, headers, body: payload });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request ${method} ${url.pathname} failed (${response.status}): ${text}`);
  }
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${method} ${url.pathname}: ${error.message}`);
  }
}

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

async function ensureFolderChain(workspaceId, path) {
  if (!path.length) {
    return null;
  }
  const fetchHierarchy = async () => {
    const hierarchyResponse = await apiRequest('GET', `/workspaces/${workspaceId}/hierarchy`);
    return hierarchyResponse.hierarchy;
  };

  let hierarchy = await fetchHierarchy();
  let targetId = findFolderId(hierarchy, path);
  if (targetId) {
    return targetId;
  }

  let parentId = null;
  for (let index = 0; index < path.length; index += 1) {
    const partialPath = path.slice(0, index + 1);
    hierarchy = await fetchHierarchy();
    const existingId = findFolderId(hierarchy, partialPath);
    if (existingId) {
      parentId = existingId;
      continue;
    }
    const created = await apiRequest('POST', `/workspaces/${workspaceId}/folders`, {
      name: path[index],
      parentId,
    });
    parentId = created.nodeId;
  }
  return parentId;
}

async function main() {
  const workspacesResponse = await apiRequest('GET', '/workspaces');
  if (!workspacesResponse.workspaces.length) {
    throw new Error('No workspaces returned by the API.');
  }
  const workspace =
    workspacesResponse.workspaces.find(ws => ws.name === WORKSPACE_NAME) ??
    workspacesResponse.workspaces[0];

  const folderId = await ensureFolderChain(workspace.id, TEST_FOLDER_PATH);

  const token = `collab-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const title = `Collab Smoke ${new Date().toISOString()}`;
  const markdown = `# Collaboration Smoke Test\n\nToken: **${token}**\n\n- Created at ${new Date().toISOString()}\n- Workspace: ${workspace.name ?? workspace.id}`;

  const document = await apiRequest('POST', `/workspaces/${workspace.id}/documents`, {
    title,
    markdown,
    folderId,
    tags: ['tests', 'collab-smoke'],
  });
  const docId = document.docId;

  const comment = await apiRequest(
    'POST',
    `/workspaces/${workspace.id}/documents/${docId}/comments`,
    {
      content: { text: `Initial automated comment for ${token}` },
      docTitle: title,
      docMode: 'page',
    },
  );

  await apiRequest(
    'PATCH',
    `/workspaces/${workspace.id}/documents/${docId}/comments/${comment.id}`,
    { content: { text: `Updated content for ${token}` } },
  );

  const resolved = await apiRequest(
    'POST',
    `/workspaces/${workspace.id}/documents/${docId}/comments/${comment.id}/resolve`,
    { resolved: true },
  );

  const reopened = await apiRequest(
    'POST',
    `/workspaces/${workspace.id}/documents/${docId}/comments/${comment.id}/resolve`,
    { resolved: false },
  );

  const commentsList = await apiRequest(
    'GET',
    `/workspaces/${workspace.id}/documents/${docId}/comments`,
  );

  await apiRequest('DELETE', `/workspaces/${workspace.id}/documents/${docId}/comments/${comment.id}`);

  const notificationsBefore = await apiRequest(
    'GET',
    '/notifications?first=10&unreadOnly=true',
  );
  const notificationsCleared = await apiRequest('POST', '/notifications/read-all');

  const tokensBefore = await apiRequest('GET', '/users/me/tokens');
  const tokenName = `collab-smoke-${Date.now()}`;
  const createdToken = await apiRequest('POST', '/users/me/tokens', { name: tokenName });
  await apiRequest('DELETE', `/users/me/tokens/${createdToken.id}`);
  const tokensAfter = await apiRequest('GET', '/users/me/tokens');

  await apiRequest('DELETE', `/workspaces/${workspace.id}/documents/${docId}`);

  const summary = {
    apiBaseUrl: API_BASE_URL,
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    folderId,
    document: {
      docId,
      title,
      token,
    },
    comments: {
      created: comment.id,
      totalBeforeCleanup: commentsList.comments.length,
      resolved,
      reopened,
    },
    notifications: {
      beforeUnread: notificationsBefore,
      cleared: notificationsCleared,
    },
    accessTokens: {
      before: tokensBefore.count,
      created: {
        id: createdToken.id,
        token: createdToken.token ?? null,
      },
      after: tokensAfter.count,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
