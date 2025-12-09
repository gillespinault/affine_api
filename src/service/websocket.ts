/**
 * WebSocket Server for Real-time Canvas Collaboration
 *
 * Provides a simple JSON protocol for Android clients to interact with AFFiNE edgeless documents.
 * Acts as an intelligent proxy: translates between simple JSON (Android) and complex Yjs/Socket.IO (AFFiNE).
 *
 * Protocol:
 * - Client → Server: join, brush, shape, text, delete, update, ping
 * - Server → Client: init, add, update, remove, pong, error
 *
 * Architecture:
 * Android (JSON) ←→ WebSocket ←→ notebooks_api ←→ Yjs/Socket.IO ←→ AFFiNE
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { AffineClient } from '../client/index.js';
import type { CredentialProvider } from './server.js';

// ============================================================================
// TYPE DEFINITIONS - Client Messages
// ============================================================================

interface JoinMessage {
  type: 'join';
  workspaceId: string;
  docId: string;
}

interface BrushMessage {
  type: 'brush';
  points: number[][];  // [[x, y, pressure], ...]
  color?: string;      // Default: "#000000"
  lineWidth?: number;  // Default: 6
}

interface ShapeMessage {
  type: 'shape';
  shapeType: 'rect' | 'ellipse' | 'triangle' | 'diamond';
  xywh: number[];      // [x, y, width, height]
  fillColor?: string;  // Default: "#ffffff"
  strokeColor?: string; // Default: "#000000"
  strokeWidth?: number; // Default: 2
}

interface TextMessage {
  type: 'text';
  text: string;
  xywh: number[];      // [x, y, width, height]
  fontSize?: number;   // Default: 16
  color?: string;      // Default: "#000000"
}

interface DeleteMessage {
  type: 'delete';
  elementId: string;
}

interface UpdateMessage {
  type: 'update';
  elementId: string;
  changes: Record<string, unknown>;
}

interface PingMessage {
  type: 'ping';
}

type ClientMessage =
  | JoinMessage
  | BrushMessage
  | ShapeMessage
  | TextMessage
  | DeleteMessage
  | UpdateMessage
  | PingMessage;

// ============================================================================
// TYPE DEFINITIONS - Server Messages
// ============================================================================

interface InitMessage {
  type: 'init';
  elements: Array<Record<string, unknown>>;
}

interface AddMessage {
  type: 'add';
  element: Record<string, unknown>;
}

interface UpdateNotification {
  type: 'update';
  elementId: string;
  changes: Record<string, unknown>;
}

interface RemoveMessage {
  type: 'remove';
  elementId: string;
}

interface PongMessage {
  type: 'pong';
}

interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

type ServerMessage =
  | InitMessage
  | AddMessage
  | UpdateNotification
  | RemoveMessage
  | PongMessage
  | ErrorMessage;

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

interface ClientSession {
  socket: WebSocket;
  workspaceId: string;
  docId: string;
  client: AffineClient;
}

/**
 * Map of document sessions: sessionKey → Set<ClientSession>
 * sessionKey format: "workspaceId:docId"
 */
const documentSessions = new Map<string, Set<ClientSession>>();

/**
 * Map of socket → session metadata for cleanup
 */
const socketToSession = new Map<WebSocket, ClientSession>();

/**
 * Get or create session key for a document
 */
function getSessionKey(workspaceId: string, docId: string): string {
  return `${workspaceId}:${docId}`;
}

/**
 * Add a client to a document session
 */
function addClientToSession(session: ClientSession): void {
  const sessionKey = getSessionKey(session.workspaceId, session.docId);
  if (!documentSessions.has(sessionKey)) {
    documentSessions.set(sessionKey, new Set());
  }
  documentSessions.get(sessionKey)!.add(session);
  socketToSession.set(session.socket, session);
  console.log(`[WS] Client joined session: ${sessionKey} (total: ${documentSessions.get(sessionKey)!.size})`);
}

/**
 * Remove a client from its document session
 */
function removeClientFromSession(socket: WebSocket): void {
  const session = socketToSession.get(socket);
  if (!session) return;

  const sessionKey = getSessionKey(session.workspaceId, session.docId);
  const clients = documentSessions.get(sessionKey);
  if (clients) {
    clients.delete(session);
    if (clients.size === 0) {
      documentSessions.delete(sessionKey);
      console.log(`[WS] Session closed (no more clients): ${sessionKey}`);
    } else {
      console.log(`[WS] Client left session: ${sessionKey} (remaining: ${clients.size})`);
    }
  }
  socketToSession.delete(socket);

  // Cleanup AffineClient
  try {
    session.client.disconnect();
  } catch (error) {
    console.error('[WS] Error disconnecting AffineClient:', error);
  }
}

/**
 * Broadcast a message to all clients in a document session (except sender)
 */
