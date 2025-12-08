# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2025-11-27

### Added

- **Blob Retrieval API** : Récupérer les blobs d'un workspace
  - `GET /workspaces/:workspaceId/blobs` - Lister tous les blobs (key, mime, size, createdAt)
  - `GET /workspaces/:workspaceId/blobs/:blobKey` - Télécharger blob (binaire ou `?format=base64`)
  - Client methods: `listBlobs(workspaceId)`, `getBlob(workspaceId, blobKey)`
  - Permet à Claude d'analyser les images stockées dans AFFiNE

- **Blob Storage API** : Upload fichiers au blob storage AFFiNE
  - `POST /workspaces/:workspaceId/blobs` - Upload blob brut
  - Client method: `uploadBlob(workspaceId, { fileName, content, mimeType })`
  - Utilise la mutation GraphQL `setBlob`

- **Image Blocks** : Support complet pour les images dans les documents
  - `POST /workspaces/:workspaceId/documents/:docId/images` - Upload image + création bloc
  - Client method: `addImageBlock(workspaceId, docId, { parentBlockId, image, caption, width, height, position })`
  - Crée des blocs `affine:image` avec `sourceId` pointant vers le blob storage
  - Supporte caption, dimensions, et positionnement

### Technical Details

- Les images AFFiNE nécessitent 2 étapes : upload blob → création bloc avec sourceId
- `addImageBlock()` combine les deux opérations en une seule
- `getBlob()` utilise `arrayBuffer()` pour préserver les données binaires (fix encodage)
- Limite de taille : 10 MB par fichier (base64)
- Format ImageBlockProps BlockSuite : `{ sourceId, caption, width, height, rotate, size }`

## [0.3.1] - 2025-11-07

### Added

- Publication publique : `POST /workspaces/:workspaceId/documents/:docId/publish` et `/revoke` côté REST + MCP (`publish_document`, `revoke_document`).
- Helpers client (`publishDocument`, `revokeDocumentPublication`) avec nouveaux scripts smoke (`tools/run-publication-smoke.mjs`, `tools/run-live-publication-smoke.mjs`).
- Script `tools/run-collaboration-smoke.mjs` référencé dans le guide de tests pour valider commentaires/notifications/tokens via REST.

### Changed

- GraphQL `listNotifications` reflète désormais le schéma production (pagination `PaginationInput` + `edges`).
- Documentation (README, MCP guide, PRD) + page AFFiNE mise à jour avec la surface publication.

## [0.3.0] - 2025-11-08

### Added

- **Commentaires** : 5 endpoints REST (`list/create/update/delete/resolve`) + outils MCP correspondants.
- **Notifications** : endpoints `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` + outils MCP pour lire et marquer les alertes.
- **Tokens personnels** : endpoints `GET|POST|DELETE /users/me/tokens` pour gérer les access tokens AFFiNE.
- **Client TypeScript** : helpers GraphQL (`listComments`, `createAccessToken`, `listNotifications`, etc.) exportés avec les nouveaux types.
- **Tests Vitest** : couverture unitaire des helpers collaboration (comments/notifications/tokens).

### Changed

- README, MCP Guide et PRD collaboration mis à jour (nouvelles sections endpoints, outils et roadmap).
- MCP server passe à 52 outils (ajout commentaires, notifications, tokens).

## [0.2.0] - 2025-11-05

### Added - Phase 2: Workspace Navigation API

- **Workspace Discovery**
  - `GET /workspaces` - List all workspaces with names (hybrid GraphQL + Yjs)
  - `GET /workspaces/:id` - Get workspace details (member count, doc count)
  - `GET /workspaces/:id/hierarchy` - Complete hierarchy (folders + docs + subdocs)
  - `GET /workspaces/:id/folders/:folderId` - Get folder contents with metadata

- **Subdocuments Support**
  - Detection of LinkedPage references in document content
  - Recursive hierarchy building (folders → docs → linked subdocs)
  - Full workspace navigation without prior knowledge of IDs

### Changed

- Architecture now hybrid (GraphQL for metadata + Yjs for content)
- Workspace names loaded from Yjs `meta.name` (not exposed by GraphQL)

