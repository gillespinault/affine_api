# PRD – AFFiNE API Extensions for NoemAI

| Champ | Détail |
| --- | --- |
| Auteur | Claude Code (Gap Analysis 2025-01-19) |
| Date | 2025-01-19 |
| Statut | Ready for Implementation |
| Projet | `projects/notebooks_api` |
| Contexte | Améliorations API pour projet NoemAI (Partenaire Cognitif Augmenté) |
| Version | 1.2 |

---

## 0. Executive Summary

Le projet **NoemAI** vise à créer un partenaire cognitif augmenté qui utilise AFFiNE comme canvas collaboratif pour la réflexion en temps réel. L'analyse de faisabilité révèle que **70% des besoins sont déjà couverts** par l'API Affine actuelle, mais nécessite des extensions spécifiques pour supporter :

1. **Brush elements** (strokes manuscrits) - CRUD complet + feedback visuel
2. **Canvas screenshots** - Capture multi-résolution progressive (fit-all/viewport/region)
3. **Transformation assistée IA** - Brush → Éléments vectoriels

**Innovations Clés** :
- 🎨 **Highlight Brush** : LLM peut changer les couleurs pour feedback visuel temps réel
- 📸 **Progressive Screenshot** : fit-all → analyse LLM → screenshots ciblés HD (30x moins cher, 5x plus rapide)

**Impact estimé** : Réduction de 10 semaines (2.5 mois) du time-to-market NoemAI en éliminant le besoin de développer un client custom.

**Priorité Business** : Haute - Permet à NoemAI d'utiliser AFFiNE comme plateforme universelle (tablettes, desktop, mobile).

---

## 1. Contexte

### 1.1 Projet NoemAI

**Vision** : Système d'augmentation cognitive en temps réel agissant comme "sparring partner" de réflexion.

**Architecture cible** :
```
Tablettes (Onyx Boox / iPad)
  → AFFiNE Web UI (capture ink native)
  → AFFiNE Server (stockage Y.js)
  → NoemAI Processor (analyse IA + transformation)
  → Claude Vision API (compréhension sémantique)
```

**Use Cases Clés** :
1. **Réflexion Solo** : Utilisateur dessine/écrit → IA structure en mindmap
2. **War Room** : Équipe brainstorme → IA détecte patterns et suggère connexions
3. **Transformation Brush** : Strokes manuscrits → Shapes/Connectors propres

### 1.2 Gap Analysis (2025-01-19)

| Fonctionnalité NoemAI | Couverture API Affine | Gap |
|----------------------|---------------------|-----|
| Canvas collaboratif ✅ | 100% - Edgeless natif | Aucun |
| Synchronisation temps réel ✅ | 100% - Y.js CRDT | Aucun |
| Recherche sémantique ✅ | 100% - Copilot API | Aucun |
| Capture ink (lecture) ✅ | 100% - Brush elements | Aucun |
| Capture ink (création) ⚠️ | 0% - Type non supporté | **Ajouter support** |
| Screenshot canvas ❌ | 0% - Pas d'endpoint | **Créer endpoint** |
| Transformation IA ⚠️ | 50% - CRUD manuel | **Ajouter helpers** |
| Audio (capture/transcription) ❌ | 0% - Hors scope | Externe (Web Audio API) |
| Graphe de connaissance ⚠️ | 30% - Linked docs | Externe (Neo4j) |

**Verdict** : Architecture AFFiNE Pure = **VIABLE** avec 3-4 extensions mineures.

---

## 2. Objectifs

### 2.1 Objectifs Business

1. **Accélérer NoemAI** : Réduire time-to-market de 22-28 semaines → 14-18 semaines (-40%)
2. **Universalité Hardware** : Support Onyx Boox, iPad, Surface, Desktop (même codebase)
3. **Contribution Open Source** : Extensions réutilisables pour la communauté AFFiNE

### 2.2 Objectifs Techniques

1. **Brush CRUD Complet** : Support création/modification brush elements via API
2. **Canvas Rendering** : Endpoint pour capturer screenshot du canvas
3. **Transformation Assistée** : Helpers pour workflow Brush → Vectoriel
4. **Documentation** : Patterns NoemAI intégrés dans `docs/`

### 2.3 Non-Objectifs

- ❌ Audio capture/transcription (géré par NoemAI Processor externe)
- ❌ OCR manuscrit (géré par services tiers : Google Vision, Tesseract)
- ❌ Graphe de connaissance (géré par Neo4j externe)
- ❌ Client mobile custom (utiliser AFFiNE web natif)

---

## 3. État Actuel

### 3.1 Brush Elements - Analyse Complète

**Format Existant** (5184 brush détectés dans `Tests/API Test Folder/Test-SketchAPI`) :

```json
{
  "id": "WmOqm648GY",
  "type": "brush",
  "lineWidth": 4,
  "color": {
    "dark": "#ffffff",
    "light": "#000000"
  },
  "points": [
    [2, 256.90234375, 0.072021484375],        // [x, y, pressure]
    [11.9951171875, 231.912109375, 0.185302734375],
    // ... 28 autres points
  ],
  "xywh": "[-3679.148,-82.461,123.951,278.893]",  // Bounding box
  "rotate": 0,
  "index": "a1",
  "seed": 330644115
}
```

**Support Actuel** :

| Opération | Status | Endpoint | Notes |
|-----------|--------|----------|-------|
| **GET** (Liste) | ✅ Fonctionnel | `GET /workspaces/:wId/documents/:dId/edgeless` | Retourne tous éléments (shape, connector, text, brush) |
| **POST** (Créer) | ❌ Non supporté | `POST .../edgeless/elements` | Erreur : `"Unknown element type: brush"` |
| **PATCH** (Modifier) | ⚠️ Non testé | `PATCH .../edgeless/elements/:eId` | Probablement fonctionnel si création OK |
| **DELETE** (Supprimer) | ✅ Probablement OK | `DELETE .../edgeless/elements/:eId` | Méthode générique `deleteElement()` |

**Code Source Concerné** :
- `src/client/types/edgeless.ts:12` - Type `EdgelessElementType` (manque `'brush'`)
- `src/client/runtime/element-defaults.ts:158` - Fonction `applyElementDefaults()` (manque case `'brush'`)
- `src/client/runtime/affine-client.ts:1655` - Méthode `getEdgelessElements()` ✅ OK

