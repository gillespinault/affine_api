#!/usr/bin/env node

import('../dist/service/start.js').catch(error => {
  console.error('Failed to start AFFiNE API server:', error);
  process.exit(1);
});
