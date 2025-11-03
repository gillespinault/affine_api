#!/usr/bin/env node
const fs = require('node:fs/promises');
const {
  AffineClient,
  DEFAULT_BASE_URL,
  nanoid,
} = require('../lib/affineClient');

const DEBUG_LOG = '/tmp/affine_doc_manager.debug.log';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      i -= 1;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function ensure(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function appendDebug(message) {
  try {
    await fs.appendFile(DEBUG_LOG, `\n${message}`);
  } catch {
    // ignore debug write failures
  }
}

function readNullableArg(args, key, defaultValue = null) {
  if (!Object.prototype.hasOwnProperty.call(args, key)) {
    return defaultValue;
  }
  const value = args[key];
  if (value === 'null') return null;
  return value;
}

async function main() {
  await appendDebug(`start ${new Date().toISOString()}`);

  const args = parseArgs();
  const baseUrl = process.env.AFFINE_BASE_URL || DEFAULT_BASE_URL;
  const workspaceId = ensure(args.workspace, '--workspace <id> is required');
  let folderId = readNullableArg(args, 'folder');
  const createFolder = Boolean(args['create-folder']);
  const folderName = args['folder-name'] || 'New folder';
  const folderParent = readNullableArg(args, 'folder-parent');
  let folderNodeId = args['folder-node'] || null;
  const skipDoc = Boolean(args['no-doc']);
  const title =
    args.title || `Programmatic doc ${new Date().toISOString()}`;
  const content =
    args.content || 'Document generated via AFFiNE API prototype.';
  const docId = args.doc || nanoid();

  await appendDebug(`parsed args docId=${docId}`);

  const email = ensure(
    process.env.AFFINE_EMAIL,
    'AFFINE_EMAIL env variable is required'
  );
  const password = ensure(
    process.env.AFFINE_PASSWORD,
    'AFFINE_PASSWORD env variable is required'
  );

  const client = new AffineClient({ baseUrl });

  console.log(`Signing in to ${baseUrl} as ${email}…`);
  await appendDebug('before signIn');
  await client.signIn(email, password);
  await appendDebug('after signIn');

  console.log('Opening Socket.IO connection…');
  const socket = await client.connectSocket();
  console.log('Socket connected:', socket.id);

  try {
    await client.joinWorkspace(workspaceId);

    if (createFolder) {
      const desiredNodeId = folderId || nanoid();
      console.log(
        `Creating folder "${folderName}" (node ${desiredNodeId})…`
      );
      await client.createFolder(workspaceId, {
        name: folderName,
        parentId: folderParent,
        nodeId: desiredNodeId,
      });
      console.log('Folder created.');
      if (folderId === null && !skipDoc) {
        folderId = desiredNodeId;
      }
    }

    if (skipDoc) {
      console.log('Skipping document creation (--no-doc set).');
      return;
    }

    console.log(`Creating doc ${docId} with title "${title}"…`);
    const creationResult = await client.createDocument(workspaceId, {
      docId,
      title,
      content,
      folderId,
      folderNodeId,
    });
    console.log('Doc creation acknowledged:', {
      docId: creationResult.docId,
      folderNodeId: creationResult.folderNodeId,
      timestamp: creationResult.timestamp,
    });

    if (folderId === null) {
      console.log('Doc left at workspace root (no folder specified).');
    }

    console.log('Done. Doc ID:', creationResult.docId);
  } finally {
    console.log('Leaving workspace and disconnecting…');
    await client.leaveWorkspace(workspaceId);
    await client.disconnect();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
