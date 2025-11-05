# AFFiNE MCP Server – Analyse & Alignement API

| Champ  | Détail                                                                            |
| ------ | --------------------------------------------------------------------------------- |
| Auteur | Codex                                                                             |
| Date   | 2025-11-05                                                                        |
| Statut | Draft                                                                             |
| Source | Audit du dépôt `affine-mcp-server` (dawncr0w) et comparaison avec `notebooks_api` |
|        |                                                                                   |

---

## 1. Résumé exécutif

Le serveur MCP open source `affine-mcp-server` expose plus de 30 outils MCP pour orchestrer AFFiNE via Claude/Codex : gestion des workspaces, documents, commentaires, historique, tokens, notifications et opérations WebSocket bas niveau sur les documents (`space:push-doc-update`).<sup>[1](../../vendor/affine-mcp-server/README.md:13)</sup> Notre API REST couvre aujourd’hui la navigation des workspaces, CRUD documents/blocs/tags, et la future prise en charge Edgeless, import et databases est décrite dans des PRD dédiés.<sup>[2](../../README.md:9)</sup><sup>[3](../prd-affine-import-automation.md:6)</sup><sup>[4](../prd-affine-database-support.md:26)</sup> Cette note inventorie la surface MCP, met en évidence les écarts et suggère une trajectoire pour aligner notre API tout en apportant la robustesse (auth, observabilité, gouvernance) que le MCP n’assure pas.

---

## 2. Surface fonctionnelle MCP

### 2.1 Authentification & transport
- Support `AFFINE_API_TOKEN`, cookies ou email/password ; handshake stdio uniquement.<sup>[5](../../vendor/affine-mcp-server/README.md:52)</sup>
- Connexion GraphQL + Socket.IO via helpers `wsUrlFromGraphQLEndpoint`, `connectWorkspaceSocket`, `pushDocUpdate`.<sup>[6](../../vendor/affine-mcp-server/src/ws.ts:1)</sup>

### 2.2 Workspaces & gouvernance
- Outils `list_workspaces`, `get_workspace`, `create_workspace`, `update_workspace`, `delete_workspace`, création initiale via upload GraphQL + push Yjs.<sup>[7](../../vendor/affine-mcp-server/README.md:115)</sup><sup>[8](../../vendor/affine-mcp-server/src/tools/workspaces.ts:1)</sup>

### 2.3 Documents & contenu
- Listing, recherche, publication, révocation via GraphQL (`list_docs`, `search_docs`, `publish_doc`).<sup>[9](../../vendor/affine-mcp-server/README.md:122)</sup><sup>[10](../../vendor/affine-mcp-server/src/tools/docs.ts:21)</sup>
- Création/append/suppression de documents via Socket.IO et Yjs (`create_doc`, `append_paragraph`, `delete_doc`).<sup>[11](../../vendor/affine-mcp-server/src/tools/docs.ts:280)</sup>

### 2.4 Collaboration
- Commentaires : CRUD + résolution.<sup>[12](../../vendor/affine-mcp-server/README.md:133)</sup><sup>[13](../../vendor/affine-mcp-server/src/tools/comments.ts:6)</sup>
- Notifications (list/read) et historique (`list_histories`, `recover_doc`).<sup>[14](../../vendor/affine-mcp-server/README.md:136)</sup><sup>[15](../../vendor/affine-mcp-server/README.md:143)</sup>

### 2.5 Comptes & tokens
- Outils pour profil utilisateur, paramètres et gestion des tokens personnels.<sup>[16](../../vendor/affine-mcp-server/README.md:139)</sup>

### 2.6 Blob storage & opérations bas niveau
- Upload/suppression de blobs + `apply_doc_updates` qui applique des diff Yjs arbitraires.<sup>[17](../../vendor/affine-mcp-server/README.md:146)</sup>

**Limitations observées**
- Pas de support explicite pour les databases (tables/board), la navigation dossiers, ni Edgeless avancé (au-delà des notes/paragraphes). Les outils se concentrent sur le noyau GraphQL + WebSocket document/page.
- Auth centrée sur un compte unique (pas de multi-clients, rate limiting, scopes API).

---

## 3. Comparaison couverture MCP vs notebooks_api

