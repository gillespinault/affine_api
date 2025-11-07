# PRD – AFFiNE Collaboration API

| Champ | Détail |
| --- | --- |
| Auteur | Codex |
| Date | 2025-11-05 (maj 2025-11-06) |
| Statut | Draft |
| Projet | `projects/notebooks_api` |
| Source | Analyse `affine-mcp-server`, code source AFFiNE, arbitrages produit |

---

## 0. Priorités & séquencement

| Rang | Contenu | Livrables clés | Tests & preuve |
| --- | --- | --- | --- |
| 1 | **Surface Copilot/Embeddings** | REST + MCP pour `matchWorkspaceDocs/Files/All`, état `queryWorkspaceEmbeddingStatus`, gestion corpus (upload, ignored docs, queue). | Jeu de documents créé automatiquement dans `Robots in Love/Affine_API/Tests API`, requêtes de similarité qui renvoient ces documents. |
| 2 | **Historique & recovery** | Listing des versions, restore ciblé, métriques idempotentes. | Script d’intégration qui crée un doc, le modifie 3×, restaure `v1` et vérifie le contenu via API. |
| 3 | **Autres chantiers fonctionnels** | Workspace lifecycle, publication publique, commentaires, notifications, tokens, blobs/apply updates. | Chaque livraison crée/annote des docs de test dans le même workspace/folder, résultats tracés dans `docs/api-test-guide.md`. |

> **Mise à jour 2025-11-08** : Commentaires, notifications et tokens personnels sont livrés (REST + MCP). Publication publique (publish/revoke) est désormais disponible via REST + MCP (smokes outillés). Le scope restant se concentre sur lifecycle workspace et blob/apply updates.

Chaque priorité ajoute des endpoints REST, les miroirs MCP et un guide d’usage. Les jobs de validation utilisent uniquement l’API notebooks (pas d’action manuelle) et laissent une trace dans AFFiNE pour audit.

## 1. Contexte & Problème

Le serveur MCP `affine-mcp-server` expose via Claude/Codex des outils couvrant commentaires, historique de versions, tokens personnels et notifications. Notre API REST n’offre pas encore ces fonctionnalités, ce qui limite l’automatisation collaborative (alertes, revue documentaire, audit). Objectif : fournir une surface REST stable, sécurisée et documentée pour ces domaines, en gardant compatibilité avec le comportement MCP.

## 2. Objectifs

1. **Copilot / Embeddings (Priorité 1)**  
   - Recherche sémantique native AFFiNE (`matchWorkspaceDocs`, `matchWorkspaceFiles`, `matchWorkspaceAll`) surfacée via REST/MCP.  
   - Pilotage du pipeline d’indexation : statut, upload de fichiers à embarquer, liste des documents ignorés, relance ciblée (`queueWorkspaceEmbedding`).  
   - Context sessions pour les agents (création, match scoped).
2. **Historique & Recovery (Priorité 2)**  
   - Exposer l’historique de versions avec restauration idempotente.  
   - Journaliser les recoveries (docId, versionId, auteur) et fournir un endpoint de prévisualisation.
3. **Autres fonctionnalités MCP à couvrir (Priorité 3)**  
   - CRUD commentaires + résolution.  
   - Publication/révocation publique des documents (livrée 2025-11-07).  
   - Notifications (list/read/mark-all).  
   - Tokens personnels self-service.  
   - Lifecycle workspace (create/update/delete) pour provisionner des sandboxes.  
   - Blob storage + `apply_doc_updates` pour import/migrations à grande échelle.

### KPI
- 100 % des opérations MCP correspondantes disponibles via REST.
- Temps moyen de réponse < 750 ms.
- Tests d’intégration couvrant page + edgeless + mentions.
- Utilisation : ≥ 1 workflow n8n et ≥ 1 script interne au trimestre suivant.

## 3. Hors périmètre
- Webhooks temps réel (à adresser plus tard).
- Création de relations/commentaires sur bases (databases) – à définir ultérieurement.
- Gestion fine des permissions (repose sur ACL AFFiNE existantes).

## 4. Personas
- **Support/Docs Ops** : veut recevoir/fermer les commentaires dans des workflows.
- **Product Owners** : déclenchent des restore de version pour rollback.
- **Users avancés** : gèrent leurs tokens sans passer par l’UI.
- **Automation Team** : lit les notifications pour générer des alertes Slack / n8n.

## 5. Scénarios
1. Créer un commentaire (mention @user) depuis un workflow et marquer comme résolu une fois traité.
2. Lister l’historique d’un document, restaurer la version `v3`.
3. Générer un token “read-only” temporaire pour un service externe.
4. Lister les notifications non lues, en marquer certaines comme lues via REST.

## 6. Exigences Fonctionnelles

