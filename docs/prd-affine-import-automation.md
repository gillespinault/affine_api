# PRD – AFFiNE Import Automation

| Champ | Détail |
| --- | --- |
| Auteur | Codex (avec inputs Gilles) |
| Date | 2025-11-03 |
| Statut | Draft |
| Projet | `projects/notebooks_api` |
| Source | Discussion 2025-11-03 |

---

## 1. Contexte & Problème

L'API AFFiNE actuelle propose une conversion Markdown → Yjs côté serveur, pensée pour la génération programmée de documents. En production, l'interface graphique de AFFiNE offre déjà un import de fichiers (Markdown, Word, Notion, snapshots AFFiNE), mais uniquement via interaction humaine.  

**Pain points identifiés :**
- Impossibilité d'automatiser l'import de fichiers depuis un dossier surveillé ou un bucket distant.
- Faible couverture des formats (Markdown uniquement) dans notre pipeline interne.
- Aucune solution pour rejouer des exports AFFiNE (snapshots `.affine`) ou des migrations Notion/Word sans passer par l'UI.

Conséquence : migrations et alimentations de contenu sont manuelles, lentes, et ne tirent pas parti des pipelines d'automatisation ServerLab (n8n, scripts, jobs planifiés).

## 2. Objectifs

1. **Automatiser l'import multi-formats** (Markdown, DOCX, ZIP Notion, snapshots AFFiNE) via notre service REST.
2. **Centraliser le flux d'import** pour qu'il soit orchestrable (n8n, scripts, cron, watchers).
3. **Maintenir la cohérence Yjs** post-import (tags, dossiers, docProperties) grâce aux endpoints existants.
4. **Offrir un socle monitorable** (logs, métriques) pour s'assurer que les imports récurrents se déroulent correctement.

### KPI & Métriques
- Taux de réussite des imports automatisés ≥ 95 % (rolling 30 jours).
- Délai médian d'import (upload → doc disponible) < 30 s pour fichiers ≤ 5 Mo.
- Temps moyen d'intervention humaine pour migration Markdown réduit de 80 %.
- Couverture des formats : au moins 4 formats validés en production.

## 3. Hors Périmètre (Non-goals)

- Créer un moteur de conversion maison pour DOCX/Notion (on réutilise la conversion native AFFiNE).
- Gérer la génération de contenu Markdown (pipeline existant reste en place).
- Implémenter l’import d’images/ressources externes non supportées par AFFiNE (ex : médias lourds).
- Gestion fine des droits côté AFFiNE (s’appuie sur les ACL actuels et le compte service).

## 4. Personas & Usages

- **Automation Engineer** : veut déposer des `.docx` générés par IA dans un dossier et voir les pages apparaître automatiquement.
- **Migration Manager** : souhaite migrer un espace Notion complet exporté en `.zip` sans intervention manuelle.
- **Knowledge Ops** : réimporte régulièrement des snapshots `.affine` pour reconstruire une base de connaissance en staging.
- **Data Scientist** : pousse des notes Markdown générées depuis des notebooks, mais veut profiter d'une API unique respectant les mêmes workflows (tags, dossiers, métadonnées).

## 5. Scénarios cibles

1. **Watcher local** : un dossier `~/imports/affine` surveillé par un service Node (chokidar) → upload automatique via API REST → tagging & placement via endpoints existants.
2. **Ingestion MinIO** : job cron listant un bucket `affine-import/` → import un fichier → archive le fichier dans `processed/`.
3. **n8n** : workflow "Nouvelle issue GitHub → doc AFFiNE" qui génère un `.md` + attachments → import via API.
4. **Migration Notion** : dépôt d’un export `.zip` dans un dossier → import complet (pages, hiérarchie) dans AFFiNE staging.
5. **Restauration snapshot** : relecture automatique d’un `.affine` pour rollback rapide d’un document.

## 6. Exigences Fonctionnelles

### 6.1 Endpoints REST

- `POST /workspaces/:workspaceId/import`
  - Authentification : API token interne + cookies AFFiNE déjà gérés par `AffineClient`.
  - Payloads supportés :
    - `multipart/form-data` (champ `file`; option `folderId`, `tags`, `mode`).
    - `application/json` avec `sourceUrl` (service télécharge le fichier distant).
    - Option `postImport` pour déclencher tagging/move automatique via nos endpoints.
  - Réponses :
    - `202 Accepted` + `jobId` si traitement asynchrone nécessaire (fichiers lourds).
    - `201 Created` + détails doc (`docId`, `folderNodeId`, `format`) si traitement synchrone.
- `GET /imports/:jobId` (optionnel) : suivre statut d’un import en file d’attente.

### 6.2 Formats supportés

- Markdown (`.md`)
- Microsoft Word (`.docx`)
- Notion Export (`.zip`) – préservation hiérarchie si possible
- Snapshot AFFiNE (`.affine` ou `.json` BlockSuite)
- (Stretch) HTML simple ou PDF texte → en file d’attente post V1.

### 6.3 Automations

- **Hooks post-import** : déclencher `PATCH /documents/:docId/properties` et `POST /documents/:docId/move`.
- **Watchers** : SDK Node pour écouter un dossier / bucket (exemple fourni).
- **n8n** : ajouter une action “Import AFFiNE File” consommant l’endpoint.

### 6.4 Reporting & Logs

