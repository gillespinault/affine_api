# PRD – AFFiNE Database Support

| Champ | Détail |
| --- | --- |
| Auteur | Codex (inputs Gilles) |
| Date | 2025-11-03 |
| Statut | Draft |
| Projet | `projects/notebooks_api` |
| Source | Discussion 2025-11-03 |

---

## 1. Contexte & Problème

AFFiNE propose des « databases » (tables, kanban, collections) intégrées aux documents. Elles s'appuient sur des blocs BlockSuite (`affine:database`, `affine:table`) stockés dans Yjs. L'UI gère aujourd'hui la création/édition, mais aucune API ne permet de lire ou manipuler ces données de manière automatisée.

**Limitations actuelles :**
- Les automatisations (n8n, scripts) ne peuvent pas ajouter/modifier des lignes d'une database AFFiNE.
- Impossible de synchroniser ces tables avec des systèmes externes (CRM, tickets) sans passer par le navigateur.
- Aucune API REST ne liste les databases existantes ni leurs schémas.

Conséquence : les équipes ne peuvent pas industrialiser l'usage des databases AFFiNE (reporting, synchronisation, ingestion automatique) malgré leur présence dans les documents.

## 2. Objectifs

1. **Exposer une API REST officielle** pour lire et manipuler les databases AFFiNE (schéma + données).
2. **Fournir des primitives SDK** (`AffineClient`) pour créer, modifier et supprimer colonnes/lignes.
3. **Garantir l’intégrité Yjs** lors des mises à jour (lexorank, ordre, timestamps) afin que l’UI reste cohérente.
4. **Permettre l’orchestration** via n8n / scripts (CRUD complet de lignes et colonnes, lecture filtrée).

### KPI & Métriques
- 100 % des bases de données d’un workspace accessibles via l’API en lecture.
- Temps moyen d’insertion d’une ligne < 1 s (hors latence réseau).
- Tests d’intégration couvrant ≥ 3 types de champs (texte, select, checkbox) et 2 modes de vue.
- Adoption : au moins 2 workflows n8n ou scripts utilisant la nouvelle API dans le mois suivant le lancement.

## 3. Hors Périmètre

- Gestion du moteur de requêtes avancées (agrégations, vues pivot complexes).
- Export CSV natif (peut être construit via l’API mais pas livré en V1).
- Support complet des relations inter-databases (V1 expose les IDs ; gestion graphique dans l’UI).
- Webhooks / events temps réel (à traiter dans une phase future).

## 4. Personas & Usages

- **Ops / Automation Engineer** : synchronise un pipeline externe (tickets, deals) avec une database AFFiNE.
- **Product Manager** : génère un reporting hebdo en lisant la table via API et en alimentant un dashboard.
- **Data Scientist** : alimente automatiquement des backlogs AFFiNE depuis un notebook Jupyter.
- **Knowledge Ops** : migre des données depuis Notion/CSV vers AFFiNE (création en masse de lignes/colonnes).

## 5. Scénarios clés

1. **Création colonne + ingestion** : un script ajoute une colonne "Status" (select) puis crée/maj 20 lignes avec les valeurs correspondantes.
2. **Synchro CRM → AFFiNE** : n8n récupère des tickets Zendesk et met à jour les lignes existantes (matching par ID externe) ou en crée de nouvelles.
3. **Reporting** : un service lit toutes les lignes où `status = "In progress"` et produit un rapport hebdomadaire.
4. **Migration Notion** : importer un tableau Notion existant en reconstituant le schéma AFFiNE (V2 stackée avec l’import generalisé).
5. **Vue Kanban** : création d’une nouvelle vue "Board" sur une base existante avec colonnes/ordres configurés.

## 6. Exigences Fonctionnelles

### 6.1 Découverte & lecture
- `GET /workspaces/:workspaceId/databases` → liste des databases (docId, blockId, titre, doc contenant).
- `GET /workspaces/:workspaceId/databases/:databaseId` → schéma (colonnes), vues, métadonnées (créateur, timestamps).
- `GET /workspaces/:workspaceId/databases/:databaseId/rows` → lignes + valeurs. Paramètres optionnels : pagination (`limit`, `cursor`), filtre simple (`fieldId=value`), tri (`sort=fieldId:asc`).

### 6.2 Création & mise à jour
- `POST /workspaces/:workspaceId/databases` → crée un bloc database dans un document donné (ou à la racine) avec schéma initial.
- `POST /workspaces/:workspaceId/databases/:databaseId/rows` → ajoute une ligne.
- `PATCH /workspaces/:workspaceId/databases/:databaseId/rows/:rowId` → met à jour les cellules.
- `DELETE /workspaces/:workspaceId/databases/:databaseId/rows/:rowId` → supprime une ligne.

### 6.3 Gestion des colonnes & vues
- `POST /.../columns` → ajoute une colonne (type, nom, options).
- `PATCH /.../columns/:columnId` → renomme / change options / réordonne.
- `DELETE /.../columns/:columnId` → supprime une colonne (gère la purge des cellules correspondantes).
- `POST /.../views` / `PATCH /.../views/:viewId` → (V2) créer/éditer les vues (table, board, calendar) et leur configuration (colonnes visibles, grouping).

### 6.4 SDK & Helpers
- `AffineClient.listDatabases(docId?)`, `getDatabase(databaseId)`, `createDatabase`, `updateRow`, etc.
- Convertisseurs Yjs ↔ JSON pour les types de champs :
  - `text`, `rich-text` → string
  - `checkbox` → bool
  - `select`, `multi-select` → array d’IDs + labels (requiert mapping options)
  - `date` → ISO string
  - `relation` → array d’IDs référencés (V1 : exposer brut, V2 : follow-up pour deref)
