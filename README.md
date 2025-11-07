# AFFiNE REST API

**Production URL**: https://affine-api.robotsinlove.be

API REST complète pour gérer programmatiquement des documents et dossiers dans une instance AFFiNE self-hosted.

## 🎯 Vue d'ensemble

Ce projet fournit :
- **Client TypeScript** (`AffineClient`) – Authentification, Socket.IO, mutations Yjs (refactor en cours pour factoriser les helpers hérités du MCP)
- **API REST Fastify** – 48 endpoints (workspaces, documents, folders, tags, blocks, edgeless, Copilot, historique, commentaires, notifications, tokens)
- **Support Markdown** – Import/export avec GitHub Flavored Markdown
- **Lecture structurée** – Extraction des blocs Yjs en JSON exploitable
- **Opérations sur les blocs** – CRUD complet sur les blocs individuels (paragraphes, listes, etc.)
- **Mode Edgeless / Canvas** ✅ – Création de shapes, connectors, text avec defaults BlockSuite automatiques
- **Configuration du mode** ✅ – Définir le mode par défaut (page/edgeless) d'un document via API
- **Copilot Search & Embeddings** – Recherche vectorielle native, statut, gestion des fichiers et docs ignorés via REST & MCP
- **Serveur MCP** ✨ – 52 outils Model Context Protocol (Copilot/Embeddings, historique, commentaires, notifications, tokens) pour agents IA (Claude Code, Claude Desktop)
- **Intégrations MCP** – Analyse comparative avec `affine-mcp-server` (détails dans `docs/reference/affine-mcp-analysis.md`)
- **Production-ready** – Déployé sur Dokploy avec SSL Let's Encrypt + webhook auto-deploy

## 🤖 Serveur MCP (Model Context Protocol)

En plus de l'API REST, ce projet fournit un **serveur MCP** permettant aux agents IA (Claude Code, Claude Desktop, Cline) de manipuler AFFiNE de manière autonome.

### Pourquoi MCP ?

- **Agents IA natifs** : Exposer les fonctionnalités AFFiNE directement aux LLMs
- **Workflows conversationnels** : "Crée un document avec ce markdown" → Agent exécute automatiquement
- **Prototypage rapide** : Tester des scénarios sans écrire de code d'intégration

### 52 Outils Disponibles

| Catégorie | Outils | Exemples |
|-----------|--------|----------|
| **Workspaces** (5) | list_workspaces, get_workspace, get_hierarchy | Navigation complète workspaces + folders + subdocs |
| **Documents** (8) | create_document, update_document, search_documents | Import Markdown, CRUD complet, recherche |
| **Blocks** (3) | add_block, update_block, delete_block | Ajout paragraphes, listes, code blocks |
| **Edgeless Canvas** (5) | create_edgeless_element, list_elements | Créer shapes, connectors, flowcharts |
| **Folders** (1) | create_folder | Organiser documents |
| **Tags** (3) | list_tags, create_tag, delete_tag | Gestion tags |
| **Copilot / Embeddings** (8) | copilot_search, copilot_embedding_status, list/update ignored docs, queue_doc_embedding, list/add/remove embedding files | Recherche vectorielle AFFiNE, pilotage du pipeline d'indexation |
| **Historique** (2) | list_document_history, recover_document_version | Audit et restauration de versions AFFiNE |
| **Commentaires** (5) | list_comments, create_comment, update_comment, delete_comment, resolve_comment | Collaboration async, suivi des fils avec mentions |
| **Notifications** (3) | list_notifications, read_notification, read_all_notifications | Mettre à jour les alertes utilisateur depuis un workflow |
| **Tokens** (3) | list_access_tokens, create_access_token, revoke_access_token | Gestion self-service des tokens personnels |
| **Meta** (1) | update_workspace_meta | Métadonnées workspace |
| **Health** (1) | health_check | Diagnostic connexion |

### Configuration Rapide

