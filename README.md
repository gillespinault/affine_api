# AFFiNE REST API

**Production URL**: https://affine-api.robotsinlove.be

API REST complète pour gérer programmatiquement des documents et dossiers dans une instance AFFiNE self-hosted.

## 🎯 Vue d'ensemble

Ce projet fournit :
- **Client TypeScript** (`AffineClient`) - Authentification, Socket.IO, mutations Yjs
- **API REST Fastify** - 23 endpoints pour documents, folders, tags, blocks, et edgeless mode
- **Support Markdown** - Import/export avec GitHub Flavored Markdown
- **Lecture structurée** - Extraction des blocs Yjs en JSON exploitable
- **Opérations sur les blocs** - CRUD complet sur les blocs individuels (paragraphes, listes, etc.)
- **Mode Edgeless / Canvas** - Manipulation programmatique de diagrammes, flowcharts, mind maps
- **Production-ready** - Déployé sur Dokploy avec SSL Let's Encrypt + webhook auto-deploy

## 📚 API Endpoints (23 total)

### Health Check
```bash
GET /healthz
```

### Documents (7 endpoints)
```bash
POST   /workspaces/:workspaceId/documents                    # Créer document
GET    /workspaces/:workspaceId/documents                    # Lister documents
GET    /workspaces/:workspaceId/documents/:docId             # Récupérer document (snapshot)
GET    /workspaces/:workspaceId/documents/:docId/content     # Lire contenu structuré
PATCH  /workspaces/:workspaceId/documents/:docId             # Modifier document
DELETE /workspaces/:workspaceId/documents/:docId             # Supprimer document
PATCH  /workspaces/:workspaceId/documents/:docId/properties  # Modifier tags
```

### Block Operations (3 endpoints)
```bash
POST   /workspaces/:workspaceId/documents/:docId/blocks           # Ajouter un bloc
PATCH  /workspaces/:workspaceId/documents/:docId/blocks/:blockId  # Modifier un bloc
DELETE /workspaces/:workspaceId/documents/:docId/blocks/:blockId  # Supprimer un bloc
```

### Edgeless Mode (5 endpoints - NEW Priority #3)
```bash
GET    /workspaces/:workspaceId/documents/:docId/edgeless                      # Lister éléments canvas
POST   /workspaces/:workspaceId/documents/:docId/edgeless/elements             # Créer élément
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

### Workspace (1 endpoint)
```bash
PATCH  /workspaces/:workspaceId/meta                   # Modifier workspace meta
```

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
- [ ] Support complet de `group` et `mindmap`
- [ ] Gestion du z-order (réordonner les éléments)
- [ ] Initialisation automatique du surface block
- [ ] Support des images et media dans le canvas
- [ ] Opérations batch (créer plusieurs éléments en une requête)

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

**Version** : 0.1.0
**Dernière mise à jour** : 2025-11-03
**Statut** : ✅ Production
**Mainteneur** : Gilles Pinault (@gillespinault)