### 3.2 Canvas Screenshot - Non Existant

**Besoin** : Capturer le canvas Edgeless en image (PNG/JPEG) pour analyse IA.

**Status** : ❌ Aucun endpoint disponible

**Approches Possibles** :
1. **Server-side rendering** (headless browser - complexe)
2. **Client-side capture** (HTML Canvas API - préféré si possible)
3. **Reconstruction SVG** (depuis éléments Yjs - très complexe)

**Décision Recommandée** : Étudier faisabilité server-side rendering via Playwright/Puppeteer.

---

## 4. Exigences Fonctionnelles

### 4.1 Priority 1 : Brush CRUD Complet

#### 4.1.1 Support Création Brush

**Endpoint** : `POST /workspaces/:workspaceId/documents/:docId/edgeless/elements`

**Payload** :
```json
{
  "type": "brush",
  "points": [
    [100, 100, 0.5],
    [150, 120, 0.7],
    [200, 100, 0.9],
    [250, 80, 1.0],
    [300, 100, 0.8]
  ],
  "lineWidth": 6,
  "color": {
    "dark": "#ff0000",
    "light": "#ff0000"
  },
  "rotate": 0
}
```

**Response** :
```json
{
  "id": "abc123xyz",
  "type": "brush",
  "index": "a1",
  "seed": 1234567890,
  "lineWidth": 6,
  "color": {"dark": "#ff0000", "light": "#ff0000"},
  "points": [[100,100,0.5], [150,120,0.7], ...],
  "xywh": [100,80,200,40],
  "rotate": 0
}
```

**Comportements Requis** :
- ✅ Calculer `xywh` automatiquement depuis `points` si non fourni
- ✅ Générer `index` (z-order) automatiquement
- ✅ Générer `seed` aléatoire si non fourni
- ✅ Valider `points` : minimum 2 points, format `[x, y, pressure]`

#### 4.1.2 Support Modification Brush

**Endpoint** : `PATCH /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId`

**Payload** (modification partielle) :
```json
{
  "lineWidth": 8,
  "color": {"dark": "#00ff00", "light": "#00ff00"}
}
```

**Comportements** :
- ✅ Modifier uniquement les propriétés fournies
- ✅ Recalculer `xywh` si `points` modifiés

#### 4.1.3 Cas d'Usage : Feedback Visuel pour LLM ⭐ NOUVEAU

**Contexte** : Le LLM doit pouvoir mettre en évidence les brush pendant l'analyse progressive pour créer un feedback visuel temps réel.

**Tool LLM** : `highlight_brush(brushIds, color, reason)`

**Implémentation** : Simple PATCH de la propriété `color` des brush ciblés.

**Exemple - Workflow d'Analyse Progressive** :
```typescript
// LLM démarre analyse
await client.updateEdgelessElement(workspaceId, docId, "brush-1", {
  color: { dark: "#FFD700", light: "#FFD700" } // Jaune = analyzing
});

// Screenshot région ciblée
const screenshot = await captureRegion(x, y, width, height);

// Analyse terminée → Marquer vert
await client.updateEdgelessElement(workspaceId, docId, "brush-1", {
  color: { dark: "#00FF00", light: "#00FF00" } // Vert = processed
});

// Brush à transformer → Marquer rouge
await client.updateEdgelessElement(workspaceId, docId, "brush-2", {
  color: { dark: "#FF0000", light: "#FF0000" } // Rouge = target
});

// Brush hors scope → Marquer gris
await client.updateEdgelessElement(workspaceId, docId, "brush-3", {
  color: { dark: "#808080", light: "#808080" } // Gris = ignore
});
```

**Helper Recommandé** (à ajouter dans `affine-client.ts`) :
```typescript
/**
 * Change la couleur d'un ou plusieurs brush pour feedback visuel.
 * Support presets : 'analyzing', 'processed', 'target', 'ignore'
 */
async highlightBrush(
  workspaceId: string,
  docId: string,
  brushIds: string[],
  colorPreset: 'analyzing' | 'processed' | 'target' | 'ignore' | string
): Promise<void> {
  const colorMap = {
    analyzing: '#FFD700',  // Jaune
    processed: '#00FF00',  // Vert
    target: '#FF0000',     // Rouge
    ignore: '#808080'      // Gris
  };

  const color = colorMap[colorPreset] || colorPreset;
  const colorObj = { dark: color, light: color };

  // Batch update
  await Promise.all(
    brushIds.map(id =>
      this.updateEdgelessElement(workspaceId, docId, id, { color: colorObj })
    )
  );
}
```

**Avantages** :
- 🎯 Feedback visuel temps réel pour l'utilisateur
- 🐛 Debugging facilité (voir où le LLM bloque)
- 🤝 Collaboration War Room (équipe voit les zones traitées)
- 🔄 Workflow itératif (corriger avant transformation finale)

#### 4.1.4 Tests Requis

**Test Suite** : `tests/unit/brush-elements.test.ts`

1. **Test création basique** : Créer brush avec 5 points → Vérifier ID retourné
2. **Test calcul xywh** : Créer brush sans xywh → Vérifier bounding box calculée
3. **Test modification** : Modifier lineWidth → Vérifier propriété mise à jour
4. **Test suppression** : Supprimer brush → Vérifier GET ne le retourne plus
5. **Test validation** : Créer brush avec 1 point → Erreur 400
6. **Test validation** : Créer brush avec points invalides → Erreur 400
7. **Test highlight** : Modifier couleur brush → Vérifier couleur mise à jour ⭐ NOUVEAU
8. **Test highlight batch** : Modifier couleur 10 brush simultanément → Vérifier toutes les couleurs ⭐ NOUVEAU

**Smoke Test** : `scripts/run-brush-api-smoke.ts`
- Créer brush programmatiquement dans `Tests/API Test Folder`
- Lire via GET
- Modifier
- Supprimer
- Vérifier cleanup

### 4.2 Priority 2 : Canvas Screenshot API ⭐⭐ APPROCHE PROGRESSIVE