- Gestion de l’ordre (lexorank) pour colonnes et lignes.

## 7. Exigences Techniques

1. **Reverse-engineering** : capturer une database via UI (snapshot Yjs) pour documenter structure exacte (`props.schema`, `props.rows`, `props.views`, `props.settings`).
2. **Abstraction Yjs** :
   - Lire/écrire les structures `Y.Map`/`Y.Array` associées à `affine:database`.
   - Générer les updates Yjs nécessaires avec `AffineClient.emitUpdate(...)` (réutiliser la logique de `createDocument`).
3. **Validation** : utiliser Zod pour vérifier payloads REST (typage fort selon type de colonne).
4. **Transactions** : regrouper updates Yjs (schema + cells) pour éviter états intermédiaires incohérents. Penser à un flag `AtomicOperation` si nécessaire.
5. **Compatibilité UI** :
   - Respecter la structure `props.schema.fields` (id, name, type, config).
   - Supporter `props.rows` (map { rowId: { cells, createdAt, updatedAt } }).
   - Maintenir `props.views` intactes si non modifiées.
6. **Performances** :
   - Optimiser lecture des rows (pagination, champs sélectifs) pour éviter de charger des volumes importants.
   - Limiter taille des payloads (ex : 2 Mo max) et rejeter import massif sans chunking.
7. **Sécurité** :
   - Authentification via API token interne + session AFFiNE (comme REST existant).
   - Vérifier ACL AFFiNE (workspace doc permissions) avant modification.
   - Rate limiting spécifique (ex : 60 opérations/minute) pour éviter spam.

## 8. Dépendances & Intégrations

- **AFFiNE backend** : dépend des structures BlockSuite ; surveiller les releases (risque de changement de schéma).
- **Dokploy** : variables pour activer/désactiver la feature (feature flag).
- **Tests** : nécessite un workspace de staging avec base de données exemple.
- **n8n** : prévoir un module "AFFiNE Database" (actions : List Rows, Create Row, Update Row).

## 9. Testing & Validation

- **Unit tests** : parse & serialize Yjs schema/rows, helpers lexorank.
- **Integration tests** :
  - Créer database → ajouter colonnes → insérer rows → vérifier via lecture.
  - Modifier type de colonne (texte → select) et confirmer conversions.
- **E2E** : script `scripts/run-affine-database-test.ts` (à créer) qui :
  1. Crée une base test (3 colonnes).
  2. Ajoute 2 lignes.
  3. Met à jour une ligne.
  4. Supprime la base ou nettoie les lignes.
- **UI validation** : ouvrir la page dans AFFiNE, vérifier cohérence (ordre colonnes, vues).

## 10. Monitoring & Opérations

- Métriques Prometheus : `database_rows_created_total`, `database_rows_updated_total`, `database_operation_duration_seconds`.
- Logs structurés : ID database, docId, type d’opération, nombre de cellules affectées.
- Alertes : taux d’erreur > 5 % sur 10 min ; durée moyenne > 2 s.
- Runbook : documenter rollback (restaurer snapshot doc) en cas de corruption.

## 11. Roadmap & Phasage

| Phase | Contenu | Délai cible |
| --- | --- | --- |
| **0 – Discovery** | Capturer snapshot + trafic UI, cartographier structure Yjs | Semaine 45 |
| **1 – SDK Core** | Helpers Yjs (lecture/écriture schema, rows) + tests unitaires | Semaine 46 |
| **2 – API REST** | Endpoints CRUD (lecture + rows) + docs | Semaine 47 |
| **3 – Colonnes & Vues** | CRUD colonnes, support vues table/board | Semaine 48 |
| **4 – Tooling** | n8n module, scripts CLI, monitoring & runbook | Semaine 49 |
| **5 – Hardening** | Tests E2E, pagination avancée, support relations (stretch) | Semaine 50 |

## 12. Risques & Mitigations

- **Évolution BlockSuite** : schéma susceptible de changer → isoler la logique dans `lib/databaseAdapter.ts` + tests snapshots.
- **Corruption Yjs** : mauvaise manipulation peut casser l’UI → validation stricte + backups (snapshots doc) avant modifications massives.
- **Performance** : grosses bases (1000+ lignes) → paginer côté API et imposer limites.
- **Permissions** : vérifier que l’utilisateur/service possède les droits d’édition (sinon renvoyer 403 explicite).
- **Complexité views** : Kanban/calendar ont des configs spécifiques ; prioriser table en V1 et documenter limitations.

## 13. Questions Ouvertes

- Faut-il exposer un champ "externalId" pour faire du upsert ? (probable, sinon utiliser un champ custom).
- Comment gérer les colonnes relationnelles vers d’autres databases ? (V1 : ID brut, V2 : deref optionnel).
- Besoin d’un endpoint bulk pour créer/mettre à jour plusieurs lignes en une requête ?
- Faut-il verrouiller temporaires (transactions) pour éviter les conflits lors d’éditions simultanées ?
- Quid des champs formule (calculs) : lecture seule acceptable, mais création manuelle complexe.

## 14. Annexes

- `projects/notebooks_api/affine_api_notes.md` – captures Yjs (docProperties, folders, etc.).
- `projects/notebooks_api/README.md` – endpoints existants (documents, blocs).
- `projects/notebooks_api/EDGELESS_DESIGN.md` – méthodologie similaire pour une autre surface Yjs.
- `projects/notebooks_api/docs/reference/affine-mcp-analysis.md` – confirme que les databases ne sont pas couvertes par le MCP.
- Capture HAR à produire (phase discovery) pour documenter les requêtes UI sur les databases.
