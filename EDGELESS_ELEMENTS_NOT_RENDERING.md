# Edgeless Elements Not Rendering in UI - Investigation Report

**Status**: 🔴 UNRESOLVED
**Date**: 2025-11-05
**Session**: Continuation from Phase 1 & 2 implementation

---

## Problem Statement

**Symptom**: Edgeless elements created via API are:
- ✅ Successfully created (API returns 201)
- ✅ Visible via GET /edgeless endpoint (count > 0, elements listed)
- ✅ Properly stored in Yjs structure (verified via /content endpoint)
- ❌ **NOT visible in AFFiNE UI** when opening document in Edgeless mode
- ❌ Console error: `TypeError: e.get is not a function` at `surface-model.ts:349`

**User Requirement**: Fully automatic, programmatic workflow to create and populate Edgeless documents via API **without any manual UI intervention**.

---

## Investigation Timeline

### Discovery 1: Elements Not Persisting
**Date**: 2025-11-03
**Finding**: Elements created via API returned success but GET /edgeless showed count: 0

**Root Cause**: `prop:elements.value` initialized as plain JavaScript object `{}` which Yjs doesn't synchronize.

**Evidence**:
```typescript
// BROKEN CODE (original)
surfaceMap.set('prop:elements', {
  type: '$blocksuite:internal:native$',
  value: {},  // Plain object - no CRDT tracking!
});
```

**Fix Attempt 1**: Changed to `new Y.Map()` for value
```typescript
surfaceMap.set('prop:elements', {
  type: '$blocksuite:internal:native$',
  value: new Y.Map<unknown>(),
});
```

**Result**: ❌ Elements persisted in API but broke UI rendering

---

### Discovery 2: UI Crashes with Y.Map Structure
**Date**: 2025-11-05
**Finding**: Console error `TypeError: e.get is not a function` at surface-model.ts:349

**Evidence from API**:
```bash
# Working document (created via UI)
curl .../h0QZ7hNtUqgdP5_JalsGb/content
{
  "type": "$blocksuite:internal:native$",
  "value": {
    "element_id": { "type": "shape", ... }  # ✅ Plain JSON
  }
}

# Broken document (created via API with plain wrapper + Y.Map value)
curl .../KnfojKxstej1K2tnTmL59/content
{
  "type": "$blocksuite:internal:native$",
  "value": {
    "_item": null,
    "_map": {},
    "doc": null,
    "_length": 0,
    ...  # ❌ Yjs internals exposed!
  }
}
```

**Root Cause Analysis**: When wrapper is plain JavaScript object, Yjs can't serialize nested Y.Map. The Y.Map becomes "orphaned" - not properly attached to Yjs document tree.

---

### Discovery 3: Yjs Requires Full Y.Map Chain
**Date**: 2025-11-05
**Finding**: Node.js tests revealed Yjs only serializes nested structures when **all levels** use Yjs types.

**Test Results**:
```javascript
// ❌ BROKEN: Plain object wrapper breaks CRDT chain
const wrapper = { type: 'marker', value: new Y.Map() };
surfaceMap.set('elements', wrapper);
// Serializes as: {"type": "marker", "value": {}}  // Empty!

// ✅ WORKING: Y.Map wrapper maintains CRDT chain
const wrapper = new Y.Map();
wrapper.set('type', 'marker');
wrapper.set('value', new Y.Map());
surfaceMap.set('elements', wrapper);
// Serializes as: {"type": "marker", "value": {"elem1": {...}}}  // Full!
```

**Fix Attempt 2**: Changed wrapper itself to Y.Map
```typescript
// doc-structure.ts lines 63-69 (commit 5e59bb0)
const elementsWrapper = new Y.Map<unknown>();
elementsWrapper.set('type', '$blocksuite:internal:native$');
elementsWrapper.set('value', new Y.Map<unknown>());
surfaceMap.set('prop:elements', elementsWrapper);
```

**Verification**:
```bash
# New document created with Y.Map wrapper
curl .../1yhStDNQcmUnVT8faDC8s/content
{
  "type": "$blocksuite:internal:native$",
  "value": {
    "742rZCUZ8lwFe6c3NE3ET": {  # ✅ Element visible!
      "type": "shape",
      "xywh": "[100,100,350,180]",
      ...
    }
  }
}
```