#### 4.2.1 Vision : Multi-Résolution Orchestrée par LLM

**Concept Clé** : Au lieu de capturer un screenshot massif haute résolution du canvas complet, l'API supporte **3 modes de cadrage** permettant une approche progressive :

1. **`fit-all`** : Vue d'ensemble (basse résolution acceptable) - LLM analyse la structure globale
2. **`viewport`** : Vue utilisateur actuelle (avec zoom/pan)
3. **`region`** : Zoom ciblé haute résolution sur zones spécifiques - LLM demande des détails

**Workflow Intelligent** :
```
Phase 1 : Screenshot fit-all (1920x1080)
   ↓
LLM analyse → Identifie 3 zones d'intérêt
   ↓
Phase 2 : Screenshots ciblés haute résolution (3x 1920x1080)
   ↓
LLM transformation précise avec correspondance brush
```

**Avantages vs Approche Naïve** :
- 💰 **30x moins cher** : $0.45 vs $15 (3 images ciblées vs 1 image 10Kx8K)
- ⚡ **5x plus rapide** : 8s vs 40s
- 🎯 **Plus précis** : Haute résolution uniquement où nécessaire
- 🧠 **Adaptatif** : LLM décide où zoomer selon complexité

#### 4.2.2 Endpoint Screenshot Multi-Mode

**Endpoint** : `GET /workspaces/:workspaceId/documents/:docId/edgeless/screenshot`

**Query Parameters** :

**Mode de cadrage** :
- `mode` (optional) : `viewport` | `fit-all` | `region` (défaut: `fit-all`)

**Pour mode `viewport`** :
- `zoom` (optional) : Niveau de zoom (0.5 = 50%, 1 = 100%, 2 = 200%)
- `centerX` (optional) : Coordonnée X du centre visible
- `centerY` (optional) : Coordonnée Y du centre visible

**Pour mode `region`** (⭐ Principal pour NoemAI) :
- `x` (required) : Coordonnée X canvas du coin supérieur gauche
- `y` (required) : Coordonnée Y canvas du coin supérieur gauche
- `regionWidth` (required) : Largeur de la zone à capturer (coordonnées canvas)
- `regionHeight` (required) : Hauteur de la zone à capturer

**Résolution sortie** (tous modes) :
- `width` (optional) : Largeur image en pixels (défaut: 1920)
- `height` (optional) : Hauteur image en pixels (défaut: 1080)
- `format` (optional) : `png` | `jpeg` (défaut: `png`)
- `quality` (optional) : 1-100 pour JPEG (défaut: 90)

**Response** :
- `Content-Type: image/png` ou `image/jpeg`
- Body : Image binaire

**Exemples d'Usage** :

```bash
# Mode 1 : Vue d'ensemble (analyse globale)
curl "https://affine-api.robotsinlove.be/workspaces/ABC/documents/XYZ/edgeless/screenshot?mode=fit-all&width=1920&height=1080" \
  -o canvas-overview.png

# Mode 2 : Viewport utilisateur (contexte actuel)
curl "https://affine-api.robotsinlove.be/workspaces/ABC/documents/XYZ/edgeless/screenshot?mode=viewport&zoom=1&centerX=0&centerY=0" \
  -o canvas-viewport.png

# Mode 3 : Région spécifique haute résolution (zoom ciblé LLM)
curl "https://affine-api.robotsinlove.be/workspaces/ABC/documents/XYZ/edgeless/screenshot?mode=region&x=-3500&y=-100&regionWidth=1000&regionHeight=800&width=1920&height=1080" \
  -o canvas-region-A.png
```

#### 4.2.3 Cas d'Usage NoemAI : Transformation Progressive

**Architecture avec LLM Tool Calling** :

```typescript
// LLM dispose de 2 tools
const tools = [
  {
    name: "capture_region",
    description: "Capture screenshot haute résolution d'une région spécifique. Utilise quand besoin de plus de détails.",
    input_schema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Coordonnée X canvas" },
        y: { type: "number", description: "Coordonnée Y canvas" },
        width: { type: "number", description: "Largeur zone" },
        height: { type: "number", description: "Hauteur zone" },
        reason: { type: "string", description: "Pourquoi cette zone est intéressante" }
      },
      required: ["x", "y", "width", "height"]
    }
  },
  {
    name: "create_vectorial_element",
    description: "Crée élément vectoriel pour remplacer brush manuscrits.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["shape", "connector", "text", "mindmap"] },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        brushIds: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "highlight_brush",
    description: "Change la couleur d'un ou plusieurs brush pour feedback visuel (analyse en cours, déjà traité, à ignorer).",
    input_schema: {
      type: "object",
      properties: {
        brushIds: { type: "array", items: { type: "string" }, description: "IDs des brush à mettre en évidence" },
        color: { type: "string", description: "Couleur (#RRGGBB ou preset: 'analyzing', 'processed', 'ignore', 'target')" },
        reason: { type: "string", description: "Pourquoi cette mise en évidence" }
      },
      required: ["brushIds", "color"]
    }
  }
];

// Workflow progressif
async function transformBrushToVectorial(workspaceId: string, docId: string) {
  // 1. Vue globale (fit-all, basse résolution OK)
  const globalScreenshot = await fetch(
    `${API_URL}/workspaces/${workspaceId}/documents/${docId}/edgeless/screenshot?mode=fit-all&width=1280&height=720`
  );

  // 2. LLM analyse + fournir métadonnées brush
  const brushMetadata = await affineClient.getEdgelessElements(workspaceId, docId)
    .then(els => els.filter(el => el.type === 'brush').map(b => ({ id: b.id, xywh: b.xywh })));

  const response = await claudeAPI.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4096,
    tools,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: globalImage } },
        {
          type: "text",
          text: `Analyse ce canvas. Métadonnées brush : ${JSON.stringify(brushMetadata)}

          Si besoin de détails, utilise capture_region. Une fois prêt, utilise create_vectorial_element.`
        }
      ]
    }]
  });

  // 3. LLM utilise les tools (capture_region + create_vectorial_element)
  // 4. Transformation automatique
}
```

**Exemple de Conversation LLM avec Feedback Visuel** :

