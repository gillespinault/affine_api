/**
 * Karakeep Webhook Handler
 * Receives webhook events from Karakeep and creates AFFiNE documents with zettels
 *
 * Enhanced workflow:
 * 1. Create parent document with metadata, summary, and full article text
 * 2. Set tags in document properties (Info panel)
 * 3. Create zettel documents with LinkedPage back to parent (bidirectional)
 * 4. Update parent with "Insights" section containing LinkedPage to each zettel
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { KarakeepClient, type KarakeepWebhookPayload, type KarakeepBookmark } from '../../client/karakeep/index.js';
import { ZettelGenerator, type Zettel } from './zettel-generator.js';
import { AffineClient } from '../../client/index.js';

export interface KarakeepWebhookConfig {
  // Karakeep
  karakeepApiUrl: string;
  karakeepApiKey: string;
  webhookSecret: string;

  // Gemini for zettel generation
  geminiApiKey: string;

  // AFFiNE
  affineBaseUrl: string;
  affineEmail: string;
  affinePassword: string;
  affineWorkspaceId: string;
  affineFolderId?: string | null;        // Folder for parent articles (Bookmarks)
  affineZettelsFolderId?: string | null; // Folder for zettels (Bookmarks/Zettels)
}

interface ProcessResult {
  success: boolean;
  bookmarkId: string;
  title: string;
  parentDocId?: string;
  zettelDocIds?: string[];
  zettelCount: number;
  error?: string;
}

interface CreatedZettel {
  docId: string;
  title: string;
  noteId: string;
}

/**
 * Format the parent document markdown content
 * Includes: Metadata, Summary, Full Article Text
 * (Insights section with LinkedPage will be added separately)
 */