**Result**: ✅ Elements persist correctly in API
**Result**: ❌ **STILL NOT VISIBLE IN UI**

---

## Current State (2025-11-05)

### What Works
1. ✅ API endpoints functional (27 endpoints)
2. ✅ Document creation via API
3. ✅ Element creation returns success
4. ✅ Elements stored in Yjs structure
5. ✅ Elements retrievable via GET /edgeless
6. ✅ Proper Y.Map structure (verified via /content endpoint)
7. ✅ Backwards compatibility with old documents

### What Doesn't Work
1. ❌ Elements not rendered in AFFiNE UI Edgeless mode
2. ❌ Console error persists: `e.get is not a function`
3. ❌ No error in API logs (server-side clean)

### Test Documents

| Document ID | Workspace | Structure | API Visible | UI Visible | Notes |
|-------------|-----------|-----------|-------------|------------|-------|
| `h0QZ7hNtUqgdP5_JalsGb` | Tests | UI-created | ✅ | ✅ | Working reference |
| `KnfojKxstej1K2tnTmL59` | Robots in Love | Plain wrapper | ✅ | ❌ | Yjs internals exposed |
| `1yhStDNQcmUnVT8faDC8s` | Robots in Love | Y.Map wrapper | ✅ | ❌ | Clean structure, still broken |

---

## Code Changes

### File: `src/client/runtime/doc-structure.ts`
**Lines**: 63-69
**Commit**: 5e59bb0

```typescript
// Initialize elements structure with nested Y.Maps for proper CRDT synchronization
// CRITICAL: Both wrapper AND value must be Y.Map for Yjs to serialize correctly
// Plain object wrapper breaks the CRDT chain and causes "value" to serialize as empty {}
const elementsWrapper = new Y.Map<unknown>();
elementsWrapper.set('type', '$blocksuite:internal:native$');
elementsWrapper.set('value', new Y.Map<unknown>());
surfaceMap.set('prop:elements', elementsWrapper);
```

### File: `src/client/runtime/affine-client.ts`
**Lines**: 1755-1783
**Function**: `getElementsMap()`
**Status**: Already handles both Y.Map and plain object wrappers (backwards compatible)

---

## Hypotheses for Next Session

### Hypothesis 1: Missing Initialization in UI-Created Docs
**Theory**: Documents created via UI may have additional metadata or initialization that API-created docs lack.

**Test**: Compare **complete** Yjs structure (not just prop:elements) between:
- Working doc: `h0QZ7hNtUqgdP5_JalsGb` (UI-created)
- Broken doc: `1yhStDNQcmUnVT8faDC8s` (API-created with Y.Map fix)

**Look for**:
- Surface block additional properties
- Block metadata differences
- Y.Map vs plain object patterns in other properties

### Hypothesis 2: BlockSuite Version Mismatch
**Theory**: AFFiNE UI expects a specific BlockSuite structure version that our programmatic creation doesn't match.

**Test**: Inspect BlockSuite source code at `surface-model.ts:349` to understand what `.get()` is being called on.

**Evidence needed**:
- What object is `e` at line 349?
- What properties does UI expect on surface elements wrapper?

### Hypothesis 3: Missing Transaction Context
**Theory**: Yjs requires elements to be added within a specific transaction context that UI creates but API doesn't.

**Test**: Check if working document has transaction markers or version vectors that API-created docs lack.

### Hypothesis 4: Wrong Yjs Document Guid
**Theory**: When we create `new Y.Doc({ guid: docId })`, there might be a mismatch between client-generated ID and server expectations.

**Test**: Compare document GUIDs between working and broken docs.

---

## Diagnostic Steps for Next Session

### Step 1: Deep Structure Comparison
```bash
# Full structure of working document
curl https://affine-api.robotsinlove.be/workspaces/65581777-b884-4a3c-af69-f286827e90b0/documents/h0QZ7hNtUqgdP5_JalsGb/content > /tmp/working_doc.json

# Full structure of broken document
curl https://affine-api.robotsinlove.be/workspaces/b89db6a1-b52c-4634-a5a0-24f555dbebdc/documents/1yhStDNQcmUnVT8faDC8s/content > /tmp/broken_doc.json

# Compare
diff -u /tmp/working_doc.json /tmp/broken_doc.json
```