```
Tour 1 (fit-all) :
  LLM: "Je vois 3 zones : mindmap (gauche), flowchart (droite), notes (bas).
        Le mindmap est flou, je zoome."
  → highlight_brush(brushIds=["brush-1", "brush-2", ...], color="analyzing", reason="Zone mindmap en cours d'analyse")
  → capture_region(x=-3500, y=-200, width=1000, height=800, reason="Analyser mindmap")

Tour 2 (région mindmap HD) :
  LLM: "Mindmap clair : 'Projet NoemAI' au centre, 3 branches.
        Je marque comme traité et vérifie le flowchart."
  → highlight_brush(brushIds=["brush-1", "brush-2", ...], color="processed", reason="Mindmap analysé")
  → highlight_brush(brushIds=["brush-10", "brush-11", ...], color="analyzing", reason="Zone flowchart en analyse")
  → capture_region(x=-1500, y=-100, width=1000, height=600, reason="Analyser flowchart")

Tour 3 (région flowchart HD) :
  LLM: "Flowchart : Start → Capture → Analyze → Transform → End.
        Les notes en bas semblent hors scope, je les marque en gris."
  → highlight_brush(brushIds=["brush-10", "brush-11", ...], color="target", reason="Flowchart à transformer")
  → highlight_brush(brushIds=["brush-20", "brush-21", ...], color="ignore", reason="Notes hors scope")
  → create_vectorial_element(type="mindmap", x=-3500, y=-200, width=1000, height=800, brushIds=["brush-1", "brush-2", ...])
  → create_vectorial_element(type="shape", x=-1500, y=-100, width=200, height=100, brushIds=["brush-10", "brush-11", ...])
```

**Patterns de Couleurs Recommandés** :

| Preset | Couleur | Usage | Exemple |
|--------|---------|-------|---------|
| `analyzing` | Jaune (`#FFD700`) | Zone en cours d'analyse par le LLM | "Je zoome sur cette zone" |
| `processed` | Vert (`#00FF00`) | Brush déjà analysé et traité | "Mindmap compris, passé au flowchart" |
| `target` | Rouge (`#FF0000`) | Brush ciblé pour transformation | "Ces brush vont devenir des shapes" |
| `ignore` | Gris (`#808080`) | Brush hors scope ou à ignorer | "Notes non structurées, on garde en l'état" |

**Avantages Feedback Visuel** :
- 🎯 **UX améliorée** : L'utilisateur voit en temps réel ce que le LLM analyse
- 🔍 **Debugging** : Facile de comprendre où le LLM a des difficultés
- 🤝 **Collaboration** : En mode War Room, l'équipe voit les zones traitées
- 🔄 **Itératif** : L'utilisateur peut corriger avant transformation finale
```

#### 4.2.4 Implémentation Technique (Playwright)

**Approche Server-Side Rendering** ⭐ RECOMMANDÉ

```typescript
import { chromium } from 'playwright';

interface CaptureOptions {
  mode: 'viewport' | 'fit-all' | 'region';
  outputSize: { width: number; height: number };
  viewport?: { zoom: number; centerX: number; centerY: number };
  region?: { x: number; y: number; width: number; height: number };
}

async function captureCanvas(
  workspaceId: string,
  docId: string,
  options: CaptureOptions
): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: options.outputSize.width, height: options.outputSize.height }
  });

  await page.goto(
    `https://affine.robotsinlove.be/workspace/${workspaceId}/${docId}?mode=edgeless`,
    { waitUntil: 'networkidle' }
  );

  await page.waitForSelector('.affine-edgeless-surface', { timeout: 10000 });

  // Configuration selon le mode
  if (options.mode === 'fit-all') {
    // Calculer bounds de tous les éléments
    const allElements = await getEdgelessElements(workspaceId, docId);
    const bounds = calculateGlobalBounds(allElements);

    await page.evaluate((bounds) => {
      const edgeless = document.querySelector('.affine-edgeless-root');
      if (edgeless?.viewport) {
        const centerX = bounds.x + bounds.width / 2;
        const centerY = bounds.y + bounds.height / 2;
        const zoom = Math.min(
          window.innerWidth / bounds.width,
          window.innerHeight / bounds.height
        );
        edgeless.viewport.setCenter(centerX, centerY);
        edgeless.viewport.setZoom(zoom);
      }
    }, bounds);

  } else if (options.mode === 'region' && options.region) {
    // Cadrer sur région spécifique
    await page.evaluate((region, outputSize) => {
      const edgeless = document.querySelector('.affine-edgeless-root');
      if (edgeless?.viewport) {
        const centerX = region.x + region.width / 2;
        const centerY = region.y + region.height / 2;
        const zoom = Math.min(
          outputSize.width / region.width,
          outputSize.height / region.height
        );
        edgeless.viewport.setCenter(centerX, centerY);
        edgeless.viewport.setZoom(zoom);
      }
    }, options.region, options.outputSize);

  } else if (options.mode === 'viewport' && options.viewport) {
    // Restaurer viewport utilisateur
    await page.evaluate((vp) => {
      const edgeless = document.querySelector('.affine-edgeless-root');
      if (edgeless?.viewport) {
        edgeless.viewport.setCenter(vp.centerX, vp.centerY);
        edgeless.viewport.setZoom(vp.zoom);
      }
    }, options.viewport);
  }

  await page.waitForTimeout(500); // Stabilisation

  const screenshot = await page.screenshot({ type: 'png' });
  await browser.close();

  return Buffer.from(screenshot);
}
```

**Avantages Playwright** :
- ✅ Rendu identique à l'UI utilisateur
- ✅ Support CSS/Thèmes automatique
- ✅ Gestion viewport/zoom native

**Inconvénients** :
- ⚠️ Nécessite Playwright installé
- ⚠️ Overhead lancement browser (~2s)
- ⚠️ Complexité déploiement (headless Chrome)

**Optimisations** :
1. **Cache screenshots** (TTL 30s) : Si LLM redemande même screenshot
2. **Résolution adaptative** : fit-all en 1280x720, region en 1920x1080
3. **Batch screenshots** : Capturer plusieurs régions avec 1 seul browser launch

#### 4.2.3 Tests Requis

**Test Suite** : `tests/unit/canvas-screenshot.test.ts`

1. **Test capture basique** : Screenshot document vide → Image 1920x1080
2. **Test avec éléments** : Créer 3 shapes → Screenshot contient les formes
3. **Test résolution** : width=800, height=600 → Image aux bonnes dimensions
4. **Test format JPEG** : format=jpeg, quality=80 → Image JPEG valide
5. **Test viewport** : viewport=[100,100,500,500] → Capture zone spécifique

**Smoke Test** : `scripts/run-screenshot-smoke.ts`
- Créer document avec 5 shapes colorées
- Capturer screenshot
- Sauvegarder `/tmp/canvas-test.png`
- Vérifier taille fichier > 10KB

### 4.3 Priority 3 : Transformation Assistée (Helpers)

#### 4.3.1 Helper : Bounding Box Matching

**Méthode** : `AffineClient.matchBrushByBoundingBox()`

```typescript
interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async matchBrushByBoundingBox(
  workspaceId: string,
  docId: string,
  targetBox: BoundingBox
): Promise<BrushElement[]> {
  // Récupère tous les brush qui chevauchent la zone cible
}
```

**Cas d'Usage** :
```typescript
// IA a détecté un rectangle à [100, 200, 150, 100]
const detectedBox = { x: 100, y: 200, width: 150, height: 100 };

