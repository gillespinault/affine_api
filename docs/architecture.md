# Architecture AFFiNE API

**Version** : 0.2.0
**Statut** : ✅ Production
**Dernière mise à jour** : 2025-11-06

## Vision

Fournir un SDK et des services backend capables de piloter AFFiNE (Socket.IO + Yjs) pour des automatisations professionnelles : création de documents (notes, dossiers), enrichissement de contenu, synchronisation avec d'autres systèmes (CRM, knowledge base, workflows internes).

## Composants en Production

### Client TypeScript (`src/client/`)

Encapsule l'authentification (REST `/api/auth/sign-in`), l'ouverture de WebSocket, l'émission des événements `space:*` et la manipulation de documents Yjs.

- **`AffineClient`** : API haut niveau avec 23 méthodes
  - Authentification : `signIn()`, `disconnect()`
  - Workspaces : `listWorkspaces()`, `getWorkspaceDetails()`, `getHierarchy()`
  - Documents : `createDocument()`, `updateDocument()`, `deleteDocument()`, `getDocumentContent()`
  - Blocks : `addBlock()`, `updateBlock()`, `deleteBlock()`
  - Edgeless : `addEdgelessElement()`, `getEdgelessElements()`, `updateEdgelessElement()`
  - Folders : `createFolder()`, `getFolderTree()`, `registerDocInFolder()`
  - Tags : `listTags()`, `deleteTag()`
- **Utilitaires exportés** : `createDocYStructure`, `encodeUpdateToBase64`, `parseSetCookies`, `randomLexoRank`
- **Factories** : `edgeless-factory.ts` pour génération defaults BlockSuite (shapes, connectors, text)

### API REST Fastify (`src/service/`)

**Production** : https://affine-api.robotsinlove.be

- **28 endpoints REST** organisés en 8 catégories
  - Workspaces (5) : Navigation complète + hiérarchie
  - Documents (8) : CRUD + Markdown import + recherche
  - Blocks (3) : Manipulation granulaire
  - Edgeless (5) : Canvas shapes, connectors, text
  - Folders (2) : Création + déplacement docs
  - Tags (3) : Gestion complète
  - Workspace meta (1) : Métadonnées
  - Health (1) : Diagnostic
- **Logging structuré** : Pino (format JSON)
- **HTTP/2** : Via nginx reverse proxy
- **Architecture** : Hybride GraphQL (metadata) + Yjs (content)

### Serveur MCP (`src/mcp/`)

**Version** : 0.1.0-mcp (2025-11-06)

- **31 outils Model Context Protocol** pour agents IA
- **Transport** : stdio (processus local)
- **Clients supportés** : Claude Code, Claude Desktop, Cline
- **Binaire** : `bin/affine-mcp.js`
- **Documentation** : [`docs/mcp-guide.md`](mcp-guide.md)

### Pipeline Markdown

- **Import** : GitHub Flavored Markdown → blocs AFFiNE
- **Éléments supportés** : Paragraphes, listes (ordered, unordered, task), code blocks, tables, headings, dividers
- **Préservation** : Formatage (gras, italique, code inline)
- **Module** : `src/client/markdown/markdown-to-yjs.ts`

### Tests

- **Framework** : Vitest
- **Couverture** : Tests unitaires pour structures Yjs, factories Edgeless, parsing Markdown
- **Localisation** : `tests/unit/`
- **CI** : À intégrer (GitHub Actions)

## Couches à venir

1. **Service REST interne** (`src/service/`)
   - Expose des endpoints JSON (Express/Fastify) pour orchestrer `AffineClient` (ex : `/workspaces/:id/documents`).
   - Intercepte les erreurs socket pour fournir des réponses typées (HTTP 4xx/5xx).
   - Permettre l'intégration avec notre stack ServerLab (auth0/authelia, audit logging, rate limit).

2. **Connecteurs métier**
   - Workers n8n / Background jobs qui consomment le SDK pour synchroniser des briefs, PRD, tickets.
   - Webhooks entrants pour recevoir des événements AFFiNE (dès que le produit expose un event bus public).

3. **Observabilité**
   - Metrics (Prometheus/OpenTelemetry) : latence `space:*`, taux d'erreur, volumétrie d'updates Yjs.
   - Journaux structurés (pino) et traçabilité des opérations (docId, workspaceId, acteur).

## Interop MCP & refactoring conservateur

- **Analyse** : `docs/reference/affine-mcp-analysis.md` recense la surface du serveur `affine-mcp-server` (workspace/doc/commentaires, operations Yjs bas-niveau) et sert de référence pour notre roadmap.
- **Objectifs refactor** :
  - aligner `AffineClient` sur les helpers MCP pour réduire la divergence protocolaire (join/push/load).
  - mutualiser la conversion Yjs → JSON entre API REST et future couche MCP interne.
  - conserver la compatibilité des endpoints existants (tests smoke sur `scripts/run-affine-api-test.ts`).
- **Priorité** : adopter une approche incrémentale (feature flags si nécessaire) afin de ne pas casser les intégrations existantes.

## Points techniques clés

- **Yjs** : AFFiNE encode la structure d'une page (page → surface → note → paragraph). Les documents additionnels (`db$<workspace>$docProperties`, `db$<workspace>$folders`, workspace root) doivent être synchronisés pour que la création apparaisse dans l'UI.
- **Socket.IO** : `emitWithAck` avec timeout. Les erreurs métier sont retournées sous forme `{ error: { code, message } }` et doivent être re-propagées.
- **Authentification** : combo jeton (GraphQL) + cookies (Socket.IO). Nous stockons uniquement `affine_session`/`affine_user_id` côté client.

## Compatibilité / Bifurcations

- Node 20 minimum (fetch natif, `WebSocket` stable, `base64url`).
- ESM par défaut (`type: "module"`). Pour compatibilité CJS, publier un bundle secondaire si besoin (`dist/index.cjs`).
- Prévoir une interface pour injecter un mock de `ioFactory` (tests, replays de paquets Socket.IO).

## Bibliothèques envisagées

- **Backend service** : Fastify + Zod (validation), or Prisma/Drizzle si persistance.
- **Tests** : Vitest (unitaires) + Playwright (smoke tests sur AFFiNE UI) + Pact (contrats si API externe).
- **CI/CD** : GitHub Actions (build, lint, test), semantic-release ou Changesets pour versioning.

## Sécurité

- Stocker les credentials AFFiNE via vault/secret manager (pas dans le repo).
- Limiter la surface d'exposition : service interne derrière AuthN (JWT, mTLS) ou job scheduler.
- Journaux sensibles (contenu doc) derrière un flag de masquage.

## Prochaines étapes architecture

1. Définir l'interface REST/GraphQL du service (`docs/roadmap.md`).
2. Implémenter la couche service et une CLI modernisée (`tsx` + `dist/cli`).
3. Refactor conservateur : factoriser les helpers Socket.IO/Yjs et aligner les mises à jour doc/folders avec le code MCP.
4. Ajouter tests d'intégration contre un workspace de staging (mock socket ou playground real).
5. Préparer un module Python (en option) pour appels AFFiNE depuis notebooks IA.
