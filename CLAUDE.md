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

Favorites are stored in a **user-specific YDoc** on the AFFiNE server.

**DocId format**: `userdata$<userId>$favorite` (WITHOUT workspaceId in the docId itself)

Each favorite entry is stored as a YMap with key format:
- `doc:<workspaceId>:<docId>` for documents
- `folder:<workspaceId>:<folderId>` for folders
- `collection:<workspaceId>:<collectionId>` for collections
- `tag:<workspaceId>:<tagId>` for tags

**Important**: The workspaceId is embedded in each entry's key, not in the docId.

#### YMap Entry Structure
```typescript
{
  key: string,      // Primary key (e.g., "doc:workspace123:docABC")
  index: string,    // Fractional index for ordering (e.g., "a0", "a1")
  // No $DELETED flag = active favorite
}
```

#### Reading Favorites
```typescript
// Load the favorite doc
const favoriteDocId = `userdata$${userId}$favorite`;
const doc = await loadYDoc(favoriteDocId);

// Iterate over all YMaps in doc.share
for (const shareKey of doc.share.keys()) {
  // IMPORTANT: Must instantiate YMap properly
  const ymap = doc.getMap(shareKey);  // NOT doc.share.get(shareKey)
  const entry = ymap.toJSON();

  if (entry['$DELETED']) continue;  // Skip deleted entries

  // Parse the key: "doc:workspaceId:docId"
  const [type, workspaceId, id] = shareKey.split(':');
}
```

### YDoc / CRDT Structure
- AFFiNE uses Yjs CRDTs for all data
- YjsDBAdapter stores rows as YMaps in `doc.share` with key = primary key
- Deletion uses `$DELETED` flag (soft delete)
- **Critical**: `doc.share` contains uninstantiated `AbstractType` objects; must use `doc.getMap(key)` to access data

## REST API Endpoints

### Favorites
- `GET /workspaces/:id/favorites` - List all favorites for a workspace
- `GET /workspaces/:id/documents/:docId/favorite` - Check if document is favorited
- `POST /workspaces/:id/documents/:docId/favorite` - Add document to favorites
- `DELETE /workspaces/:id/documents/:docId/favorite` - Remove from favorites

### Documents
- `GET /workspaces/:id/documents` - List all documents
- `GET /workspaces/:id/recent-documents` - List recent documents
- `POST /workspaces/:id/documents` - Create new document

### Workspaces
- `GET /workspaces` - List all workspaces
- `GET /health` - Health check

## Environment Variables

Required in `.env`:
- `AFFINE_EMAIL` - AFFiNE account email
- `AFFINE_PASSWORD` - AFFiNE account password
- `AFFINE_BASE_URL` - AFFiNE server URL (default: https://affine.robotsinlove.be)