// Trouver les brush correspondants
const matchingBrush = await client.matchBrushByBoundingBox(
  workspaceId,
  docId,
  detectedBox
);

// Supprimer les brush
for (const brush of matchingBrush) {
  await client.deleteEdgelessElement(workspaceId, docId, brush.id);
}

// Créer shape propre
await client.createEdgelessElement(workspaceId, docId, {
  type: 'shape',
  shapeType: 'rect',
  xywh: [detectedBox.x, detectedBox.y, detectedBox.width, detectedBox.height]
});
```

#### 4.3.2 Module NoemAI (Exemple d'Intégration)

**Fichier** : `src/noemai/brush-transformer.ts` (documentation référence)

```typescript
import { AffineClient } from '../client/index.js';
import Anthropic from '@anthropic-ai/sdk';

export class NoemAIBrushTransformer {
  constructor(
    private affineClient: AffineClient,
    private claudeAPI: Anthropic
  ) {}

  /**
   * Transforme les brush manuscrits en éléments vectoriels structurés.
   *
   * Workflow :
   * 1. Capture screenshot du canvas
   * 2. Analyse via Claude Vision (détection structures)
   * 3. Matching brush par bounding box
   * 4. Remplacement brush → éléments vectoriels
   *
   * @param workspaceId Workspace ID
   * @param docId Document ID
   * @returns Statistiques de transformation
   */
  async transformBrushToVectorial(
    workspaceId: string,
    docId: string
  ): Promise<{
    brushDeleted: number;
    shapesCreated: number;
    connectorsCreated: number;
    mindmapsCreated: number;
  }> {
    // 1. Screenshot
    const screenshot = await fetch(
      `${this.affineClient.baseUrl}/workspaces/${workspaceId}/documents/${docId}/edgeless/screenshot`
    );
    const imageBuffer = await screenshot.arrayBuffer();

    // 2. Analyse IA
    const analysis = await this.claudeAPI.messages.create({
      model: "claude-3-5-sonnet-20241022",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: Buffer.from(imageBuffer).toString('base64')
            }
          },
          {
            type: "text",
            text: `Analyse ce canvas dessiné à main levée.

            Identifie les éléments structurés et retourne JSON :
            {
              "elements": [
                {"type": "shape", "shapeType": "rect", "bounds": [x, y, w, h], "text": "..."},
                {"type": "connector", "bounds": [x, y, w, h], "from": "...", "to": "..."},
                {"type": "mindmap", "bounds": [x, y, w, h], "root": "...", "branches": [...]}
              ]
            }`
          }
        ]
      })
    });

    const detected = JSON.parse(analysis.content[0].text);

    // 3. Transformation
    let stats = {
      brushDeleted: 0,
      shapesCreated: 0,
      connectorsCreated: 0,
      mindmapsCreated: 0
    };

    for (const element of detected.elements) {
      const [x, y, w, h] = element.bounds;

      // Matcher brush
      const matchingBrush = await this.affineClient.matchBrushByBoundingBox(
        workspaceId,
        docId,
        { x, y, width: w, height: h }
      );

      // Créer élément vectoriel
      await this.affineClient.createEdgelessElement(workspaceId, docId, {
        type: element.type,
        shapeType: element.shapeType,
        xywh: [x, y, w, h],
        text: element.text || element.root
      });

      // Supprimer brush
      for (const brush of matchingBrush) {
        await this.affineClient.deleteEdgelessElement(workspaceId, docId, brush.id);
        stats.brushDeleted++;
      }

      // Stats
      if (element.type === 'shape') stats.shapesCreated++;
      if (element.type === 'connector') stats.connectorsCreated++;
      if (element.type === 'mindmap') stats.mindmapsCreated++;
    }

    return stats;
  }
}
```

---

## 5. Exigences Techniques

### 5.1 Modifications Code

#### 5.1.1 TypeScript Types

**Fichier** : `src/client/types/edgeless.ts`

**Changements** :
```typescript
// Ligne 12 : Ajouter 'brush' dans le type union
export type EdgelessElementType =
  'connector' | 'shape' | 'text' | 'group' | 'mindmap' | 'brush'; // ← Ajout

// Ligne 306+ : Ajouter interface BrushElement
export interface BrushElement extends BaseElement {
  type: 'brush';
  xywh: number[] | string;
  rotate: number;
  points: number[][];
  lineWidth: number;
  color: string | { dark: string; light: string };
}

// Ligne 195 : Ajouter dans union type
export type EdgelessElement =
  | ConnectorElement
  | ShapeElement
  | TextElement
  | GroupElement
  | MindmapElement
  | BrushElement; // ← Ajout

// Ligne 235+ : Ajouter input type
export interface CreateBrushInput {
  points: number[][];
  lineWidth?: number;
  color?: string | { dark: string; light: string };
  xywh?: number[];
  rotate?: number;
}

