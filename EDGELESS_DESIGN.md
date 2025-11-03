# Priority #3: Edgeless Mode API Support - Design Document

**Status**: Research Complete - Ready for Implementation
**Created**: 2025-11-03
**Author**: Claude Code Analysis

---

## 1. Executive Summary

This document outlines the design for implementing REST API support for AFFiNE's **Edgeless mode** - the infinite canvas/whiteboard feature that allows visual brainstorming, mind mapping, flowcharts, and spatial document organization.

### What is Edgeless Mode?

Edgeless is AFFiNE's alternative to Miro/Notion Canvas - an infinite whiteboard where users can:
- Place blocks anywhere in 2D space
- Create shapes (rectangles, ellipses, diamonds) with text
- Draw connectors (arrows) between elements
- Add free-floating text labels
- Create mind maps with automatic layouts
- Group related elements together

Each AFFiNE document has **two views**:
1. **Page Mode**: Linear document (traditional note-taking)
2. **Edgeless Mode**: Canvas view with spatial positioning

---

## 2. Data Structure Analysis

### 2.1. Surface Block Architecture

**Location in Yjs Document**: `blocks[surfaceId]`

```typescript
{
  "id": "Cqgi25EyG3",
  "flavour": "affine:surface",
  "props": {
    "elements": {
      "type": "$blocksuite:internal:native$",
      "value": {
        // Map of element IDs to element objects
        "elementId1": { ...elementData },
        "elementId2": { ...elementData }
      }
    }
  },
  "children": []
}
```

**Key observations**:
- `elements` is a special native type in BlockSuite
- Stored as flat map (no nesting)
- Each element has unique ID (21-char nanoid)
- All spatial elements live in surface block's `value` object

### 2.2. Element Types Discovered

From real production data analysis (77 elements in "Getting Started" doc):

| Type      | Count | Purpose                           | Key Properties              |
|-----------|-------|-----------------------------------|-----------------------------|
| connector | 36    | Arrows connecting elements        | source, target, endpoints   |
| shape     | 19    | Geometric shapes with text        | shapeType, xywh, text       |
| group     | 13    | Grouping related elements         | children, title             |
| text      | 8     | Free-floating text labels         | text, xywh, fontSize        |
| mindmap   | 1     | Mind map layout container         | layoutType, style, children |

---

## 3. Element Schema Details

### 3.1. Connector Element

**Purpose**: Arrow/line connecting two elements

```typescript
{
  "id": "PuF62wQxva",
  "type": "connector",
  "index": "a2",                    // Z-index for layering
  "seed": 717021639,                // Random seed for rendering

  // Connection points
  "source": {
    "id": "63i78ONZas",             // Source block/element ID
    "position": [0, 0.5]            // Relative position [x, y] where 0-1
  },
  "target": {
    "id": "Ms1TUkh534",             // Target block/element ID
    "position": [1, 0.5]            // Relative position [x, y]
  },

  // Styling
  "stroke": "#929292",              // Line color
  "strokeStyle": "solid",           // "solid", "dashed", "dotted"
  "strokeWidth": 2,                 // Line thickness
  "frontEndpointStyle": "None",     // Start arrow: "None", "Arrow", "Circle", etc.
  "rearEndpointStyle": "Arrow",     // End arrow

  // Optional label
  "text": "Workspace doc",           // Label text
  "labelOffset": {                  // Label position on line
    "distance": 0.5,                // 0-1 along line
    "anchor": "center"              // Alignment
  },
  "labelXYWH": [x, y, w, h],       // Label bounding box
  "labelStyle": {
    "color": { "dark": "#fff", "light": "#000" },
    "fontSize": 16,
    "fontFamily": "blocksuite:surface:Inter",
    "fontWeight": "400",
    "textAlign": "center"
  },

  // Rendering
  "mode": 2,                        // Rendering mode
  "rough": false,                   // Hand-drawn style
  "roughness": 1.4                  // Roughness amount if enabled
}
```

