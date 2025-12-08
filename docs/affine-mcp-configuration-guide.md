# Guide Complet : Configuration MCP AFFiNE pour Claude, ChatGPT & Gemini

**Date**: 2025-11-06
**Auteur**: Claude Code
**Instance AFFiNE**: https://affine.robotsinlove.be

---

## 📊 Skills vs MCP : Quelle approche choisir ?

### 🎯 Skills (Claude Code uniquement)

**Qu'est-ce que c'est ?**
- Dossiers Markdown qui apprennent à Claude **comment** effectuer des tâches
- Chargés à la demande (efficient en tokens)
- Procédures, workflows, standards, patterns

**Avantages** :
- ✅ **Ultra-efficient** : Seulement les Skills pertinents sont chargés
- ✅ **Simple** : Juste des fichiers Markdown + YAML frontmatter
- ✅ **Maintenance facile** : Éditer un `.md`, c'est tout
- ✅ **Rapide** : Pas de serveur externe, pas de réseau

**Limites** :
- ❌ **Claude Code uniquement** : Ne fonctionne pas avec ChatGPT/Gemini
- ❌ **Pas d'intégration système** : Pas d'accès aux APIs externes
- ❌ **Données statiques** : Pas de requêtes en temps réel

**Quand utiliser Skills ?**
- Templates de briefs/PRDs
- Workflows de développement
- Standards de code
- Procédures répétitives

---

### 🔌 MCP (Model Context Protocol)

**Qu'est-ce que c'est ?**
- Protocole standard pour connecter des LLMs **aux** systèmes externes
- Serveurs MCP qui exposent des outils (APIs, bases de données, etc.)
- Standard ouvert d'Anthropic, adopté par OpenAI, Google, Microsoft

**Avantages** :
- ✅ **Multi-clients** : Claude Desktop, ChatGPT, Gemini CLI, etc.
- ✅ **Intégrations système** : Accès temps réel aux APIs, BDD, fichiers
- ✅ **Écosystème riche** : 100+ serveurs MCP open source
- ✅ **Données dynamiques** : Requêtes, créations, modifications en temps réel

**Limites** :
- ❌ **Consomme beaucoup de tokens** : Surtout avec plusieurs serveurs
- ❌ **Plus complexe** : Config JSON, serveurs Node/Python
- ❌ **Latence réseau** : Communication client ↔ serveur

**Quand utiliser MCP ?**
- Intégration avec systèmes existants (AFFiNE, GitHub, Jira, etc.)
- Opérations CRUD en temps réel
- Besoin de partager les outils entre plusieurs LLMs
- Workflows collaboratifs

---

### 🎯 Recommandation pour ton cas

**Pour AFFiNE** → **MCP** est la meilleure approche car :
1. ✅ Tu veux écrire/éditer des notes en temps réel
2. ✅ Tu veux chercher dans tes documents existants
3. ✅ Tu veux utiliser depuis Claude, ChatGPT ET Gemini
4. ✅ Les embeddings AFFiNE nécessitent l'accès API

**Bonus** : Tu peux créer un **Skill** qui documente comment utiliser le serveur MCP AFFiNE !

---

## 🚀 Configuration MCP par plateforme

### 1️⃣ Claude Desktop (Natif ✅)

**Support** : Officiel depuis novembre 2024
**Complexité** : ⭐️ Facile
**Recommandé** : ✅ Oui

#### Installation

1. **Installer Claude Desktop** : https://claude.ai/download

2. **Localiser le fichier de config** :
   - **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Linux** : `~/.config/Claude/claude_desktop_config.json`

3. **Éditer via l'interface** :
   - Ouvrir Claude Desktop
   - Aller dans Settings → Developer
   - Cliquer sur "Edit Config"

