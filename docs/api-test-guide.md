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

## Extending the Scenario

- Add assertions on rendered Markdown by converting the Yjs blocks back to Markdown using `@affine/reader`.
- Cover error paths (invalid folder/tag, missing credentials) once the REST façade is in place.
- Integrate this script in CI (GitHub Actions or n8n) after introducing environment secrets and rate limits.
