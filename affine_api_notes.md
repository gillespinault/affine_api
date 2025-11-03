# Affine Self-Hosted API Notes

## Deployment Context
- Base URL: `https://affine.robotsinlove.be`
- Hosted through Dokploy / Docker Swarm (`serverlabapps-affine-*`).
- Dependencies (from docs/reference/services-dokploy.md): PostgreSQL schema `affine`, Redis DB 6, storage volumes `affine-config` and `affine-storage`.
- GraphQL endpoint: `https://affine.robotsinlove.be/graphql`
- REST endpoints observed under `/api`, notably `/api/auth/sign-in` and `/api/workspaces/.../docs/...`.

## Authentication
1. **Personal access token**
   - Stored in MCP config as `AFFINE_API_TOKEN=ut_9de43196b184d026c7ecd73fc6566421effbc`.
   - Works for GraphQL reads and direct Yjs document fetches.
   - GraphQL query example:
     ```bash
     curl -s \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"query":"{ currentUser { id email name } }"}' \
       https://affine.robotsinlove.be/graphql
     ```

2. **Session cookies**
   - Needed for operations that require WebSocket writes (document creation/edit from MCP).
   - Login endpoint: `POST /api/auth/sign-in` with JSON body `{ "email": "...", "password": "..." }`.
   - Valid credentials tested: `gillespinault@gmail.com / AFFiNE56554ine*`.
   - Successful login returns cookies `affine_session=…` and `affine_user_id=…`.

3. **MCP configuration**
   - `~/.mcp.json` registers `affine` MCP server using the personal token (read access only).
   - To enable MCP write tools (`create_doc`, `append_paragraph`, etc.), the MCP server must also hold session cookies or perform `sign_in` to populate them.

## GraphQL Surface
- Introspection allowed (`__schema`). Query root exposes: `currentUser`, `workspace(id)`, `workspaces`, plus administration endpoints.
- `workspaces(): [WorkspaceType!]!` only yields IDs + ACL metadata; no human-readable name or slug fields are present on `WorkspaceType`.
- `workspace(id)` exposes two useful entry points:
  - `doc(docId: …)` → `DocType` (id, mode, defaultRole, `meta` timestamps, creator/updater, `public` flag).
  - `docs(pagination: PaginationInput!)` → `PaginatedDocType` (Relay-style `edges { node { … } }`).
- `PaginationInput` fields: `first` (default 10), `offset`, `after`. Example listing query:
  ```graphql
  query WorkspaceDocs($workspaceId: String!) {
    workspace(id: $workspaceId) {
      id
      docs(pagination: { first: 5, offset: 0 }) {
        edges {
          node {
            id
            title
            summary
            updatedAt
            meta { createdAt updatedAt }
          }
        }
      }
    }
  }
  ```
  - Sample response (`b89db6a1-b52c-4634-a5a0-24f555dbebdc`, 2025-10-31) shows `title`/`summary` resolved as `null`; text lives inside the Yjs `blocks` map, not GraphQL metadata.
- `DocPermissions` returns a capability list (`Doc_Read`, `Doc_Update`, etc.) rather than boolean flags.
- Mutation surface (excerpt):
  - `applyDocUpdates(workspaceId, docId, op, updates)` – likely GraphQL façade for pushing Yjs payloads (not yet exercised).
  - `setBlob`, `uploadCommentAttachment`, `updateDocUserRole`, `updateDocDefaultRole`, etc.
  - No dedicated doc create/delete mutation; aligns with client shipping edits via Socket.IO.
- No GraphQL field covers folder/collection membership or “Quick Notes” placement; metadata is absent from the schema.

