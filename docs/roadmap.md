# Roadmap AFFiNE API

## Phase 1 – Stabilisation SDK (Semaine 45)
- [x] Créer squelette TypeScript + outils (lint, test, build).
- [x] Porter l'ancien client CJS (`lib/affineClient.js`) dans `src/client/`.
- [x] Couvrir `AffineClient` avec tests unitaires ciblés (parse cookies, encode updates).
- [ ] Ajouter des tests d'intégration simulés (mock `ioFactory`) pour `space:join`, `space:load-doc`.
- [x] Publier les scripts CLI en TypeScript (nouveau package `src/service/cli`).
- [x] Construire le convertisseur Markdown → blocs AFFiNE et tests de mapping.

## Phase 2 – Service REST/CLI (Semaine 46-47)
- [ ] Design REST (`docs/specs/rest-api.yaml`) et validation avec stakeholders.
- [ ] Implémenter service Fastify (`src/service/server.ts`) avec endpoints doc/folder. *(squelette initial en place)*
- [ ] Exposer les opérations essentielles : lecture liste (GET), lecture contenu (GET Yjs), mise à jour (PATCH), suppression (DELETE), déplacement dossier.
- [ ] Ajouter middleware AuthN/AuthZ (token AFFiNE + API key interne) + rate limiting/logs.
- [ ] Intégration n8n : action "Create AFFiNE doc" + variantes (update, delete).
- [ ] Packaging Docker + Helm chart.

## Phase 3 – Production readiness (Semaine 48+)
- [ ] Tests d'intégration sur workspace staging (workflow GitHub Action nightly) couvrant création, mise à jour, suppression.
- [ ] Tests E2E markdown → AFFiNE (import complet, contenus riches : listes, tableaux, code).
- [ ] Monitoring (Prometheus metrics + alertes) et traçabilité (OpenTelemetry).
- [ ] Documentation utilisateur (guides, snippets Python/JS) incluant pipeline Markdown.
- [ ] Processus de release semver (Changesets ou semantic-release).
- [ ] Préparation open-source (audit dependencies, licence, contribution guidelines).

## Préparation GitHub
- [ ] Créer dépôt `serverlab/affine-api`, importer l'historique.
- [ ] Configurer GitHub Actions (lint/build/test on push + release pipeline).
- [ ] Activer Branch Protection (main, PR review, status checks).
- [ ] Documenter CODEOWNERS (ex: `@gillespinault`, `@serverlab/devops`).

## Risques / Points d'attention
- Changements de protocole AFFiNE (versions futures) → prévoir une couche de compatibilité et tests de contract.
- Sensibilité des credentials (cookies) → chiffrer au repos, rotation automatisée.
- Gestion volumétrie Yjs (gros documents) → monitorer la taille des updates et limiter la fréquence.