### 6.1 Commentaires
- `GET /workspaces/:workspaceId/documents/:docId/comments`
- `POST /.../comments`
- `PATCH /.../comments/:commentId`
- `DELETE /.../comments/:commentId`
- `POST /.../comments/:commentId/resolve` (boolean)
- Gestion docMode (Page/Edgeless), mentions (array userId), réponses.

### 6.2 Historique
- `GET /workspaces/:workspaceId/documents/:docId/history`
- `POST /.../history/:versionId/recover`

### 6.3 Tokens
- `GET /users/me/tokens`
- `POST /users/me/tokens`
- `DELETE /users/me/tokens/:tokenId`

### 6.4 Notifications
- `GET /notifications`
- `POST /notifications/:notificationId/read`
- `POST /notifications/read-all`

### 6.5 Publication publique
- `POST /workspaces/:workspaceId/documents/:docId/publish`
- `POST /workspaces/:workspaceId/documents/:docId/revoke`
- Usage concret : automatiser la diffusion de docs (notes de version, comptes rendus) depuis CI/CD sans passer par l’UI.

### 6.6 Lifecycle workspaces
- `POST /workspaces` – bootstrap workspace + doc initial.
- `PATCH /workspaces/:workspaceId` – mise à jour metadata (nom, options AI).
- `DELETE /workspaces/:workspaceId` – nettoyage environnement sandbox.

### 6.7 Blob storage & apply updates
- Upload/suppression de blobs (`upload_blob`, `delete_blob`) pour automatiser l’ajout de fichiers volumineux.
- `POST /workspaces/:workspaceId/documents/:docId/apply-updates` pour rejouer des diffs Yjs (migrations massives).

### 6.8 Compatibilité MCP
- Inputs/outputs alignés avec `affine-mcp-server` (`comments.ts`, `history.ts`, `accessTokens.ts`, `notifications.ts`, `publish.ts`, `workspaces.ts`, `blobs.ts`).
- Réutiliser GraphQL ou REST internes selon les mutations en place.

## 7. Exigences Techniques
- S’appuyer sur `AffineClient` refactor (helpers Socket.IO partagés).
- Décoder/encoder les payloads JSON GraphQL existants (ex: `CommentCreateInput`).
- Zod schemas pour validation.
- Test coverage (Vitest + intégration staging).
- Auth : utiliser nos API keys en plus des credentials AFFiNE.

## 8. Dépendances
- Analyse MCP (`docs/reference/affine-mcp-analysis.md`).
- Accès GraphQL AFFiNE (`createComment`, `resolveComment`, `recoverDoc`).
- Gestion cookies/token existante.

## 9. Tests & Validation
- Unit tests TB (transformations, payloads).
- Intégration : workspace **Robots in Love**, dossier `Affine_API/Tests API`.  
  Chaque feature crée via l’API un sous-dossier daté + documents/fichiers de preuve (ex : `copilot-search/query-001`), puis consigne les IDs retournés.
- Scripts d’exemple :
  - `scripts/run-affine-api-test.ts` (CRUD markdown)
  - `scripts/run-copilot-embedding-smoke.ts` (queue + search)
  - `scripts/run-history-recovery-smoke.ts` (list/recover history)
  1. Provisionnent le jeu de données (création doc, upload fichier).  
  2. Appellent l’endpoint ciblé.  
  3. Vérifient la réponse (contenu, distances, statut).  
  4. Journalisent le résultat dans AFFiNE (note « Test run XYZ »).
- Smoke test CLI réutilisable dans CI pour déclencher l’ensemble.

## 10. Monitoring
- Métriques : `comments_created_total`, `history_recover_total`, `tokens_created_total`, `notifications_marked_total`.
- Logs Pino avec docId/commentId pour audit.

## 11. Roadmap & Phases

| Phase | Contenu |
| --- | --- |
| 0 | Capturer requêtes GraphQL copilot (match/status/queue) + publication + workspace lifecycle |
| 1 | **Priorité 1** – search copilot + gestion embeddings + context sessions |
| 2 | **Priorité 2** – historique/recovery + monitoring |
| 3 | **Priorité 3a** – commentaires + notifications + tokens |
| 4 | **Priorité 3b** – publication publique + workspace lifecycle + blobs/apply-updates |
| 5 | Docs OpenAPI + guide utilisateur + jeux de test automatisés |

## 12. Risques
- Changements schema GraphQL AFFiNE → isoler ces appels dans `lib/gql`.
- Permissions (certains comptes ne peuvent pas gérer tokens) → propagation d’erreurs claire.
- Concurrence (resolve comment déjà résolu) → renvoyer 409 ou 200 idempotent.

## 13. Annexes
- `projects/notebooks_api/docs/reference/affine-mcp-analysis.md` – surface MCP.
- `projects/notebooks_api/vendor/affine-mcp-server/src/tools/comments.ts` etc.
- `projects/notebooks_api/README.md` – endpoints actuels.