## REST + Yjs Payloads
- `GET /api/workspaces/<workspaceId>/docs/<docId>` returns binary Yjs updates representing the document tree.
- `/api/workspaces/<workspaceId>/docs` returns the SPA shell (HTML); there is no documented REST listing endpoint beyond the binary doc fetch.
- Example doc IDs observed in workspace `b89db6a1-b52c-4634-a5a0-24f555dbebdc` (`Robots in Love`).
- Yjs maps of interest:
  - `meta` – includes doc id, title, create/update timestamps, tags.
  - `blocks` – contains the page/note structure (`affine:page`, `affine:note`, `affine:paragraph`, etc.).
  - `spaces` (in workspace root doc) – references each page as a Yjs subdoc (`Doc`) but without readily accessible metadata.
  - `docProperties` doc exists but currently empty in this workspace.
- `space:load-doc` Socket.IO call returns `{ state, missing, timestamp }`. `state` is the Yjs **state vector**, not the full document snapshot; in practice it est seulement ~20 octets. Pour reconstruire le contenu : écouter les `space:doc-update` diffusés ensuite ou récupérer le snapshot binaire via REST.
- `missing` is a base64 blob listing referenced subdocs (e.g., embedded notes). Non-empty values indicate extra `space:load-doc` calls are required to fetch those subdocuments.
- To decode a REST snapshot:
  ```js
  import fs from "node:fs";
  import * as Y from "yjs";

  const raw = fs.readFileSync("/tmp/doc.bin"); // GET /api/workspaces/<ws>/docs/<docId>
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, raw);
  const blocks = ydoc.getMap("blocks");
  blocks.forEach((value, key) => {
    const title = value.get("prop:title");
    if (title) {
      console.log(key, value.get("sys:flavour"), title.toString());
    }
  });
  ```
- Confirmed block metadata: `sys:flavour` yields block types (`affine:page`, `affine:note`, etc.) while `prop:title` and related attributes are stored as `Y.Text`.
- En activant `DEBUG=affine:*,socket.io:*` sur le conteneur (`serverlabapps-affine-…`), les logs affichent chaque `space:push-doc-update` reçu/émis. Exemple :
  - workspace docId `b89db6a1-b52c-4634-a5a0-24f555dbebdc` – updates envoyées par l’UI (« Une nouvelle page de test… »).
  - doc `db$<workspace>$docProperties` – meta pages/folder enregistrées en parallèle.
  - ACK renvoyé sous la forme `{"data":{"accepted":true,"timestamp":…}}`.
  Ces traces confirment que chaque action UI génère une rafale d’updates (texte, renommage, docProperties) suivie du job `DocServiceCronJob.mergePendingDocUpdates`.

## Creating a Document Programmatically
1. Obtain `affine_session` / `affine_user_id` cookies via `/api/auth/sign-in`.
2. Connect to Socket.IO endpoint:
   ```js
   import { io } from "socket.io-client";
   const socket = io("wss://affine.robotsinlove.be", {
     path: "/socket.io/",
     transports: ["websocket"],
     extraHeaders: { Cookie: "affine_session=…; affine_user_id=…" }
   });
   ```
3. Join workspace space:
   ```js
   socket.emit("space:join", { spaceType: "workspace", spaceId: WORKSPACE_ID });
   ```
4. Build a Yjs doc that mimics an Affine page (page block + surface + note + paragraph) and push via `space:push-doc-update`.
5. Update workspace root doc `meta.pages` to register the new doc in the page list.

**Node script used (abridged):**
```js
const { wsUrlFromGraphQLEndpoint, connectWorkspaceSocket, joinWorkspace, loadDoc, pushDocUpdate } = require('affine-mcp-server/dist/ws');
const Y = require('yjs');

const workspaceId = 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const endpoint = 'https://affine.robotsinlove.be/graphql';
const cookieHeader = 'affine_session=…; affine_user_id=…';

(async () => {
  const socket = await connectWorkspaceSocket(wsUrlFromGraphQLEndpoint(endpoint), cookieHeader);
  try {
    await joinWorkspace(socket, workspaceId);
    const docId = generateId();
    const ydoc = buildAffinePage({ title: 'Quick note API test …', content: 'Note créée automatiquement via WebSocket Yjs pour valider l\'API.' });
    await pushDocUpdate(socket, workspaceId, docId, encodeUpdate(ydoc));

    // Update workspace root pages list
    const wsDoc = await loadWorkspaceRoot(socket, workspaceId);
    appendPageEntry(wsDoc, { id: docId, title: ydoc.getMap('meta').get('title'), createDate: Date.now() });
    await pushDocUpdate(socket, workspaceId, workspaceId, encodeUpdateSince(wsDoc));
  } finally {
    socket.disconnect();
  }
})();
```

