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
  return text ? JSON.parse(text) : undefined;
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
    const partial = path.slice(0, index + 1);
    hierarchy = await fetchHierarchy();
    const existing = findFolderId(hierarchy, partial);
    if (existing) {
      parentId = existing;
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

  const token = `publish-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const title = `Publication Smoke ${new Date().toISOString()}`;
  const markdown = `# Publication Smoke Test\n\nToken: **${token}**`;

  const document = await apiRequest('POST', `/workspaces/${workspace.id}/documents`, {
    title,
    markdown,
    folderId,
    tags: ['tests', 'publish-smoke'],
  });
  const docId = document.docId;

  const published = await apiRequest(
    'POST',
    `/workspaces/${workspace.id}/documents/${docId}/publish`,
    { mode: 'page' },
  );

  const revoked = await apiRequest(
    'POST',
    `/workspaces/${workspace.id}/documents/${docId}/revoke`,
  );

  await apiRequest('DELETE', `/workspaces/${workspace.id}/documents/${docId}`);

  const summary = {
    workspace,
    folderId,
    document: { docId, title, token },
    published,
    revoked,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