// Ligne 258 : Ajouter dans union input
export type CreateElementInput =
  | ({ type: 'connector' } & CreateConnectorInput)
  | ({ type: 'shape' } & CreateShapeInput)
  | ({ type: 'text' } & CreateTextInput)
  | ({ type: 'group' } & CreateGroupInput)
  | ({ type: 'mindmap' } & CreateMindmapInput)
  | ({ type: 'brush' } & CreateBrushInput); // ← Ajout
```

#### 5.1.2 Element Defaults

**Fichier** : `src/client/runtime/element-defaults.ts`

**Changements** :
```typescript
// Ligne 142+ : Ajouter defaults brush
export const BRUSH_DEFAULTS = {
  rotate: 0,
  xywh: '[0,0,100,100]',
  lineWidth: 4,
  color: { dark: '#ffffff', light: '#000000' },
  points: [] as number[][],
};

// Ligne 158 : Modifier fonction applyElementDefaults
export function applyElementDefaults(
  elementData: Partial<CreateElementInput>
): Record<string, unknown> {
  const { type } = elementData;
  let defaults: Record<string, unknown> = {};

  switch (type) {
    case 'shape':
      defaults = { ...SHAPE_DEFAULTS };
      break;
    case 'connector':
      defaults = { ...CONNECTOR_DEFAULTS };
      break;
    case 'text':
      defaults = { ...TEXT_DEFAULTS };
      break;
    case 'group':
      defaults = { ...GROUP_DEFAULTS };
      break;
    case 'mindmap':
      defaults = { ...MINDMAP_DEFAULTS };
      break;
    case 'brush': // ← NOUVEAU
      defaults = { ...BRUSH_DEFAULTS };

      // Calculer xywh depuis points si non fourni
      if (!elementData.xywh && Array.isArray(elementData.points) && elementData.points.length > 0) {
        const points = elementData.points as number[][];
        const xs = points.map(p => p[0]);
        const ys = points.map(p => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        defaults.xywh = `[${minX},${minY},${maxX - minX},${maxY - minY}]`;
      }
      break;
    default:
      throw new Error(`Unknown element type: ${type}`);
  }

  return {
    ...defaults,
    ...elementData,
  };
}
```

#### 5.1.3 Client Helpers (Brush Operations)

**Fichier** : `src/client/runtime/affine-client.ts`

**Méthodes à ajouter** (ligne ~2100) :

**A. Helper Highlight Brush** ⭐ NOUVEAU
```typescript
/**
 * Change la couleur d'un ou plusieurs brush pour feedback visuel.
 * Support presets : 'analyzing', 'processed', 'target', 'ignore'
 *
 * @param workspaceId Workspace ID
 * @param docId Document ID
 * @param brushIds Array of brush element IDs
 * @param colorPreset Color preset or custom hex color
 * @returns Promise resolving when all brush are updated
 */
async highlightBrush(
  workspaceId: string,
  docId: string,
  brushIds: string[],
  colorPreset: 'analyzing' | 'processed' | 'target' | 'ignore' | string
): Promise<void> {
  const colorMap: Record<string, string> = {
    analyzing: '#FFD700',  // Jaune
    processed: '#00FF00',  // Vert
    target: '#FF0000',     // Rouge
    ignore: '#808080'      // Gris
  };

  const color = colorMap[colorPreset] || colorPreset;
  const colorObj = { dark: color, light: color };

  // Batch update pour performance
  await Promise.all(
    brushIds.map(id =>
      this.updateEdgelessElement(workspaceId, docId, id, { color: colorObj })
    )
  );
}
```

**B. Helper Bounding Box Matching**
```typescript
/**
 * Find brush elements that overlap with a target bounding box.
 * Used for AI-driven brush → vectorial transformation.
 *
 * @param workspaceId Workspace ID
 * @param docId Document ID
 * @param targetBox Target bounding box {x, y, width, height}
 * @param overlapThreshold Minimum overlap ratio (0-1, default: 0.3)
 * @returns Array of brush elements overlapping the target box
 */
async matchBrushByBoundingBox(
  workspaceId: string,
  docId: string,
  targetBox: { x: number; y: number; width: number; height: number },
  overlapThreshold = 0.3
): Promise<Array<Record<string, unknown>>> {
  await this.joinWorkspace(workspaceId);

  // Get all edgeless elements
  const allElements = await this.getEdgelessElements(workspaceId, docId);

  // Filter brush elements
  const brushElements = allElements.filter(el => el.type === 'brush');

  // Match by bounding box overlap
  const matching: Array<Record<string, unknown>> = [];

  for (const brush of brushElements) {
    const brushBox = this.parseBoundingBox(brush.xywh as string | number[]);
    const overlap = this.calculateOverlap(brushBox, targetBox);

    if (overlap >= overlapThreshold) {
      matching.push(brush);
    }
  }

  return matching;
}

/**
 * Parse bounding box from xywh (string or array).
 */
private parseBoundingBox(xywh: string | number[]): { x: number; y: number; width: number; height: number } {
  const arr = typeof xywh === 'string' ? JSON.parse(xywh) : xywh;
  return { x: arr[0], y: arr[1], width: arr[2], height: arr[3] };
}

/**
 * Calculate overlap ratio between two bounding boxes (Jaccard index).
 */
private calculateOverlap(
  box1: { x: number; y: number; width: number; height: number },
  box2: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0; // No overlap
  }

  const intersectionArea = (x2 - x1) * (y2 - y1);
  const box1Area = box1.width * box1.height;
  const box2Area = box2.width * box2.height;
  const unionArea = box1Area + box2Area - intersectionArea;

  return intersectionArea / unionArea; // Jaccard index
}
```

#### 5.1.4 REST Endpoint (Screenshot)

**Fichier** : `src/service/server.ts`

**Endpoint à ajouter** (ligne ~1700) :
```typescript
app.get(
  '/workspaces/:workspaceId/documents/:docId/edgeless/screenshot',
  async (request, reply) => {
    const { workspaceId, docId } = request.params as {
      workspaceId: string;
      docId: string;
    };
    const query = request.query as {
      width?: string;
      height?: string;
      format?: 'png' | 'jpeg';
      quality?: string;
      viewport?: string;
    };

    const width = parseInt(query.width || '1920');
    const height = parseInt(query.height || '1080');
    const format = query.format || 'png';
    const quality = parseInt(query.quality || '90');

    try {
      const screenshot = await captureEdgelessCanvas(workspaceId, docId, {
        width,
        height,
        format,
        quality
      });

      reply
        .type(`image/${format}`)
        .send(screenshot);
    } catch (error) {
      reply.code(500).send({
        error: 'Failed to capture canvas screenshot',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);
```

**Helper Function** (playwright-based) :
```typescript
import { chromium } from 'playwright';

async function captureEdgelessCanvas(
  workspaceId: string,
  docId: string,
  options: {
    width: number;
    height: number;
    format: 'png' | 'jpeg';
    quality: number;
  }
): Promise<Buffer> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height }
  });

  // Navigate to edgeless mode
  const url = `${process.env.AFFINE_BASE_URL}/workspace/${workspaceId}/${docId}?mode=edgeless`;
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for canvas to render
  await page.waitForSelector('.affine-edgeless-surface', { timeout: 10000 });

  // Capture screenshot
  const screenshot = await page.screenshot({
    type: options.format,
    quality: options.format === 'jpeg' ? options.quality : undefined,
    fullPage: false
  });

  await browser.close();

  return Buffer.from(screenshot);
}
```

### 5.2 Dépendances à Ajouter

**Fichier** : `package.json`

```json
{
  "dependencies": {
    "playwright": "^1.40.0"
  }
}
```

**Installation** :
```bash
npm install playwright
npx playwright install chromium
```

### 5.3 Configuration Déploiement

**Dockerfile** : Ajouter support Playwright

```dockerfile
FROM node:20-slim AS build
WORKDIR /app

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install Playwright dependencies (runtime)
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install chromium --with-deps
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/service/start.js"]
```

---

## 6. Roadmap & Priorisation

### 6.1 Phase 1 : Brush CRUD + Highlight (Priorité Haute)

**Objectif** : Support complet création/modification brush elements + feedback visuel pour LLM

**Effort** : 3-4 heures

**Livrables** :
1. ✅ Type `BrushElement` dans `edgeless.ts`
2. ✅ Defaults `BRUSH_DEFAULTS` dans `element-defaults.ts`
3. ✅ Case `'brush'` dans `applyElementDefaults()`
4. ✅ Méthode `highlightBrush()` dans `affine-client.ts` ⭐ NOUVEAU
5. ✅ Tests unitaires `tests/unit/brush-elements.test.ts` (incluant highlight tests)
6. ✅ Smoke test `scripts/run-brush-api-smoke.ts`
7. ✅ Documentation README mise à jour

**Validation** :
```bash
# Test création brush via API
curl -X POST "https://affine-api.robotsinlove.be/workspaces/ABC/documents/XYZ/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "brush",
    "points": [[100,100,0.5], [200,200,0.8]],
    "lineWidth": 6
  }'