## Local Tooling & Captures
- `~/affine_socket_sniffer.js` → quick Socket.IO tap using the published MCP helper (`connectWorkspaceSocket`). Requires `AFFINE_COOKIE` env var populated with `affine_session=…; affine_user_id=…`.
- `~/run_affine_sniffer.sh` → end-to-end harness that logs in via REST, extracts cookies, then streams all `space:*` events. Outputs land in `/home/gilles/serverlab/.tmp/affine_socket_<timestamp>.log`.
- `/home/gilles/serverlab/pure_socket_listener.js` → minimal Socket.IO client (no MCP helpers) for validating auth headers and watching event names.
- Headless browser capture lives under `/home/gilles/serverlab/.tmp/affine_ws/` (Puppeteer). Outputs include raw JSON dumps of login form elements, `workspace.html`, and websocket frame transcripts (`affine_ws_sniffer.js`).
- Historical traces: `quickshare/logAffine_socketIO.txt` and `quickshare/logAffine_space.txt` retain verbose `DEBUG=affine:*,socket.io:*` output for replay.
- `~/affine-tools/affine_capture.js` → clé en main : connexion GraphQL/REST + `space:load-doc`, téléchargement des snapshots binaire (`snapshot_<docId>.bin`), journalisation Socket.IO (`socket-events.ndjson`). Exemple :
  ```bash
  node ~/affine-tools/affine_capture.js \
    --workspace=b89db6a1-b52c-4634-a5a0-24f555dbebdc \
    --doc=MdwloSO_3MbMCwGB1GY9b --duration=8000
  ```
  → sortie regroupée sous `/home/gilles/serverlab/.tmp/affine_capture/<horodatage>/` (métadonnées, réponses `space:load-doc`, snapshots REST). Prend `AFFINE_COOKIE` existant ou tente le login si absent.
- `~/affine-tools/client.js` → première façade API : authentification, téléchargement de snapshot, préparation Y.Doc, génération d’updates (folders/docProperties/meta) et push via Socket.IO (`moveDocument`, `setDocumentTags`, `updateDocProperties`). Exemple pour lister les tags connus :
  ```bash
  AFFINE_EMAIL=... AFFINE_PASSWORD=... node ~/affine-tools/client.js tags
  ```
  (les commandes d’écriture nécessitent `AFFINE_COOKIE` valide ou login + accès réseau).

## Planned API Facade (draft)
- **Authentication**: session cookies from `POST /api/auth/sign-in` (login) combined with optional personal token for snapshot `GET`s. No long-lived refresh flow yet; caller must re-auth when cookie expires.
- **Read Path**:
  - `list_documents(workspaceId)` → GraphQL query (token OK) for doc IDs, supplemented by decoding workspace root snapshot to surface titles/tags.
  - `fetch_snapshot(docId)` → REST binary download + optional cached `space:load-doc` state vector to seed local Y.Doc.
- **Write Path** (Socket.IO `space:push-doc-update`):
  - `create_document(workspaceId, ydoc)` → push base page payload, then patch workspace root `spaces` map to register metadata.
  - `move_document(workspaceId, docId, parentFolderId, indexToken)` → mutate `db$<ws>$folders` entry; ordering token derived from neighbours (captured update shows server accepts arbitrary monotonic string).
  - `set_doc_mode(docId, mode)` → update `db$<ws>$docProperties` map fields (`primaryMode`, `createdBy`, `updatedBy`).
  - `update_tags(docId, tags[])` → edit workspace root `spaces[docId].meta.tags` (Y.Array of strings) respecting existing structure seen in captures.
  - `delete_or_trash(docId)` → adjust `spaces[docId].meta.trash` flags; confirm with additional capture before exposing.
