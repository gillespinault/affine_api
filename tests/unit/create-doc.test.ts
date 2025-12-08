import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDocYStructure, nanoid } from '../../src/client';

describe('createDocYStructure', () => {
  it('seeds a page with title, note, and paragraph blocks', () => {
    const docId = nanoid();
    const title = 'Unit Test Note';
    const content = 'Hello from Vitest';

    const { ydoc, timestamp } = createDocYStructure({
      docId,
      title,
      content,
      userId: 'unit-user',
      timestamp: 1700000000000,
    });

    expect(timestamp).toBe(1700000000000);

    const meta = ydoc.getMap('meta');
    expect(meta.get('id')).toBe(docId);
    expect(meta.get('title')).toBe(title);

    const blocks = ydoc.getMap('blocks');
    const blockValues = Array.from(blocks.values());

    const flavours = blockValues
      .filter((value): value is Y.Map<unknown> => value instanceof Y.Map)
      .map(value => value.get('sys:flavour'));

    expect(flavours).toEqual(
      expect.arrayContaining(['affine:page', 'affine:note', 'affine:paragraph']),
    );

    const paragraph = blockValues.find(
      value => value instanceof Y.Map && value.get('sys:flavour') === 'affine:paragraph',
    ) as Y.Map<unknown> | undefined;
    expect(paragraph).toBeDefined();

    const text = paragraph?.get('prop:text');
    expect(text).toBeInstanceOf(Y.Text);
    expect((text as Y.Text).toString()).toBe(content);
  });
});
