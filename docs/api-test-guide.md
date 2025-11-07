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

## Extending the Scenario

- Add assertions on rendered Markdown by converting the Yjs blocks back to Markdown using `@affine/reader`.
- Cover error paths (invalid folder/tag, missing credentials) once the REST façade is in place.
- Integrate this script in CI (GitHub Actions or n8n) after introducing environment secrets and rate limits.