# → Retour 201 avec ID
```

### 6.2 Phase 2 : Canvas Screenshot (Priorité Moyenne)

**Objectif** : Endpoint pour capturer image du canvas

**Effort** : 1-2 jours

**Livrables** :
1. ✅ Endpoint `GET /edgeless/screenshot`
2. ✅ Helper `captureEdgelessCanvas()` avec Playwright
3. ✅ Support query params (width, height, format, quality)
4. ✅ Tests unitaires `tests/unit/canvas-screenshot.test.ts`
5. ✅ Smoke test `scripts/run-screenshot-smoke.ts`
6. ✅ Dockerfile mis à jour (Playwright dependencies)

**Validation** :
```bash
# Capturer screenshot
curl "https://affine-api.robotsinlove.be/workspaces/ABC/documents/XYZ/edgeless/screenshot" \
  -o canvas.png
# → Fichier canvas.png créé (taille > 10KB)

# Vérifier image valide
file canvas.png
# → canvas.png: PNG image data, 1920 x 1080, ...
```

### 6.3 Phase 3 : Transformation Assistée (Priorité Basse)

**Objectif** : Helpers pour workflow Brush → Vectoriel

**Effort** : 1 jour

**Livrables** :
1. ✅ Méthode `matchBrushByBoundingBox()` dans `affine-client.ts`
2. ✅ Documentation exemple `src/noemai/brush-transformer.ts` (référence)
3. ✅ Tests unitaires `tests/unit/brush-matching.test.ts`
4. ✅ Guide d'intégration NoemAI dans `docs/noemai-integration-guide.md`

**Validation** :
```typescript
// Test matching bounding box
const matchingBrush = await client.matchBrushByBoundingBox(
  workspaceId,
  docId,
  { x: 100, y: 100, width: 200, height: 150 }
);
console.log(`Found ${matchingBrush.length} brush elements`);
// → Found 3 brush elements
```

### 6.4 Timeline Global

| Phase | Effort | Début | Fin | Status |
|-------|--------|-------|-----|--------|
| Phase 1 : Brush CRUD + Highlight | 3-4h | Semaine 1 | Semaine 1 | 🔲 Todo |
| Phase 2 : Screenshot API Multi-Mode | 1-2 jours | Semaine 1 | Semaine 1 | 🔲 Todo |
| Phase 3 : Helpers | 1 jour | Semaine 2 | Semaine 2 | 🔲 Todo |
| Documentation | 0.5 jour | Semaine 2 | Semaine 2 | 🔲 Todo |
| **Total** | **~4 jours** | | | |

---

## 7. Tests & Validation

### 7.1 Test Strategy

**Niveaux de tests** :
1. **Unit tests** : Tests isolés des fonctions helpers
2. **Integration tests** : Tests end-to-end API REST
3. **Smoke tests** : Scénarios réels sur workspace `Tests`

### 7.2 Test Coverage Target

- ✅ Unit tests : **> 80%** coverage
- ✅ Integration tests : **100%** des endpoints
- ✅ Smoke tests : **1 scénario complet** par feature

### 7.3 Test Documents

**Workspace** : `Tests` (ID: `65581777-b884-4a3c-af69-f286827e90b0`)
**Folder** : `API Test Folder` (ID: `gMd6IfCCR1mPSErqj3vGj`)

**Documents de test** :
1. `Test-SketchAPI` (existant) : 5184 brush elements
2. `Test-BrushCRUD` (à créer) : Test création/modification/suppression
3. `Test-Screenshot` (à créer) : Test capture canvas
4. `Test-Transformation` (à créer) : Test workflow Brush → Vectoriel

---

## 8. Documentation

### 8.1 Documentation Utilisateur

**Fichier** : `README.md` (section à ajouter)

**Contenu** :
```markdown
## 🎨 Brush Elements API

