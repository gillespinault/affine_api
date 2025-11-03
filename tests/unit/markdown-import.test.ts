import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDocYStructureFromMarkdown } from '../../src/client';

const SAMPLE_MARKDOWN = `# Heading 1

Paragraph text here.

- First bullet
- Second bullet
~~~js
console.log('hello');
~~~
`;

const TABLE_MARKDOWN = `| Name | Value |
| --- | --- |
| Foo | 123 |
`;

describe('createDocYStructureFromMarkdown', () => {
  it('creates blocks matching markdown structure', () => {
    const { ydoc, title } = createDocYStructureFromMarkdown({
      docId: 'doc-md-test',
      markdown: SAMPLE_MARKDOWN,
      userId: 'markdown-user',
    });

    expect(title).toBe('Heading 1');

    const blocks = ydoc.getMap('blocks');
    const entries = Array.from(blocks.entries());
    const noteEntry = entries.find(([, value]) => value.get('sys:flavour') === 'affine:note');
    expect(noteEntry).toBeDefined();
    const noteMap = noteEntry?.[1] as Y.Map<unknown>;
    const rawChildren = (noteMap.get('sys:children') as Y.Array<unknown>).toArray();
    expect(rawChildren.length).toBe(5);

    const childIds = rawChildren.map(child =>
      Array.isArray(child) ? child[0] : (child as string),
    );
    const childBlocks = childIds.map(id => blocks.get(id) as Y.Map<unknown>);
    const headingBlock = childBlocks[0];
    expect(headingBlock.get('sys:flavour')).toBe('affine:paragraph');
    expect(headingBlock.get('prop:type')).toBe('h1');

    const paragraphBlock = childBlocks[1];
    expect(paragraphBlock.get('prop:type')).toBe('text');
    const paragraphText = paragraphBlock.get('prop:text');
    expect(paragraphText).toBeInstanceOf(Y.Text);
    expect((paragraphText as Y.Text).toString()).toContain('Paragraph text here');

    const listBlock = childBlocks[2];
    expect(listBlock.get('sys:flavour')).toBe('affine:list');
    expect(listBlock.get('prop:type')).toBe('bulleted');
    const firstListText = listBlock.get('prop:text');
    expect(firstListText).toBeInstanceOf(Y.Text);
    expect((firstListText as Y.Text).toString()).toBe('First bullet');

    const secondListBlock = childBlocks[3];
    const secondListText = secondListBlock.get('prop:text');
    expect(secondListText).toBeInstanceOf(Y.Text);
    expect((secondListText as Y.Text).toString()).toBe('Second bullet');

    const codeBlock = childBlocks[4];
    expect(codeBlock.get('sys:flavour')).toBe('affine:code');
    expect(codeBlock.get('prop:language')).toBe('js');
    const codeText = codeBlock.get('prop:text');
    expect(codeText).toBeInstanceOf(Y.Text);
    expect((codeText as Y.Text).toString()).toContain("console.log('hello');");
  });

  it('uses fallback title when markdown lacks heading', () => {
    const { title } = createDocYStructureFromMarkdown({
      docId: 'doc-fallback',
      markdown: '* bullet only',
      userId: 'md-user',
    });

    expect(title).toBe('bullet only');
  });

  it('converts markdown tables into affine table blocks', () => {
    const { ydoc } = createDocYStructureFromMarkdown({
      docId: 'doc-table',
      markdown: TABLE_MARKDOWN,
      userId: 'md-user',
    });

    const blocks = ydoc.getMap('blocks');
    const allBlocks = Array.from(blocks.values());
    const tableBlock = allBlocks.find(
      value => value instanceof Y.Map && value.get('sys:flavour') === 'affine:table',
    ) as Y.Map<unknown> | undefined;

    expect(tableBlock, 'table block should exist').toBeDefined();

    const keys = Array.from(tableBlock!.keys()).filter(
      (key): key is string => typeof key === 'string',
    );

    const rowIds = keys
      .filter(key => key.startsWith('prop:rows.') && key.endsWith('.rowId'))
      .map(key => tableBlock!.get(key) as string);
    const columnIds = keys
      .filter(key => key.startsWith('prop:columns.') && key.endsWith('.columnId'))
      .map(key => tableBlock!.get(key) as string);

    expect(rowIds.length).toBeGreaterThanOrEqual(2);
    expect(columnIds.length).toBe(2);

    const [headerRowId, firstDataRowId] = rowIds;
    const [firstColumnId, secondColumnId] = columnIds;

    expect(tableBlock!.get(`prop:cells.${headerRowId}:${firstColumnId}.text`)).toBe('Name');
    expect(tableBlock!.get(`prop:cells.${headerRowId}:${secondColumnId}.text`)).toBe('Value');
    expect(tableBlock!.get(`prop:cells.${firstDataRowId}:${firstColumnId}.text`)).toBe('Foo');
    expect(tableBlock!.get(`prop:cells.${firstDataRowId}:${secondColumnId}.text`)).toBe('123');
  });
});
