#!/usr/bin/env node
import { startMcpServer } from './server.js';

async function main() {
  console.error('Starting AFFiNE MCP Server...');
  console.error('AFFiNE:', process.env.AFFINE_BASE_URL || 'https://affine.robotsinlove.be');

  try {
    await startMcpServer();
  } catch (error) {
    console.error('Fatal:', error);
    process.exit(1);
  }
}

main();
