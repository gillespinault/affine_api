import { AffineClient } from '../dist/client/index.js';

const TARGET_WORKSPACE_ID = process.env.AFFINE_DOC_WORKSPACE_ID ?? 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const TARGET_DOC_ID = process.env.AFFINE_DOC_ID ?? 'VAe6jRLPNernhJIfdmtrr';

async function main() {
  const email = process.env.AFFINE_EMAIL;
  const password = process.env.AFFINE_PASSWORD;
  if (!email || !password) {
    throw new Error('AFFINE_EMAIL and AFFINE_PASSWORD must be set.');
  }

  const client = new AffineClient();
  await client.signIn(email, password);
  await client.connectSocket();

  const content = await client.getDocumentContent(TARGET_WORKSPACE_ID, TARGET_DOC_ID);
  const noteBlock = content.blocks.find(block => block.flavour === 'affine:note');
  if (!noteBlock) {
    throw new Error('Unable to find note block to append documentation update.');
  }

  const timestamp = new Date().toISOString();
  const text = `Update ${timestamp}: Added document publish/revoke API endpoints plus smoke tests (tools/run-publication-smoke.mjs & tools/run-live-publication-smoke.mjs).`;

  await client.addBlock(TARGET_WORKSPACE_ID, TARGET_DOC_ID, {
    flavour: 'affine:paragraph',
    parentBlockId: noteBlock.id,
    position: 'end',
    props: {
      text,
    },
  });

  await client.disconnect();
  console.log('Affine documentation page updated with publication API note.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
