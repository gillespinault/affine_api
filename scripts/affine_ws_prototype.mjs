#!/usr/bin/env node
/**
 * Prototype client to authenticate against an AFFiNE instance, load a document
 * via Socket.IO, tweak its title with Yjs, and push the update back.
 *
 * Requirements (install once):
 *   npm install yjs socket.io-client
 *
 * Usage:
 *   node scripts/affine_ws_prototype.mjs \
 *     --workspace <workspace-id> \
 *     --doc <doc-id> \
 *     --title "New title"
 *
 * Environment variables:
 *   AFFINE_BASE_URL (default: https://affine.robotsinlove.be)
 *   AFFINE_EMAIL
 *   AFFINE_PASSWORD
 */

import { io } from 'socket.io-client';
import * as Y from 'yjs';
import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL } from 'node:url';

const DEFAULT_BASE_URL = 'https://affine.robotsinlove.be';
const SOCKET_PATH = '/socket.io/';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (!current.startsWith('--')) {
      continue;
    }
    const key = current.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      i -= 1;
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function ensure(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function parseSetCookies(setCookieHeaders = []) {
  const jar = new Map();
  for (const header of setCookieHeaders) {
    if (!header) continue;
    const [cookiePart] = header.split(';');
    const [name, ...rest] = cookiePart.split('=');
    jar.set(name.trim(), rest.join('=').trim());
  }
  return jar;
}

function serializeCookies(jar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function signIn(baseUrl, email, password) {
  const response = await fetch(new URL('/api/auth/sign-in', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
    redirect: 'manual',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Sign-in failed (${response.status} ${response.statusText}): ${text}`
    );
  }

  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')];

  const jar = parseSetCookies(cookies);

  if (!jar.has('affine_session') || !jar.has('affine_user_id')) {
    throw new Error('Missing required cookies from sign-in response.');
  }

  return jar;
}

async function connectSocket(baseUrl, cookieHeader) {
  const socket = io(baseUrl, {
    path: SOCKET_PATH,
    transports: ['websocket'],
    extraHeaders: {
      Cookie: cookieHeader,
    },
  });

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

  return socket;
}

async function emitWithAck(socket, event, payload, timeout = 10_000) {
  return await socket.timeout(timeout).emitWithAck(event, payload);
}

function loadDocIntoYjs(response) {
  const missing = Buffer.from(response.missing, 'base64');
  const stateVector = Buffer.from(response.state, 'base64');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, missing);
  return { doc, stateVector };
}

function setPageTitle(doc, newTitle) {
  const blocks = doc.getMap('blocks');
  for (const block of blocks.values()) {
    if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:page') {
      const title = block.get('prop:title');
      if (title) {
        title.delete(0, title.length);
        title.insert(0, newTitle);
        return true;
      }
    }
  }
  return false;
}

async function main() {
  const args = parseArgs();
  const baseUrl = process.env.AFFINE_BASE_URL ?? DEFAULT_BASE_URL;
  const email = ensure(
    process.env.AFFINE_EMAIL,
    'AFFINE_EMAIL env variable is required'
  );
  const password = ensure(
    process.env.AFFINE_PASSWORD,
    'AFFINE_PASSWORD env variable is required'
  );
  const workspaceId = ensure(
    args.workspace ?? args.ws,
    '--workspace <id> is required'
  );
  const docId = ensure(args.doc, '--doc <id> is required');
  const newTitle = args.title ?? `API update ${new Date().toISOString()}`;

  console.log(`Signing in to ${baseUrl} as ${email}...`);
  const jar = await signIn(baseUrl, email, password);
  const cookieHeader = serializeCookies(jar);
  console.log('Cookies acquired:', cookieHeader);

  console.log('Opening Socket.IO connection…');
  const socket = await connectSocket(baseUrl, cookieHeader);
  console.log('Socket connected:', socket.id);

  try {
    console.log(`Joining workspace ${workspaceId}…`);
    const joinRes = await emitWithAck(socket, 'space:join', {
      spaceType: 'workspace',
      spaceId: workspaceId,
      clientVersion: 'prototype-' + crypto.randomUUID(),
    });
    if (joinRes?.error) {
      throw new Error(`space:join rejected: ${JSON.stringify(joinRes.error)}`);
    }
    console.log('Joined workspace.');

    console.log(`Loading doc ${docId}…`);
    const loadRes = await emitWithAck(socket, 'space:load-doc', {
      spaceType: 'workspace',
      spaceId: workspaceId,
      docId,
    });
    if (loadRes?.error) {
      throw new Error(
        `space:load-doc failed: ${JSON.stringify(loadRes.error)}`
      );
    }

    const { doc, stateVector } = loadDocIntoYjs(loadRes.data);
    console.log(
      'Doc loaded – current title:',
      (() => {
        const blocks = doc.getMap('blocks');
        for (const block of blocks.values()) {
          if (
            block instanceof Y.Map &&
            block.get('sys:flavour') === 'affine:page'
          ) {
            const title = block.get('prop:title');
            return title ? title.toString() : '<empty>';
          }
        }
        return '<unknown>';
      })()
    );

    console.log('Updating title to:', newTitle);
    const updated = setPageTitle(doc, newTitle);
    if (!updated) {
      throw new Error('Failed to locate page title block inside the document.');
    }

    const updateBinary = Y.encodeStateAsUpdate(doc, stateVector);
    const updatePayload = Buffer.from(updateBinary).toString('base64');

    console.log('Pushing doc update…');
    const pushRes = await emitWithAck(socket, 'space:push-doc-update', {
      spaceType: 'workspace',
      spaceId: workspaceId,
      docId,
      update: updatePayload,
    });

    if (pushRes?.error) {
      throw new Error(
        `space:push-doc-update failed: ${JSON.stringify(pushRes.error)}`
      );
    }

    console.log('Update accepted:', pushRes?.data ?? pushRes);
  } finally {
    console.log('Leaving workspace and disconnecting…');
    try {
      await emitWithAck(socket, 'space:leave', {
        spaceType: 'workspace',
        spaceId: workspaceId,
      });
    } catch (err) {
      console.warn('space:leave failed:', err);
    }
    socket.disconnect();
    await sleep(250);
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
