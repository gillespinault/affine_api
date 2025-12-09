/**
 * Edgeless Mode Types
 *
 * TypeScript interfaces for AFFiNE Edgeless canvas elements.
 * Based on BlockSuite surface block schema analysis.
 */

// ============================================================================
// Base Types
// ============================================================================

export type EdgelessElementType = 'connector' | 'shape' | 'text' | 'group' | 'mindmap';

export interface BaseElement {
  id: string;
  type: EdgelessElementType;
  index: string;
  seed: number;
}

// ============================================================================
// Connector Element
// ============================================================================

export interface ConnectorEndpoint {
  id: string;
  position: [number, number]; // [x, y] relative position (0-1)
}

export interface LabelStyle {
  color: {
    dark: string;
    light: string;
  };
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: 'left' | 'center' | 'right';
}

export interface LabelOffset {
  distance: number; // 0-1 along connector line
  anchor?: 'center' | 'start' | 'end';
}

export interface ConnectorElement extends BaseElement {
  type: 'connector';
  source: ConnectorEndpoint;
  target: ConnectorEndpoint;

  // Styling
  stroke: string;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  strokeWidth: number;
  frontEndpointStyle: string; // "None", "Arrow", "Circle", etc.
  rearEndpointStyle: string;

  // Rendering
  mode: number;
  rough: boolean;
  roughness: number;

  // Optional label
  text?: string;
  labelOffset?: LabelOffset;
  labelStyle?: LabelStyle;
  labelXYWH?: number[]; // [x, y, width, height]
}

// ============================================================================
// Shape Element
// ============================================================================

export type ShapeType = 'rect' | 'ellipse' | 'diamond' | 'triangle';

export interface Shadow {
  blur: number;
  offsetX: number;
  offsetY: number;
  color: string;
}

export interface EdgelessStyle {
  style?: {
    borderRadius?: number;
    borderSize?: number;
    borderStyle?: string;
    shadowType?: string;
  };
  collapse?: boolean;
  collapsedHeight?: number;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';

  // Geometry
  shapeType: ShapeType;
  xywh: number[] | string; // [x, y, width, height] or JSON string
  rotate: number;
  radius?: number; // Border radius (for rect)

  // Fill
  fillColor: string;
  filled: boolean;

  // Stroke
  strokeColor: string;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  strokeWidth: number;

  // Text content
  text?: string;
  textResizing?: number;
  textAlign?: 'left' | 'center' | 'right';

  // Typography
  color?: string | { dark: string; light: string };
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: 'normal' | 'italic';

  // Advanced
  maxWidth?: boolean;
  padding?: [number, number]; // [vertical, horizontal]
  shadow?: Shadow | null;
  shapeStyle?: string;
  rough?: boolean;
  roughness?: number;

  // State
  lockedBySelf?: boolean;
  hidden?: boolean;
}

// ============================================================================
// Text Element
// ============================================================================

export interface TextElement extends BaseElement {
  type: 'text';

  // Position
  xywh: number[] | string; // [x, y, width, height]
  rotate: number;

  // Content
  text: string;
  textAlign: 'left' | 'center' | 'right';

  // Typography
  color: string | { dark: string; light: string };
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: 'normal' | 'italic';

  // Sizing
  hasMaxWidth: boolean;

  // State
  lockedBySelf?: boolean;
}

// ============================================================================
// Group Element
// ============================================================================

export interface GroupElement extends BaseElement {
  type: 'group';
  title: string;
  children: Record<string, boolean | { index?: string; parent?: string; collapsed?: boolean }>;
}

// ============================================================================
// Mindmap Element
// ============================================================================

export interface MindmapElement extends BaseElement {
  type: 'mindmap';
  layoutType: number;
  style: number;
  children: Record<string, {
    index: string;
    parent?: string;
    collapsed?: boolean;
  }>;
}

// ============================================================================
// Union Type
// ============================================================================

export type EdgelessElement =
  | ConnectorElement
  | ShapeElement
  | TextElement
  | GroupElement
  | MindmapElement;

// ============================================================================
// Input Types for Creation
// ============================================================================

export interface CreateConnectorInput {
  sourceId: string;
  sourcePosition?: [number, number];
  targetId: string;
  targetPosition?: [number, number];
  stroke?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  strokeWidth?: number;
  frontEndpointStyle?: string;
  rearEndpointStyle?: string;
  text?: string;
  rough?: boolean;
}

export interface CreateShapeInput {
  shapeType: ShapeType;
  xywh: number[]; // [x, y, width, height]
  text?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  rotate?: number;
  radius?: number;
  fontSize?: number;
  fontWeight?: string;
  textAlign?: 'left' | 'center' | 'right';
}

export interface CreateTextInput {
  text: string;
  xywh: number[]; // [x, y, width, height]
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  color?: string | { dark: string; light: string };
  textAlign?: 'left' | 'center' | 'right';
  rotate?: number;
}

export interface CreateGroupInput {
  title: string;
  children: Record<string, boolean>;
}

export interface CreateMindmapInput {
  layoutType?: number;
  style?: number;
  rootNodeId: string;
}

export interface CreateBrushInput {
  points: number[][];
  color?: string;
  lineWidth?: number;
  rotate?: number;
  xywh?: number[] | string;
}

export type CreateElementInput =
  | ({ type: 'connector' } & CreateConnectorInput)
  | ({ type: 'shape' } & CreateShapeInput)
  | ({ type: 'brush' } & CreateBrushInput)
  | ({ type: 'text' } & CreateTextInput)
  | ({ type: 'group' } & CreateGroupInput)
  | ({ type: 'mindmap' } & CreateMindmapInput);

// ============================================================================
// Response Types
// ============================================================================

export interface EdgelessResponse {
  docId: string;
  surfaceId: string;
  elements: EdgelessElement[];
  count: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function parseXYWH(xywh: string | number[]): number[] {
  if (Array.isArray(xywh)) return xywh;
  return JSON.parse(xywh);
}

export function serializeXYWH(xywh: number[]): string {
  return JSON.stringify(xywh);
}

export function isConnectorElement(element: EdgelessElement): element is ConnectorElement {
  return element.type === 'connector';
}

export function isShapeElement(element: EdgelessElement): element is ShapeElement {
  return element.type === 'shape';
}

export function isTextElement(element: EdgelessElement): element is TextElement {
  return element.type === 'text';
}

export function isGroupElement(element: EdgelessElement): element is GroupElement {
  return element.type === 'group';
}

export function isMindmapElement(element: EdgelessElement): element is MindmapElement {
  return element.type === 'mindmap';
}
