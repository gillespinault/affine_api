# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- **Model Context Protocol Server** (31 tools)
  - Health: `health_check`
  - Workspaces (5): list_workspaces, get_workspace, get_hierarchy, etc.
  - Documents (8): create_document, update_document, search_documents, etc.
  - Blocks (3): add_block, update_block, delete_block
  - Edgeless (5): create_edgeless_element, list_elements, etc.
  - Folders (1): create_folder
  - Tags (3): list_tags, create_tag, delete_tag
  - Meta (1): update_workspace_meta

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
