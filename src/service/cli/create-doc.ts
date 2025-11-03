#!/usr/bin/env node
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AffineClient, nanoid } from '../../client.js';

type ParsedArgs = Record<string, string | boolean>;

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) {
      continue;
    }
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      i -= 1;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function ensure<T>(value: T | undefined, message: string): T {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function asNullable(value: string | boolean | undefined): string | null | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return undefined;
  }
  if (value === 'null') {
    return null;
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceId = ensure(
    typeof args.workspace === 'string' ? args.workspace : undefined,
    '--workspace <id> is required',
  );

  const folderId = asNullable(args.folder);
  const folderNodeId = asNullable(args['folder-node']);
  const title =
    typeof args.title === 'string'
      ? args.title
      : `Programmatic doc ${new Date().toISOString()}`;
  const contentArg =
    typeof args.content === 'string' ? args.content : 'Document generated via AFFiNE CLI.';
  const explicitDocId = asNullable(args.doc);
  const markdownInline = typeof args.markdown === 'string' ? args.markdown : undefined;
  const markdownFile = asNullable(args['markdown-file']);
  let markdownContent: string | undefined;
  if (markdownFile) {
    const resolved = path.isAbsolute(markdownFile)
      ? markdownFile
      : path.join(process.cwd(), markdownFile);
    markdownContent = await fs.readFile(resolved, 'utf8');
  } else if (markdownInline) {
    markdownContent = markdownInline;
  }
  const content = markdownContent ? undefined : contentArg;

  const email = ensure(process.env.AFFINE_EMAIL, 'AFFINE_EMAIL env variable is required');
  const password = ensure(
    process.env.AFFINE_PASSWORD,
    'AFFINE_PASSWORD env variable is required',
  );
  const baseUrl = process.env.AFFINE_BASE_URL;

  const client = new AffineClient({ baseUrl });

  console.log(`Signing in to ${baseUrl ?? '(default AFFiNE host)'} as ${email}…`);
  await client.signIn(email, password);

  console.log('Opening Socket.IO connection…');
  const socket = await client.connectSocket();
  console.log('Socket connected:', socket.id);

  const docId = explicitDocId ?? nanoid();
  if (markdownContent) {
    console.log(`Creating document ${docId} from markdown in workspace ${workspaceId}…`);
  } else {
    console.log(`Creating document ${docId} in workspace ${workspaceId}…`);
  }

  const result = await client.createDocument(workspaceId, {
    docId,
    title,
    content,
    markdown: markdownContent,
    folderId: folderId ?? null,
    folderNodeId: folderNodeId ?? null,
  });

  console.log(
    JSON.stringify(
      {
        docId: result.docId,
        folderNodeId: result.folderNodeId,
        timestamp: result.timestamp,
        title: result.title,
      },
      null,
      2,
    ),
  );
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