- **Support Utilities**:
  - `pull_state_vector(docId)` via `space:load-doc` to enable incremental diff generation.
  - Snapshot cache on disk (`~/.tmp/affine_capture/<ts>/snapshot_<docId>.bin`) to rebuild baseline without re-downloading.

### Limitations & Open Items
- Requires active session cookie; token-only flows insufficient for writes. Need secure storage/rotation plan for credentials.
- Ordering tokens (`index`) in `folders` are opaque strings; generation algorithm still inferred from captured values (likely LexoRank). Must derive safe helper for insert-between cases.
- Tag updates observed only through workspace root doc; ensure no other doc (e.g., `db$<ws>$tags`) needs syncing before committing to public API surface.
- Concurrency not handled: multiple simultaneous edits could conflict with locally generated diffs; include state-vector comparison before pushing.
- Large binary snapshots (~100s KB) per doc: consider compression/caching to avoid unnecessary downloads.
- WebSocket errors (network restrictions, auth lapse) currently surfaced raw; final API should normalize error reporting (`DOC_NOT_FOUND`, permission issues).

## Quick Notes Folder
- The UI folder “Quick Notes” behaves as a normal Affine collection in the workspace, but the corresponding metadata is not exposed via the accessible GraphQL or REST endpoints inspected.
- `logAffine_socketIO.txt` captures live `space:push-doc-update` payloads for `db$<workspace>$docProperties` and `db$<workspace>$folders` while editing doc `MdwloSO_3MbMCwGB1GY9b`:
  - `docProperties` entry keyed by the doc ID writes `id`, `primaryMode: "page"`, `edgelessColorTheme: "light"`, plus `createdBy` / `updatedBy` referencing user `w$b39e8d83-ea0b-450e-9bf6-51eb45d9850f`.
  - `folders` doc now contains record `q2n6hCGpKHCVNpNM8gFtw` with `parentId: "p6rL2PhvbXjTH88agC9yN"`, `type: "doc"`, `data: "MdwloSO_3MbMCwGB1GY9b"`, and ordering token `index: "w#Zx06BzWS8wWCA6zzCnR7RFd1bMHbjxOcXJI"`, pointing to the Quick Notes collection tree.
  - Replaying those diffs against an empty Y.Doc produces empty maps, so we still need the baseline snapshot from REST (`GET /api/workspaces/<ws>/docs/<docId>`) or a `space:load-doc` response that includes the `missing` payload.
- REST snapshots downloaded with the personal access token (stored under `/home/gilles/serverlab/.tmp/docProperties.bin` and `/home/gilles/serverlab/.tmp/folders.bin`) reveal the full state:
  - `docProperties` contains one Y.Map per document (`id`, `primaryMode`, `edgelessColorTheme`, `createdBy`, `updatedBy`). Pages default to `"page"`/`"light"`, while canvases like `pIve0YJLLhiXHKw5Purhm` use `primaryMode: "edgeless"`.
  - `folders` is a flat map of nodes: each entry has `parentId`, `type` (`"folder"` or `"doc"`), `data` (`docId` or folder label), `index` (ordering token) and `id`. Root folders include `Quick notes` (`p6rL2PhvbXjTH88agC9yN`), `Serverlab`, `The AI project`, etc. Docs appear as nodes pointing back to their Yjs doc IDs (e.g., node `q2n6hCGpKHCVNpNM8gFtw` → doc `MdwloSO_3MbMCwGB1GY9b`).