4. **Ajouter la configuration AFFiNE** :

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["-y", "affine-mcp-server@latest"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.robotsinlove.be",
        "AFFINE_EMAIL": "gillespinault@gmail.com",
        "AFFINE_PASSWORD": "AFFiNE56554ine*"
      }
    }
  }
}
```

**Note Windows** : Si `npx` ne fonctionne pas, utiliser le chemin complet :
```json
"command": "C:\\Program Files\\nodejs\\npx.cmd"
```

5. **Redémarrer Claude Desktop**

6. **Vérifier** :
   - Ouvrir une conversation
   - Taper : "Liste mes workspaces AFFiNE"
   - Claude devrait voir 2 workspaces

---

### 2️⃣ ChatGPT Desktop (Officiel septembre 2025 ✅)

**Support** : Developer Mode depuis septembre 2025
**Complexité** : ⭐️⭐️ Moyen
**Recommandé** : ✅ Oui (si abonné ChatGPT Plus/Team/Enterprise)

#### Prérequis

- **ChatGPT Plus, Team ou Enterprise** (pas disponible en gratuit)
- **ChatGPT Desktop App** installée
- **Developer Mode** activé

#### Configuration

**Option A : Via l'interface ChatGPT** (recommandé)

1. Ouvrir ChatGPT Desktop

2. Activer **Developer Mode** :
   - Settings → Beta Features
   - Activer "Developer Mode"
   - Activer "MCP Server Tools"

3. Ajouter un MCP Server :
   - Dans une conversation, cliquer sur l'icône 🔧 (Tools)
   - "Add MCP Server"
   - Remplir :
     - **Name** : AFFiNE
     - **Command** : `npx`
     - **Args** : `-y affine-mcp-server@latest`
     - **Environment Variables** :
       ```
       AFFINE_BASE_URL=https://affine.robotsinlove.be
       AFFINE_EMAIL=gillespinault@gmail.com
       AFFINE_PASSWORD=AFFiNE56554ine*
       ```

4. Sauvegarder et tester

**Option B : Via fichier de config** (macOS uniquement)

Créer/éditer `~/Library/Application Support/ChatGPT/mcp_config.json` :

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["-y", "affine-mcp-server@latest"],
      "env": {
        "AFFINE_BASE_URL": "https://affine.robotsinlove.be",
        "AFFINE_EMAIL": "gillespinault@gmail.com",
        "AFFINE_PASSWORD": "AFFiNE56554ine*"
      }
    }
  }
}
```

**Option C : Extension Chrome** (pour ChatGPT web)

1. Installer "MCP SuperAssistant" depuis le Chrome Web Store
2. Configurer via l'extension
3. Limitation : Certaines fonctionnalités peuvent ne pas être disponibles

#### Vérification

- Ouvrir une conversation
- Taper : "Crée un document AFFiNE avec le titre 'Test ChatGPT MCP'"
- ChatGPT devrait proposer d'utiliser le serveur MCP AFFiNE

---

### 3️⃣ Gemini CLI (Officiel 2025 ✅)

**Support** : Natif depuis janvier 2025
**Complexité** : ⭐️⭐️⭐️ Avancé (ligne de commande)
**Recommandé** : ✅

#### Installation du serveur local

Le serveur `DAWNCR0W` étant limité, il est recommandé d'utiliser le serveur local plus puissant, `affine-mcp`, disponible dans le projet `notebooks_api`.

1.  **Compiler et lier le serveur local** :
    ```bash
    cd /home/gilles/serverlab/projects/notebooks_api
    npm install
    npm run build
    npm link --force
    ```

#### Configuration de Gemini CLI

1.  **Éditer `~/.gemini/settings.json`** :

    Ajoutez la configuration suivante. Attention à la casse de `mcpServers`.

    ```json
    {
      "mcpServers": {
        "affine": {
          "command": "/home/gilles/.nvm/versions/node/v20.19.5/bin/affine-mcp",
          "args": [],
          "env": {
            "AFFINE_EMAIL": "gillespinault@gmail.com",
            "AFFINE_PASSWORD": "AFFiNE56554ine*"
          }
        }
      }
    }
    ```

2.  **Redémarrer Gemini CLI** :

    **IMPORTANT** : Le client Gemini CLI doit être redémarré pour prendre en compte la nouvelle configuration du serveur MCP.

#### Utilisation

```bash
# Lancer Gemini CLI
gemini-cli

# Vérifier les serveurs MCP (après redémarrage)
/mcp

# Tester
"Liste mes documents AFFiNE récents"
```

---

## 🔧 Dépannage

### Erreur : "Must sign in first"

**Cause** : Session MCP expirée ou credentials incorrects

**Solution 1** : Vérifier les credentials

```bash
# Tester la connexion AFFiNE
curl -X POST https://affine.robotsinlove.be/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{
    "email": "gillespinault@gmail.com",
    "password": "AFFiNE56554ine*"
  }'
```

Si erreur 401 → Mot de passe incorrect
Si succès 200 → Credentials OK

**Solution 2** : Redémarrer le client LLM

