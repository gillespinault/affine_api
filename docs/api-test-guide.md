# AFFiNE API Test Scenario

This repository now ships with a reproducible smoke test that exercises the end-to-end flow against the `Robots in Love` workspace.

## Script Overview

- **Path**: `scripts/run-affine-api-test.ts`
- **Execution**:
  ```bash
  AFFINE_EMAIL=<email> AFFINE_PASSWORD=<password> \
    ./node_modules/.bin/tsx scripts/run-affine-api-test.ts
  ```
- **What it does**:
  1. Authenticates with the AFFiNE instance and joins the workspace.
  2. Creates a rich Markdown note inside the `test api` folder, including headings, bullet lists, numbered lists, and a Markdown table.
  3. Automatically applies the `test api` tag both in the document metadata and in `docProperties`, so the UI surfaces the tag immediately.
  4. Reads the document back to verify:
     - All lists are backed by `affine:list` blocks with `Y.Text` payloads.
     - The table is materialised as an `affine:table` block with populated rows/columns.
     - The folder registration points to the requested parent folder.
  5. Prints a concise JSON summary for quick inspection.

## Requirements

- Set `AFFINE_EMAIL` and `AFFINE_PASSWORD` in the environment. The script does **not** persist credentials anywhere.
- Network access to the AFFiNE instance must be allowed from the execution environment.
- The workspace has to expose the folder id `Sif6m2iLTXMPqw47IULGE` ("test api"). Update the script if IDs change between environments.

## Cleanup

Le helper nettoie désormais l'environnement en supprimant la note créée via `AffineClient.deleteDocument`. Aucun passage manuel n'est nécessaire.

## Copilot Embedding Smoke Test

- **Path**: `scripts/run-copilot-embedding-smoke.ts`
- **Execution**:
  ```bash
  AFFINE_EMAIL=<email> AFFINE_PASSWORD=<password> \
    ./node_modules/.bin/tsx scripts/run-copilot-embedding-smoke.ts
  ```