- Local decode sanity check (2025-11-04):
  ```bash
  node - <<'JS'
  const Y = require('yjs');
  const fs = require('fs');
  const docProps = new Y.Doc();
  const folders = new Y.Doc();
  Y.applyUpdate(docProps, fs.readFileSync('/home/gilles/serverlab/.tmp/docProperties.bin'));
  Y.applyUpdate(folders, fs.readFileSync('/home/gilles/serverlab/.tmp/folders.bin'));

  const props = docProps.getMap('MdwloSO_3MbMCwGB1GY9b');
  const quickNotesNode = folders.getMap('q2n6hCGpKHCVNpNM8gFtw');
  console.log('docProperties keys', Array.from(props.keys()));
  console.log('folders entry', Object.fromEntries(Array.from(quickNotesNode.entries())));
  JS
  ```
  - Output confirms `MdwloSO_3MbMCwGB1GY9b` carries `{ primaryMode: "page", edgelessColorTheme: "light", createdBy: "b39e8d83-…" }`.
  - Folder node `q2n6hCGpKHCVNpNM8gFtw` resolves to `{ parentId: "8zAHBo2-DehRwx_21j7-b", type: "doc", data: "MdwloSO_3MbMCwGB1GY9b", index: "Zv0U9g8qgRgbVOA4q7uZDQyyXCe4TOBnsAw" }`, matching the live Socket.IO diff.
- A new doc created via WebSocket appears in the workspace root list, not inside “Quick Notes”. Placement likely requires manipulating a separate Yjs document (`db$<workspace>$collections` or similar); attempts to fetch this doc returned `DOC_NOT_FOUND` (401/404), suggesting the collection state may be cached client-side or gated behind additional API routes.
- Root workspace doc (`b89db6a1-b52c-4634-a5a0-24f555dbebdc`) receives `spaces` updates that embed human title, `createDate`, `updatedDate`, `tags`, `trash`, and `trashDate` for `MdwloSO_3MbMCwGB1GY9b`. None of these fields appear in GraphQL today.
- DNS to `affine.robotsinlove.be` requires elevated permission from this sandbox, but once approved the binary snapshots above can be fetched directly with `curl -H "Authorization: Bearer $TOKEN"`.
- Next steps: capture network calls from the Affine web UI when moving a page into “Quick Notes” to identify the exact endpoint or Yjs doc updates that represent folder membership.

### Socket Trace Sample (`logAffine_socketIO.txt`, 2025-10-31)
- Yjs block diff for `MdwloSO_3MbMCwGB1GY9b` shows the standard page → surface → note hierarchy with text blocks such as “un septième document pour codex (renommé)”, an `affine:table`, and multiple `affine:paragraph` entries.
- The captured `docProperties` / `folders` updates above provide the concrete keys Affine expects when wiring a page into a collection; once we have the baseline snapshot we can try synthesising those diffs.
- Priority follow-up: grab the `space:load-doc` response (state vector + `missing`) for both docs so the local Y.Doc matches the server state before applying mutations.

## Awareness & Edgeless Surface Signals
- `logAffine_space.txt` records a dense stream of `space:update-awareness` events; decoding the base64 payload reveals a JSON structure `{ selectionV2: { <docId:blockId>: [{ type: "cursor", x, y }] }, user: { name }, color }`. This matches Affine’s live cursor annotations and confirms that awareness traffic is separate from document updates (`space:push-doc-update`).
- Example decode (base64 stripped from the log, 2025-10-31) yields `{"selectionV2":{"pIve0YJLLhiXHKw5Purhm:jXtJg04nuu":[{"type":"cursor","x":799.3162393162389,"y":580.7799145299145}],"pIve0YJLLhiXHKw5Purhm:b-txJyDMCq":[]},"user":{"name":"gillespinault"},"color":"var(--affine-multi-players-green)"}` once leading binary headers are discarded.
- The same log also shows additional `space:push-doc-update` payloads carrying plain-text fragments such as `positionu`, `idw\n414UBTDU8p`, and RGBA hex values (`#ff8c38`, `#004b7b`, `#ceecff`). These likely correspond to edgeless canvas node positions/appearance for block `414UBTDU8p` inside doc `MdwloSO_3MbMCwGB1GY9b`.
- Applying those diffs in isolation yields empty Y.Maps (no baseline). We still need a full snapshot of `db$<workspace>$docProperties` (and related edgeless subdocs) to make sense of the deltas and to replay positional edits safely.
- No `space:load-doc` responses were captured in this run, so future traces should explicitly record the initial `missing` payload to seed the local Y.Doc before logging real-time updates.