function broadcastToDocument(
  workspaceId: string,
  docId: string,
  message: ServerMessage,
  excludeSocket?: WebSocket
): void {
  const sessionKey = getSessionKey(workspaceId, docId);
  const clients = documentSessions.get(sessionKey);

  if (!clients || clients.size === 0) {
    console.log(`[WS] No clients to broadcast to: ${sessionKey}`);
    return;
  }

  const messageStr = JSON.stringify(message);
  let sentCount = 0;

  for (const client of clients) {
    if (client.socket !== excludeSocket) {
      try {
        client.socket.send(messageStr);
        sentCount++;
      } catch (error) {
        console.error('[WS] Error broadcasting to client:', error);
      }
    }
  }

  console.log(`[WS] Broadcast to ${sentCount} clients in ${sessionKey}`);
}

/**
 * Send a message to a specific client
 */
function sendToClient(socket: WebSocket, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    console.error('[WS] Error sending to client:', error);
  }
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

/**
 * Handle JOIN message: authenticate and load initial document state
 */
async function handleJoin(
  socket: WebSocket,
  message: JoinMessage,
  credentialProvider: CredentialProvider,
  baseUrl?: string
): Promise<void> {
  const { workspaceId, docId } = message;
  console.log(`[WS] JOIN request: workspaceId=${workspaceId}, docId=${docId}`);

  try {
    // Get credentials
    const credentials = await credentialProvider.getCredentials(workspaceId);

    // Create AffineClient
    const client = new AffineClient({ baseUrl });
    await client.signIn(credentials.email, credentials.password);
    await client.connectSocket();

    // Get initial document state
    const elements = await client.getEdgelessElements(workspaceId, docId);

    // Add to session
    const session: ClientSession = {
      socket,
      workspaceId,
      docId,
      client,
    };
    addClientToSession(session);

    // Send initial state to client
    sendToClient(socket, {
      type: 'init',
      elements: elements as unknown as Array<Record<string, unknown>>,
    });

    console.log(`[WS] JOIN successful: ${elements.length} elements loaded`);
  } catch (error) {
    console.error('[WS] JOIN failed:', error);
    sendToClient(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'JOIN_FAILED',
    });
  }
}

/**
 * Handle BRUSH message: create brush stroke in AFFiNE
 */
async function handleBrush(socket: WebSocket, message: BrushMessage): Promise<void> {
  const session = socketToSession.get(socket);
  if (!session) {
    sendToClient(socket, { type: 'error', message: 'Not joined to a document', code: 'NOT_JOINED' });
    return;
  }

  console.log(`[WS] BRUSH: ${message.points.length} points, color=${message.color}, lineWidth=${message.lineWidth}`);

  try {
    const { workspaceId, docId, client } = session;

    // Calculate bounding box from points
    const xs = message.points.map(p => p[0]);
    const ys = message.points.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const xywh = [minX, minY, maxX - minX, maxY - minY];

    // Create brush element in AFFiNE via Yjs
    const element = await client.addEdgelessElement(workspaceId, docId, {
      type: 'brush',
      points: message.points,
      color: message.color || '#000000',
      lineWidth: message.lineWidth || 6,
      xywh,
    });

    // Broadcast to other clients
    broadcastToDocument(workspaceId, docId, {
      type: 'add',
      element: element as unknown as Record<string, unknown>,
    }, socket);

    console.log(`[WS] BRUSH created: id=${element.id}`);
  } catch (error) {
    console.error('[WS] BRUSH failed:', error);
    sendToClient(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'BRUSH_FAILED',
    });
  }
}

/**
 * Handle SHAPE message: create shape in AFFiNE
 */
async function handleShape(socket: WebSocket, message: ShapeMessage): Promise<void> {
  const session = socketToSession.get(socket);
  if (!session) {
    sendToClient(socket, { type: 'error', message: 'Not joined to a document', code: 'NOT_JOINED' });
    return;
  }

  console.log(`[WS] SHAPE: type=${message.shapeType}, xywh=${message.xywh}`);

  try {
    const { workspaceId, docId, client } = session;

    // Create shape element in AFFiNE
    const element = await client.addEdgelessElement(workspaceId, docId, {
      type: 'shape',
      shapeType: message.shapeType,
      xywh: message.xywh,
      fillColor: message.fillColor || '#ffffff',
      strokeColor: message.strokeColor || '#000000',
      strokeWidth: message.strokeWidth || 2,
    });

    // Broadcast to other clients
    broadcastToDocument(workspaceId, docId, {
      type: 'add',
      element: element as unknown as Record<string, unknown>,
    }, socket);

    console.log(`[WS] SHAPE created: id=${element.id}`);
  } catch (error) {
    console.error('[WS] SHAPE failed:', error);
    sendToClient(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'SHAPE_FAILED',
    });
  }
}

/**
 * Handle TEXT message: create text element in AFFiNE
 */