- **Scénario** :
  1. Localise le workspace `Robots in Love` (surchageable via `AFFINE_WORKSPACE_NAME`).
  2. Garantit l'existence du dossier `Affine_API/Tests API` (création si nécessaire).
  3. Crée une note contenant un token unique (`copilot-<timestamp>`).
  4. Utilise l'API REST `/copilot/queue` puis `/copilot/search` via `server.inject()` pour vérifier que le document est bien indexé (polling jusqu'à 1 min).
  5. Récupère le statut global (`/copilot/status`) et imprime un résumé JSON (workspace, docId, token, résultat de recherche, statut d'indexation).

Ce script prouve l'intégration bout en bout Copilot/Embeddings sans dépendre d'outils externes.

> **Prereq (prod AFFiNE)** : l’extension `vector` doit être déplacée dans le schéma `affine` ( `ALTER EXTENSION vector SET SCHEMA affine;` ) pour que Prisma résolve le type lors des requêtes `matchWorkspaceDocs`. Exemple de run validé le 2025‑11‑07 : doc `SxjNhXGckl3oz2RTVUc8p` avec token `copilot-mhonytp5` détecté (distance ≈0.25) et statut `total=59 / embedded=59`.

## Historique & Recovery Smoke Test

- **Path**: `scripts/run-history-recovery-smoke.ts`
- **Execution**:
  ```bash
  AFFINE_EMAIL=<email> AFFINE_PASSWORD=<password> \
    ./node_modules/.bin/tsx scripts/run-history-recovery-smoke.ts
  ```
- **Scénario** :
  1. Crée un document dans `Affine_API/Tests API` avec un token unique.
  2. Applique deux mises à jour successives (versions B et C) pour générer des entrées d’historique.
  3. Appelle `GET /history` pour récupérer les timestamps disponibles.
  4. Restaure la version la plus ancienne via `POST /history/recover`.
  5. Lit le contenu courant (`AffineClient.getDocumentContent`) et vérifie que le texte correspond à la “Version A”.

La sortie JSON inclut la liste des `historyEntries`, le timestamp restauré et un booléen `restoredMatches` qui doit être `true` pour valider la réussite.

## Collaboration Smoke Test (REST Dokploy)

- **Path**: `tools/run-collaboration-smoke.mjs`
- **Execution**:
  ```bash
  node tools/run-collaboration-smoke.mjs
  ```
- **Scénario** :
  1. Frappe l’API REST déployée (`https://affine-api.robotsinlove.be`) pour lister les workspaces et garantir la présence du dossier `Affine_API/Tests API`.
  2. Crée un document Markdown éphémère avec un token unique et l’étiquette `collab-smoke`.
  3. Exerce le flux complet des commentaires via REST : création, patch, resolve/unresolve, list, puis suppression du commentaire.
  4. Appelle `GET /notifications?unreadOnly=true` et `POST /notifications/read-all` pour vérifier la surface notifications.
  5. Crée puis révoque un token personnel via `/users/me/tokens`, ce qui confirme le CRUD des tokens.
  6. Supprime le document pour garder l’environnement propre.

La sortie JSON inclut toutes les IDs manipulées (docId, commentId, tokenId) et les objets de réponse bruts pour les notifications/access tokens (facile à tracer dans les logs Fastify).

> **Notes** : Ce script n’a pas besoin des credentials AFFiNE car il tape la façade REST Dokploy. Assurez-vous que la version déployée contient bien les endpoints `/comments`, `/notifications` et `/users/me/tokens` (v0.3.0+).

## Collaboration Smoke Test (Client direct)

- **Path**: `tools/run-live-collaboration-smoke.mjs`
- **Execution**:
  ```bash
  AFFINE_EMAIL=<email> AFFINE_PASSWORD=<password> \
    AFFINE_KEEP_TEST_DOC=1 \
    node tools/run-live-collaboration-smoke.mjs
  ```
- **Scénario** :
  1. Utilise `AffineClient` pour se connecter directement à l’instance AFFiNE (`Robots in Love`) et garantir le dossier `Affine_API/Tests API`.
  2. Crée une page Markdown riche, appliquant un token unique (`live-collab-...`) pour l’audit.
  3. Exécute le cycle complet des commentaires via GraphQL/Socket (`createComment`, `updateComment`, `resolveComment`, `deleteComment`) et capture le résultat de `listComments`.
  4. Appelle `listNotifications`, `markAllNotificationsRead`, puis `listNotifications` à nouveau pour vérifier le compteur `unreadCount`.
  5. Crée un token personnel via `createAccessToken`, vérifie sa présence, puis le révoque.
  6. Optionnel : si `AFFINE_KEEP_TEST_DOC=1`, conserve la page (sinon elle est supprimée à la fin).

La sortie JSON récapitule les IDs (doc, commentaire, token) ainsi que les compteurs notifications avant/après. Laisser `AFFINE_KEEP_TEST_DOC=1` permet de garder une trace permanente dans `Affine_API/Tests API` pour les revues produit.

## Publication Smoke Test (REST Dokploy)

- **Path**: `tools/run-publication-smoke.mjs`
- **Execution**:
  ```bash
  node tools/run-publication-smoke.mjs
  ```
- **Scénario** : Crée un document dans `Affine_API/Tests API`, appelle `/publish` (mode page), vérifie la réponse (`public: true`), appelle `/revoke`, puis supprime le document. Le JSON final expose les payloads `published`/`revoked` pour audit.

## Publication Smoke Test (Client direct)

- **Path**: `tools/run-live-publication-smoke.mjs`
- **Execution**:
  ```bash
  AFFINE_EMAIL=<email> AFFINE_PASSWORD=<password> \
    node tools/run-live-publication-smoke.mjs
  ```
- **Scénario** : Utilise `AffineClient` pour créer un document, le publier (`publishDocument`), le révoquer (`revokeDocumentPublication`), puis supprimer ou conserver la page (`AFFINE_KEEP_TEST_DOC=1`). Ce test garantit que les mutations GraphQL fonctionnent avant tout déploiement REST.

## Extending the Scenario

- Add assertions on rendered Markdown by converting the Yjs blocks back to Markdown using `@affine/reader`.
- Cover error paths (invalid folder/tag, missing credentials) once the REST façade is in place.
- Integrate this script in CI (GitHub Actions or n8n) after introducing environment secrets and rate limits.
