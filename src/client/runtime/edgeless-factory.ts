/**
 * Edgeless Element Factories
 *
 * Functions to create Edgeless canvas elements with proper defaults.
 */

import {
  ConnectorElement,
  CreateConnectorInput,
  CreateElementInput,
  CreateGroupInput,
  CreateMindmapInput,
  CreateShapeInput,
  CreateTextInput,
  EdgelessElement,
  GroupElement,
  MindmapElement,
  ShapeElement,
  TextElement,
  serializeXYWH,
} from '../types/edgeless.js';
import { nanoid } from './doc-structure.js';

// ============================================================================
// Index Generation
// ============================================================================

/**
 * Generate next fractional index for layering.
 * Uses alphanumeric indexing (a0, a1, ..., aZ, b0, ...).
 */
export function generateNextIndex(existingIndices?: string[]): string {
  if (!existingIndices || existingIndices.length === 0) {
    return 'a0';
  }

  // Find max index
  const sorted = existingIndices.sort().reverse();
  const maxIndex = sorted[0];

  // Simple increment (for now - can be improved with fractional-indexing lib)
  const match = maxIndex.match(/^([a-z]+)(\d+)$/i);
  if (!match) return 'a0';

  const [, letters, numbers] = match;
  const num = parseInt(numbers, 10);

  // Increment number
  return `${letters}${num + 1}`;
}

/**
 * Generate random seed for consistent rendering.
 */
export function generateSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

// ============================================================================
// Connector Factory
// ============================================================================

export function createConnector(input: CreateConnectorInput): ConnectorElement {
  return {
    id: nanoid(),
    type: 'connector',
    index: 'temp', // Will be set during insertion
    seed: generateSeed(),

    source: {
      id: input.sourceId,
      position: input.sourcePosition ?? [1, 0.5],
    },
    target: {
      id: input.targetId,
      position: input.targetPosition ?? [0, 0.5],
    },

    stroke: input.stroke ?? '#929292',
    strokeStyle: input.strokeStyle ?? 'solid',
    strokeWidth: input.strokeWidth ?? 2,
    frontEndpointStyle: input.frontEndpointStyle ?? 'None',
    rearEndpointStyle: input.rearEndpointStyle ?? 'Arrow',

    mode: 2,
    rough: input.rough ?? false,
    roughness: 1.4,

    text: input.text,
    labelStyle: input.text
      ? {
          color: {
            dark: '#ffffff',
            light: '#000000',
          },
          fontSize: 16,
          fontFamily: 'blocksuite:surface:Inter',
          fontWeight: '400',
          fontStyle: 'normal',
          textAlign: 'center',
        }
      : undefined,
  };
}

// ============================================================================
// Shape Factory
// ============================================================================

export function createShape(input: CreateShapeInput): ShapeElement {
  const xywh = serializeXYWH(input.xywh);

  return {
    id: nanoid(),
    type: 'shape',
    index: 'temp', // Will be set during insertion
    seed: generateSeed(),

    // Geometry
    shapeType: input.shapeType,
    xywh,
    rotate: input.rotate ?? 0,
    radius: input.radius ?? (input.shapeType === 'rect' ? 0.1 : undefined),

    // Fill
    fillColor: input.fillColor ?? '#ffffff',
    filled: true,

    // Stroke
    strokeColor: input.strokeColor ?? '#000000',
    strokeStyle: input.strokeStyle ?? 'solid',
    strokeWidth: input.strokeWidth ?? 2,

    // Text
    text: input.text ?? '',
    textResizing: 1,
    textAlign: input.textAlign ?? 'center',

    // Typography
    color: '--affine-palette-line-black',
    fontFamily: 'blocksuite:surface:Inter',
    fontSize: input.fontSize ?? 20,
    fontWeight: input.fontWeight ?? '400',
    fontStyle: 'normal',

    // Advanced
    maxWidth: false,
    padding: [10, 20],
    shadow: {
      blur: 12,
      offsetX: 0,
      offsetY: 0,
      color: 'rgba(66, 65, 73, 0.18)',
    },
    shapeStyle: 'General',
    rough: false,
    roughness: 1.4,

    lockedBySelf: false,
    hidden: false,
  };
}

// ============================================================================
// Text Factory
// ============================================================================

