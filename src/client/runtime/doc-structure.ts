import * as Y from 'yjs';

export function nanoid(size = 21) {
  const alphabet =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < size; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

type CreateDocInput = {
  docId: string;
  title: string;
  content?: string;
  userId: string;
  timestamp?: number;
};

export interface CreateDocResult {
  ydoc: Y.Doc;
  timestamp: number;
}

export function createDocYStructure({
  docId,
  title,
  content,
  userId,
  timestamp,
}: CreateDocInput): CreateDocResult {
  const now = timestamp ?? Date.now();
  const pageId = nanoid();
  const surfaceId = nanoid();
  const noteId = nanoid();
  const paragraphId = nanoid();

  const ydoc = new Y.Doc({ guid: docId });
  const blocks = ydoc.getMap<unknown>('blocks');
  const meta = ydoc.getMap<unknown>('meta');

  const titleText = new Y.Text();
  titleText.insert(0, title);

  const pageChildren = new Y.Array<string>();
  pageChildren.push([surfaceId, noteId]);

  const pageMap = new Y.Map<unknown>();
  pageMap.set('sys:id', pageId);
  pageMap.set('sys:flavour', 'affine:page');
  pageMap.set('prop:title', titleText);
  pageMap.set('sys:children', pageChildren);
  blocks.set(pageId, pageMap);

  const surfaceChildren = new Y.Array<string>();
  const surfaceMap = new Y.Map<unknown>();
  surfaceMap.set('sys:id', surfaceId);
  surfaceMap.set('sys:flavour', 'affine:surface');
  surfaceMap.set('sys:parent', pageId);
  surfaceMap.set('sys:children', surfaceChildren);

  // Initialize elements with Y.Map value for proper CRDT synchronization
  // The wrapper must be plain object for AFFiNE UI compatibility
  // But the value must be Y.Map for elements to persist
  surfaceMap.set('prop:elements', {
    type: '$blocksuite:internal:native$',
    value: new Y.Map<unknown>(),
  });

  blocks.set(surfaceId, surfaceMap);

  const noteChildren = new Y.Array<string>();
  noteChildren.push([paragraphId]);

  const noteMap = new Y.Map<unknown>();
  noteMap.set('sys:id', noteId);
  noteMap.set('sys:flavour', 'affine:note');
  noteMap.set('sys:parent', pageId);
  noteMap.set('sys:children', noteChildren);
  noteMap.set('prop:background', { dark: '#252525', light: '#ffffff' });
  noteMap.set('prop:hidden', false);
  noteMap.set('prop:displayMode', 'DocAndEdgeless');
  noteMap.set('prop:xywh', '[0,0,800,600]');
  noteMap.set('prop:index', 'a0');
  noteMap.set('prop:lockedBySelf', false);
  noteMap.set('prop:edgeless', {
    style: {
      borderRadius: 8,
      borderSize: 4,
      borderStyle: 'none',
      shadowType: '--affine-note-shadow-box',
    },
  });
  blocks.set(noteId, noteMap);

  const paragraphMap = new Y.Map<unknown>();
  paragraphMap.set('sys:id', paragraphId);
  paragraphMap.set('sys:flavour', 'affine:paragraph');
  paragraphMap.set('sys:parent', noteId);
  paragraphMap.set('sys:children', new Y.Array());
  paragraphMap.set('prop:type', 'text');
  const paragraphText = new Y.Text();
  paragraphText.insert(0, content || '');
  paragraphMap.set('prop:text', paragraphText);
  const metaPrefix = 'prop:meta:';
  paragraphMap.set(`${metaPrefix}createdAt`, now);
  paragraphMap.set(`${metaPrefix}createdBy`, userId);
  paragraphMap.set(`${metaPrefix}updatedAt`, now);
  paragraphMap.set(`${metaPrefix}updatedBy`, userId);
  paragraphMap.set('prop:collapsed', false);
  blocks.set(paragraphId, paragraphMap);

  const tags = new Y.Array();
  meta.set('id', docId);
  meta.set('title', title);
  meta.set('createDate', now);
  meta.set('tags', tags);

  return { ydoc, timestamp: now };
}