**Connection Strategy**:
- Connectors reference ANY block ID (notes, shapes, etc.)
- Position `[0, 0.5]` means left edge (x=0), middle height (y=0.5)
- Position `[1, 0.5]` means right edge, middle height
- Position `[0.5, 0]` means top edge, centered horizontally

### 3.2. Shape Element

**Purpose**: Geometric shapes (rectangles, ellipses, diamonds) with optional text

```typescript
{
  "id": "Inp-i3x1wc",
  "type": "shape",
  "index": "aG",
  "seed": 497608336,

  // Geometry
  "shapeType": "rect",              // "rect", "ellipse", "diamond", "triangle"
  "xywh": "[845.188,-303.38,192.03,38.5]",  // [x, y, width, height] as JSON string
  "rotate": 0,                      // Rotation in degrees
  "radius": 10,                     // Border radius (for rect)

  // Fill
  "fillColor": "#fcd34d",           // Background color
  "filled": true,                   // Whether filled

  // Stroke
  "strokeColor": "transparent",     // Border color
  "strokeStyle": "solid",           // Border style
  "strokeWidth": 0,                 // Border thickness

  // Text content
  "text": "Canvas Operation",       // Text inside shape
  "textResizing": 0,                // Auto-resize behavior
  "textAlign": "center",            // Text alignment

  // Typography
  "fontFamily": "blocksuite:surface:Poppins",
  "fontSize": 16,
  "fontWeight": "500",              // "400", "500", "600", "700"
  "fontStyle": "normal",            // "normal", "italic"

  // Advanced
  "maxWidth": false,                // Text wrapping
  "padding": [10, 22],              // [vertical, horizontal]
  "shadow": {                       // Drop shadow
    "blur": 12,
    "offsetX": 0,
    "offsetY": 0,
    "color": "rgba(66, 65, 73, 0.18)"
  },
  "shapeStyle": "General",          // Style preset
  "roughness": 1.4,                 // For rough mode
  "rough": false                    // Hand-drawn style
}
```

**Shape Types**:
- `rect`: Rectangle (supports `radius` for rounded corners)
- `ellipse`: Circle/oval
- `diamond`: Diamond/rhombus (45° rotated square)
- `triangle`: Triangle (orientation varies)

### 3.3. Text Element

**Purpose**: Free-floating text labels (no background shape)

```typescript
{
  "id": "o25lztr-nP",
  "type": "text",
  "index": "b30",
  "seed": 868124845,

  // Position
  "xywh": "[5733.628,1988.469,41.88,28.796]",  // Bounding box
  "rotate": 0,                      // Rotation

  // Content
  "text": "Yes",                     // Text content
  "textAlign": "left",              // "left", "center", "right"

  // Typography
  "color": {                        // Theme-aware color
    "dark": "#ffffff",
    "light": "#000000"
  },
  "fontFamily": "blocksuite:surface:Inter",
  "fontSize": 24,
  "fontWeight": "600",
  "fontStyle": "normal",            // "normal", "italic"

  // Sizing
  "hasMaxWidth": false,             // Text wrapping

  // State
  "lockedBySelf": false             // Edit lock
}
```

### 3.4. Group Element

**Purpose**: Logical grouping of related elements (like folders)

```typescript
{
  "id": "qu_rYDcZFe",
  "type": "group",
  "index": "b3N",
  "seed": 299039412,

  "title": "Group 7",               // Group name
  "children": {                     // Map of child elements
    "N7jlsBuNac": true,             // Simple boolean flag
    "otherElementId": true
  }
}
```

**Notes**:
- Groups don't have visual representation (no xywh)
- Used for selection, moving multiple elements together
- Can be nested (group can contain other groups)

### 3.5. Mindmap Element

**Purpose**: Specialized mind map layout container

```typescript
{
  "id": "N7jlsBuNac",
  "type": "mindmap",
  "index": "aq",
  "seed": 494775280,

  "layoutType": 0,                  // Layout algorithm (0 = radial?)
  "style": 3,                       // Visual style preset

  "children": {                     // Hierarchical structure
    "Inp-i3x1wc": {                 // Root node
      "index": "a0",
      "collapsed": false
    },
    "IQCHhRIqpD": {                 // Child node
      "index": "ZzV",
      "parent": "Inp-i3x1wc"        // Parent reference
    },
    "f9guyzY7Zg": {
      "index": "Zz",
      "parent": "Inp-i3x1wc"
    }
  }
}
```