- Logs Fastify (Pino) incluant `importId`, `workspaceId`, `format`, `source`.
- Émissions d’événements (ex : `imports.completed`) vers bus interne à définir.
- Métriques Prometheus (nombre imports, temps moyen, erreurs).

## 7. Exigences Techniques

1. **Reverse-engineering import UI** : capturer la requête réseau actuelle (Playwright + HAR) pour connaître le endpoint exact, les headers et champs attendus (probablement `POST /api/workspaces/:id/import` en multipart).
2. **Client AFFiNE** :
   - Ajouter méthode `importFile(workspaceId, fileStream, options)` réutilisant les cookies/session.
   - Gérer upload multipart (streaming) et propagation des erreurs AFFiNE.
3. **Service Fastify** :
   - Ajout route `POST /workspaces/:workspaceId/import`.
   - Support upload via `fastify-multipart` (limiter taille, security).
   - Possibilité de télécharger un fichier distant (HTTP, S3/MinIO) → stream vers AFFiNE.
   - File d’attente interne (BullMQ / simple queue en mémoire) si l’import est long.
4. **Sécurité** :
   - API key interne pour appeler notre service (header `X-API-Token`).
   - Filtrage whitelist d’extensions (rejeter `.exe`, `.bat`, etc.).
   - Quotas (ex : max 20 imports/min par clé).
5. **Stockage temporaire** :
   - Utiliser `/tmp` ou MinIO temporaire avec TTL 15 min pour les fichiers distants.
   - Nettoyage automatique en cas d’échec.
6. **Compatibilité** :
   - Node 20 (streams, fetch).
   - Maintenir pipeline Markdown existant (option `mode=markdown-direct`).

## 8. Dépendances & Intégrations

- **AFFiNE backend** : endpoint import existant (non documenté) doit rester stable. Prévoir fallback en cas de changement (feature flag).
- **Dokploy** : configurer les variables (API token, limites taille upload).
- **Secrets Vault** : conserver credentials AFFiNE et éventuels tokens MinIO/S3.
- **n8n** : nouvelle action dans `docs/guides/n8n-integration-process.md` à documenter.

## 9. Testing & Validation

- **Unit tests** : méthodes `AffineClient.importFile`, parsing d’options.
- **Integration tests** :
  - Mock AFFiNE import via nock + fixtures (V1).
  - En staging : importer un `.md`, `.docx`, `.zip` et vérifier création, tags, placement.
- **E2E** :
  - Watcher local → import → vérification dans AFFiNE UI (manuel).
  - Workflow n8n → import → validation JSON de réponse.
- **Smoke test** : script `scripts/run-affine-import-smoke.ts` (à créer) qui injecte un markdown puis un `.affine`.

## 10. Monitoring & Opérations

- **Métriques** : `imports_total{format=}`, `imports_duration_seconds`, `imports_errors_total{reason=}`.
- **Alerts** : si taux d’erreur > 10 % sur 15 min, ou durée moyenne > 120 s.
- **Runbooks** :
  - Ajouter une section dans `docs/runbooks/docker-service-down.md` pour relancer les imports.
  - Mettre à jour `docs/reference/services-reference.md` pour inclure les nouveaux endpoints.

## 11. Roadmap & Phasage

| Phase | Contenu | Délai cible |
| --- | --- | --- |
| **0 – Discovery** | Capturer requêtes UI, inventorier formats et limites | Semaine 45 |
| **1 – MVP Markdown/DOCX** | Endpoint REST, upload direct, postImport tags/folders | Semaine 46 |
| **2 – Formats avancés** | Support Notion ZIP & snapshots AFFiNE, hook n8n | Semaine 47 |
| **3 – Automations** | Watcher dossier, ingestion MinIO, métriques/alerts | Semaine 48 |
| **4 – Hardening** | Rate limiting, file queue, docs runbooks, CI smoke tests | Semaine 49 |

## 12. Risques & Mitigations

- **Changements côté AFFiNE** : API import non officielle -> surveiller releases, garder un adapter isolé + flag de désactivation.
- **Fichiers volumineux** : risque timeout -> streaming + seuil taille (ex : 50 Mo max) + job asynchrone.
- **Sécurité** : import de fichiers malicieux -> validation extension + scanning antivirus (stretch).
- **Coût stockage temporaire** : rotation agressive + quotas.
- **Charge réseau** : limiter nombre d’imports parallèles (configurable).

## 13. Ouvert & Questions

- Format exact des options import (tags/dossier) côté AFFiNE ? À confirmer via capture réseau.
- AFFiNE renvoie-t-il un ID de job ou un docId direct ? À vérifier.
- Notion ZIP : supporte-t-on la hiérarchie (sous-pages) automatiquement ? Peut nécessiter post-traitement.
- Faut-il stocker un log d’audit (qui a importé quoi, à quelle heure) ? Probablement oui.
- Nécessité d’un rollback automatique en cas d’échec partiel (ex : Notion avec 20 pages) ?

---

## 14. Annexes

- `projects/notebooks_api/README.md` – endpoints REST actuels, pipeline Markdown.
- `projects/notebooks_api/docs/architecture.md` – vision du SDK et service.
- `projects/notebooks_api/docs/api-test-guide.md` – smoke test existant (à étendre).
- `projects/notebooks_api/EDGELESS_DESIGN.md` – référence pour futures extensions (non couvert ici).

