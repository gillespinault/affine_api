/**
 * Element Default Properties
 *
 * Extracted from BlockSuite source code (@field() decorators).
 * These defaults are applied when creating elements to match BlockSuite's behavior.
 *
 * Source: affine_source/blocksuite/affine/model/src/elements/
 */

import type { CreateElementInput } from '../types/edgeless.js';

// ============================================================================
// Shape Defaults (from shape/shape.ts)
// ============================================================================

export const SHAPE_DEFAULTS = {
  // Geometry
  rotate: 0,
  radius: 0,
  xywh: '[0,0,100,100]',

  // Fill
  filled: false,
  fillColor: '--affine-palette-shape-white', // DefaultTheme.shapeFillColor

  // Stroke
  strokeColor: '--affine-palette-line-black', // DefaultTheme.shapeStrokeColor
  strokeStyle: 'solid' as const,
  strokeWidth: 4,

  // Text
  color: '--affine-palette-line-black', // DefaultTheme.shapeTextColor
  fontFamily: 'blocksuite:surface:Inter',
  fontSize: 20, // ShapeTextFontSize.MEDIUM
  fontStyle: 'normal' as const,
  fontWeight: '400' as const,
  textAlign: 'center' as const,
  textHorizontalAlign: 'center' as const,
  textVerticalAlign: 'center' as const,
  textResizing: 1, // TextResizing.AUTO_HEIGHT
  maxWidth: false as const,
  padding: [10, 20] as [number, number], // [SHAPE_TEXT_VERTICAL_PADDING, SHAPE_TEXT_PADDING]

  // Advanced
  shadow: null,
  shapeStyle: 'General',
  roughness: 1.4, // DEFAULT_ROUGHNESS

  // Shape type specific
  shapeType: 'rect' as const,
};

// ============================================================================
// Connector Defaults (from connector/connector.ts)
// ============================================================================

export const CONNECTOR_DEFAULTS = {
  // Geometry
  rotate: 0,
  xywh: '[0,0,0,0]',

  // Connection
  source: { position: [0, 0] },
  target: { position: [0, 0] },

  // Stroke
  stroke: '--affine-palette-line-grey', // DefaultTheme.connectorColor
  strokeStyle: 'solid' as const,
  strokeWidth: 4,

  // Mode
  mode: 2, // DEFAULT_CONNECTOR_MODE (ConnectorMode.Orthogonal)
  roughness: 1.4, // DEFAULT_ROUGHNESS
  rough: undefined,

  // Endpoints
  frontEndpointStyle: 'None',
  rearEndpointStyle: 'Arrow',

  // Label
  labelDisplay: true,
  labelOffset: {
    distance: 0.5,
    anchor: 'center' as const,
  },
  labelStyle: {
    color: { dark: '#ffffff', light: '#000000' },
    fontFamily: 'blocksuite:surface:Inter',
    fontSize: 16,
    fontStyle: 'normal' as const,
    fontWeight: '400' as const,
    textAlign: 'center' as const,
  },
  labelConstraints: {
    hasMaxWidth: true,
    maxWidth: 1000, // CONNECTOR_LABEL_MAX_WIDTH
  },
  labelXYWH: undefined,
};

// ============================================================================
// Text Defaults (from text/text.ts)
// ============================================================================

export const TEXT_DEFAULTS = {
  // Geometry
  rotate: 0,
  xywh: '[0,0,100,100]',

  // Typography
  color: { dark: '#ffffff', light: '#000000' },
  fontFamily: 'blocksuite:surface:Inter',
  fontSize: 16,
  fontStyle: 'normal' as const,
  fontWeight: '400' as const,
  textAlign: 'left' as const,
  hasMaxWidth: false,
};

// ============================================================================
// Group Defaults (from group/group.ts)
// ============================================================================

export const GROUP_DEFAULTS = {
  rotate: 0,
  xywh: '[0,0,0,0]',
  children: {},
  title: { type: 'text' as const, delta: [] },
};

// ============================================================================
// Mindmap Defaults (from mindmap/mindmap.ts)
// ============================================================================

export const MINDMAP_DEFAULTS = {
  rotate: 0,
  xywh: '[0,0,0,0]',
  layoutType: 0,
  style: 3,
  children: {},
};

// ============================================================================
// Apply Defaults Function
// ============================================================================

/**
 * Apply default properties to element data based on element type.
 * Mimics BlockSuite's @field() decorator behavior.
 */
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
    default:
      throw new Error(`Unknown element type: ${type}`);
  }

  // Merge user data over defaults
  // User-provided values take precedence
  return {
    ...defaults,
    ...elementData,
  };
}

/**
 * Transform specific properties to Yjs types (mimics propsToY static methods).
 *
 * From BlockSuite source:
 * - ShapeElementModel.propsToY: Converts string text to Y.Text
 * - ConnectorElementModel.propsToY: Converts string text to Y.Text
 */
export function transformPropsToYjs(props: Record<string, unknown>): Record<string, unknown> {
  const transformed = { ...props };

  // Transform text property for shapes and connectors
  if (typeof transformed.text === 'string' && transformed.text.length > 0) {
    // Note: We keep it as string for now since we're working with plain Yjs,
    // not the full BlockSuite runtime. The actual Y.Text conversion happens
    // in the YMap layer via setElement().
    //
    // In a future version, we could use:
    // import * as Y from 'yjs';
    // transformed.text = new Y.Text(transformed.text);
  }

  return transformed;
}