**Notes**:
- Automatic layout management
- Hierarchical parent-child relationships
- Collapsible branches

---

## 4. Common Properties

All elements share these properties:

| Property | Type    | Required | Purpose                           |
|----------|---------|----------|-----------------------------------|
| id       | string  | ✅       | Unique identifier (21-char nanoid)|
| type     | string  | ✅       | Element type discriminator        |
| index    | string  | ✅       | Z-index for layer ordering        |
| seed     | number  | ✅       | Random seed for consistent render |

**Index Format**: Alphanumeric string for fractional indexing (e.g., "a2", "aG", "b30", "Zz")
- Allows inserting elements between existing ones without reordering
- Similar to Figma's layer ordering

---

## 5. Proposed API Design

### 5.1. Endpoint Strategy

We'll create **specialized endpoints** for Edgeless operations, separate from block CRUD:

```
GET    /workspaces/:workspaceId/documents/:docId/edgeless
POST   /workspaces/:workspaceId/documents/:docId/edgeless/elements
GET    /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId
PATCH  /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId
DELETE /workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId
```

**Rationale**:
- Edgeless elements are NOT blocks (different data model)
- Stored in surface block's `prop:elements` (special handling)
- Require different operations (positioning, connections)

### 5.2. Endpoint Specifications

#### GET /edgeless - Get Canvas State

**Purpose**: Retrieve all elements on the canvas

```bash
GET /workspaces/{workspaceId}/documents/{docId}/edgeless
```

**Response**:
```json
{
  "docId": "98U_91z95t",
  "surfaceId": "Cqgi25EyG3",
  "elements": [
    {
      "id": "PuF62wQxva",
      "type": "connector",
      "source": { "id": "63i78ONZas", "position": [0, 0.5] },
      "target": { "id": "Ms1TUkh534", "position": [1, 0.5] },
      "stroke": "#929292",
      "strokeWidth": 2,
      ...
    },
    {
      "id": "Inp-i3x1wc",
      "type": "shape",
      "shapeType": "rect",
      "xywh": [845.188, -303.38, 192.03, 38.5],
      "text": "Canvas Operation",
      "fillColor": "#fcd34d",
      ...
    }
  ],
  "count": 77
}
```

**Features**:
- Parse `xywh` string to array `[x, y, w, h]`
- Include all element properties
- Optional filters: `?type=shape` or `?type=connector`

---

#### POST /edgeless/elements - Add Element

**Purpose**: Create new element on canvas

```bash
POST /workspaces/{workspaceId}/documents/{docId}/edgeless/elements
Content-Type: application/json

{
  "type": "shape",
  "shapeType": "rect",
  "xywh": [100, 200, 300, 150],
  "text": "New Shape",
  "fillColor": "#84cfff",
  "strokeColor": "#000000",
  "strokeWidth": 2
}
```

**Response**:
```json
{
  "id": "NewElementId123",
  "type": "shape",
  "shapeType": "rect",
  "xywh": [100, 200, 300, 150],
  "text": "New Shape",
  "fillColor": "#84cfff",
  "strokeColor": "#000000",
  "strokeWidth": 2,
  "index": "b40",           // Auto-assigned
  "seed": 1234567890,       // Auto-generated
  ...defaults
}
```

**Implementation**:
1. Generate `id` (nanoid)
2. Generate `seed` (random)
3. Assign `index` (find max + increment)
4. Apply type-specific defaults
5. Validate required properties per type
6. Insert into `surface.props.elements.value[id]`

**Type-Specific Validation**:

**Shape**:
- Required: `shapeType`, `xywh`
- Defaults: `fillColor: "#ffffff"`, `filled: true`, `strokeColor: "#000000"`, `strokeWidth: 2`

**Connector**:
- Required: `source.id`, `target.id`
- Defaults: `source.position: [1, 0.5]`, `target.position: [0, 0.5]`, `stroke: "#929292"`

