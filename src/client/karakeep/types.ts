/**
 * Karakeep API Types
 * Based on API v1 documentation
 */

export interface KarakeepTag {
  id: string;
  name: string;
  attachedBy: 'ai' | 'human';
}

export interface KarakeepAsset {
  id: string;
  assetType: 'screenshot' | 'bannerImage' | 'linkHtmlContent';
  fileName: string | null;
}

export interface KarakeepLinkContent {
  type: 'link';
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  imageAssetId: string | null;
  screenshotAssetId: string | null;
  favicon: string | null;
  htmlContent: string | null;
  contentAssetId: string | null;
  crawledAt: string | null;
  author: string | null;
  publisher: string | null;
  datePublished: string | null;
  dateModified: string | null;
}

export interface KarakeepTextContent {
  type: 'text';
  text: string;
  sourceUrl: string | null;
}

export type KarakeepContent = KarakeepLinkContent | KarakeepTextContent;

export interface KarakeepBookmark {
  id: string;
  createdAt: string;
  modifiedAt: string | null;
  title: string | null;
  archived: boolean;
  favourited: boolean;
  taggingStatus: 'pending' | 'success' | 'failure';
  summarizationStatus: 'pending' | 'success' | 'failure';
  note: string | null;
  summary: string | null;
  source: string;
  userId: string;
  tags: KarakeepTag[];
  content: KarakeepContent;
  assets: KarakeepAsset[];
}

export interface KarakeepWebhookPayload {
  jobId: string;
  bookmarkId: string;
  type: string;
  userId: string;
  url: string;
  operation: 'created' | 'crawled' | 'tagged' | 'deleted' | 'changed';
}

export interface KarakeepListResponse {
  bookmarks: KarakeepBookmark[];
  nextCursor: string | null;
}