- Claude Desktop : Quitter complètement et relancer
- ChatGPT : Quitter et relancer l'app
- Gemini CLI : Taper `/exit` puis relancer

**Solution 3** : Utiliser un API Token (plus fiable)

1. Aller sur https://affine.robotsinlove.be/settings/account
2. Section "Personal Access Tokens"
3. Créer un token "MCP Access"
4. Remplacer dans la config :

```json
"env": {
  "AFFINE_BASE_URL": "https://affine.robotsinlove.be",
  "AFFINE_API_TOKEN": "ut_VOTRE_TOKEN_ICI"
}
```

---

### Erreur : "Command not found: npx"

**Windows** :
```json
"command": "C:\\Program Files\\nodejs\\npx.cmd"
```

**macOS/Linux** :
```bash
# Trouver le chemin npx
which npx
# Utiliser le chemin complet dans la config
```

---

### Erreur : "Connection timeout"

**Cause** : Serveur MCP ne démarre pas

**Solution** :
1. Vérifier que Node.js est installé : `node --version` (≥ 18)
2. Tester le serveur manuellement :
   ```bash
   npx -y affine-mcp-server@latest
   ```
3. Regarder les logs d'erreur

---

### Performances lentes / Beaucoup de tokens

**Cause** : MCP charge beaucoup de métadonnées

**Solution** :
- Limiter le nombre de serveurs MCP actifs (désactiver ceux non utilisés)
- Utiliser des requêtes précises ("Liste mes 5 derniers documents" au lieu de "Liste tous mes documents")
- Pour les procédures récurrentes, créer un Skill à la place

---

## 📝 Exemples d'utilisation

### Claude Desktop

```
"Crée un document AFFiNE dans mon workspace 'Robots in Love'
avec le titre 'Synthèse réunion 2025-11-06' et le contenu :

# Réunion équipe - 06 nov 2025

## Participants
- Gilles
- Claude

## Points discutés
1. Configuration MCP pour AFFiNE
2. Différence Skills vs MCP

## Décisions
- Utiliser MCP pour intégrations multi-LLM
- Créer un Skill pour workflows répétitifs

## Actions
- [ ] Tester config ChatGPT
- [ ] Tester config Gemini CLI
- [ ] Documenter dans docs/guides/
"
```

### ChatGPT Desktop

```
"Recherche tous mes documents AFFiNE qui mentionnent 'API'
ou 'automation' et synthétise les idées principales en 3 sections :
Objectifs, Approche, Risques"
```

### Gemini CLI

```bash
gemini-cli

> "Trouve le document AFFiNE 'Roadmap 2025' et ajoute une section
'Q2 Priorities' avec ces items :
- Feature X : Edgeless API
- Migration Y : PostgreSQL 17
- Refactor Z : Documentation structure"
```

---

## 🎁 Bonus : Créer un Skill AFFiNE pour Claude Code

**Location** : `~/.claude/skills/affine/`

**Fichier** : `~/.claude/skills/affine/skill.md`

```markdown
---
name: affine
description: Quick access to AFFiNE workspace operations
version: 1.0.0
tags: [productivity, notes, knowledge-base]
---

# AFFiNE Skill

## Quick Operations

### Create a note
Use: "Create AFFiNE note [title] with [content]"

### Search notes
Use: "Search AFFiNE for [query]"

### Recent docs
Use: "Show my 10 recent AFFiNE docs"

## Workspace Info

- **Instance**: https://affine.robotsinlove.be
- **Workspace**: Robots in Love (b89db6a1-b52c-4634-a5a0-24f555dbebdc)
- **MCP Server**: affine-mcp-server

## Common Workflows

### 1. Synthèse de réunion
```
Create AFFiNE note "Réunion [date]" with:
- Participants
- Points discutés
- Décisions
- Actions
```

### 2. Brief de projet
```
Create AFFiNE note "Brief [project]" with:
- Objectifs
- Approche technique
- Risques
- Timeline
```

### 3. PRD Template
```
Create AFFiNE note "PRD - [feature]" with:
- Problem Statement
- User Stories
- Technical Design
- Success Metrics
```

## Tips

- Use search with embeddings for semantic queries
- Tag documents for better organization
- Link related docs with @mentions
```

**Recharger les Skills** :
- Redémarrer Claude Code
- Ou commande : `/skills reload`

---

## 📊 Comparaison finale