**Text**:
- Required: `text`, `xywh`
- Defaults: `fontSize: 16`, `fontFamily: "blocksuite:surface:Inter"`

---

#### GET /edgeless/elements/:elementId - Get Element

**Purpose**: Retrieve single element details

```bash
GET /workspaces/{workspaceId}/documents/{docId}/edgeless/elements/{elementId}
```

**Response**:
```json
{
  "id": "Inp-i3x1wc",
  "type": "shape",
  "shapeType": "rect",
  "xywh": [845.188, -303.38, 192.03, 38.5],
  ...allProperties
}
```

---

#### PATCH /edgeless/elements/:elementId - Update Element

**Purpose**: Modify element properties (move, resize, restyle)

```bash
PATCH /workspaces/{workspaceId}/documents/{docId}/edgeless/elements/{elementId}
Content-Type: application/json

{
  "xywh": [900, -200, 250, 100],
  "fillColor": "#fcd34d",
  "text": "Updated Text"
}
```

**Response**:
```json
{
  "id": "Inp-i3x1wc",
  "type": "shape",
  "xywh": [900, -200, 250, 100],
  "fillColor": "#fcd34d",
  "text": "Updated Text",
  ...allProperties
}
```

**Implementation**:
1. Load existing element
2. Merge provided properties (shallow merge)
3. Validate updated element
4. Update `surface.props.elements.value[elementId]`

**Common Operations**:
- **Move**: Update `xywh` (change x, y)
- **Resize**: Update `xywh` (change w, h)
- **Restyle**: Update color/stroke properties
- **Edit text**: Update `text` property
- **Reconnect**: Update `source`/`target` (connectors)

---

#### DELETE /edgeless/elements/:elementId - Remove Element

**Purpose**: Delete element from canvas

```bash
DELETE /workspaces/{workspaceId}/documents/{docId}/edgeless/elements/{elementId}
```

**Response**:
```http
204 No Content
```

**Cascade Behavior**:
- If deleting element referenced by connector → connector becomes dangling (still valid)
- If deleting group → children remain, lose group membership
- If deleting mindmap → children become orphaned

**Optional**: Add `?cascade=true` to delete dependent elements

---

### 5.3. Batch Operations (Future Enhancement)

For performance with large canvases:

```bash
POST /workspaces/{workspaceId}/documents/{docId}/edgeless/batch
Content-Type: application/json

{
  "operations": [
    { "op": "create", "type": "shape", "data": {...} },
    { "op": "update", "elementId": "xyz", "data": {...} },
    { "op": "delete", "elementId": "abc" }
  ]
}
```

---

## 6. Implementation Plan

### Phase 1: Core Element CRUD (Priority)

**Client Methods** (`affine-client.ts`):
```typescript
// Get all canvas elements
async getEdgelessElements(workspaceId: string, docId: string): Promise<EdgelessElement[]>

// Add element to canvas
async addEdgelessElement(workspaceId: string, docId: string, element: CreateElementInput): Promise<EdgelessElement>

// Update element properties
async updateEdgelessElement(workspaceId: string, docId: string, elementId: string, updates: Partial<EdgelessElement>): Promise<EdgelessElement>

// Delete element
async deleteEdgelessElement(workspaceId: string, docId: string, elementId: string): Promise<void>
```

**Server Endpoints** (`server.ts`):
- `app.get('/workspaces/:workspaceId/documents/:docId/edgeless')`
- `app.post('/workspaces/:workspaceId/documents/:docId/edgeless/elements')`
- `app.get('/workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId')`
- `app.patch('/workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId')`
- `app.delete('/workspaces/:workspaceId/documents/:docId/edgeless/elements/:elementId')`

### Phase 2: Type Factories & Validation