## Comparison with Official / Community Notes
- Internal runbook (`docs/reference/services-dokploy.md`) only documents login + GraphQL basics (`currentUser`, `workspace`, `setBlob`). Actual schema now exposes `applyDocUpdates`, comment APIs, subscription/billing mutations – none of which are described upstream.
- Official Affine public docs focus on end-user features; no comprehensive API reference exists. Community forum posts (up to 2024) mention Socket.IO + Yjs for collaboration, matching our findings but lacking concrete payload samples.
- Conclusion: self-hosted instances effectively require reverse engineering. Our token-based read path matches the documented GraphQL login flow, but write operations (doc CRUD, folder management) remain undocumented and gated behind WebSocket/Yjs semantics.
- Affine MCP server code (`affine-mcp-server/dist/ws.js`) confirms the event surface used by the desktop client: `space:join`, `space:load-doc`, `space:push-doc-update`, `space:delete-doc`. The helpers also reveal that acknowledgements include structured errors (`DOC_NOT_FOUND`) worth surfacing in our future API shim.
- Direct Socket.IO sniffing via `socket.io-client` + session cookies works. In steady state, `space:load-doc` responds with the state vector only; the full document must be sourced from REST snapshots or live `space:doc-update` events.
- Les logs `DEBUG=affine:*,socket.io:*` sont très verbeux (rafales d’`update` + tâches Prisma/Copilot). Pour l’analyse rapide, rediriger vers un fichier (`quickshare/logAffine_socketIO.txt`) puis filtrer sur `space:push-doc-update`.

## Next Reverse-Engineering Steps
- Sniff Socket.IO traffic when creating/moving docs in the web client to map events beyond `space:push-doc-update` (e.g., collection updates, trash workflow).
- Exercise `applyDocUpdates` with a small Yjs payload to confirm whether GraphQL can bypass Socket.IO for updates (and whether it enforces auth scopes differently).
- Replay the captured Quick Notes diffs against the stored `/home/gilles/serverlab/.tmp/{docProperties,folders}.bin` snapshots to validate write flows and ordering semantics.
- Identify the Yjs documents backing collections (`db$<workspace>$collections`?) by enumerating doc IDs referenced in workspace root metadata; confirm access requirements.
- Investigate how the front-end populates doc titles (currently null via GraphQL) – likely via Yjs `meta` map; document merge strategy for API consumers.
- Assess whether MCP server can persist session cookies securely (potentially via custom `sign_in` tool) to unlock write automation without manual cookie injection.
- Build a reusable Socket.IO sniffer (prototype at `/home/gilles/affine_socket_sniffer.js`) that logs `space:*` events while the UI performs actions; combine with browser DevTools captures to map folder operations.

## Summary of Findings
- Read access: GraphQL listings + binary Yjs fetches succeed with the personal token, but doc metadata (`title`, `summary`) is incomplete without decoding Yjs content.
- Write access (docs): still hinges on session cookies + Socket.IO `space:push-doc-update`; `applyDocUpdates` may offer an alternate path worth testing.
- Folder metadata for “Quick Notes” lives in `db$<workspace>$docProperties` (view defaults, authorship) and `db$<workspace>$folders` (collection edges + ordering); baseline snapshots are saved at `/home/gilles/serverlab/.tmp/docProperties.bin` and `/home/gilles/serverlab/.tmp/folders.bin` for local experimentation.
- Example page created programmatically: `Quick note API test 2025-10-30 16:05:40` (docId `8Q6-KvdcRI`).

