import { AffineClient } from './src/client/runtime/affine-client.js';
import * as Y from 'yjs';

const WORKSPACE_ID = 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const SHOPPING_ID = 'vttLpxLrkfTiL5mLMknhf';
const RUNNING_SHOES_ID = 'ZBcRJwoMfg91W96LwzdWT';

async function inspectPagesStructure() {
  const client = new AffineClient('https://affine-api.robotsinlove.be');

  const email = process.env.AFFINE_EMAIL || 'gilles.pinault+ril@gmail.com';
  const password = process.env.AFFINE_PASSWORD || 'GBkz9p4g!';

  console.log('=== Signing in ===');
  await client.signIn(email, password);
  
  console.log('=== Connecting socket ===');
  await client.connectSocket();
  
  console.log('=== Joining workspace ===');
  await client.joinWorkspace(WORKSPACE_ID);
  
  console.log('=== Loading workspace doc ===');
  const workspaceDoc = await client.loadWorkspaceDoc(WORKSPACE_ID);
  
  const workspaceMeta = workspaceDoc.doc.getMap('meta');
  const pages = workspaceMeta.get('pages');
  
  console.log('\n=== Analyzing workspace.meta.pages structure ===\n');
  
  if (pages instanceof Y.Array) {
    for (let i = 0; i < pages.length; i++) {
      const rawEntry = pages.get(i);
      
      const pageEntry = (client as any).asYMap(rawEntry);
      if (!pageEntry) continue;
      
      const docId = pageEntry.get('id');
      
      if (docId === SHOPPING_ID) {
        console.log('=== Shopping document entry ===');
        console.log('Keys:', Array.from(pageEntry.keys()));
        pageEntry.forEach((value: any, key: string) => {
          console.log(`  ${key}:`, value);
        });
      }
      
      if (docId === RUNNING_SHOES_ID) {
        console.log('\n=== Running Shoes document entry ===');
        console.log('Keys:', Array.from(pageEntry.keys()));
        pageEntry.forEach((value: any, key: string) => {
          console.log(`  ${key}:`, value);
        });
      }
    }
  }
  
  client.disconnect();
}

inspectPagesStructure().catch(console.error);
