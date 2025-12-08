import express from 'express';
import { createServer } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, handleToolCall } from './server.js';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json());

const httpServer = createServer(app);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

const server = new Server({
  name: 'affine-notebooks-mcp-network',
  version: '0.1.0',
});

server.registerCapabilities({
  tools: {
    listChanged: false,
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions.map(def => ({
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleToolCall(request.params.name, request.params.arguments);
});

app.post('/mcp', (req, res) => {
  console.log('Request body:', req.body);
  transport.handleRequest(req, res, req.body);
});

server.connect(transport);

const port = 8799;
httpServer.listen(port, () => {
  console.log(`AFFiNE MCP Network Server listening on http://localhost:${port}/mcp`);
});
