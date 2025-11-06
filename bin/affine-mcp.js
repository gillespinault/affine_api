#!/usr/bin/env node

import('../dist/mcp/start.js').catch(error => {
  console.error('Failed to start AFFiNE MCP server:', error);
  process.exit(1);
});
