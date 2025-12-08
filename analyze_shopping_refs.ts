import { AffineClient } from './src/client/index.js';
import * as Y from 'yjs';

const workspaceId = 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const shoppingDocId = 'vttLpxLrkfTiL5mLMknhf';

async function main() {
  const client = new AffineClient();

  try {
    const email = 'gillespinault@gmail.com';
    const password = 'AFFiNE56554ine*';

    await client.signIn(email, password);
    await client.connectSocket();
    await client.joinWorkspace(workspaceId);

    console.log('=== Analyzing Shopping document for references ===\n');

    const { doc } = await client.loadWorkspaceDoc(workspaceId, shoppingDocId);

    console.log('Document loaded. Analyzing blocks...\n');

    // Get the blocks Map
    const blocksMap = doc.getMap('blocks');
    if (!blocksMap) {
      console.log('No blocks map found');
      return;
    }

    console.log(`Found ${blocksMap.size} blocks\n`);

    let foundReferences = false;

    // Iterate through all blocks
    blocksMap.forEach((blockValue, blockId) => {
      if (!(blockValue instanceof Y.Map)) return;

      const flavour = blockValue.get('sys:flavour');
      const propsMap = blockValue.get('prop:text');

      if (propsMap && propsMap instanceof Y.Text) {
        const text = propsMap.toString();
        const delta = propsMap.toDelta();

        // Check if delta contains references
        const hasReferences = delta.some((op: any) =>
          op.attributes?.reference?.type === 'LinkedPage'
        );

        if (hasReferences || text.includes('ZBcRJwoMfg91W96LwzdWT')) {
          foundReferences = true;
          console.log(`[Block ${blockId}] (${flavour})`);
          console.log(`  Text: ${text}`);
          console.log(`  Delta:`, JSON.stringify(delta, null, 2));
          console.log();
        }
      }
    });

    if (!foundReferences) {
      console.log('No references found in text deltas. Checking all block props...\n');

      blocksMap.forEach((blockValue, blockId) => {
        if (!(blockValue instanceof Y.Map)) return;

        const flavour = blockValue.get('sys:flavour');
        console.log(`[Block ${blockId}] (${flavour})`);

        blockValue.forEach((value, key) => {
          if (key.startsWith('prop:')) {
            console.log(`  ${key}:`, typeof value, value instanceof Y.Text ? value.toString() : '');
          }
        });
        console.log();
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.disconnect();
  }
}

main();
