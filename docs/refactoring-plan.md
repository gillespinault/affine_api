# Refactoring Plan – Alignement MCP & API REST

| Champ | Détail |
| --- | --- |
| Auteur | Codex |
| Date | 2025-11-05 |
| Statut | Draft |

---

## Objectifs
- Factoriser les helpers Socket.IO/Yjs (`wsUrlFromGraphQLEndpoint`, `pushDocUpdate`, `loadDoc`) dans `AffineClient`.
- Harmoniser les structures de data (documents, workspace pages) avec la référence MCP.
- Préserver la compatibilité existante (tests smoke, scripts CLI, n8n).

## Périmètre
- `src/client/` + `src/service/` : consolidation des APIs internes.
- Aucun changement breaking sur les endpoints REST.

## Étapes
1. Inventorier le code local vs `vendor/affine-mcp-server/src/ws.ts`.
2. Introduire un module `src/client/socketHelpers.ts` dérivé des helpers MCP.
3. Adapter `AffineClient` pour utiliser ces helpers (feature branch, tests).
4. Mettre à jour les scripts/tests (`scripts/run-affine-api-test.ts`) pour vérifier join/push/load.
5. Ajouter un test comparatif (MCP `create_doc` → validation REST) pour assurer la parité.

## Principes
- Commits incrémentaux, tests à chaque étape.
- Possibilité de mettre en place un flag (env) pour toggler la nouvelle implémentation si nécessaire.
- Documenter les changements dans `docs/reference/affine-mcp-analysis.md`.

## Validation
- Smoke tests (markdown, create doc, folder move).
- Tests unitaires Yjs (structures identiques avant/après).
- Si possible, test via MCP pour confirmer la compatibilité.

---

Ce plan sert de base pour guider les refactorings conservateurs à venir.