| Critère | Claude Skills | MCP |
|---------|---------------|-----|
| **Plateformes** | Claude Code uniquement | Claude, ChatGPT, Gemini, autres |
| **Complexité setup** | ⭐️ Facile | ⭐️⭐️⭐️ Moyen-Avancé |
| **Tokens utilisés** | 🟢 Minimal | 🔴 Élevé |
| **Intégrations système** | ❌ Non | ✅ Oui |
| **Données temps réel** | ❌ Non | ✅ Oui |
| **Maintenance** | 🟢 Simple (Markdown) | 🟡 Moyen (Serveurs) |
| **Latence** | 🟢 Instantané | 🟡 Réseau |
| **Multi-LLM** | ❌ Non | ✅ Oui |

---

## 🎯 Décision finale pour ton cas

**Configuration recommandée** :

1. ✅ **MCP AFFiNE** pour :
   - Claude Desktop (usage quotidien)
   - ChatGPT Desktop (pour comparer les réponses)
   - Gemini CLI (pour automatisation scripts)

2. ✅ **Skill AFFiNE** pour :
   - Templates rapides dans Claude Code
   - Workflows répétitifs
   - Documentation des usages courants

**Avantage** : Tu bénéficies du meilleur des 2 mondes !

---

## 📚 Ressources

- **MCP Spec** : https://modelcontextprotocol.io
- **AFFiNE MCP Server** : https://github.com/DAWNCR0W/affine-mcp-server
- **Claude Skills Docs** : https://docs.anthropic.com/claude/docs/skills
- **MCP Servers Directory** : https://www.mcplist.ai

---

---

## ⚠️ Limitations DAWNCR0W MCP (Découvertes en Test)

**Date test** : 2025-11-06
**Testé par** : Gilles via Claude Desktop

### Problèmes confirmés

#### 1. Titres de documents → `null`

**Ce que retourne DAWNCR0W** :
```json
{
  "id": "98U_91z95t",
  "title": null,  // ❌ Toujours null
  "workspaceId": "...",
  "updatedAt": "2025-11-05..."
}
```

**Ce que retourne l'API REST notebooks_api** :
```json
{
  "docId": "98U_91z95t",
  "title": "Getting Started",  // ✅ Titre réel
  "createDate": 1758544718770,
  "updatedDate": 1761757994292
}
```

**Impact** : Impossible de naviguer par titre de document.

---

#### 2. Structure folders → Absente

**Ce que retourne DAWNCR0W** :
```json
{
  "documents": [
    { "id": "doc1", "title": null },
    { "id": "doc2", "title": null },
    { "id": "doc3", "title": null }
  ]
}
// ❌ Aucune structure de dossiers
```

**Ce que retourne l'API REST notebooks_api** :
```json
{
  "folders": [
    {
      "id": "CU7sAbKjKMaFhek1rq22z",
      "name": "The AI project",
      "children": [],
      "documents": ["OoAIJ-Jo8cwKerKTjQ3pS", "pIve0YJLLhiXHKw5Purhm"]
    },
    {
      "id": "xfMzRffXzYkzNJ1gP4UFH",
      "name": "Serverlab",
      "children": [],
      "documents": ["QvSdYyhDTpsK8rJt4VGyY", "RBM9RjA-snWyKNopgwi1O"]
    }
  ]
}
// ✅ Structure hiérarchique complète
```

**Impact** : Impossible de naviguer par dossiers, organisation plate uniquement.

---

#### 3. Hiérarchie subdocs → Absente

**Ce que retourne notebooks_api** :
```json
{
  "hierarchy": [
    {
      "type": "folder",
      "name": "Affine_API",
      "children": [
        {
          "type": "folder",
          "name": "🧪 Tests API",
          "children": [],
          "documents": ["Vxg1lBr1e1rgwgE1pMnSn"]
        }
      ]
    }
  ]
}
// ✅ Folders imbriqués + subdocs (LinkedDocs)
```

DAWNCR0W : ❌ Non disponible

**Impact** : Impossible de voir les documents liés (subdocs) dans la hiérarchie.

---

### Pourquoi ces limitations ?

**DAWNCR0W utilise uniquement l'API GraphQL officielle d'AFFiNE** qui :
- N'expose pas les noms de workspace dans les réponses
- N'expose pas la structure `db$workspace$folders`
- N'expose pas les titres de documents dans les listes
- N'expose pas les LinkedDocs (subdocs)

**L'API REST notebooks_api utilise Yjs (WebSocket)** qui accède directement :
- `workspace.meta.name` pour les noms
- `db$workspace$folders` pour la hiérarchie
- Documents complets avec métadonnées
- Parsing des LinkedDocs dans le contenu

