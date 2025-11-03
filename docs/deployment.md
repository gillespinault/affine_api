# Deployment Guide – AFFiNE API Toolkit

Ce guide décrit comment préparer la publication GitHub du projet et organiser un déploiement Dokploy, en prenant pour modèle la stack `noemai-voice`.

## 1. Préparer la publication GitHub

1. **Nettoyer les secrets** : vérifier que `AFFINE_EMAIL`, `AFFINE_PASSWORD`, cookies ou tokens ne sont jamais commit (voir `.gitignore`).  
2. **Créer le dépôt** : `serverlab/affine-api` (privé dans un premier temps).  
3. **Pipeline CI** :
   - Workflow GitHub Actions : `npm ci`, `npm run build`, `npm test`.  
   - Ajouter `--runInBand` si nécessaire pour la CI.  
4. **Protection & gouvernance** :
   - Branch protection `main`.  
   - `CODEOWNERS` (`@gillespinault`, `@serverlab/devops`).  
   - Activer Dependabot/secrets scanning.  
5. **Release** : conserver `dist/` comme artefact build (publier via Releases ou registry interne quand prêt).

## 2. Durcir le service Fastify

Avant une mise en ligne :

- Finaliser les endpoints REST (GET/PATCH/DELETE, navigation dossier).  
- Ajouter Auth API-key + logging + rate limiting.  
- Écrire les tests d’intégration (mock `ioFactory`) et l’intégration `AffineClient.createDocument` avec `tags`.  
- Penser à l’automatisation de nettoyage pour les documents générés par `scripts/run-affine-api-test.ts`.

## 3. Packaging & Runtime

1. **Runtime Node** :
   ```bash
   npm install
   npm run build
   npm start
   ```
   `npm start` instancie `Fastify` via `dist/service/start.js` (port `3000` par défaut, configurable avec `PORT`).
2. **Dockerfile** : un multi-stage est fourni à la racine (`Dockerfile`). Il exécute `npm ci`, `npm run build`, puis ne conserve que les dépendances de production et le dossier `dist/`.
3. **Docker Compose (optionnel)** : prévoir des services additionnels (Redis, metrics) si requis pour la prod.

## 4. Déploiement Dokploy

1. **Créer une app** dans `Dokploy → ServerLab Apps → Create Service` en mode *Application*.  
2. **Source** : GitHub `serverlab/affine-api`, branche `main`.  
3. **Build** :
   - Méthode : Docker.  
   - Dockerfile : `Dockerfile` (root).  
4. **Variables d’environnement** (onglet *Environment*) :
   ```
   AFFINE_BASE_URL=https://affine.<domaine>
   AFFINE_EMAIL=${SECRET_AFFINE_EMAIL}
   AFFINE_PASSWORD=${SECRET_AFFINE_PASSWORD}
   AFFINE_DEFAULT_FOLDER_ID=...
   AFFINE_DEFAULT_FOLDER_NODE_ID=...
   API_TOKEN=... (clé interne pour Auth du service)
   ```
   Utiliser les secrets Dokploy ; rotation régulière.  
5. **Ports et domaine** :
   - Port interne : `3000`.  
   - Domaine : `affine-api.robotsinlove.be` (exemple).  
   - SSL : activer Let’s Encrypt.  
6. **Smoke-test post déploiement** :
   ```bash
   dokploy exec affine-api npm run run-affine-api-test -- --workspace <workspace-id>
   ```
   Le script nettoie désormais la note générée (`deleteDocument`).

## 5. Observabilité & Suivi

- Ajouter Prometheus metrics/health checks (`/healthz` existe déjà).  
- Brancher les logs Dokploy → Loki/ELK si disponibles.  
- Suivre la feuille de route `docs/roadmap.md` pour la partie monitoring et n8n.

## 6. Prochaines actions

1. Documenter l’intégration n8n dès que l’API est stable.  
2. Ajouter un guide utilisateur (exemples curl/Node) une fois les endpoints GET/PATCH exposés.  
3. Mettre en place Auth API-key + observabilité (cf. section 2 & 5).

Référence croisée : la procédure `noemai-voice` (`../noemai-voice/DEPLOY_DOKPLOY.md`) illustre la configuration Dokploy complète (domaine, SSL, logs). Adopter la même discipline de documentation ici pour garantir la continuité entre sessions.