### Step 2: Manual UI Test (Original Request)
User proposed this test but we didn't execute:

1. **Manually create document** in AFFiNE UI (workspace 'Robots in Love')
2. **Switch to Edgeless mode** (click Edgeless icon)
3. **Draw ONE element manually** (e.g., rectangle)
4. **Get document ID** from URL
5. **Add element via API** to this UI-created document
6. **Refresh UI** - does API-added element appear?

**Purpose**: Isolate whether problem is:
- Document initialization (if API element appears → initialization issue)
- Element addition method (if API element doesn't appear → addition issue)

### Step 3: Inspect BlockSuite Source
**File**: `packages/blocks/src/surface-block/surface-model.ts:349`
**Error**: `TypeError: e.get is not a function`

**Questions**:
- What is variable `e`?
- What method expects `.get()` to exist?
- Does it expect Y.Map instance or plain object?
- Are we mixing structures (Y.Map where plain object expected, or vice versa)?

### Step 4: Check AFFiNE Server Logs
The error `e.get is not a function` happens **client-side** (browser), but server might have warnings.

**Check**:
```bash
docker service logs serverlabapps-affine --tail 100 | grep -i error
```

---

## Files to Review

1. **`/home/gilles/serverlab/projects/notebooks_api/src/client/runtime/doc-structure.ts`**
   - Document initialization logic
   - Surface block creation (lines 56-71)

2. **`/home/gilles/serverlab/projects/notebooks_api/src/client/runtime/affine-client.ts`**
   - Element manipulation (lines 1520-1625: `createEdgelessElement`)
   - Helper methods (lines 1745-1860: getElementsMap, setElement, etc.)
   - Yjs sync (lines 494-516: `pushWorkspaceDocUpdate`)

3. **Working reference document**:
   - Workspace: `65581777-b884-4a3c-af69-f286827e90b0` (Tests)
   - DocId: `h0QZ7hNtUqgdP5_JalsGb`
   - Created via UI, elements added via API successfully
   - **THIS DOCUMENT WORKS** - use as ground truth

4. **Test documents**:
   - `KnfojKxstej1K2tnTmL59` - Plain wrapper (Yjs internals exposed)
   - `1yhStDNQcmUnVT8faDC8s` - Y.Map wrapper (clean structure, still broken)

---

## Key Insights from Session

1. **Yjs CRDT Chain**: Must use Yjs types (Y.Map, Y.Array) at **all nesting levels** for proper synchronization. Plain JavaScript objects break the chain.

2. **Serialization vs Rendering**: Just because structure serializes correctly via `/content` endpoint doesn't mean UI can render it. There's a missing piece.

3. **UI vs API Creation**: Documents created via UI work perfectly. Documents created programmatically via API (even with correct Yjs structure) don't render in UI.

4. **The Gap**: We've solved **persistence** (API storage works). We haven't solved **rendering** (UI display broken).

---

## Next Session Action Plan

1. **Execute Manual Test** (user creates doc in UI, we add elements via API)
2. **Deep Diff** working vs broken document structures
3. **Inspect BlockSuite source** at error line
4. **Consider Alternative**: If programmatic creation fundamentally incompatible, explore:
   - Triggering UI document creation via automation
   - Reverse-engineering exact UI creation sequence
   - Using AFFiNE SDK instead of direct Yjs manipulation

---

## Related Documentation

- **Phase 1 Implementation**: `EDGELESS_DESIGN.md`
- **Phase 2 Implementation**: `SESSION-2025-11-03.md`
- **API Documentation**: `docs/api/edgeless-endpoints.md`
- **Original PRD**: User's brief for Edgeless API demo

---

## Commits Related to This Issue

- `bcf5f97` - Hybrid Y.Map/Object approach (didn't work)
- `5e59bb0` - Full Y.Map wrapper (correct structure, still doesn't render)

---

**Conclusion**: We have a **structurally correct** Yjs implementation (verified), but there's a **rendering incompatibility** between programmatically-created documents and UI expectations. The root cause is likely in how AFFiNE UI initializes or expects certain metadata/context that our programmatic creation doesn't provide.

**User Feedback**: "Non, toujours pas [visible]" - Elements still not rendering after Y.Map fix.

**Status**: Ready for fresh context session with full diagnostic information.
