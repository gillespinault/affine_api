# AFFiNE REST API

**Production URL**: https://affine-api.robotsinlove.be

API REST complète pour gérer programmatiquement des documents et dossiers dans une instance AFFiNE self-hosted.

## 🎯 Vue d'ensemble

Ce projet fournit :
- **Client TypeScript** (`AffineClient`) - Authentification, Socket.IO, mutations Yjs
- **API REST Fastify** - 11 endpoints pour documents, folders, et workspace
- **Support Markdown** - Import/export avec GitHub Flavored Markdown
- **Production-ready** - Déployé sur Dokploy avec SSL Let's Encrypt

## 📚 API Endpoints (11 total)

### Health Check
```bash
GET /healthz
```

### Documents (6 endpoints)
```bash
POST   /workspaces/:workspaceId/documents              # Créer document
GET    /workspaces/:workspaceId/documents              # Lister documents
GET    /workspaces/:workspaceId/documents/:docId       # Récupérer document
PATCH  /workspaces/:workspaceId/documents/:docId       # Modifier document
DELETE /workspaces/:workspaceId/documents/:docId       # Supprimer document
PATCH  /workspaces/:workspaceId/documents/:docId/properties  # Modifier tags
```

### Folders (2 endpoints)
```bash
POST   /workspaces/:workspaceId/folders                # Créer dossier
POST   /workspaces/:workspaceId/documents/:docId/move  # Déplacer document
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

### Modifier les tags d'un document

```bash
curl -X PATCH https://affine-api.robotsinlove.be/workspaces/WORKSPACE_ID/documents/DOC_ID/properties \
  -H "Content-Type: application/json" \
  -d '{
    "tags": ["api", "documentation", "production"]
  }'
```

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
│   │   │   ├── affine-client.ts
│   │   │   ├── doc-structure.ts
│   │   │   └── types.ts
│   │   └── markdown/        # Markdown import
│   │       └── markdown-to-yjs.ts
│   ├── service/             # REST API server
│   │   ├── server.ts        # Fastify endpoints
│   │   ├── start.ts         # Entry point
│   │   └── cli/             # CLI tools
│   └── index.ts             # Root exports
├── tests/
│   └── unit/                # Vitest tests
├── dist/                    # Build output (ESM)
├── docs/                    # Documentation
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
