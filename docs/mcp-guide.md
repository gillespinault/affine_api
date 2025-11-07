# AFFiNE Notebooks MCP Server - Guide Complet

| Champ | Détail |
|-------|--------|
| Version | 0.1.0 |
| Date | 2025-11-06 |
| Statut | Production |
| Auteur | ServerLab Team |

---

## 📋 Table des matières

1. [Introduction](#1-introduction)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Liste des outils MCP](#4-liste-des-outils-mcp)
5. [Exemples d'utilisation](#5-exemples-dutilisation)
6. [Troubleshooting](#6-troubleshooting)
7. [Comparaison REST API vs MCP](#7-comparaison-rest-api-vs-mcp)

---

## 1. Introduction

Le **serveur MCP AFFiNE Notebooks** expose 39 outils via le protocole [Model Context Protocol](https://modelcontextprotocol.io) pour permettre aux agents IA (Claude Code, Claude Desktop, Cline, etc.) de manipuler programmatiquement des workspaces, documents, blocs, dossiers, tags, éléments Edgeless et les embeddings Copilot dans AFFiNE.

### Différences avec affine-mcp-server (DAWNCR0W)

Notre serveur MCP se distingue du serveur communautaire [\`affine-mcp-server\`](https://github.com/DAWNCR0W/affine-mcp-server) par :

| Fonctionnalité | affine-mcp-server | AFFiNE Notebooks MCP |
|----------------|-------------------|----------------------|
| **Support Edgeless** | ❌ Basique (notes uniquement) | ✅ Complet (shapes, connectors, text) |
| **Import Markdown** | ❌ Non supporté | ✅ GitHub Flavored Markdown |
| **Navigation hiérarchique** | ❌ Partielle | ✅ Folders + Subdocs complets |
| **Blocks CRUD** | ❌ Append uniquement | ✅ Add/Update/Delete avec position |
| **Tags management** | ❌ Non supporté | ✅ List/Create/Delete tags |
| **Content structuré** | ❌ Binaire Yjs | ✅ JSON exploitable (blocs) |
| **Architecture** | GraphQL + WebSocket | REST API + Client TypeScript |

Voir [\`docs/reference/affine-mcp-analysis.md\`](reference/affine-mcp-analysis.md) pour analyse détaillée.

---

## 2. Installation

### Prérequis

- **Node.js** ≥ 20.8.0 (recommandé : 20.19.5 via nvm)
- **AFFiNE instance** accessible (cloud ou self-hosted)
- **Claude Code** ou **Claude Desktop** installé

### Build du serveur

\`\`\`bash
cd /path/to/notebooks_api
npm install
npm run build
\`\`\`

Le serveur MCP sera compilé dans \`dist/mcp/start.js\` avec le binaire \`bin/affine-mcp.js\`.

---

## 3. Configuration

### 3.1 Claude Code (Linux/macOS)

**Fichier** : \`~/.mcp.json\` ou \`.mcp.json\` dans le projet

\`\`\`json
{
  "mcpServers": {
    "affine-notebooks": {
      "command": "/path/to/node",
      "args": ["/path/to/notebooks_api/bin/affine-mcp.js"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.robotsinlove.be",
        "AFFINE_EMAIL": "your-email@example.com",
        "AFFINE_PASSWORD": "your-password"
      }
    }
  }
}
\`\`\`

**Activation** : \`~/.claude/settings.local.json\`

\`\`\`json
{
  "enabledMcpjsonServers": ["affine-notebooks"]
}
\`\`\`

### 3.2 Claude Desktop (Windows)

**Fichier** : \`%APPDATA%\\Claude\\claude_desktop_config.json\`

#### Option A : Installation via npx (recommandé)

\`\`\`json
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
\`\`\`

**Note** : Le serveur se build automatiquement via le script \`prepare\` lors de l'installation.

### 3.3 Variables d'environnement

| Variable | Requis | Description | Défaut |
|----------|--------|-------------|--------|
| \`AFFINE_BASE_URL\` | Non | URL instance AFFiNE | \`https://affine.robotsinlove.be\` |
| \`AFFINE_EMAIL\` | **Oui** | Email compte AFFiNE | - |
| \`AFFINE_PASSWORD\` | **Oui** | Mot de passe | - |

⚠️ **Sécurité** : Ne jamais commiter les credentials dans git.

---

## 4. Liste des outils MCP (39 outils)

### 4.1 Health (1 outil)

- **\`health_check\`** : Vérifier connectivité AFFiNE

### 4.2 Workspaces (5 outils)

- **\`list_workspaces\`** : Lister tous les workspaces
- **\`get_workspace\`** : Détails d'un workspace
- **\`get_folder_tree\`** : Arborescence dossiers (legacy)
- **\`get_workspace_hierarchy\`** ⭐ : Hiérarchie complète (folders + docs + subdocs)
- **\`get_folder_contents\`** : Contenu d'un dossier

### 4.3 Documents (8 outils)

- **\`list_documents\`** : Lister documents
- **\`get_document\`** : Snapshot binaire
- **\`get_document_content\`** ⭐ : Contenu structuré (blocs JSON)
- **\`create_document\`** ⭐ : Créer avec Markdown/texte
- **\`update_document\`** : Modifier contenu/metadata
- **\`delete_document\`** : Supprimer
- **\`move_document\`** : Déplacer entre dossiers
- **\`update_document_properties\`** : Modifier tags
- **\`search_documents\`** : Recherche par titre/tags

### 4.4 Blocks (3 outils)

- **\`add_block\`** : Ajouter paragraphe/liste/code
- **\`update_block\`** : Modifier bloc
- **\`delete_block\`** : Supprimer bloc

### 4.5 Edgeless Canvas (5 outils)

- **\`list_edgeless_elements\`** : Lister éléments canvas
- **\`create_edgeless_element\`** ⭐ : Créer shapes/connectors/text
- **\`get_edgeless_element\`** : Récupérer élément
- **\`update_edgeless_element\`** : Modifier élément
- **\`delete_edgeless_element\`** : Supprimer élément

### 4.6 Folders (1 outil)

- **\`create_folder\`** : Créer dossier

### 4.7 Tags (3 outils)

- **\`list_tags\`** : Lister tous les tags
- **\`create_tag\`** : Créer tag (⚠️ limitation UI)
- **\`delete_tag\`** : Supprimer tag

### 4.8 Workspace Meta (1 outil)

- **\`update_workspace_meta\`** : Mettre à jour métadonnées

### 4.9 Copilot / Embeddings (8 outils)

- **\`copilot_search\`** : Recherche sémantique (docs/files) via les embeddings AFFiNE
- **\`copilot_embedding_status\`** : Statistiques total vs indexé d’un workspace
- **\`list_embedding_ignored_docs\`** : Lister les documents exclus de l’index
- **\`update_embedding_ignored_docs\`** : Ajouter/retirer des docIds ignorés
- **\`queue_doc_embedding\`** : Enfiler des documents pour re-embedding
- **\`list_embedding_files\`** : Inventorier les fichiers/attachments indexés
- **\`add_embedding_file\`** : Uploader un fichier (base64 ou data URL)
- **\`remove_embedding_file\`** : Supprimer un fichier et ses embeddings associés

Voir documentation complète de chaque outil dans le guide complet.

---

## 5. Exemples d'utilisation

### Créer une note de réunion

1. \`list_workspaces()\` → Identifier workspace
2. \`create_document(title="Meeting Notes", markdown="# Agenda...", tags=["meeting"])\`
3. \`add_block(flavour="affine:paragraph", props={text: "Action items..."})\`

### Créer un flowchart Edgeless

1. \`create_document(title="Flowchart")\`
2. \`update_document(primaryMode="edgeless")\`
3. \`create_edgeless_element(element={type:"shape", shapeType:"rect", xywh:[100,100,200,100], text:"Start"})\`
4. \`create_edgeless_element(element={type:"connector", sourceId:"shape-1", targetId:"shape-2"})\`

---

## 6. Troubleshooting

### Serveur ne démarre pas

\`\`\`bash
# Tester manuellement
node /path/to/bin/affine-mcp.js
# Devrait afficher: ✓ MCP Server ready
\`\`\`

**Solutions** :
- Vérifier build : \`npm run build\`
- Vérifier credentials env
- Vérifier connectivité : \`curl https://affine.robotsinlove.be\`

### Windows - npx timeout

**Solutions** :
- Vider cache : \`Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\npm-cache\\_npx"\`
- Redémarrer Claude Desktop

### Tags non visibles dans l'UI

**Cause** : Tags non enregistrés dans registre système AFFiNE

**Solution** : Créer d'abord les tags dans l'interface AFFiNE, puis les utiliser via l'API

---

## 7. Comparaison REST API vs MCP

| Aspect | MCP | REST API |
|--------|-----|----------|
| **Usage** | Agents IA, workflows conversationnels | Apps production, intégrations systèmes |
| **Transport** | stdio (local) | HTTPS |
| **Auth** | Env vars | API Keys (roadmap) |
| **État** | Stateful | Stateless |
| **Monitoring** | Logs stderr | Structured logs |

**Peuvent-ils coexister ?** ✅ Oui ! Même \`AffineClient\` sous-jacent.

---

## 8. Ressources

- **REST API** : [\`README.md\`](../README.md)
- **Architecture** : [\`docs/architecture.md\`](architecture.md)
- **Roadmap** : [\`docs/roadmap.md\`](roadmap.md)
- **Edgeless Design** : [\`EDGELESS_DESIGN.md\`](../EDGELESS_DESIGN.md)
- **MCP Spec** : https://modelcontextprotocol.io

---

**Version** : 0.1.0 | **Dernière mise à jour** : 2025-11-06 | **Statut** : ✅ Production