async function handleText(socket: WebSocket, message: TextMessage): Promise<void> {
  const session = socketToSession.get(socket);
  if (!session) {
    sendToClient(socket, { type: 'error', message: 'Not joined to a document', code: 'NOT_JOINED' });
    return;
  }

  console.log(`[WS] TEXT: text="${message.text}", xywh=${message.xywh}`);

  try {
    const { workspaceId, docId, client } = session;

    // Create text element in AFFiNE
    const element = await client.addEdgelessElement(workspaceId, docId, {
      type: 'text',
      text: message.text,
      xywh: message.xywh,
      fontSize: message.fontSize || 16,
      color: message.color || '#000000',
    });

    // Broadcast to other clients
    broadcastToDocument(workspaceId, docId, {
      type: 'add',
      element: element as unknown as Record<string, unknown>,
    }, socket);

    console.log(`[WS] TEXT created: id=${element.id}`);
  } catch (error) {
    console.error('[WS] TEXT failed:', error);
    sendToClient(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'TEXT_FAILED',
    });
  }
}

/**
 * Handle DELETE message: remove element from AFFiNE
 */
async function handleDelete(socket: WebSocket, message: DeleteMessage): Promise<void> {
  const session = socketToSession.get(socket);
  if (!session) {
    sendToClient(socket, { type: 'error', message: 'Not joined to a document', code: 'NOT_JOINED' });
    return;
  }

  console.log(`[WS] DELETE: elementId=${message.elementId}`);

  try {
    const { workspaceId, docId, client } = session;

    // Delete element in AFFiNE
    await client.deleteEdgelessElement(workspaceId, docId, message.elementId);

    // Broadcast to other clients
    broadcastToDocument(workspaceId, docId, {
      type: 'remove',
      elementId: message.elementId,
    }, socket);

    console.log(`[WS] DELETE completed: id=${message.elementId}`);
  } catch (error) {
    console.error('[WS] DELETE failed:', error);
    sendToClient(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'DELETE_FAILED',
    });
  }
}

/**
 * Handle UPDATE message: modify element in AFFiNE
 */
async function handleUpdate(socket: WebSocket, message: UpdateMessage): Promise<void> {
  const session = socketToSession.get(socket);
  if (!session) {
    sendToClient(socket, { type: 'error', message: 'Not joined to a document', code: 'NOT_JOINED' });
    return;
  }

  console.log(`[WS] UPDATE: elementId=${message.elementId}, changes=`, message.changes);

  try {
    const { workspaceId, docId, client } = session;

    // Update element in AFFiNE
    await client.updateEdgelessElement(workspaceId, docId, message.elementId, message.changes);

    // Broadcast to other clients
    broadcastToDocument(workspaceId, docId, {
      type: 'update',
      elementId: message.elementId,
      changes: message.changes,
    }, socket);

    console.log(`[WS] UPDATE completed: id=${message.elementId}`);
  } catch (error) {
    console.error('[WS] UPDATE failed:', error);
    sendToClient(socket, {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'UPDATE_FAILED',
    });
  }
}

/**
 * Handle PING message: send PONG response
 */
function handlePing(socket: WebSocket): void {
  sendToClient(socket, { type: 'pong' });
}

// ============================================================================
// WEBSOCKET ROUTE REGISTRATION
// ============================================================================

export interface WebSocketConfig {
  credentialProvider: CredentialProvider;
  baseUrl?: string;
}

/**
 * Register WebSocket route for real-time canvas collaboration
 */
export function registerWebSocketRoute(fastify: FastifyInstance, config: WebSocketConfig): void {
  fastify.get('/canvas', { websocket: true }, (socket, req) => {
    const clientId = `${req.ip}:${Math.random().toString(36).substring(7)}`;
    console.log(`[WS] New connection: ${clientId}`);

    // Handle incoming messages
    socket.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        console.log(`[WS] Received message: type=${message.type}`);

        switch (message.type) {
          case 'join':
            await handleJoin(socket, message, config.credentialProvider, config.baseUrl);
            break;
          case 'brush':
            await handleBrush(socket, message);
            break;
          case 'shape':
            await handleShape(socket, message);
            break;
          case 'text':
            await handleText(socket, message);
            break;
          case 'delete':
            await handleDelete(socket, message);
            break;
          case 'update':
            await handleUpdate(socket, message);
            break;
          case 'ping':
            handlePing(socket);
            break;
          default:
            console.warn('[WS] Unknown message type:', (message as { type: string }).type);
            sendToClient(socket, {
              type: 'error',
              message: 'Unknown message type',
              code: 'UNKNOWN_TYPE',
            });
        }
      } catch (error) {
        console.error('[WS] Error handling message:', error);
        sendToClient(socket, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          code: 'HANDLER_ERROR',
        });
      }
    });

    // Handle client disconnect
    socket.on('close', () => {
      console.log(`[WS] Connection closed: ${clientId}`);
      removeClientFromSession(socket);
    });

    // Handle errors
    socket.on('error', (error: Error) => {
      console.error(`[WS] Socket error (${clientId}):`, error);
      removeClientFromSession(socket);
    });
  });

  console.log('[WS] WebSocket route registered: GET /canvas');
}