**Claude Code (Linux/macOS)** - `~/.mcp.json` :
```json
{
  "mcpServers": {
    "affine-notebooks": {
      "command": "node",
      "args": ["/path/to/notebooks_api/bin/affine-mcp.js"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.robotsinlove.be",
        "AFFINE_EMAIL": "your-email@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

**Claude Desktop (Windows)** - `%APPDATA%\Claude\claude_desktop_config.json` :
```json
{
  "mcpServers": {
    "affine-notebooks": {
      "command": "npx",
      "args": ["-y", "github:gillespinault/affine_api", "affine-mcp"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.robotsinlove.be",
        "AFFINE_EMAIL": "your-email@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
```

### Documentation Complète

📖 **Guide complet** : [`docs/mcp-guide.md`](docs/mcp-guide.md)
- Installation et configuration détaillée
- Liste exhaustive des 39 outils avec paramètres
- Exemples d'utilisation pratiques
- Troubleshooting (Windows, Linux, macOS)
- Comparaison MCP vs REST API

### Comparaison avec affine-mcp-server

Notre serveur MCP apporte des fonctionnalités absentes du serveur communautaire :

| Fonctionnalité | affine-mcp-server | AFFiNE Notebooks MCP |
|----------------|-------------------|----------------------|
| Support Edgeless | ❌ Basique | ✅ Complet (shapes, connectors) |
| Import Markdown | ❌ Non | ✅ GitHub Flavored Markdown |
| Navigation hiérarchique | ❌ Partielle | ✅ Folders + Subdocs |
| Blocks CRUD | ❌ Append uniquement | ✅ Add/Update/Delete |
| Tags management | ❌ Non | ✅ List/Create/Delete |

Analyse détaillée : [`docs/reference/affine-mcp-analysis.md`](docs/reference/affine-mcp-analysis.md)

## 📚 API Endpoints REST (48 total)

### Health Check
```bash
GET /healthz
```

### Workspace Navigation (5 endpoints - NEW Phase 2)
```bash
GET    /workspaces                                  # List all workspaces with names
GET    /workspaces/:id                              # Get workspace details
GET    /workspaces/:id/folders                      # Get folder tree hierarchy (legacy, excludes subdocs)
GET    /workspaces/:id/hierarchy                    # Get complete hierarchy (folders + docs + subdocs) ✅
GET    /workspaces/:workspaceId/folders/:folderId   # Get folder contents
```

### Documents (7 endpoints)
```bash
POST   /workspaces/:workspaceId/documents                    # Créer document
GET    /workspaces/:workspaceId/documents                    # Lister documents
GET    /workspaces/:workspaceId/documents/:docId             # Récupérer document (snapshot)
GET    /workspaces/:workspaceId/documents/:docId/content     # Lire contenu structuré
PATCH  /workspaces/:workspaceId/documents/:docId             # Modifier document (title, content, primaryMode, folder)
DELETE /workspaces/:workspaceId/documents/:docId             # Supprimer document
PATCH  /workspaces/:workspaceId/documents/:docId/properties  # Modifier tags
```

### Block Operations (3 endpoints)
```bash
POST   /workspaces/:workspaceId/documents/:docId/blocks           # Ajouter un bloc
PATCH  /workspaces/:workspaceId/documents/:docId/blocks/:blockId  # Modifier un bloc
DELETE /workspaces/:workspaceId/documents/:docId/blocks/:blockId  # Supprimer un bloc
```

### Edgeless Mode (5 endpoints - ✅ FONCTIONNEL)
```bash
GET    /workspaces/:workspaceId/documents/:docId/edgeless                      # Lister éléments canvas
POST   /workspaces/:workspaceId/documents/:docId/edgeless/elements             # Créer élément (shape, connector, text, group, mindmap)
GET    /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId  # Récupérer élément
PATCH  /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId  # Modifier élément
DELETE /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId  # Supprimer élément
```

### Folders (2 endpoints)
```bash
POST   /workspaces/:workspaceId/folders                # Créer dossier
POST   /workspaces/:workspaceId/documents/:docId/move  # Déplacer document
```

### Tags (3 endpoints)
```bash
GET    /workspaces/:workspaceId/tags         # Lister tous les tags
POST   /workspaces/:workspaceId/tags         # Créer un tag
DELETE /workspaces/:workspaceId/tags/:tagId  # Supprimer un tag
```

### Copilot / Embeddings (8 endpoints - NOUVEAU)
```bash
GET    /workspaces/:workspaceId/copilot/status             # Suivre le ratio total vs indexé
POST   /workspaces/:workspaceId/copilot/search             # Recherche sémantique (docs/files)
GET    /workspaces/:workspaceId/copilot/ignored-docs       # Lister les docs ignorés
PATCH  /workspaces/:workspaceId/copilot/ignored-docs       # Ajouter/retirer des docs ignorés
POST   /workspaces/:workspaceId/copilot/queue              # Enfiler des docs pour re-embedding
GET    /workspaces/:workspaceId/copilot/files              # Lister les fichiers embarqués
POST   /workspaces/:workspaceId/copilot/files              # Uploader un fichier (base64)
DELETE /workspaces/:workspaceId/copilot/files/:fileId      # Supprimer un fichier
```

### Commentaires (5 endpoints - NOUVEAU)
```bash
GET    /workspaces/:workspaceId/documents/:docId/comments                    # Lister commentaires + replies
POST   /workspaces/:workspaceId/documents/:docId/comments                    # Créer commentaire (Page/Edgeless, mentions)
PATCH  /workspaces/:workspaceId/documents/:docId/comments/:commentId         # Mettre à jour le contenu
DELETE /workspaces/:workspaceId/documents/:docId/comments/:commentId         # Supprimer un commentaire
POST   /workspaces/:workspaceId/documents/:docId/comments/:commentId/resolve # Résoudre / rouvrir un fil
```

### Notifications (3 endpoints)
```bash
GET    /notifications                          # Lister (filtre unreadOnly, pagination simple)
POST   /notifications/:notificationId/read     # Marquer une notification comme lue
POST   /notifications/read-all                 # Tout marquer comme lu
```

### Tokens personnels (3 endpoints)
```bash
GET    /users/me/tokens            # Lister les tokens actifs (id, expiresAt)
POST   /users/me/tokens            # Créer un token (retourne le secret une seule fois)
DELETE /users/me/tokens/:tokenId   # Révoquer un token
```

### Workspace (1 endpoint)
```bash
PATCH  /workspaces/:workspaceId/meta                   # Modifier workspace meta
```

## 🗺️ Workspace Navigation API (Phase 2)

La **Workspace Navigation API** permet de découvrir et naviguer dans la structure complète de vos workspaces AFFiNE.

### Problème résolu

L'API initiale nécessitait de connaître les workspace IDs à l'avance, sans moyen de :
- Lister les workspaces avec leurs **noms** (l'API GraphQL AFFiNE ne retourne que les IDs)
- Comprendre l'arborescence des dossiers
- Identifier le workspace "Robots in Love" parmi plusieurs workspace IDs

### Architecture technique

**Approche hybride GraphQL + Yjs** :
- GraphQL (`/graphql`) fournit les IDs et métadonnées de base
- Yjs (`loadWorkspaceDoc()`) charge les noms depuis `workspace.meta.name`
- **Requis** : `connectSocket()` + `joinWorkspace()` avant tout accès Yjs

### Lister tous les workspaces avec noms

```bash
curl https://affine-api.robotsinlove.be/workspaces
```

**Réponse** :
```json
{
  "workspaces": [
    {
      "id": "b89db6a1-b52c-4634-a5a0-24f555dbebdc",
      "name": "Robots in Love",
      "public": false,
      "enableAi": true,
      "createdAt": "2025-09-22T12:38:38.130Z"
    },
    {
      "id": "65581777-b884-4a3c-af69-f286827e90b0",
      "name": "Tests",
      "public": false,
      "enableAi": true,
      "createdAt": "2025-09-22T13:06:33.440Z"
    }
  ]
}
```

**Champs retournés** :
- `id` : Workspace UUID (requis pour les autres endpoints)
- `name` : Nom du workspace (chargé depuis Yjs meta)
- `public` : Visibilité publique (GraphQL)
- `enableAi` : Fonctionnalités AI activées (GraphQL)
- `createdAt` : Date de création ISO 8601 (GraphQL)

**Note importante** : Le champ `name` peut être `null` si le workspace n'a jamais été nommé dans l'UI AFFiNE.

### Obtenir les détails d'un workspace

```bash
curl https://affine-api.robotsinlove.be/workspaces/b89db6a1-b52c-4634-a5a0-24f555dbebdc
```

**Réponse** :
```json
{
  "id": "b89db6a1-b52c-4634-a5a0-24f555dbebdc",
  "name": "Robots in Love",
  "public": false,
  "enableAi": true,
  "createdAt": "2025-09-22T12:38:38.130Z",
  "memberCount": 1,
  "docCount": 37
}
```

**Champs supplémentaires** :
- `memberCount` : Nombre de membres (via GraphQL `workspace.members`)
- `docCount` : Nombre de documents (via Yjs `meta.pages.length`)

### Obtenir l'arborescence complète (folders + docs + subdocs) ✨ RECOMMANDÉ

```bash
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/hierarchy
```

**Réponse** (arbre récursif avec subdocuments) :
```json
{
  "workspaceId": "b89db6a1-b52c-4634-a5a0-24f555dbebdc",
  "hierarchy": [
    {
      "type": "folder",
      "id": "folder-123",
      "name": "📁 Projects",
      "children": [
        {
          "type": "doc",
          "id": "doc-node-456",
          "name": "Project Alpha",
          "docId": "doc-abc",
          "children": [
            {
              "type": "doc",
              "id": "linked-subdoc-1",
              "name": "Architecture Overview",
              "docId": "subdoc-xyz",
              "children": []
            },
            {
              "type": "doc",
              "id": "linked-subdoc-2",
              "name": "API Specs",
              "docId": "subdoc-def",
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

**Caractéristiques** :
- ✅ **Arborescence complète** : Inclut folders, documents ET subdocuments
- ✅ **Linked docs** : Les documents liés via `@mention` apparaissent comme enfants
- ✅ **Structure récursive** : Supporte plusieurs niveaux d'imbrication
- ✅ **Types explicites** : Chaque nœud a un `type` ('folder' ou 'doc')
- ✅ **IDs de documents** : `docId` fourni pour tous les documents

**Architecture AFFiNE révélée** 🔍 :

Les "subdocs" dans AFFiNE ne sont **PAS** stockés dans `db$workspace$folders`. Ce sont des **LinkedPage references** intégrées dans le contenu du document parent :

```typescript
// Dans les blocs Yjs du document parent
{
  insert: " ",
  attributes: {
    reference: {
      type: "LinkedPage",
      pageId: "child-doc-id"
    }
  }
}
```

L'API parse automatiquement ces références pour construire l'arborescence complète.

**⚠️ Note importante** : Cette méthode charge le contenu de chaque document pour extraire les linked docs. Pour les workspaces avec beaucoup de documents, cela peut prendre quelques secondes.

### Obtenir l'arborescence des dossiers uniquement (legacy)

```bash
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/folders
```

**⚠️ Limitation** : N'inclut PAS les subdocs (linked docs). Utilisez `/hierarchy` pour l'arborescence complète.

**Réponse** (arbre récursif, documents = IDs uniquement) :
```json
{
  "workspaceId": "b89db6a1-b52c-4634-a5a0-24f555dbebdc",
  "folders": [
    {
      "id": "folder-123",
      "name": "📁 Projects",
      "children": [
        {
          "id": "folder-456",
          "name": "🚀 Active",
          "children": [],
          "documents": ["doc-abc", "doc-def"]
        }
      ],
      "documents": ["doc-xyz"]
    }
  ]
}
```

**Structure de l'arbre** :
- Seuls les dossiers **racine** (sans `parentId`) apparaissent au niveau supérieur
- Les sous-dossiers sont imbriqués dans `children`
- Les documents dans chaque dossier sont listés dans `documents` (IDs uniquement, pas de métadonnées)

**Note technique** : L'arborescence est construite depuis le document Yjs `db${workspaceId}$folders` qui contient un YMap de tous les dossiers avec leurs relations `parentId`.

### Obtenir le contenu d'un dossier spécifique

```bash
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/folders/folder-123
```

**Réponse** :
```json
{
  "folderId": "folder-123",
  "name": "📁 Projects",
  "documents": [
    {
      "docId": "doc-abc",
      "title": "Project Alpha",
      "createDate": 1730000000000,
      "updatedDate": 1730010000000,
      "tags": ["project", "active"],
      "folderId": "69ux-EElzNi0t1l1qscJC",
      "folderNodeId": "folder-123"
    },
    {
      "docId": "doc-def",
      "title": "Project Beta",
      "createDate": 1730020000000,
      "updatedDate": 1730030000000,
      "tags": [],
      "folderId": "69ux-EElzNi0t1l1qscJC",
      "folderNodeId": "folder-123"
    }
  ],
  "subfolders": [
    {
      "id": "folder-456",
      "name": "🚀 Active"
    },
    {
      "id": "folder-457",
      "name": "📦 Archived"
    }
  ]
}
```

**Champs retournés** :
- `folderId` : ID du dossier demandé
- `name` : Nom du dossier
- `documents` : Array de **documents complets** avec métadonnées (pas juste des IDs)
- `subfolders` : Sous-dossiers directs (1 niveau uniquement)

**Code erreur 404** : Si le folder n'existe pas dans le YMap folders

### Workflow recommandé pour la navigation

**Scénario 1 - Découvrir les workspaces** :
```bash
# 1. Lister tous les workspaces
curl https://affine-api.robotsinlove.be/workspaces

# 2. Identifier le workspace souhaité par son nom
# → Workspace "Robots in Love" a l'ID b89db6a1-b52c-4634-a5a0-24f555dbebdc

# 3. Obtenir ses détails
curl https://affine-api.robotsinlove.be/workspaces/b89db6a1-b52c-4634-a5a0-24f555dbebdc
```

**Scénario 2 - Explorer la hiérarchie** :
```bash
# 1. Obtenir l'arbre complet de dossiers
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/folders

# 2. Identifier un dossier intéressant (ex: "Projects" → folder-123)

# 3. Récupérer ses documents et sous-dossiers
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/folders/folder-123
```

**Scénario 3 - Créer un document dans le bon workspace** :
```bash
# 1. Lister les workspaces pour trouver le bon ID
WORKSPACE_ID=$(curl -s https://affine-api.robotsinlove.be/workspaces \
  | jq -r '.workspaces[] | select(.name == "Robots in Love") | .id')

# 2. Créer le document
curl -X POST https://affine-api.robotsinlove.be/workspaces/$WORKSPACE_ID/documents \
  -H "Content-Type: application/json" \
  -d '{"title": "My new document", "markdown": "# Hello"}'
```

### Limitations et notes techniques

**GraphQL vs Yjs** :
- **Workspace names** : Uniquement dans Yjs `meta.name` (pas exposé par GraphQL)
- **Doc count** : Calculé depuis Yjs `meta.pages.length` (GraphQL n'a pas ce champ)
- **Folder structure** : Entièrement dans Yjs `db${workspaceId}$folders` (pas dans GraphQL)

**Socket.IO workflow requis** :
```typescript
await client.signIn(email, password);     // 1. Authentification
await client.connectSocket();             // 2. WebSocket connection
await client.joinWorkspace(workspaceId);  // 3. REQUIS avant loadWorkspaceDoc()
await client.loadWorkspaceDoc(...);       // 4. Accès aux données Yjs
```

**Performance** :
- `GET /workspaces` charge les métadonnées de TOUS les workspaces en parallèle (`Promise.all`)
- Temps de réponse typique : ~500-1000ms pour 3 workspaces

**Roadmap** :
- [ ] Support pagination pour workspaces nombreux
- [ ] Cache des workspace names (éviter rechargement à chaque requête)
- [ ] Endpoint pour créer/renommer des dossiers via l'API

## 🚀 Démarrage rapide

### Installation

```bash
cd /home/gilles/serverlab/projects/notebooks_api
npm install
```

### Configuration

Créer un fichier `.env` :

```env
AFFINE_EMAIL=your-email@example.com
AFFINE_PASSWORD=your-password
AFFINE_BASE_URL=https://affine.robotsinlove.be
PORT=3000
```

### Build

```bash
npm run build
```

Le build TypeScript compile `src/` vers `dist/` avec :
- Configuration ESM moderne (`module: "NodeNext"`)
- Extensions `.js` explicites dans les imports
- Source maps pour debugging

### Développement local

```bash
npm run dev
```

Le serveur démarre sur `http://localhost:3000`.

### Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## 🌐 Architecture des environnements

- **Local (développement)**  
  - L’API Fastify tourne en local via `npm run dev` (reload) ou `node dist/service/start.js` après `npm run build`.  
  - Variables nécessaires : `AFFINE_EMAIL`, `AFFINE_PASSWORD`, `AFFINE_BASE_URL` (par défaut `https://affine.robotsinlove.be`).  
  - Utiliser `HOST=127.0.0.1` (ou `HOST=0.0.0.0` lorsque c’est autorisé) et `PORT=<port>` pour personnaliser l’écoute.  
  - Les requêtes REST touchent l’instance AFFiNE distante directement, ce qui permet de valider les changements sans déployer.

- **Production (Dokploy)**  
  - Déployée automatiquement depuis GitHub → branche `main` → Dokploy (Dockerfile).  
  - Secrets `AFFINE_*` sont injectés via Dokploy.  
  - Domaine par défaut : `https://affine-api.robotsinlove.be` avec SSL Let’s Encrypt.

- **Flux recommandé**  
  1. Développer/tester localement (Fastify + scripts `scripts/run-affine-api-test.ts`).  
  2. Commit/push sur `main`.  
  3. Dokploy reconstruit l’image via Webhook et redéploie.  
  4. Vérifier via `/healthz` ou le smoke-test `npm run run-affine-api-test`.

Cette séparation permet de garder un environnement production stable tout en offrant un terrain de test local pour les corrections rapides (ex : reproduction d’un bug sans attendre le déploiement Dokploy).

## 📖 Exemples d'utilisation

### Créer un document avec Markdown

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Mon document",
    "markdown": "# Titre\n\nContenu **formaté** avec du markdown."
  }'
```

**Réponse** :
```json
{
  "docId": "abc123xyz",
  "title": "Mon document",
  "timestamp": 1730000000000,
  "folderNodeId": null
}
```

### Créer un dossier

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/folders \
  -H "Content-Type: application/json" \
  -d '{
    "name": "📁 Mon Dossier",
    "parentId": null
  }'
```

**Réponse** :
```json
{
  "nodeId": "folder-node-123"
}
```

### Déplacer un document dans un dossier

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/move \
  -H "Content-Type: application/json" \
  -d '{
    "folderId": "folder-node-123"
  }'
```

**Réponse** :
```json
{
  "nodeId": "doc-folder-node-456"
}
```

### Lire le contenu structuré d'un document

```bash
curl -X GET https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/content
```

**Réponse** :
```json
{
  "docId": "abc123xyz",
  "title": "Mon document",
  "createDate": 1730000000000,
  "updatedDate": 1730000000000,
  "tags": ["api", "documentation"],
  "folderId": null,
  "folderNodeId": null,
  "blocks": [
    {
      "id": "block-page-1",
      "flavour": "affine:page",
      "props": {
        "title": "Mon document"
      },
      "children": ["block-surface-1", "block-note-1"],
      "text": "Mon document"
    },
    {
      "id": "block-note-1",
      "flavour": "affine:note",
      "props": {
        "xywh": "[0,0,800,95]",
        "background": "--affine-background-secondary-color"
      },
      "children": ["block-para-1", "block-para-2"]
    },
    {
      "id": "block-para-1",
      "flavour": "affine:paragraph",
      "props": {
        "text": "Premier paragraphe avec du texte.",
        "type": "text"
      },
      "children": [],
      "text": "Premier paragraphe avec du texte."
    },
    {
      "id": "block-para-2",
      "flavour": "affine:paragraph",
      "props": {
        "text": "Deuxième paragraphe.",
        "type": "text"
      },
      "children": [],
      "text": "Deuxième paragraphe."
    }
  ]
}
```

**Types de blocs supportés** :
- `affine:page` - Racine du document
- `affine:surface` - Canvas pour mode edgeless
- `affine:note` - Conteneur de contenu
- `affine:paragraph` - Paragraphe de texte
- `affine:list` - Liste (bulleted, numbered, todo)
- `affine:code` - Bloc de code
- `affine:heading` - Titre (h1-h6)
- `affine:divider` - Séparateur horizontal
- `affine:image` - Image
- `affine:bookmark` - Signet/lien
- Et bien d'autres...

### Modifier les tags d'un document

```bash
curl -X PATCH https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/properties \
  -H "Content-Type: application/json" \
  -d '{
    "tags": ["api", "documentation", "production"]
  }'
```

### Opérations sur les blocs (Priority #2)

#### Ajouter un paragraphe

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/blocks \
  -H "Content-Type: application/json" \
  -d '{
    "flavour": "affine:paragraph",
    "parentBlockId": "note-block-id",
    "props": {
      "text": "Nouveau paragraphe ajouté via l'API",
      "type": "text"
    },
    "position": "end"
  }'
```

**Réponse** :
```json
{
  "blockId": "BuLbYU091c46vEhwC3Ulg",
  "timestamp": 1762184437368
}
```

**Options de position** :
- `"start"` - Insérer au début des enfants
- `"end"` - Insérer à la fin (défaut)
- `0`, `1`, `2`, ... - Insérer à l'index spécifique

#### Modifier un bloc existant

```bash
curl -X PATCH https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/blocks/BLOCK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "props": {
      "text": "Texte modifié"
    }
  }'
```

**Réponse** :
```json
{
  "blockId": "BuLbYU091c46vEhwC3Ulg",
  "timestamp": 1762184457665
}
```

#### Supprimer un bloc

```bash
curl -X DELETE https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/blocks/BLOCK_ID
```

**Réponse** :
```json
{
  "blockId": "BuLbYU091c46vEhwC3Ulg",
  "deleted": true
}
```

**Notes importantes** :
- La suppression est récursive (supprime aussi les blocs enfants)
- Impossible de supprimer les blocs racine (affine:page)
- Les métadonnées (createdAt, updatedAt, createdBy, updatedBy) sont gérées automatiquement

### Gestion des tags (NEW)

#### Lister tous les tags

```bash
curl -X GET https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/tags
```

**Réponse** :
```json
{
  "tags": [
    {
      "id": "rs-1en1xsootkpql0AZBN",
      "name": "rs-1en1xsootkpql0AZBN",
      "count": 6
    },
    {
      "id": "CKFttRPiaBYmrtvIYqBVm",
      "name": "CKFttRPiaBYmrtvIYqBVm",
      "count": 2
    }
  ]
}
```

**Notes** :
- Les tags sont triés par usage (décroissant) puis alphabétiquement
- `count` indique le nombre de documents utilisant ce tag
- `id` et `name` sont identiques pour l'instant

#### Créer un tag

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/tags \
  -H "Content-Type: application/json" \
  -d '{"name": "documentation"}'
```

**Réponse** :
```json
{
  "id": "documentation",
  "name": "documentation",
  "count": 0
}
```

**⚠️ Limitation importante** :
Les tags créés via l'API sont stockés dans les documents mais **ne sont PAS visibles dans l'UI AFFiNE** car ils ne sont pas enregistrés dans le registre système des tags.

**Solutions de contournement** :
1. **Créer d'abord les tags dans l'UI AFFiNE** - Ouvrir AFFiNE, créer le tag manuellement, puis l'utiliser via l'API
2. **Utiliser les tags existants** - Lister les tags avec GET /tags et utiliser leurs IDs

#### Supprimer un tag

```bash
curl -X DELETE https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/tags/TAG_ID
```

**Réponse** :
```json
{
  "tagId": "documentation",
  "deleted": true,
  "documentsUpdated": 3
}
```

**Comportement** :
- Supprime le tag de TOUS les documents qui l'utilisent
- Retourne le nombre de documents mis à jour
- Retourne 404 si le tag n'existe pas ou n'est utilisé par aucun document

#### Appliquer des tags à un document

```bash
curl -X PATCH https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/properties \
  -H "Content-Type: application/json" \
  -d '{"tags": ["tag-existant-1", "tag-existant-2"]}'
```

**⚠️ Important** :
- Utiliser uniquement des tags **déjà créés dans l'UI AFFiNE**
- Les tags inexistants seront stockés mais invisibles dans l'UI
- Pour voir quels tags sont disponibles : `GET /workspaces/:id/tags`

**Réponse** :
```json
{
  "docId": "abc123",
  "timestamp": 1762188123445,
  "updated": true
}
```

#### Workflow recommandé pour les tags

**Option 1 - Tags pré-existants (recommandé)** :
```bash
# 1. Lister les tags disponibles
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/tags

# 2. Utiliser un tag existant
curl -X PATCH .../documents/DOC_ID/properties \
  -d '{"tags": ["rs-1en1xsootkpql0AZBN"]}'
```

**Option 2 - Créer via UI puis utiliser** :
1. Ouvrir AFFiNE UI
2. Créer manuellement les tags souhaités ("api", "documentation", etc.)
3. Récupérer leurs IDs via `GET /tags`
4. Utiliser ces IDs dans `PATCH /properties`

**Pourquoi cette limitation ?**

AFFiNE utilise un registre centralisé de tags (probablement dans `workspace meta.tagOptions` ou document système) qui mappe les IDs de tags vers leurs noms et couleurs affichés dans l'UI. Notre API ne modifie actuellement que les références de tags dans les documents, pas ce registre système.

**Roadmap** :
- [ ] Reverse engineering du format `tagOptions` dans AFFiNE
- [ ] Implémentation de la création complète de tags (registre + documents)
- [ ] Support des couleurs et métadonnées de tags

### Mode Edgeless / Canvas (Priority #3)

Le mode **Edgeless** d'AFFiNE est un canvas infini type Miro/Notion Canvas permettant de créer des diagrammes, mind maps, et visualisations.

#### Architecture des éléments Edgeless

**5 types d'éléments supportés** :
- **`shape`** - Formes géométriques (rect, ellipse, diamond, triangle) avec texte
- **`connector`** - Flèches et connecteurs entre éléments
- **`text`** - Blocs de texte flottants
- **`group`** - Groupements d'éléments
- **`mindmap`** - Structures de mind mapping

**Structure des éléments** :
```typescript
interface BaseElement {
  id: string;           // Généré automatiquement
  type: ElementType;    // 'shape' | 'connector' | 'text' | 'group' | 'mindmap'
  index: string;        // Index fractionnaire pour z-order ("a0", "a1", "b0", ...)
  seed: number;         // Seed aléatoire pour rendu cohérent
}
```

#### Lister tous les éléments du canvas

```bash
curl https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless
```

**Réponse** :
```json
{
  "docId": "abc123",
  "elements": [
    {
      "id": "shape-123",
      "type": "shape",
      "index": "a0",
      "seed": 1234567890,
      "shapeType": "rect",
      "xywh": [100, 100, 200, 150],
      "text": "Mon rectangle",
      "fillColor": "#D4F1C5",
      "strokeColor": "#4CAF50",
      "strokeWidth": 2
    }
  ],
  "count": 1
}
```

**⚠️ Prérequis important** :
Le document doit avoir été ouvert au moins une fois en mode Edgeless dans l'interface AFFiNE pour initialiser la structure `surface block`. Sinon, vous obtiendrez l'erreur `"Elements value not found"`.

#### Créer un élément Shape (rectangle, cercle, diamant)

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements \
  -H "Content-Type: application/json" \
  -d '{
    "type": "shape",
    "shapeType": "rect",
    "xywh": [100, 100, 200, 150],
    "text": "Start",
    "fillColor": "#D4F1C5",
    "strokeColor": "#4CAF50",
    "strokeWidth": 3,
    "fontSize": 24,
    "fontWeight": "600"
  }'
```

**Paramètres Shape** :
- `shapeType` : `"rect"` | `"ellipse"` | `"diamond"` | `"triangle"`
- `xywh` : `[x, y, width, height]` - Position et dimensions absolues
- `text` : Texte affiché dans la forme (optionnel)
- `fillColor` : Couleur de remplissage (hex)
- `strokeColor` : Couleur du contour (hex)
- `strokeWidth` : Épaisseur du contour (en pixels)
- `fontSize` : Taille du texte (optionnel, défaut: 20)
- `fontWeight` : Poids du texte (optionnel, défaut: "400")
- `textAlign` : `"left"` | `"center"` | `"right"` (défaut: "center")

**Réponse** :
```json
{
  "id": "BuLbYU091c46vEhwC3Ulg",
  "type": "shape",
  "index": "a0",
  "seed": 1762184437,
  "shapeType": "rect",
  "xywh": [100, 100, 200, 150],
  "text": "Start",
  "fillColor": "#D4F1C5",
  "strokeColor": "#4CAF50",
  "strokeWidth": 3,
  "filled": true,
  "rough": false
}
```

#### Créer un Connector (flèche entre éléments)

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements \
  -H "Content-Type: application/json" \
  -d '{
    "type": "connector",
    "sourceId": "shape-id-1",
    "targetId": "shape-id-2",
    "stroke": "#2196F3",
    "strokeWidth": 3,
    "text": "Label de la flèche"
  }'
```

**Paramètres Connector** :
- `sourceId` : ID de l'élément source (obligatoire)
- `targetId` : ID de l'élément cible (obligatoire)
- `sourcePosition` : `[x, y]` - Point d'attache relatif sur source (défaut: `[1, 0.5]` = droite centre)
- `targetPosition` : `[x, y]` - Point d'attache relatif sur cible (défaut: `[0, 0.5]` = gauche centre)
- `stroke` : Couleur de la flèche (hex)
- `strokeWidth` : Épaisseur de la flèche
- `strokeStyle` : `"solid"` | `"dashed"` | `"dotted"`
- `frontEndpointStyle` : Style pointe avant (défaut: `"None"`)
- `rearEndpointStyle` : Style pointe arrière (défaut: `"Arrow"`)
- `text` : Label sur la flèche (optionnel)

**Positions relatives** :
- `[0, 0]` = coin supérieur gauche
- `[1, 0]` = coin supérieur droit
- `[0.5, 0.5]` = centre
- `[1, 0.5]` = milieu droite

#### Créer un élément Text flottant

```bash
curl -X POST https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "xywh": [300, 50, 200, 40],
    "text": "Note importante",
    "fontSize": 18,
    "color": {
      "dark": "#ffffff",
      "light": "#000000"
    }
  }'
```

**Paramètres Text** :
- `text` : Contenu textuel (obligatoire)
- `xywh` : `[x, y, width, height]`
- `fontSize` : Taille du texte (défaut: 16)
- `fontWeight` : `"400"` | `"600"` | `"700"` (défaut: "400")
- `fontFamily` : Police (défaut: `"blocksuite:surface:Inter"`)
- `textAlign` : `"left"` | `"center"` | `"right"` (défaut: "left")
- `color` : Objet `{dark, light}` pour thème clair/sombre

#### Modifier un élément existant

```bash
curl -X PATCH https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements/ELEMENT_ID \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Texte modifié",
    "fillColor": "#FFCDD2",
    "xywh": [150, 150, 250, 180]
  }'
```

**Modification partielle** : Seules les propriétés fournies sont modifiées.

#### Supprimer un élément

```bash
curl -X DELETE https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements/ELEMENT_ID
```

**Réponse** :
```json
{
  "elementId": "BuLbYU091c46vEhwC3Ulg",
  "deleted": true
}
```

#### Exemple complet : Créer un flowchart

```bash
# 1. Créer le nœud "Start"
START=$(curl -s -X POST "https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{"type":"shape","shapeType":"rect","xywh":[100,100,200,100],"text":"Start","fillColor":"#D4F1C5","strokeColor":"#4CAF50"}' \
  | jq -r '.id')

# 2. Créer le nœud "Process"
PROCESS=$(curl -s -X POST "https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{"type":"shape","shapeType":"diamond","xywh":[400,100,180,120],"text":"Process","fillColor":"#BBDEFB","strokeColor":"#2196F3"}' \
  | jq -r '.id')

# 3. Créer le nœud "End"
END=$(curl -s -X POST "https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{"type":"shape","shapeType":"ellipse","xywh":[700,100,180,100],"text":"End","fillColor":"#FFCDD2","strokeColor":"#F44336"}' \
  | jq -r '.id')

# 4. Connecter Start → Process
curl -s -X POST "https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"connector\",\"sourceId\":\"$START\",\"targetId\":\"$PROCESS\",\"stroke\":\"#4CAF50\",\"strokeWidth\":3}"

# 5. Connecter Process → End
curl -s -X POST "https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"connector\",\"sourceId\":\"$PROCESS\",\"targetId\":\"$END\",\"stroke\":\"#2196F3\",\"strokeWidth\":3}"
```

#### Limitations et notes techniques

**⚠️ Document structure required** :
- Le document doit avoir un `affine:surface` block initialisé
- Ouvrir le document en mode Edgeless dans l'UI AFFiNE avant d'utiliser l'API
- L'erreur `"Elements value not found"` indique un document sans structure Edgeless

**Z-ordering (layering)** :
- L'ordre des éléments est géré via l'`index` (fractionnaire: "a0", "a1", "aZ", "b0", ...)
- Les index sont générés automatiquement par ordre d'insertion
- L'API ne permet pas encore de modifier l'ordre (roadmap future)

**Coordonnées absolues** :
- Le système de coordonnées `xywh` utilise des pixels absolus
- Origine `[0, 0]` en haut à gauche du canvas
- Canvas infini (pas de limites théoriques)

**Types non encore supportés** :
- `group` - Groupements d'éléments (structure identifiée, implémentation à venir)
- `mindmap` - Mind maps (structure identifiée, implémentation à venir)

**Roadmap Edgeless API** :
- [x] Support des element defaults (shape, connector, text) - ✅ Résolu
- [x] Configuration du mode par défaut (primaryMode) - ✅ Résolu
- [ ] Support complet de `group` et `mindmap`
- [ ] Gestion du z-order (réordonner les éléments)
- [ ] Initialisation automatique du surface block
- [ ] Support des images et media dans le canvas
- [ ] Opérations batch (créer plusieurs éléments en une requête)

### Configurer le mode par défaut d'un document

AFFiNE supporte deux modes d'affichage pour les documents :
- **`page`** (défaut) - Mode éditeur de texte classique
- **`edgeless`** - Mode canvas pour diagrammes et mind maps

Vous pouvez configurer le mode par défaut via l'API :

```bash
# Passer un document en mode edgeless par défaut
curl -X PATCH https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID \
  -H "Content-Type: application/json" \
  -d '{"primaryMode": "edgeless"}'
```

**Réponse** :
```json
{
  "docId": "MSberxztj0DMWATG61itf",
  "title": "Edgeless API Test",
  "tags": [],
  "folderId": null,
  "folderNodeId": null,
  "timestamp": 1762343236909
}
```

**Notes** :
- Le `primaryMode` est stocké dans `db$workspace$docProperties` (synchronisé via CRDT)
- Le changement est persistant et affecte tous les clients
- À l'ouverture du document, l'UI AFFiNE utilisera ce mode par défaut
- Peut être combiné avec d'autres mises à jour : `{"title": "Nouveau titre", "primaryMode": "edgeless"}`

## 🏗️ Architecture

### Stack technique

- **Runtime** : Node.js 20+
- **Framework** : Fastify 4.x (HTTP/2, logging Pino)
- **Client** : Socket.IO client 4.x + Yjs 13.x
- **Language** : TypeScript 5.6 (ESM strict)
- **Build** : tsc (pas de bundler)

### Structure du projet

```
/home/gilles/serverlab/projects/notebooks_api/
├── src/
│   ├── client/              # AffineClient + Yjs utilities
│   │   ├── index.ts         # Public exports
│   │   ├── runtime/         # Client implementation
│   │   │   ├── affine-client.ts      # Main client (23 methods)
│   │   │   ├── doc-structure.ts      # Yjs utilities
│   │   │   ├── edgeless-factory.ts   # Element factories (NEW)
│   │   │   └── types.ts
│   │   ├── types/           # TypeScript definitions
│   │   │   └── edgeless.ts            # Edgeless types (NEW)
│   │   └── markdown/        # Markdown import
│   │       └── markdown-to-yjs.ts
│   ├── service/             # REST API server
│   │   ├── server.ts        # Fastify endpoints (23 endpoints)
│   │   ├── start.ts         # Entry point
│   │   └── cli/             # CLI tools
│   └── index.ts             # Root exports
├── tests/
│   └── unit/                # Vitest tests
├── dist/                    # Build output (ESM)
├── docs/                    # Documentation
│   └── EDGELESS_DESIGN.md   # Edgeless implementation (NEW)
├── package.json
├── tsconfig.json            # TypeScript config
└── README.md
```

### Déploiement (Dokploy)

**Infrastructure** :
```
Internet (HTTPS)
  ↓ (Let's Encrypt SSL)
nginx VPS (185.158.132.168)
  ↓ proxy_pass (Tailscale)
Traefik (100.80.12.35:443)
  ↓ (Host-based routing)
Docker Swarm Service
  ↓ (dokploy-network overlay)
affine-api container (port 3000)
```

**Service Docker** :
- **Image** : Built from `Dockerfile` via Dokploy
- **Network** : `dokploy-network` (overlay)
- **Replicas** : 1
- **Auto-deploy** : Git push → GitHub → Webhook Dokploy

**Webhook URL** (pour CI/CD) :
```
https://dokploy.robotsinlove.be/api/deploy/kDjCutKV2keMoxHUGvEqg
```

## 🏗️ Architecture AFFiNE

### Organisation hybride des documents

AFFiNE utilise une architecture hybride pour organiser les documents :

#### 1. Structure explicite (Folders)

Stockée dans `db$workspaceId$folders` (document Yjs) :
- **Folders** : Dossiers avec `type: 'folder'`
- **Docs organisés** : Documents placés dans des dossiers avec `folderId` et `folderNodeId`
- **Autres types** : Tags (`type: 'tag'`), Collections (`type: 'collection'`)

Cette structure est retournée par l'endpoint `/folders` (legacy).

#### 2. Liens dynamiques (LinkedPage)

Les "subdocs" (documents enfants d'un autre document) ne sont **pas stockés dans la structure folders**. Ils sont représentés comme des **références dans le contenu du document parent**.

**Mécanisme technique** :
- Chaque document contient une YMap `blocks` avec tous ses blocs de contenu
- Les blocs de type paragraphe ont une propriété `prop:text` (Y.Text)
- Le Y.Text contient des **Delta operations** avec des attributs riches
- Les liens vers d'autres documents utilisent l'attribut `reference` :

```typescript
{
  insert: "Running Shoes",
  attributes: {
    reference: {
      type: 'LinkedPage',
      pageId: 'ZBcRJwoMfg91W96LwzdWT'
    }
  }
}
```

**Détection des subdocs** (méthode `getLinkedDocs()`) :
1. Charger le document parent via `loadWorkspaceDoc(workspaceId, docId)`
2. Récupérer la YMap `blocks`
3. Pour chaque bloc, extraire `prop:text` (Y.Text)
4. Parser les Delta operations avec `toDelta()`
5. Filtrer les operations ayant `attributes.reference.type === 'LinkedPage'`
6. Extraire les `pageId` de chaque référence

**Exemple réel** (workspace "Robots in Love") :
```
Shenzhen Round 2 (folder)
└── Shopping (doc)
    ├── Running Shoes (subdoc via LinkedPage)
    ├── Quartier pour running Shoes (subdoc via LinkedPage)
    └── Earbuds (subdoc via LinkedPage)
```

Le document "Shopping" contient 3 blocs avec des références LinkedPage vers les subdocs.

#### 3. Endpoint `/hierarchy` (recommandé)

Combine les deux mécanismes :
- Charge la structure explicite depuis `/folders`
- Pour chaque document trouvé, extrait les LinkedPage via `getLinkedDocs()`
- Ajoute les subdocs comme enfants avec `id: linked-${docId}`
- Retourne l'arborescence **complète** (folders + docs + subdocs)

**Avantage** : Reflète exactement ce que l'utilisateur voit dans l'interface AFFiNE.

**Code implémentation** : `src/client/runtime/affine-client.ts`
- Ligne 2188 : `getLinkedDocs()` - Extraction des LinkedPage
- Ligne 2234 : `getHierarchy()` - Construction de la hiérarchie complète

## 🔐 Sécurité

### Authentification

L'API utilise les credentials côté serveur (pas d'API keys) :
- Authentification AFFiNE via `AFFINE_EMAIL` + `AFFINE_PASSWORD`
- Toutes les requêtes sont effectuées au nom du compte configuré
- Socket.IO session gérée automatiquement par le client

### Transport

- **HTTPS** : Obligatoire en production (certificat Let's Encrypt)
- **HTTP/2** : Activé via nginx
- **WebSocket** : Support configuré pour Socket.IO

### À implémenter (roadmap)

- [ ] Rate limiting (protection DDoS)
- [ ] API Keys pour authentification client
- [ ] CORS configuration
- [ ] Request validation (schemas)

## 🐛 Débogage

## ✅ État & prochaines étapes

### Ce qui est en place (2025-11-07)

- REST : 48 endpoints (Workspaces, Documents, Blocks, Tags, Edgeless, Copilot, Historique, Commentaires, Notifications, Tokens).
- MCP : 52 outils (surface complète REST + Commentaires/Notifications/Tokens).
- Smoke tests :
  - `scripts/run-affine-api-test.ts` – CRUD Markdown + tags.
  - `scripts/run-copilot-embedding-smoke.ts` – embeddings + `/copilot/search` (doc `SxjNhXGckl3oz2RTVUc8p`).
  - `scripts/run-history-recovery-smoke.ts` – `/history` + `/history/recover` (doc `t9dGJJqbC2gAvlbonvj4P`).
- Documentation utilisateur synchronisée dans AFFiNE (`Affine_API/Documentation/AFFiNE REST API – Guide 2025-11`).
- Déploiement Dokploy opérationnel (auto-deploy sur `main`).

### Priorité suivante (Phase 3b)

1. Publication publique / révocation des documents.
2. Lifecycle workspace (create/update/delete) pour provisioner des sandboxes.
3. Blob storage + `apply_doc_updates` pour les migrations massives.

> Conserver le workflow : helpers client → REST → MCP → script smoke + mise à jour AFFiNE.


### Logs serveur

```bash
# Production logs (Dokploy)
docker service logs serverlabapps-affineapi-6bk95t --tail 100 -f

# Filtrer par type de requête
docker service logs serverlabapps-affineapi-6bk95t | grep -E '(POST|GET|PATCH|DELETE)'

# Voir uniquement les erreurs
docker service logs serverlabapps-affineapi-6bk95t | grep '"level":50'
```

### Logs Fastify

Format JSON structuré (Pino) :
```json
{
  "level": 30,
  "time": 1762174481034,
  "pid": 20,
  "hostname": "6fc543a6cfa8",
  "reqId": "req-1",
  "req": {
    "method": "POST",
    "url": "/workspaces/xxx/folders",
    "hostname": "affine-api.robotsinlove.be"
  },
  "res": {
    "statusCode": 201
  },
  "responseTime": 2866.73,
  "msg": "request completed"
}
```

### Erreurs communes

**1. "NOT_IN_SPACE" (403)**
- **Cause** : Le client n'a pas rejoint le workspace Socket.IO
- **Fix** : Appeler `await client.joinWorkspace(workspaceId)` avant toute opération
- **Note** : Déjà implémenté dans tous les endpoints depuis v0.1.0

**2. "ERR_MODULE_NOT_FOUND"**
- **Cause** : Imports ESM sans extensions `.js`
- **Fix** : Utiliser `import { foo } from './bar.js'` (pas `./bar`)
- **Note** : Résolu avec `moduleResolution: "NodeNext"` dans tsconfig

**3. Nginx 500**
- **Cause** : Mauvaise configuration proxy_pass
- **Fix** : Vérifier que nginx pointe vers Traefik Tailscale (100.80.12.35:443)
- **Contact** : claude-vps pour modifications nginx

## 📝 Contribuer

### Workflow Git

```bash
# Feature branch
git checkout -b feature/ma-feature
git add .
git commit -m "feat: Description"
git push origin feature/ma-feature

# Main branch (production)
git checkout main
git pull origin main
git push origin main  # → Auto-deploy via webhook
```

### Conventions

- **Commits** : [Conventional Commits](https://www.conventionalcommits.org/)
  - `feat:` Nouvelle fonctionnalité
  - `fix:` Correction de bug
  - `docs:` Documentation
  - `refactor:` Refactoring sans changement de comportement

- **TypeScript** : Strict mode activé
- **Linting** : ESLint + Prettier (automatique)
- **Tests** : Vitest pour toutes les nouvelles features

## 📦 Build Docker

### Dockerfile

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/service/start.js"]
```

### Build local

```bash
docker build -t affine-api:local .
docker run -p 3000:3000 \
  -e AFFINE_EMAIL=email@example.com \
  -e AFFINE_PASSWORD=password \
  -e AFFINE_BASE_URL=https://affine.robotsinlove.be \
  affine-api:local
```

## 🔗 Liens

- **Production API** : https://affine-api.robotsinlove.be
- **AFFiNE instance** : https://affine.robotsinlove.be
- **GitHub** : https://github.com/gillespinault/affine_api
- **Dokploy** : https://dokploy.robotsinlove.be
- **Documentation AFFiNE** : https://affine.pro/docs

## 📄 Licence

MIT

## 🙏 Remerciements

- AFFiNE Team pour l'instance self-hosted
- Dokploy pour l'orchestration Docker
- claude-vps pour la configuration nginx

---

**Version** : 0.2.0 (Phase 2 - Workspace Navigation API)
**Dernière mise à jour** : 2025-11-05
**Statut** : ✅ Production
**Mainteneur** : Gilles Pinault (@gillespinault)
- **Collaboration** (planning) : commentaires, historique, tokens API, notifications (voir roadmap)
- **Blob storage** (planning) : upload/suppression fichiers, aligné avec MCP `blobStorage`
- **Interop MCP** : le serveur `affine-mcp-server` couvre workspace/doc/commentaires (voir `docs/reference/affine-mcp-analysis.md`). Notre API ajoute Edgeless, import multi-format, databases.