**TypeScript Interfaces** (`types.ts`):
```typescript
export type EdgelessElementType = 'connector' | 'shape' | 'text' | 'group' | 'mindmap';

export interface BaseElement {
  id: string;
  type: EdgelessElementType;
  index: string;
  seed: number;
}

export interface ConnectorElement extends BaseElement {
  type: 'connector';
  source: { id: string; position: [number, number] };
  target: { id: string; position: [number, number] };
  stroke: string;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  strokeWidth: number;
  frontEndpointStyle: string;
  rearEndpointStyle: string;
  // ... full schema
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: 'rect' | 'ellipse' | 'diamond' | 'triangle';
  xywh: number[]; // [x, y, width, height]
  text?: string;
  fillColor: string;
  // ... full schema
}

// ... TextElement, GroupElement, MindmapElement
```

**Element Factories** (`edgeless-factory.ts`):
```typescript
export function createShape(input: CreateShapeInput): ShapeElement {
  return {
    id: nanoid(),
    type: 'shape',
    index: generateNextIndex(),
    seed: Math.floor(Math.random() * 2147483647),
    shapeType: input.shapeType,
    xywh: input.xywh,
    text: input.text ?? '',
    fillColor: input.fillColor ?? '#ffffff',
    filled: true,
    strokeColor: input.strokeColor ?? '#000000',
    strokeWidth: input.strokeWidth ?? 2,
    // ... apply all defaults
  };
}

export function createConnector(input: CreateConnectorInput): ConnectorElement {
  return {
    id: nanoid(),
    type: 'connector',
    index: generateNextIndex(),
    seed: Math.floor(Math.random() * 2147483647),
    source: {
      id: input.sourceId,
      position: input.sourcePosition ?? [1, 0.5]
    },
    target: {
      id: input.targetId,
      position: input.targetPosition ?? [0, 0.5]
    },
    stroke: input.stroke ?? '#929292',
    strokeStyle: input.strokeStyle ?? 'solid',
    strokeWidth: input.strokeWidth ?? 2,
    // ... apply all defaults
  };
}
```

### Phase 3: Documentation & Examples

**README.md Updates**:
- Add "Edgeless Mode Operations" section
- Document all 5 element types with examples
- Provide common use cases (flowcharts, mind maps, annotations)

**Example Recipes**:
```bash
# Create flowchart
curl -X POST "https://api.example.com/workspaces/ABC/documents/123/edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "shape",
    "shapeType": "rect",
    "xywh": [0, 0, 200, 100],
    "text": "Start",
    "fillColor": "#6e52df"
  }'

# Connect two elements
curl -X POST ".../edgeless/elements" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "connector",
    "sourceId": "elementId1",
    "targetId": "elementId2",
    "rearEndpointStyle": "Arrow"
  }'
```

---

## 7. Technical Considerations

### 7.1. Yjs Manipulation

**Challenge**: `prop:elements` has special type `$blocksuite:internal:native$`

**Strategy**:
1. Retrieve surface block: `doc.blocks[surfaceId]`
2. Access elements map: `surface['prop:elements'].value`
3. Modify elements object directly (plain JS object, not Y.Map)
4. Yjs tracks changes automatically

**Example Code**:
```typescript
const surface = blocks.get(surfaceId);
const elementsWrapper = surface.get('prop:elements');
const elements = elementsWrapper.value; // Plain object

// Add element
elements[newElementId] = createShape({...});

// Update element
elements[existingId] = { ...elements[existingId], xywh: [100, 200, 300, 150] };

// Delete element
delete elements[elementId];
```

### 7.2. Index Generation

**Fractional Indexing Algorithm**:
```typescript
function generateNextIndex(existingIndices: string[]): string {
  if (existingIndices.length === 0) return 'a0';

  const maxIndex = existingIndices.sort().reverse()[0];
  // Increment alphanumeric index (a0 → a1 → ... → aZ → b0)
  return incrementIndex(maxIndex);
}
```

**Use library**: `fractional-indexing` npm package

### 7.3. XYWH Formatting

**Storage**: `"[x,y,w,h]"` (JSON string)
**API Input/Output**: `[x, y, w, h]` (array)

**Conversion**:
```typescript
// Parse from storage
const xywh = JSON.parse(xywhString); // "[100,200,300,150]" → [100, 200, 300, 150]

// Serialize for storage
const xywhString = JSON.stringify(xywh); // [100, 200, 300, 150] → "[100,200,300,150]"
```