export function createText(input: CreateTextInput): TextElement {
  const xywh = serializeXYWH(input.xywh);

  return {
    id: nanoid(),
    type: 'text',
    index: 'temp', // Will be set during insertion
    seed: generateSeed(),

    xywh,
    rotate: input.rotate ?? 0,

    text: input.text,
    textAlign: input.textAlign ?? 'left',

    color: input.color ?? {
      dark: '#ffffff',
      light: '#000000',
    },
    fontFamily: input.fontFamily ?? 'blocksuite:surface:Inter',
    fontSize: input.fontSize ?? 16,
    fontWeight: input.fontWeight ?? '400',
    fontStyle: 'normal',

    hasMaxWidth: false,
    lockedBySelf: false,
  };
}

// ============================================================================
// Group Factory
// ============================================================================

export function createGroup(input: CreateGroupInput): GroupElement {
  return {
    id: nanoid(),
    type: 'group',
    index: 'temp', // Will be set during insertion
    seed: generateSeed(),

    title: input.title,
    children: input.children,
  };
}

// ============================================================================
// Mindmap Factory
// ============================================================================

export function createMindmap(input: CreateMindmapInput): MindmapElement {
  return {
    id: nanoid(),
    type: 'mindmap',
    index: 'temp', // Will be set during insertion
    seed: generateSeed(),

    layoutType: input.layoutType ?? 0,
    style: input.style ?? 3,
    children: {
      [input.rootNodeId]: {
        index: 'a0',
        collapsed: false,
      },
    },
  };
}

// ============================================================================
// Universal Factory
// ============================================================================

export function createElement(input: CreateElementInput): EdgelessElement {
  switch (input.type) {
    case 'connector':
      return createConnector(input);
    case 'shape':
      return createShape(input);
    case 'text':
      return createText(input);
    case 'group':
      return createGroup(input);
    case 'mindmap':
      return createMindmap(input);
    default:
      throw new Error(`Unknown element type: ${(input as { type: string }).type}`);
  }
}

// ============================================================================
// Validation
// ============================================================================

export function validateConnectorInput(input: CreateConnectorInput): void {
  if (!input.sourceId || typeof input.sourceId !== 'string') {
    throw new Error('sourceId is required and must be a string');
  }
  if (!input.targetId || typeof input.targetId !== 'string') {
    throw new Error('targetId is required and must be a string');
  }
  if (input.sourcePosition && !Array.isArray(input.sourcePosition)) {
    throw new Error('sourcePosition must be [x, y] array');
  }
  if (input.targetPosition && !Array.isArray(input.targetPosition)) {
    throw new Error('targetPosition must be [x, y] array');
  }
}

export function validateShapeInput(input: CreateShapeInput): void {
  if (!input.shapeType) {
    throw new Error('shapeType is required');
  }
  if (!['rect', 'ellipse', 'diamond', 'triangle'].includes(input.shapeType)) {
    throw new Error('shapeType must be rect, ellipse, diamond, or triangle');
  }
  if (!input.xywh || !Array.isArray(input.xywh) || input.xywh.length !== 4) {
    throw new Error('xywh is required and must be [x, y, width, height]');
  }
}

export function validateTextInput(input: CreateTextInput): void {
  if (!input.text || typeof input.text !== 'string') {
    throw new Error('text is required and must be a string');
  }
  if (!input.xywh || !Array.isArray(input.xywh) || input.xywh.length !== 4) {
    throw new Error('xywh is required and must be [x, y, width, height]');
  }
}

export function validateGroupInput(input: CreateGroupInput): void {
  if (!input.title || typeof input.title !== 'string') {
    throw new Error('title is required and must be a string');
  }
  if (!input.children || typeof input.children !== 'object') {
    throw new Error('children is required and must be an object');
  }
}

export function validateMindmapInput(input: CreateMindmapInput): void {
  if (!input.rootNodeId || typeof input.rootNodeId !== 'string') {
    throw new Error('rootNodeId is required and must be a string');
  }
}

export function validateElementInput(input: CreateElementInput): void {
  switch (input.type) {
    case 'connector':
      validateConnectorInput(input);
      break;
    case 'shape':
      validateShapeInput(input);
      break;
    case 'text':
      validateTextInput(input);
      break;
    case 'group':
      validateGroupInput(input);
      break;
    case 'mindmap':
      validateMindmapInput(input);
      break;
    default:
      throw new Error(`Unknown element type: ${(input as { type: string }).type}`);
  }
}
