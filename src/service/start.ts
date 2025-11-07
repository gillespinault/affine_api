import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const AFFINE_BASE_URL = process.env.AFFINE_BASE_URL || 'https://affine.robotsinlove.be';

const HOST = process.env.HOST || '0.0.0.0';

const server = createServer({
  baseUrl: AFFINE_BASE_URL,
  logger: true,
});

server.listen({ port: PORT, host: HOST }, (err: Error | null, address: string) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`Server listening on ${address}`);
  server.log.info(`AFFiNE base URL: ${AFFINE_BASE_URL}`);
});
