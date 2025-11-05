# PRD – AFFiNE Collaboration API

| Champ | Détail |
| --- | --- |
| Auteur | Codex |
| Date | 2025-11-05 |
| Statut | Draft |
| Projet | `projects/notebooks_api` |
| Source | Analyse `affine-mcp-server` et besoins API notebooks |

---

## 1. Contexte & Problème

Le serveur MCP `affine-mcp-server` expose via Claude/Codex des outils couvrant commentaires, historique de versions, tokens personnels et notifications. Notre API REST n’offre pas encore ces fonctionnalités, ce qui limite l’automatisation collaborative (alertes, revue documentaire, audit). Objectif : fournir une surface REST stable, sécurisée et documentée pour ces domaines, en gardant compatibilité avec le comportement MCP.

## 2. Objectifs

1. CRUD commentaires + résolution (mode page & edgeless) via REST.
2. Exposer l’historique de versions (listing + restore) pour automatiser les rollbacks.
3. Gérer tokens personnels (création/ révocation) pour autogestion des accès.
4. Lire / marquer notifications pour intégration avec nos outils (n8n, alerting).

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

### 6.5 Compatibilité MCP
- Inputs/outputs alignés avec `affine-mcp-server` (`comments.ts`, `history.ts`, `accessTokens.ts`, `notifications.ts`).
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
- Intégration : workspace staging, doc dummy, commentaire round-trip.
- Smoke test CLI (`scripts/run-affine-collaboration-test.ts`).

## 10. Monitoring
- Métriques : `comments_created_total`, `history_recover_total`, `tokens_created_total`, `notifications_marked_total`.
- Logs Pino avec docId/commentId pour audit.

## 11. Roadmap & Phases

| Phase | Contenu |
| --- | --- |
| 0 | Capturer requêtes GraphQL comment/history/tokens/notifications via UI |
| 1 | Implémenter endpoints commentaires + tests |
| 2 | Historique + restore |
| 3 | Tokens + Notifications |
| 4 | Docs OpenAPI + guide utilisateur |

## 12. Risques
- Changements schema GraphQL AFFiNE → isoler ces appels dans `lib/gql`.
- Permissions (certains comptes ne peuvent pas gérer tokens) → propagation d’erreurs claire.
- Concurrence (resolve comment déjà résolu) → renvoyer 409 ou 200 idempotent.

## 13. Annexes
- `projects/notebooks_api/docs/reference/affine-mcp-analysis.md` – surface MCP.
- `projects/notebooks_api/vendor/affine-mcp-server/src/tools/comments.ts` etc.
- `projects/notebooks_api/README.md` – endpoints actuels.