AFFiNE brush elements represent freehand ink strokes captured by stylus/touch input.

### Create Brush Element

```bash
POST /workspaces/:workspaceId/documents/:docId/edgeless/elements
```

**Payload**:
```json
{
  "type": "brush",
  "points": [[x, y, pressure], ...],
  "lineWidth": 4,
  "color": {"dark": "#fff", "light": "#000"}
}
```

### Capture Canvas Screenshot

```bash
GET /workspaces/:workspaceId/documents/:docId/edgeless/screenshot?width=1920&height=1080&format=png
```

Returns PNG/JPEG image of the canvas.

### Transformation Pattern (NoemAI)

See `docs/noemai-integration-guide.md` for complete workflow:
1. User draws freehand (brush elements created automatically)
2. AI captures screenshot and analyzes structure
3. AI matches brush by bounding box
4. AI replaces brush with vectorial elements (shapes, connectors, mindmaps)
```

### 8.2 Documentation Technique

**Fichiers à créer** :

1. **`docs/noemai-integration-guide.md`** : Guide complet intégration NoemAI
   - Architecture overview
   - Workflow détaillé Brush → Vectoriel
   - Exemples de code avec Claude Vision
   - Best practices

2. **`docs/brush-api-reference.md`** : Référence complète API Brush
   - Format JSON détaillé
   - Tous les endpoints (CRUD)
   - Propriétés et validations
   - Exemples cURL

3. **`docs/screenshot-api-reference.md`** : Référence API Screenshot
   - Query parameters
   - Formats supportés
   - Configuration Playwright
   - Troubleshooting

### 8.3 Code Documentation

**Ajouter JSDoc** sur toutes les méthodes publiques :

```typescript
/**
 * Create a brush element (freehand ink stroke).
 *
 * @param workspaceId - Workspace UUID
 * @param docId - Document UUID
 * @param brushData - Brush properties
 * @param brushData.points - Array of [x, y, pressure] coordinates (min 2 points)
 * @param brushData.lineWidth - Stroke width in pixels (default: 4)
 * @param brushData.color - Stroke color (theme-aware)
 * @returns Created brush element with generated ID
 *
 * @example
 * ```typescript
 * const brush = await client.createEdgelessElement(workspaceId, docId, {
 *   type: 'brush',
 *   points: [[100, 100, 0.5], [200, 200, 0.8]],
 *   lineWidth: 6,
 *   color: { dark: '#ff0000', light: '#ff0000' }
 * });
 * ```
 */
async createEdgelessElement(/* ... */) { /* ... */ }
```

---

## 9. Risques & Mitigation

| Risque | Impact | Probabilité | Mitigation |
|--------|--------|-------------|------------|
| Playwright performance (lent) | Moyen | Élevée | Cache screenshots, optimiser viewport, limiter rate |
| Playwright déploiement (complexité) | Élevé | Moyenne | Dockerfile testé, documentation complète, fallback sans screenshot |
| Bounding box matching imprécis | Moyen | Moyenne | Threshold configurable, améliorer avec algo vectoriel si besoin |
| Changements schema AFFiNE | Élevé | Faible | Tests d'intégration réguliers, monitoring version AFFiNE |
| Coût API Claude Vision | Moyen | Moyenne | Batch screenshots, cache analyses, pricing monitoring |

**Plan de Contingence** :
- Si Playwright trop lent → Implémenter cache intelligent (TTL 30s)
- Si matching imprécis → Ajouter fallback analyse vectorielle (Phase 2)
- Si API Claude coûteuse → Implémenter rate limiting utilisateur

---

## 10. Métriques de Succès

### 10.1 Métriques Techniques

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| Temps de réponse POST brush | < 500ms | Monitoring Fastify |
| Temps de capture screenshot | < 3s | Monitoring endpoint |
| Coverage tests | > 80% | Vitest report |
| Zero breaking changes | 100% | Tests de régression |

### 10.2 Métriques Business (NoemAI)

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| Time-to-market NoemAI | -40% (vs client custom) | Timeline projet |
| Support multi-devices | 100% (Onyx, iPad, Surface, Desktop) | Tests hardware |
| Précision transformation Brush → Vectoriel | > 85% | User testing |
| Adoption NoemAI | > 10 utilisateurs beta | Analytics |

---

## 11. Annexes

### 11.1 Références

- **Gap Analysis NoemAI** : Session 2025-01-19 (résultats dans ce PRD)
- **Document Test Brush** : `Tests/API Test Folder/Test-SketchAPI` (5184 brush)
- **AFFiNE BlockSuite Source** : https://github.com/toeverything/blocksuite
- **Claude Vision API** : https://docs.anthropic.com/claude/docs/vision

### 11.2 Contacts

- **Product Owner** : Gilles Pinault
- **Developer** : Claude Code (AI Assistant)
- **Workspace AFFiNE** : https://affine.robotsinlove.be
- **Projet NoemAI** : Documentation fournie (Vision v4.1)

### 11.3 Changelog

| Version | Date | Auteur | Changements |
|---------|------|--------|-------------|
| 1.0 | 2025-01-19 | Claude Code | Création initiale basée sur gap analysis |
| 1.1 | 2025-01-19 | Claude Code | Ajout approche progressive multi-résolution (fit-all/viewport/region) |
| 1.2 | 2025-01-19 | Claude Code | Ajout fonctionnalité highlight_brush pour feedback visuel LLM |

---

**Status** : ✅ PRD Complet v1.2 - Prêt pour implémentation

**Prochaines Actions** :
1. Review PRD avec Product Owner
2. Validation priorités (Phase 1 en premier ?)
3. Setup environnement de développement
4. Implémentation Phase 1 (Brush CRUD + Highlight)