### 7.4. Performance Optimization

For documents with 1000+ elements:

**Pagination** (Future):
```bash
GET /edgeless?limit=100&offset=0
```

**Spatial Queries** (Future):
```bash
GET /edgeless?viewport=[x,y,w,h]  # Only elements in visible area
```

**Incremental Updates** (Advanced):
- Use Yjs update streams for real-time sync
- Subscribe to `prop:elements` changes

---

## 8. Use Cases & Examples

### Use Case 1: Flowchart Creation

**Scenario**: API creates a simple process flowchart

**Steps**:
1. Create "Start" ellipse
2. Create "Process" rectangle
3. Create "Decision" diamond
4. Create "End" ellipse
5. Connect with arrows

**API Calls**:
```bash
# 1. Start node
START_ID=$(curl -X POST ".../edgeless/elements" -d '{
  "type": "shape",
  "shapeType": "ellipse",
  "xywh": [0, 0, 150, 150],
  "text": "Start",
  "fillColor": "#6e52df"
}' | jq -r '.id')

# 2. Process node
PROCESS_ID=$(curl -X POST ".../edgeless/elements" -d '{
  "type": "shape",
  "shapeType": "rect",
  "xywh": [0, 200, 200, 100],
  "text": "Process Data",
  "fillColor": "#84cfff"
}' | jq -r '.id')

# 3. Connect Start → Process
curl -X POST ".../edgeless/elements" -d '{
  "type": "connector",
  "sourceId": "'$START_ID'",
  "sourcePosition": [0.5, 1],
  "targetId": "'$PROCESS_ID'",
  "targetPosition": [0.5, 0],
  "rearEndpointStyle": "Arrow"
}'
```

### Use Case 2: Mind Map

**Scenario**: Create mind map with central topic and branches

**Structure**:
```
           Topic
          /  |  \
       Idea1 Idea2 Idea3
```

**API Calls**:
```bash
# 1. Central topic
TOPIC_ID=$(curl -X POST ".../edgeless/elements" -d '{
  "type": "shape",
  "shapeType": "rect",
  "xywh": [0, 0, 200, 80],
  "text": "Main Topic",
  "fillColor": "#fcd34d"
}' | jq -r '.id')

# 2. Branch 1
IDEA1_ID=$(curl -X POST ".../edgeless/elements" -d '{
  "type": "shape",
  "shapeType": "rect",
  "xywh": [-300, 150, 150, 60],
  "text": "Idea 1",
  "fillColor": "#84cfff"
}' | jq -r '.id')

# 3. Connect Topic → Idea1
curl -X POST ".../edgeless/elements" -d '{
  "type": "connector",
  "sourceId": "'$TOPIC_ID'",
  "targetId": "'$IDEA1_ID'",
  "strokeStyle": "solid"
}'

# ... repeat for Idea2, Idea3
```

### Use Case 3: Annotation Layer

**Scenario**: Add arrows and labels to annotate existing document

**Example**: Pointing out important blocks

```bash
# 1. Get document to find block IDs
BLOCKS=$(curl ".../documents/123/content" | jq '.blocks')

# 2. Add arrow pointing to important block
curl -X POST ".../edgeless/elements" -d '{
  "type": "connector",
  "sourceId": "existingBlockId",
  "targetId": "existingBlockId2",
  "text": "Important connection!",
  "stroke": "#ff0000",
  "strokeWidth": 3
}'

# 3. Add label text
curl -X POST ".../edgeless/elements" -d '{
  "type": "text",
  "xywh": [500, 100, 200, 50],
  "text": "⚠️ Pay attention here",
  "fontSize": 20,
  "color": { "light": "#ff0000", "dark": "#ff6b6b" }
}'
```

---

## 9. Testing Strategy

### Unit Tests

**Element Creation**:
```typescript
test('createShape generates valid shape element', () => {
  const shape = createShape({
    shapeType: 'rect',
    xywh: [0, 0, 100, 100],
    text: 'Test'
  });

  expect(shape.id).toHaveLength(21);
  expect(shape.type).toBe('shape');
  expect(shape.shapeType).toBe('rect');
  expect(shape.fillColor).toBe('#ffffff'); // Default
});
```