## Source Code Study (2025-11-01)

### Backend Architecture
- Entry point `packages/backend/server/src/index.ts` switches between CLI and HTTP server depending on `SERVER_FLAVOR`. Main bootstrap (`server.ts`) wires CORS, GraphQL, REST, Socket.IO, file uploads, and optional Swagger in development.
- `AuthController` and `AuthService` (`packages/backend/server/src/core/auth`) implement `/api/auth/*`, issuing `affine_session` / `affine_user_id` cookies. `AuthGuard` applies the same cookie/token logic to REST, GraphQL, and Socket.IO handshakes while allowing internal RPC via `x-access-token`.
- Document persistence is handled by `DocStorageAdapter` (`packages/backend/server/src/core/doc/storage/doc.ts`). The Postgres adapter queues Yjs updates, merges them in `DocServiceCronJob`, and emits events consumed by `DocEventsListener` to refresh metadata caches.
- Live collaboration flows through `SpaceSyncGateway` (`packages/backend/server/src/core/sync/gateway.ts`), which exposes the exact `space:*` events captured earlier. Pushes go through `PgWorkspaceDocStorageAdapter` after ACL checks, returning timestamps and broadcasting to peers.
- `/api/workspaces/:id/docs/:docId` and the internal `/rpc/workspaces/...` endpoints (controller in `core/doc-service`) expose snapshots/diffs/markdown. The RPC path requires a signed token but falls back to database snapshots if the doc service fails.
- GraphQL resolvers (`core/workspaces/resolvers/doc.ts`, etc.) surface metadata, publication state, and ACL mutations but still rely on the Yjs pipeline for content changes; there is no dedicated mutation for creating/deleting documents.

### Frontend & nbstore Client
- Socket.IO access is abstracted by `CloudDocStorage` (`packages/common/nbstore/src/impls/cloud/doc.ts`), which sends `space:load-doc`/`space:push-doc-update` with base64-encoded Yjs buffers and listens for `space:broadcast-doc-update`.
- `DocFrontend` (`packages/common/nbstore/src/frontend/doc.ts`) batches local Yjs edits, merges them, and calls `pushDocUpdate`, matching the traffic in our logs.
- `DocsService` (`packages/frontend/core/src/modules/doc/services/docs.ts`) seeds new documents via `initDocFromProps` (page + surface + note + paragraph) and registers them in the workspace root `meta.pages`. Subsequent metadata (mode, tags, timestamps) is synchronised to Postgres via the server events we observed.
- Native clients persist bearer tokens in IndexedDB (`packages/frontend/apps/ios/src/proxy.ts`) and inject them into fetch/socket auth through `configureSocketAuthMethod`; web builds rely on the session cookies from `/api/auth/sign-in`.
- Secondary Yjs docs (`db$docProperties`, `db$folders`) are kept in sync the same way; frontend helpers like `writeInitialDocProperties` (`workspace-engine/impls/cloud.ts`) show how doc ownership/metadata is initialised after fetching snapshots.

### Guidance for API Implementation
- **Authentication**: wrap `/api/auth/sign-in` for cookie-based sessions or mint personal tokens (`AccessTokenModel`). Socket.IO clients must forward either cookies or the same `token` payload that native workers use.
- **Reads**: combine GraphQL (`workspace.docs`, ACLs) with RPC snapshots for full Yjs content. Reuse `DocReader` logic to extract titles/summaries from Yjs instead of re-parsing manually.
- **Writes**: imitate the frontend flow by constructing Yjs docs with `initDocFromProps`, pushing via `space:push-doc-update`, and then patching the workspace root plus related docs (`db$docProperties`, `db$folders`) so the new page appears in listings.
- **Collections/Tags**: reside in auxiliary docs; the captured Socket.IO diffs align with the structures in `workspace-engine/impls/cloud.ts`, so we can replicate ordering tokens and folder membership.
- **Error surfacing**: Socket acknowledgements return typed errors (`DOC_NOT_FOUND`, `DocUpdateBlocked`); the API wrapper should propagate them for clearer diagnostics.

