import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import * as Y from 'yjs';

import { createDocYStructure, nanoid } from '../runtime/doc-structure';

const markdownParser = unified().use(remarkParse).use(remarkGfm);

type MarkdownBlockSpec =
  | {
      kind: 'paragraph';
      headingLevel: null | 1 | 2 | 3;
      text: string;
    }
  | {
      kind: 'list';
      ordered: boolean;
      text: string;
      order?: number;
    }
  | {
      kind: 'code';
      language: string | null;
      text: string;
    }
  | {
      kind: 'table';
      rows: string[][];
    };

type ParagraphBlock = Extract<MarkdownBlockSpec, { kind: 'paragraph' }>;
type ListBlock = Extract<MarkdownBlockSpec, { kind: 'list' }>;
type CodeBlock = Extract<MarkdownBlockSpec, { kind: 'code' }>;
type TableBlock = Extract<MarkdownBlockSpec, { kind: 'table' }>;

function isParagraphBlock(block: MarkdownBlockSpec): block is ParagraphBlock {
  return block.kind === 'paragraph';
}

function isListBlock(block: MarkdownBlockSpec): block is ListBlock {
  return block.kind === 'list';
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function extractBlocks(markdown: string): MarkdownBlockSpec[] {
  const tree = markdownParser.parse(markdown);
  const blocks: MarkdownBlockSpec[] = [];

  for (const node of (tree as { children?: unknown[] }).children ?? []) {
    switch ((node as { type?: string }).type) {
      case 'heading': {
        const heading = node as { depth?: number };
        const depth = heading.depth ?? 1;
        if (depth > 3) {
          blocks.push({
            kind: 'paragraph',
            headingLevel: null,
            text: normalizeText(toString(node as never)),
          });
        } else {
          blocks.push({
            kind: 'paragraph',
            headingLevel: (depth as 1 | 2 | 3) ?? 1,
            text: normalizeText(toString(node as never)),
          });
        }
        break;
      }
      case 'paragraph': {
        const text = normalizeText(toString(node as never));
        if (text.length) {
          blocks.push({
            kind: 'paragraph',
            headingLevel: null,
            text,
          });
        }
        break;
      }
      case 'code': {
        const codeNode = node as { lang?: string; value?: string };
        blocks.push({
          kind: 'code',
          language: codeNode.lang ?? null,
          text: (codeNode.value ?? '').replace(/\r\n/g, '\n'),
        });
        break;
      }
      case 'list': {
        const listNode = node as {
          ordered?: boolean;
          children?: Array<{ children?: unknown[] }>;
        };
        (listNode.children ?? []).forEach((item, index) => {
          const text = normalizeText(toString(item as never));
          if (!text) {
            return;
          }
          blocks.push({
            kind: 'list',
            ordered: Boolean(listNode.ordered),
            text,
            order: listNode.ordered ? index + 1 : undefined,
          });
        });
        break;
      }
      case 'table': {
        const tableNode = node as {
          children?: Array<{ children?: Array<{ children?: unknown[] }> }>;
        };
        const rows =
          tableNode.children?.map(row => {
            return (row.children ?? []).map(cell =>
              normalizeText(toString(cell as never)),
            );
          }) ?? [];
        if (rows.length) {
          blocks.push({
            kind: 'table',
            rows,
          });
        }
        break;
      }
      case 'blockquote': {
        visit(node as never, 'paragraph', child => {
          const text = normalizeText(toString(child as never));
          if (text) {
            blocks.push({
              kind: 'paragraph',
              headingLevel: null,
              text,
            });
          }
        });
        break;
      }
      default:
        break;
    }
  }

  return blocks;
}

type MarkdownDocOptions = {
  docId: string;
  title?: string | null;
  markdown: string;
  userId: string;
  timestamp?: number;
};

export function createDocYStructureFromMarkdown(options: MarkdownDocOptions) {
  const { docId, title, markdown, userId, timestamp } = options;
  const extractedBlocks = extractBlocks(markdown);
  const headingParagraph = extractedBlocks.find(
    (block): block is ParagraphBlock =>
      block.kind === 'paragraph' && block.headingLevel != null,
  );
  const fallbackParagraph = extractedBlocks.find(isParagraphBlock);
  const fallbackList = extractedBlocks.find(isListBlock);
  const derivedTitle =
    title ??
    headingParagraph?.text ??
    fallbackParagraph?.text ??
    fallbackList?.text ??
    'Markdown import';

  const { ydoc, timestamp: docTimestamp } = createDocYStructure({
    docId,
    title: derivedTitle,
    content: '',
    userId,
    timestamp,
  });
  const effectiveTimestamp = docTimestamp;

  const blocks = ydoc.getMap<Y.Map<unknown>>('blocks');
  const pageEntries = Array.from(blocks.entries());
  const noteId =
    pageEntries.find(([, map]) => map.get('sys:flavour') === 'affine:note')?.[0] ??
    null;
  if (!noteId) {
    throw new Error('Missing note block in document scaffolding.');
  }

  const noteMap = blocks.get(noteId);
  if (!noteMap) {
    throw new Error('Missing note block in document scaffolding.');
  }

  const noteChildren = noteMap.get('sys:children') as Y.Array<unknown>;
  const existingChildren = noteChildren.toArray() as Array<string | string[]>;
  if (existingChildren.length) {
    noteChildren.delete(0, existingChildren.length);
    for (const child of existingChildren) {
      const childId = Array.isArray(child) ? child[0] : child;
      if (typeof childId === 'string') {
        blocks.delete(childId);
      }
    }
  }

  if (!extractedBlocks.length) {
    const blockId = nanoid();
    noteChildren.push([blockId]);
    const paragraph = new Y.Map();
    paragraph.set('sys:id', blockId);
    paragraph.set('sys:flavour', 'affine:paragraph');
    paragraph.set('sys:parent', noteId);
    paragraph.set('sys:children', new Y.Array());
    paragraph.set('prop:type', 'text');
    paragraph.set('prop:collapsed', false);
    const text = new Y.Text();
    paragraph.set('prop:text', text);
    blocks.set(blockId, paragraph);
    return { ydoc, timestamp: effectiveTimestamp, title: derivedTitle };
  }

  const metaPrefix = 'prop:meta:';
  for (const block of extractedBlocks) {
    const blockId = nanoid();
    noteChildren.push([blockId]);
    const map = new Y.Map<unknown>();
    map.set('sys:id', blockId);
    map.set('sys:parent', noteId);
    map.set('sys:children', new Y.Array());

    switch (block.kind) {
      case 'paragraph': {
        const paragraphBlock: ParagraphBlock = block;
        map.set('sys:flavour', 'affine:paragraph');
        const type =
          paragraphBlock.headingLevel === 1
            ? 'h1'
            : paragraphBlock.headingLevel === 2
              ? 'h2'
              : paragraphBlock.headingLevel === 3
                ? 'h3'
                : 'text';
        map.set('prop:type', type);
        map.set('prop:collapsed', false);
        const textNode = new Y.Text();
        textNode.insert(0, paragraphBlock.text);
        map.set('prop:text', textNode);
        map.set(`${metaPrefix}createdAt`, effectiveTimestamp);
        map.set(`${metaPrefix}updatedAt`, effectiveTimestamp);
        map.set(`${metaPrefix}createdBy`, userId);
        map.set(`${metaPrefix}updatedBy`, userId);
        break;
      }
      case 'list': {
        const listBlock: ListBlock = block;
        map.set('sys:flavour', 'affine:list');
        map.set('prop:type', listBlock.ordered ? 'numbered' : 'bulleted');
        map.set('prop:checked', false);
        map.set('prop:collapsed', false);
        map.set('prop:order', listBlock.ordered ? listBlock.order ?? null : null);
        const textNode = new Y.Text();
        textNode.insert(0, listBlock.text);
        map.set('prop:text', textNode);
        break;
      }
      case 'table': {
        const tableBlock: TableBlock = block;
        map.set('sys:flavour', 'affine:table');
        const rowCount = tableBlock.rows.length;
        const columnCount = tableBlock.rows.reduce(
          (max, current) => Math.max(max, current.length),
          0,
        );
        const rowIds = Array.from({ length: rowCount }, () => nanoid());
        const columnIds = Array.from({ length: columnCount }, () => nanoid());

        rowIds.forEach((rowId, rowIndex) => {
          map.set(`prop:rows.${rowId}.rowId`, rowId);
          map.set(
            `prop:rows.${rowId}.order`,
            `a${(rowIndex + 1).toString(36).padStart(5, '0')}`,
          );
        });

        columnIds.forEach((columnId, columnIndex) => {
          map.set(`prop:columns.${columnId}.columnId`, columnId);
          map.set(
            `prop:columns.${columnId}.order`,
            `a${(columnIndex + 1).toString(36).padStart(5, '0')}`,
          );
        });

        rowIds.forEach((rowId, rowIndex) => {
          const cells = tableBlock.rows[rowIndex] ?? [];
          columnIds.forEach((columnId, columnIndex) => {
            const cellText = cells[columnIndex] ?? '';
            map.set(`prop:cells.${rowId}:${columnId}.text`, cellText);
          });
        });
        break;
      }
      case 'code': {
        const codeBlock: CodeBlock = block;
        map.set('sys:flavour', 'affine:code');
        const textNode = new Y.Text();
        textNode.insert(0, codeBlock.text);
        map.set('prop:text', textNode);
        map.set('prop:language', codeBlock.language ?? 'plaintext');
        map.set('prop:wrap', false);
        map.set('prop:caption', '');
        break;
      }
    }

    blocks.set(blockId, map);
  }

  const meta = ydoc.getMap('meta');
  meta.set('title', derivedTitle);

  return { ydoc, timestamp: effectiveTimestamp, title: derivedTitle };
}
