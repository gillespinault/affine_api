# ServerLab AFFiNE API Toolkit

Toolkit pour industrialiser les intégrations avec une instance AFFiNE self-hosted. Le projet fournit :

- Un client TypeScript (`AffineClient`) qui gère authentification, Socket.IO et mutations Yjs pour créer/modifier des documents.
- Des utilitaires Yjs (construction de documents, encodage d'updates, gestion des cookies).
- Une base de tests Vitest pour sécuriser les évolutions.
- Une documentation d'architecture et une feuille de route pour préparer la publication sur GitHub et les déploiements clients.

## Prise en main

```bash
npm install
npm run build
npm test
npm run cli:create-doc -- --workspace <workspace-id>
npm run cli:create-doc -- --workspace <workspace-id> --markdown-file ./note.md
```

- `npm run build` produit `dist/` (ESM + déclarations TypeScript) à publier dans un registre interne ou un package CDN.
- `npm test` exécute la suite Vitest (unit tests). Ajouter `--runInBand` en environnement CI si nécessaire.
- `npm run cli:create-doc -- --workspace <workspace>` lance le nouveau CLI TypeScript (nécessite variables `AFFINE_EMAIL`/`AFFINE_PASSWORD`). Ajoutez `--markdown "<contenu>"` ou `--markdown-file <chemin>` pour importer une page riche à partir d'un Markdown.
- Les scripts historiques (`scripts/affine_doc_manager.cjs`, `scripts/affine_ws_prototype.mjs`) continueront d'utiliser la couche CJS existante tant que `dist/` n'est pas publié. Voir [docs/roadmap.md](docs/roadmap.md) pour le plan de migration.

## Structure du dépôt

```text
README.md                     → overview et instructions rapides
affine_api_notes.md           → notes de recherche existantes
src/client/                   → client TypeScript + exports publics
src/service/                  → service HTTP + CLI (Fastify skeleton)
tests/unit/                   → Vitest specs
scripts/                      → scripts Node historiques (CJS/MJS)
docs/                         → architecture, roadmap, contributions
docs/specs/rest-api.yaml     → spécification OpenAPI des endpoints REST
docs/deployment.md           → guide publication GitHub + déploiement Dokploy
```

## Configurations principales

- `package.json` – scripts, dépendances (socket.io-client, yjs, tooling TS/Vitest).
- `tsconfig.json` & `tsconfig.build.json` – configuration TypeScript (Node 20, paths `@client/*`).
- `.eslintrc.cjs`, `.prettierrc.json`, `.editorconfig` – conventions de code.

## Exposer le service REST en local

```bash
npm install
npm run build
npm start
```

La commande `npm start` instancie `Fastify` sur le port `3000` (configurable via `PORT`) et s'appuie sur les variables d'environnement `AFFINE_EMAIL`, `AFFINE_PASSWORD` et `AFFINE_BASE_URL`.

## Publication GitHub (prochaines étapes)

1. Initialiser un dépôt privé (ex. `serverlab/affine-api`) puis pousser l'historique.
2. Activer une CI (GitHub Actions) avec jobs `npm ci`, `npm run build`, `npm test`.
3. Générer des releases semver (`npm version`) et publier les artefacts (`dist/`).

Les détails complets (gouvernance, backlog, services REST/GraphQL) sont décrits dans la documentation du dossier `docs/`.
