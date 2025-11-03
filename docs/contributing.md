# Guide de contribution

## Pré-requis
- Node.js 20.x
- npm 10.x (`npm install -g npm@latest` si besoin)
- Accès au workspace AFFiNE de staging (credentials via vault ServerLab).

## Workflow Git
1. Créer une branche (`feature/affine-api-*`).
2. `npm install` (une seule fois) puis `npm run build`/`npm test` avant push.
3. Soumettre une Pull Request → lint/test obligatoires via GitHub Actions.
4. Rebase (pas de merge commit) et squash à l'intégration.

## Qualité & Tests
- Lint : `npm run lint` (ESLint + Prettier).
- Unit tests : `npm test` (Vitest).
- Intégration : à venir (`npm run test:integration`), mock de `ioFactory` ou workspace staging.
- Ajouter des tests pour chaque bugfix ou nouvelle fonctionnalité.

## Style de code
- TypeScript strict (`strict: true`).
- Modules ESM (import/export). Exporter explicitement les fonctions utilitaires.
- Commentaires concis exclusivement pour clarifier les sections complexes (Yjs, Socket.IO).
- Utiliser `docs/` pour la documentation longue (architecture, décisions, specs REST).

## Revue de code
- Vérifier la propagation des erreurs socket (`error.code`/`error.message`).
- S'assurer que chaque opération AFFiNE met à jour les documents associés (`workspace meta`, `docProperties`, `folders`).
- Vérifier la non-régression sur la compatibilité CJS (scripts existants) tant que la migration n'est pas finalisée.

## Publication / Release
- Tag semver via `npm version`.
- `npm run build` doit précéder toute release : le contenu de `dist/` est l'artefact distribué.
- Changelog généré via Changesets/semantic-release (à définir Phase 3).

## Support / Contact
- Slack `#affine-infra` (ServerLab).
- Tickets GitHub (issues + labels `bug`, `enhancement`, `discussion`).
- Escalade devops : `devops@robotsinlove.be`.
