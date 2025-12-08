import { createServer } from './server.js';
import type { KarakeepWebhookConfig } from './webhooks/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const AFFINE_BASE_URL = process.env.AFFINE_BASE_URL || 'https://affine.robotsinlove.be';
const HOST = process.env.HOST || '0.0.0.0';

// Build Karakeep webhook config from environment (optional)
function getKarakeepWebhookConfig(): KarakeepWebhookConfig | undefined {
  const karakeepApiUrl = process.env.KARAKEEP_API_URL;
  const karakeepApiKey = process.env.KARAKEEP_API_KEY;
  const webhookSecret = process.env.KARAKEEP_WEBHOOK_SECRET;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const affineEmail = process.env.AFFINE_EMAIL;
  const affinePassword = process.env.AFFINE_PASSWORD;
  const affineWorkspaceId = process.env.AFFINE_WORKSPACE_ID;

  // All required fields must be present
  if (
    !karakeepApiUrl ||
    !karakeepApiKey ||
    !webhookSecret ||
    !geminiApiKey ||
    !affineEmail ||
    !affinePassword ||
    !affineWorkspaceId
  ) {
    console.log('Karakeep webhook not configured (missing environment variables)');
    return undefined;
  }

  return {
    karakeepApiUrl,
    karakeepApiKey,
    webhookSecret,
    geminiApiKey,
    affineBaseUrl: AFFINE_BASE_URL,
    affineEmail,
    affinePassword,
    affineWorkspaceId,
    affineFolderId: process.env.AFFINE_KARAKEEP_FOLDER_ID || null,
    affineZettelsFolderId: process.env.AFFINE_KARAKEEP_ZETTELS_FOLDER_ID || null,
  };
}

const karakeepWebhook = getKarakeepWebhookConfig();

const server = createServer({
  baseUrl: AFFINE_BASE_URL,
  logger: true,
  karakeepWebhook,
});

server.listen({ port: PORT, host: HOST }, (err: Error | null, address: string) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`Server listening on ${address}`);
  server.log.info(`AFFiNE base URL: ${AFFINE_BASE_URL}`);
  if (karakeepWebhook) {
    server.log.info(`Karakeep webhook enabled for workspace: ${karakeepWebhook.affineWorkspaceId}`);
  }
});