| Domaine | MCP (`affine-mcp-server`) | notebooks_api (actuel/prévu) | Gap / Pertinence |
| --- | --- | --- | --- |
| Workspaces | List/get/create/update/delete via GraphQL + Yjs init.<sup>[18](../../vendor/affine-mcp-server/src/tools/workspaces.ts:1)</sup> | Lecture + navigation hiérarchie (`GET /workspaces`, `/folders`).<sup>[19](../../README.md:25)</sup> | Provisioning workspace manquant côté API REST → utile si on gère plusieurs tenants/sandboxes. |
| Documents (metadata) | List/search/publish/revoke, get metadata.<sup>[20](../../vendor/affine-mcp-server/src/tools/docs.ts:21)</sup> | CRUD complet + contenu structuré (`/documents`, `/blocks`).<sup>[21](../../README.md:34)</sup> | Publication publique non exposée chez nous. |
| Documents (contenu Yjs) | Création/append/suppression via Socket.IO helpers.<sup>[22](../../vendor/affine-mcp-server/src/tools/docs.ts:318)</sup> | REST blocs + pipeline Markdown + roadmap Edgeless.<sup>[23](../../README.md:44)</sup><sup>[24](../../EDGELESS_DESIGN.md:1)</sup> | MCP n’offre pas les conversions Markdown, Edgeless ni la granularité bloc JSON. |
| Folders/Tags | Non géré (hors update workspace pages). | Endpoints dédiés tags/dossiers + navigation arbre.<sup>[25](../../README.md:60)</sup> | Notre API couvre mieux l’organisation documentaire. |
| Databases | Non couvert. | PRD dédié (Phase 2/3).<sup>[26](../prd-affine-database-support.md:59)</sup> | Forte valeur interne → différenciant. |
| Edgeless | Non dédié (note bloc basique). | Design complet (Priority #3 Edgeless CRUD).<sup>[27](../../EDGELESS_DESIGN.md:9)</sup> | Notre roadmap addresse ce manque. |
| Import/export | Aucun outil dédié. | PRD import multi-format (Markdown, DOCX, Notion, snapshot).<sup>[28](../prd-affine-import-automation.md:6)</sup> | Nous couvrons un besoin absent côté MCP. |
| Commentaires | CRUD complet + résolve.<sup>[29](../../vendor/affine-mcp-server/src/tools/comments.ts:6)</sup> | Pas d’API actuelle. | Pertinent pour intégrations collaboratives (notifications, IA). |
| Version history | List/recover.<sup>[30](../../vendor/affine-mcp-server/README.md:136)</sup> | Non exposé. | Utile pour automatiser rollback/audit. |
| Users & tokens | Gestion profil/tokens, signin.<sup>[31](../../vendor/affine-mcp-server/README.md:139)</sup> | Non exposé (auth server intern). | À considérer pour provisioning multi-comptes & audit. |
| Notifications | List/mark read.<sup>[32](../../vendor/affine-mcp-server/README.md:143)</sup> | Non exposé. | Pertinence selon usages (alerting). |
| Blob storage | Upload/delete/cleanup.<sup>[33](../../vendor/affine-mcp-server/README.md:146)</sup> | Non exposé. | Indispensable à moyen terme pour attacher des fichiers via API. |
| apply_doc_updates | Outil bas niveau Yjs.<sup>[34](../../vendor/affine-mcp-server/README.md:149)</sup> | Non exposé (nous passons par abstractions). | Option avancée pour power users, à offrir prudemment. |

---

## 4. Enseignements techniques utilisables

1. **Illustration de flux Yjs** : le code `create_doc` montre la séquence complète (doc Y.Doc → `space:push-doc-update` → update workspace root).<sup>[35](../../vendor/affine-mcp-server/src/tools/docs.ts:280)</sup> Nous pouvons réutiliser la même orchestration dans `AffineClient` pour fiabiliser nos endpoints et nos tests.
2. **GraphQL fallback** : les outils mixent REST GraphQL (metadata) et WebSocket (contenu) – approche identique à la nôtre pour workspace navigation et renforce la validité de notre architecture hybride.<sup>[36](../../vendor/affine-mcp-server/src/tools/docs.ts:21)</sup>
3. **Documentation commandes** : la liste d’outils sert de backlog exhaustif de fonctionnalités AFFiNE à exposer par notre API.
4. **Limitations visibles** : absence de databases/edgeless/import confirme que notre roadmap comble des manques structurels du MCP.

---

## 5. Recommandations

1. **Référencer les helpers MCP** dans notre SDK (ex: harmoniser `AffineClient` avec `wsUrlFromGraphQLEndpoint`, `pushDocUpdate`) pour réduire les divergences protocolaires.<sup>[37](../../vendor/affine-mcp-server/src/ws.ts:1)</sup>
2. **Prioriser les gaps à forte valeur** :
   - Phase courte : commentaires + version history (fort impact collaboration).<sup>[38](../../vendor/affine-mcp-server/README.md:133)</sup>
   - Phase moyenne : gestion tokens/notifications pour orchestrer des intégrations.
   - Phase longue : blob storage + apply_doc_updates (pour use cases avancés).
3. **Garder notre différenciation** : maintenir la priorité sur Edgeless, import multi-format et databases – absent du MCP mais clés pour ServerLab.<sup>[39](../../EDGELESS_DESIGN.md:9)</sup><sup>[40](../prd-affine-import-automation.md:6)</sup><sup>[41](../prd-affine-database-support.md:59)</sup>
4. **Éviter la dépendance directe au MCP** : proposer une façade REST stable avec auth API key, monitoring, rate limiting – éléments absents du projet MCP.
5. **Documenter compatibilité** : ajouter une section “Interop MCP” à notre doc technique pour rappeler que nos endpoints peuvent alimenter un MCP interne plus robuste.

---

## 6. Étapes suivantes proposées

1. **Documenter** (ce memo) → intégrer dans la doc projet (fait). 
2. **Capitaliser sur le code MCP** :
   - Extraire les snippets utiles (création doc, workspace init) pour renforcer les tests/unit `AffineClient`.
   - Écrire un script de comparaison (smoke) qui exécute `create_doc` MCP puis consomme notre API pour vérifier la cohérence Yjs (idéal pour CI).
3. **Plan de mise à niveau API** :
   - Ajout backlog “Collaboration endpoints” (comments/history tokens) en Phase 3 de la vision API.
   - Formaliser un PRD minimal pour `comments` (en s’inspirant de leurs requêtes GraphQL) et `blob storage`.
4. **Communication interne** : partager aux équipes IA que le MCP est utile pour prototypage, mais que l’API REST reste la voie supportée pour production.

---

## 7. Annexes

- Dépôt audité : `projects/notebooks_api/vendor/affine-mcp-server`.
- Fichiers clés : `README.md` (liste outils), `src/ws.ts` (helpers WebSocket), `src/tools/*.ts` (outils GraphQL/WebSocket).
- Comparatif API : `projects/notebooks_api/README.md` (27 endpoints REST).