**XYWH Parsing**:
```typescript
test('parses xywh string to array', () => {
  const xywh = parseXYWH('[10,20,30,40]');
  expect(xywh).toEqual([10, 20, 30, 40]);
});
```

### Integration Tests

**End-to-End Flowchart**:
```typescript
test('create flowchart with shapes and connectors', async () => {
  // Create shapes
  const start = await client.addEdgelessElement(workspaceId, docId, {
    type: 'shape',
    shapeType: 'ellipse',
    xywh: [0, 0, 150, 150],
    text: 'Start'
  });

  const process = await client.addEdgelessElement(workspaceId, docId, {
    type: 'shape',
    shapeType: 'rect',
    xywh: [0, 200, 200, 100],
    text: 'Process'
  });

  // Connect them
  const connector = await client.addEdgelessElement(workspaceId, docId, {
    type: 'connector',
    sourceId: start.id,
    targetId: process.id
  });

  // Verify
  const elements = await client.getEdgelessElements(workspaceId, docId);
  expect(elements).toHaveLength(3);
  expect(elements.find(e => e.type === 'connector')).toBeDefined();
});
```

### Manual Testing

**Production Validation**:
1. Create flowchart via API
2. Open document in AFFiNE GUI → switch to Edgeless mode
3. Verify elements appear correctly
4. Move elements in GUI → verify API GET reflects changes
5. Update via API → verify GUI updates

---

## 10. Limitations & Future Work

### Known Limitations

1. **No Brushes/Freehand Drawing**: Current design supports structured elements only (no pen strokes)
2. **No Image Elements**: Would require file upload/storage
3. **No Embedded Blocks**: Can't create new blocks via Edgeless API (only connect existing)
4. **Limited Layout Algorithms**: Mindmap layout is automatic (can't customize)
5. **No Undo/Redo**: API is stateless (client responsibility)

### Future Enhancements

**Phase 4** (Advanced):
- [ ] Batch operations for performance
- [ ] Spatial queries (viewport filtering)
- [ ] Element templates/presets
- [ ] Auto-layout algorithms (force-directed, tree)
- [ ] Export canvas as image/SVG
- [ ] Import from Miro/Figma

**Phase 5** (Enterprise):
- [ ] Real-time collaboration events (WebSocket)
- [ ] Version history for canvas
- [ ] Access control per element
- [ ] Canvas snapshots/branching

---

## 11. Success Metrics

**Completeness**:
- ✅ All 5 element types supported (connector, shape, text, group, mindmap)
- ✅ Full CRUD operations (create, read, update, delete)
- ✅ Properties match BlockSuite schema 100%

**Usability**:
- ✅ Clear examples for common use cases
- ✅ Type-safe TypeScript interfaces
- ✅ Comprehensive error messages

**Performance**:
- ✅ Handle documents with 500+ elements
- ✅ API response time < 500ms for CRUD ops

**Validation**:
- ✅ Elements created via API display correctly in GUI
- ✅ Elements created in GUI accessible via API
- ✅ Round-trip fidelity (GUI ↔ API ↔ GUI)

---

## 12. Conclusion

This design document provides a complete blueprint for implementing Edgeless mode support in the AFFiNE REST API.

**Key Achievements**:
1. ✅ Reverse-engineered BlockSuite element schema from production data
2. ✅ Identified 5 element types with full property schemas
3. ✅ Designed RESTful API matching AFFiNE's architecture
4. ✅ Planned phased implementation with clear milestones

**Next Steps**:
1. Review this document with user
2. Implement Phase 1 (Core CRUD)
3. Test with real production data
4. Iterate based on feedback

**Estimated Timeline**:
- Phase 1 (Core CRUD): 2-3 days
- Phase 2 (Factories & Validation): 1-2 days
- Phase 3 (Documentation): 1 day
- **Total**: ~5-6 days for MVP

---

**Document Version**: 1.0
**Ready for Review**: ✅ Yes
**Implementation Status**: 🔴 Not Started (awaiting approval)