---

### Solution : Wrapper MCP sur l'API REST

**Architecture proposée** :
```
Claude Desktop / ChatGPT / Gemini
         ↓ (MCP stdio)
  affine-notebooks-mcp (wrapper ~200 lignes)
         ↓ (HTTP REST)
  notebooks_api (existant, production)
         ↓ (Socket.IO + Yjs)
    AFFiNE instance
```

**Effort de développement** :
- API REST (2000+ lignes) : ✅ Déjà fait
- Wrapper MCP (~200 lignes) : 1-2 heures

**Nouveaux outils MCP exposés** :
1. `list_workspaces` → Avec noms réels
2. `get_folders_hierarchy` → Structure dossiers
3. `get_complete_hierarchy` → Folders + docs + subdocs
4. `list_documents_with_titles` → Titres réels
5. `get_folder_contents` → Contenu dossier spécifique

**Configuration recommandée** : Utiliser les 2 serveurs MCP en parallèle
- `affine` (DAWNCR0W) pour comments, history, blobs
- `affine-advanced` (wrapper custom) pour folders, hierarchy, titres

---

### Spécifications du wrapper MCP (pour implémentation future)

**Package.json** :
```json
{
  "name": "affine-notebooks-mcp",
  "version": "0.1.0",
  "bin": { "affine-notebooks-mcp": "./dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4"
  }
}
```

**Code principal** (simplifié) :
```typescript
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

const API_URL = process.env.NOTEBOOKS_API_URL || 'https://affine-api.robotsinlove.be';

const server = new Server({ name: 'affine-notebooks-mcp', version: '0.1.0' });

// Liste des outils
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'list_workspaces', description: '...', inputSchema: {...} },
    { name: 'get_folders_hierarchy', description: '...', inputSchema: {...} },
    { name: 'get_complete_hierarchy', description: '...', inputSchema: {...} },
    { name: 'list_documents_with_titles', description: '...', inputSchema: {...} },
    { name: 'get_folder_contents', description: '...', inputSchema: {...} },
  ]
}));

// Appels d'outils
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'list_workspaces':
      const response = await fetch(`${API_URL}/workspaces`);
      return { content: [{ type: 'text', text: await response.text() }] };

    case 'get_folders_hierarchy':
      const { workspaceId } = args;
      const response = await fetch(`${API_URL}/workspaces/${workspaceId}/folders`);
      return { content: [{ type: 'text', text: await response.text() }] };

    // ... 3 autres outils
  }
});

// Démarrage
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Total** : ~200 lignes pour un wrapper complet.

**Installation future** :
```bash
cd /home/gilles/serverlab/projects/affine-notebooks-mcp
npm install
npm run build
npm link  # Expose 'affine-notebooks-mcp' globalement
```

**Configuration Claude Desktop** :
```json
{
  "mcpServers": {
    "affine": {
      "command": "affine-mcp-server",
      "env": { "AFFINE_EMAIL": "...", "AFFINE_PASSWORD": "..." }
    },
    "affine-advanced": {
      "command": "affine-notebooks-mcp",
      "env": { "NOTEBOOKS_API_URL": "https://affine-api.robotsinlove.be" }
    }
  }
}
```

---

**Dernière mise à jour** : 2025-11-06
**Limitations découvertes** : 2025-11-06 (test en production)
**Prochaine étape** : Utiliser DAWNCR0W pour les besoins actuels, créer le wrapper si besoin de folders/hierarchy

---
## 🚀 Configuration MCP Réseau (Avancé)

Pour un accès depuis d'autres machines (ex: votre laptop via Tailscale), un second serveur MCP est disponible en mode réseau.

**Port**: `8799`
**Endpoint**: `/mcp`

### Configuration Client (Exemple avec un client MCP générique)

Pour vous connecter depuis une autre machine, vous devrez utiliser l'adresse IP Tailscale de votre serveur.

Exemple de configuration d'un client :
```json
{
  "mcpServers": {
    "affine-network": {
      "url": "http://<IP_TAILSCALE_DU_SERVEUR>:8799/mcp"
    }
  }
}
```

**Note**: Ce serveur réseau utilise le même backend que le serveur `stdio` local, mais expose une interface réseau. Il n'est pas nécessaire de le configurer pour l'usage de Gemini sur le serveur lui-même, car il utilise déjà la version `stdio`.