### Open Questions / Follow-Ups
- Validate whether the GraphQL `applyDocUpdates` mutation can replace direct Socket.IO calls and what permissions it checks.
- Determine the minimal set of Yjs updates for moving/trashing pages (likely workspace root + `db$docProperties` + `db$folders`).
- Decide how to persist session cookies (e.g., within the MCP server) to avoid manual authentication in automation contexts.
- Document awareness handling (`space:join-awareness`) only if collaborative cursors are relevant to the future API surface.

### Prototype Client (`scripts/affine_ws_prototype.mjs`)
- Node script that authenticates via `/api/auth/sign-in`, opens a Socket.IO session, downloads a doc snapshot (`space:load-doc`), rewrites the page title with Yjs, then pushes the diff using `space:push-doc-update`.
- Run after installing dependencies locally (`npm install yjs socket.io-client`). Usage example:
  ```bash
  AFFINE_EMAIL=... AFFINE_PASSWORD=... \
  node scripts/affine_ws_prototype.mjs \
    --workspace b89db6a1-b52c-4634-a5a0-24f555dbebdc \
    --doc MdwloSO_3MbMCwGB1GY9b \
    --title "API playground $(date +%H:%M:%S)"
  ```
- The script logs current and new titles, reports socket acknowledgements, and leaves the workspace cleanly. Next steps: extend it to register new documents (workspace root + `db$docProperties` / `db$folders`) and expose a higher-level CLI/interface for automated workflows.

### Document Creation Prototype (`scripts/affine_doc_manager.cjs`, 2025-11-01 · maj 2025-11-03 · tests 2025-11-02)
- New script automates full doc creation: pushes initial Y.Doc structure, appends an entry to workspace meta (`meta.pages`), updates `db$<workspace>$docProperties`, and registers the node in `db$<workspace>$folders`.
- Usage (creates a page inside “Quick notes”):
  ```bash
  AFFINE_EMAIL=... AFFINE_PASSWORD=... \
  node scripts/affine_doc_manager.cjs \
    --workspace b89db6a1-b52c-4634-a5a0-24f555dbebdc \
    --folder p6rL2PhvbXjTH88agC9yN \
    --title "API created note" \
    --content "Contenu généré automatiquement."
  ```
- Output includes the generated doc ID and the folder node ID so we can cross-check in AFFiNE or roll back if needed. The script currently seeds a single paragraph; extend it to accept richer block payloads or additional metadata if required.
- **Mise à jour** : script converti en CommonJS et branché sur `lib/affineClient.js`. Ce module factorise l’authentification (REST), l’ouverture Socket.IO et les helpers Yjs (`createDoc`, `updateWorkspaceMeta`, `registerDocInFolder`). L’exécution CLI (`node scripts/affine_doc_manager.cjs …`) gère désormais automatiquement la connexion/déconnexion et le `space:leave`.
- **Validation 2025-11-02** :
  - `AFFINE_EMAIL=… AFFINE_PASSWORD=… node scripts/affine_doc_manager.cjs --workspace … --folder p6rL2PhvbXjTH88agC9yN --title "API created note"` → doc `ZSRtEGzG5q7dNv5dLuAjh` confirmé dans l’UI.
  - `node scripts/affine_doc_manager.cjs --workspace … --create-folder --folder-name "test api" --title "API folder smoke test"` crée un dossier `test api` (`Sif6m2iLTXMPqw47IULGE`) + doc `5xJ0FTEY1nstAxyXLEEYO` imbriqué.
- Prochaines étapes : enrichir `AffineClient.createDocument` (tags, propriétés supplémentaires, blocs multiples) et exposer une couche plus déclarative (ex. `affineClient.createDocumentationSpace()` pour les recettes récurrentes).