### Technical

- Added `getLinkedDocs()` method in AffineClient
- Added `getHierarchy()` for complete tree traversal
- Socket.IO workflow: signIn → connectSocket → joinWorkspace → loadWorkspaceDoc

## [0.1.0] - 2025-11-03

### Added - Initial Release

- **REST API** (27 endpoints)
  - Documents: CRUD complete with Markdown import
  - Blocks: Add/Update/Delete with positioning
  - Edgeless Canvas: Shapes, connectors, text elements
  - Folders: Create, organize documents
  - Tags: List, create, delete

- **TypeScript Client** (`AffineClient`)
  - Authentication (email/password)
  - Socket.IO connection management
  - Yjs document manipulation
  - GraphQL queries for metadata

- **Markdown Support**
  - GitHub Flavored Markdown import
  - Conversion to AFFiNE blocks (paragraphs, lists, code, tables)
  - Preservation of formatting

- **Edgeless Mode**
  - Complete element factory (shapes, connectors, text)
  - Default properties from BlockSuite
  - CRUD operations on canvas elements
  - Primary mode configuration (page/edgeless)

- **Production Deployment**
  - Dokploy Docker Swarm deployment
  - HTTPS with Let's Encrypt
  - Traefik reverse proxy
  - Auto-deploy via GitHub webhook

### Infrastructure

- FastifyHTTP/2 server with Pino logging
- TypeScript ESM with strict mode
- Vitest for unit testing
- Docker multi-stage build

## [0.1.0-mcp] - 2025-11-06

### Added - MCP Server

- **Model Context Protocol Server** (41 tools)
  - Health: `health_check`
  - Workspaces (5): list_workspaces, get_workspace, get_hierarchy, etc.
  - Documents (8): create_document, update_document, search_documents, etc.
  - Blocks (3): add_block, update_block, delete_block
  - Edgeless (5): create_edgeless_element, list_elements, etc.
  - Folders (1): create_folder
  - Tags (3): list_tags, create_tag, delete_tag
  - Meta (1): update_workspace_meta
  - Copilot / Embeddings (8): copilot_search, copilot_embedding_status, list/update ignored docs, queue_doc_embedding, list/add/remove embedding files
  - Historique (2): list_document_history, recover_document_version

- **MCP Configuration**
  - stdio transport for local agents
  - Support for Claude Code (Linux/macOS)
  - Support for Claude Desktop (Windows via npx)
  - Environment variables authentication

- **Documentation**
  - Complete MCP guide (`docs/mcp-guide.md`)
  - Configuration examples (Linux, Windows, SSH)
  - Troubleshooting section
  - Comparison with affine-mcp-server (DAWNCR0W)

### Changed

- README updated with MCP server section
- package.json `bin` field includes `affine-mcp`

## Roadmap

### Phase 3 - Collaboration & Advanced Features

**Planned**:
- [ ] Comments CRUD (aligned with affine-mcp-server)
- [ ] Version history (list/recover)
- [ ] Blob storage (upload/delete/cleanup)
- [ ] Personal access tokens management
- [ ] Notifications (list/read)
- [ ] Database support (tables/board views)

**Under Consideration**:
- [ ] API Keys authentication (production-grade auth)
- [ ] Rate limiting and quotas
- [ ] Webhook support for AFFiNE events
- [ ] OpenAPI specification
- [ ] Multi-format import (DOCX, Notion, Obsidian)

## Migration Notes

### From 0.1.0 to 0.2.0

No breaking changes. New endpoints are additive.

**Recommended**:
- Use `GET /workspaces/:id/hierarchy` instead of `/folders` for complete navigation
- Update workflows to leverage workspace name discovery

### Installing MCP Server

```bash
# Build first
npm run build

# Configure in ~/.mcp.json or claude_desktop_config.json
# See docs/mcp-guide.md for details
```

## Links

- **Production API**: https://affine-api.robotsinlove.be
- **GitHub**: https://github.com/gillespinault/affine_api
- **Documentation**: [README.md](README.md)
- **MCP Guide**: [docs/mcp-guide.md](docs/mcp-guide.md)
