# CLAUDE.md - AFFiNE API Project

## Deployment Workflow

**IMPORTANT**: This project auto-deploys via Dokploy webhook on GitHub push.

### To deploy changes:
```bash
git add <files>
git commit -m "description"
git push origin main
```

That's it! Dokploy will automatically:
1. Detect the push via webhook
2. Pull the new code
3. Rebuild and restart the container

**DO NOT** try to run the server locally for testing - just push to GitHub.

### Production URLs
- **API**: https://affine-api.robotsinlove.be
- **Health**: https://affine-api.robotsinlove.be/health

### Testing after deployment
Wait ~30 seconds for deployment, then:
```bash
curl https://affine-api.robotsinlove.be/health
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/favorites
```

## Project Structure

- `src/client/runtime/affine-client.ts` - Main AFFiNE client with Socket.IO, YDoc handling
- `src/service/server.ts` - Fastify REST API server
- `src/mcp/` - MCP server for AI agents

## Key Technical Details

### Favorites System
Favorites are stored **PER WORKSPACE** on the AFFiNE server, not globally per user.

Server docId format: `userdata$userId$workspaceId$favorite`

This is an AFFiNE internal detail discovered by reading their source code (id-converter.ts).

### YDoc / CRDT Structure
- AFFiNE uses Yjs CRDTs for all data
- YjsDBAdapter stores rows as YMaps in `doc.share` with key = primary key
- Deletion uses `$DELETED` flag (soft delete)

## Environment Variables

Required in `.env`:
- `AFFINE_EMAIL` - AFFiNE account email
- `AFFINE_PASSWORD` - AFFiNE account password
- `AFFINE_BASE_URL` - AFFiNE server URL (default: https://affine.robotsinlove.be)