function formatParentMarkdown(bookmark: KarakeepBookmark): string {
  const url = bookmark.content.type === 'link' ? bookmark.content.url : null;
  const summary = bookmark.summary;
  const author = bookmark.content.type === 'link' ? bookmark.content.author : null;
  const publisher = bookmark.content.type === 'link' ? bookmark.content.publisher : null;
  const datePublished = bookmark.content.type === 'link' ? bookmark.content.datePublished : null;
  const fullText = KarakeepClient.extractTextContent(bookmark);

  const lines: string[] = [];

  // Metadata section
  lines.push('## Metadata');
  if (url) lines.push(`- **Source**: [${url}](${url})`);
  if (author) lines.push(`- **Author**: ${author}`);
  if (publisher) lines.push(`- **Publisher**: ${publisher}`);
  if (datePublished) {
    const date = new Date(datePublished).toLocaleDateString('fr-FR');
    lines.push(`- **Published**: ${date}`);
  }
  lines.push(`- **Imported**: ${new Date().toLocaleDateString('fr-FR')}`);
  lines.push(`- **Karakeep ID**: ${bookmark.id}`);
  lines.push('');

  // Summary section
  if (summary) {
    lines.push('## Summary');
    lines.push(summary);
    lines.push('');
  }

  // Full article text
  if (fullText && fullText.length > 100) {
    lines.push('## Full Article');
    lines.push(fullText);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a zettel document markdown content
 * (LinkedPage to parent will be added separately)
 */
function formatZettelMarkdown(zettel: Zettel): string {
  const lines: string[] = [];

  lines.push(zettel.body);
  lines.push('');
  lines.push('---');

  return lines.join('\n');
}

/**
 * Process a crawled bookmark: generate zettels and create AFFiNE documents
 * with bidirectional links
 */
async function processBookmark(
  bookmark: KarakeepBookmark,
  config: KarakeepWebhookConfig,
): Promise<ProcessResult> {
  const title = KarakeepClient.getTitle(bookmark);
  const content = KarakeepClient.extractTextContent(bookmark);
  const tags = KarakeepClient.getTagNames(bookmark);

  // Skip if content is too short
  if (content.length < 100) {
    return {
      success: false,
      bookmarkId: bookmark.id,
      title,
      zettelCount: 0,
      error: 'Content too short for zettel extraction',
    };
  }

  // Generate zettels using Gemini
  const generator = new ZettelGenerator({
    apiKey: config.geminiApiKey,
  });

  const zettels = await generator.generate(content, {
    title,
    summary: bookmark.summary ?? undefined,
    url: bookmark.content.type === 'link' ? bookmark.content.url : undefined,
    existingTags: tags,
  });

  if (zettels.length === 0) {
    return {
      success: false,
      bookmarkId: bookmark.id,
      title,
      zettelCount: 0,
      error: 'No zettels generated',
    };
  }

  // Create AFFiNE documents with bidirectional links
  const affineClient = new AffineClient({
    baseUrl: config.affineBaseUrl,
  });

  try {
    await affineClient.signIn(config.affineEmail, config.affinePassword);
    await affineClient.connectSocket();
    await affineClient.joinWorkspace(config.affineWorkspaceId);

    // ============================================================
    // STEP 1: Create parent document with metadata and full text
    // ============================================================
    const parentMarkdown = formatParentMarkdown(bookmark);
    const parentDoc = await affineClient.createDocumentWithStructure(config.affineWorkspaceId, {
      title,
      markdown: parentMarkdown,
      folderId: config.affineFolderId ?? null,
      tags,
    });

    // Set tags in document properties (shows in Info panel)
    await affineClient.upsertDocProperties(config.affineWorkspaceId, {
      docId: parentDoc.docId,
      timestamp: Date.now(),
      tags,
    });

    // ============================================================
    // STEP 2: Create zettel documents with LinkedPage to parent
    // ============================================================
    const createdZettels: CreatedZettel[] = [];

    for (const zettel of zettels) {
      const zettelMarkdown = formatZettelMarkdown(zettel);

      // Create zettel document in the Zettels subfolder
      const zettelDoc = await affineClient.createDocumentWithStructure(config.affineWorkspaceId, {
        title: zettel.title,
        markdown: zettelMarkdown,
        folderId: config.affineZettelsFolderId ?? config.affineFolderId ?? null,
        tags: zettel.tags,
      });

      // Set zettel tags in document properties
      await affineClient.upsertDocProperties(config.affineWorkspaceId, {
        docId: zettelDoc.docId,
        timestamp: Date.now(),
        tags: zettel.tags,
      });

      // Add LinkedPage reference back to parent document
      await affineClient.addParagraphWithDocLink(
        config.affineWorkspaceId,
        zettelDoc.docId,
        {
          parentBlockId: zettelDoc.noteId,
          linkedDocId: parentDoc.docId,
          linkText: title,
          prefixText: 'Source: ',
        },
      );

      createdZettels.push({
        docId: zettelDoc.docId,
        title: zettel.title,
        noteId: zettelDoc.noteId,
      });
    }

    // ============================================================
    // STEP 3: Update parent with "Insights" section + embedded zettels
    // ============================================================

    // Add "Insights" heading
    await affineClient.addBlock(config.affineWorkspaceId, parentDoc.docId, {
      flavour: 'affine:paragraph',
      parentBlockId: parentDoc.noteId,
      props: {
        type: 'h2',
        text: `Insights (${createdZettels.length} zettels)`,
      },
    });

    // Add embedded synced doc blocks for each zettel (inline preview)
    await affineClient.addEmbeddedSyncedDocsList(
      config.affineWorkspaceId,
      parentDoc.docId,
      {
        parentBlockId: parentDoc.noteId,
        embeddedDocs: createdZettels.map(z => ({ docId: z.docId, title: z.title })),
      },
    );

    return {
      success: true,
      bookmarkId: bookmark.id,
      title,
      parentDocId: parentDoc.docId,
      zettelDocIds: createdZettels.map(z => z.docId),
      zettelCount: createdZettels.length,
    };
  } finally {
    await affineClient.disconnect();
  }
}

/**
 * Validate webhook authorization
 */
function validateWebhook(request: FastifyRequest, secret: string): boolean {
  const authHeader = request.headers.authorization;
  if (!authHeader) return false;

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer') return false;

  return token === secret;
}

/**
 * Register Karakeep webhook routes
 */
export function registerKarakeepWebhook(
  app: FastifyInstance,
  config: KarakeepWebhookConfig,
): void {
  const karakeepClient = new KarakeepClient({
    baseUrl: config.karakeepApiUrl,
    apiKey: config.karakeepApiKey,
  });

  /**
   * POST /webhooks/karakeep
   * Receive webhook events from Karakeep
   */
  app.post('/webhooks/karakeep', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate webhook secret
    if (!validateWebhook(request, config.webhookSecret)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const payload = request.body as KarakeepWebhookPayload;

    app.log.info({
      msg: 'Karakeep webhook received',
      operation: payload.operation,
      bookmarkId: payload.bookmarkId,
      jobId: payload.jobId,
    });

    // Only process 'crawled' events (content is ready)
    if (payload.operation !== 'crawled') {
      return reply.send({
        received: true,
        skipped: true,
        reason: `Operation '${payload.operation}' ignored, only 'crawled' is processed`,
      });
    }

    try {
      // Fetch full bookmark data
      const bookmark = await karakeepClient.getBookmark(payload.bookmarkId);

      // Process and create AFFiNE documents with bidirectional links
      const result = await processBookmark(bookmark, config);

      if (result.success) {
        app.log.info({
          msg: 'Bookmark processed successfully',
          bookmarkId: result.bookmarkId,
          title: result.title,
          parentDocId: result.parentDocId,
          zettelDocIds: result.zettelDocIds,
          zettelCount: result.zettelCount,
        });
      } else {
        app.log.warn({
          msg: 'Bookmark processing failed',
          bookmarkId: result.bookmarkId,
          error: result.error,
        });
      }

      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.log.error({
        msg: 'Webhook processing error',
        bookmarkId: payload.bookmarkId,
        error: message,
      });

      return reply.code(500).send({
        success: false,
        bookmarkId: payload.bookmarkId,
        error: message,
      });
    }
  });

  /**
   * GET /webhooks/karakeep/health
   * Health check for the webhook endpoint
   */
  app.get('/webhooks/karakeep/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Test Karakeep API connectivity
      await karakeepClient.listBookmarks({ limit: 1 });
      return reply.send({ status: 'ok', karakeep: 'connected' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(503).send({ status: 'error', karakeep: message });
    }
  });

  /**
   * POST /webhooks/karakeep/test/:bookmarkId
   * Manually trigger processing for a specific bookmark (for testing)
   */
  app.post('/webhooks/karakeep/test/:bookmarkId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { bookmarkId } = request.params as { bookmarkId: string };

    try {
      const bookmark = await karakeepClient.getBookmark(bookmarkId);
      const result = await processBookmark(bookmark, config);
      return reply.send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({
        success: false,
        bookmarkId,
        error: message,
      });
    }
  });
}
