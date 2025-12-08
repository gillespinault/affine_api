/**
 * Karakeep API Client
 * Fetches bookmark data from Karakeep REST API
 */

import type {
  KarakeepBookmark,
  KarakeepListResponse,
} from './types.js';

export interface KarakeepClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class KarakeepClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: KarakeepClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Karakeep API error ${response.status}: ${text}`);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get a single bookmark by ID
   */
  async getBookmark(bookmarkId: string): Promise<KarakeepBookmark> {
    return this.request<KarakeepBookmark>(`/api/v1/bookmarks/${bookmarkId}`);
  }

  /**
   * List bookmarks with optional pagination
   */
  async listBookmarks(options?: {
    limit?: number;
    cursor?: string;
    archived?: boolean;
    favourited?: boolean;
  }): Promise<KarakeepListResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.cursor) params.set('cursor', options.cursor);
    if (options?.archived !== undefined) params.set('archived', options.archived.toString());
    if (options?.favourited !== undefined) params.set('favourited', options.favourited.toString());

    const query = params.toString();
    const endpoint = `/api/v1/bookmarks${query ? `?${query}` : ''}`;
    return this.request<KarakeepListResponse>(endpoint);
  }

  /**
   * Trigger re-summarization for a bookmark
   * (useful for existing bookmarks that were crawled before auto-summarization was enabled)
   */
  async resummmarize(bookmarkId: string): Promise<void> {
    await this.request(`/api/v1/bookmarks/${bookmarkId}/summarize`, {
      method: 'POST',
    });
  }

  /**
   * Extract clean text content from bookmark
   * Removes HTML tags and returns plain text
   */
  static extractTextContent(bookmark: KarakeepBookmark): string {
    if (bookmark.content.type === 'text') {
      return bookmark.content.text || '';
    }

    // For link content, prefer htmlContent, fallback to description
    const htmlContent = bookmark.content.htmlContent;
    if (htmlContent) {
      // Simple HTML to text conversion
      return htmlContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    }

    return bookmark.content.description || '';
  }

  /**
   * Get tag names from bookmark
   */
  static getTagNames(bookmark: KarakeepBookmark): string[] {
    return bookmark.tags.map(tag => tag.name);
  }

  /**
   * Get effective title (with fallback)
   */
  static getTitle(bookmark: KarakeepBookmark): string {
    if (bookmark.title) return bookmark.title;
    if (bookmark.content.type === 'link') {
      return bookmark.content.title || bookmark.content.url;
    }
    return 'Untitled';
  }
}
