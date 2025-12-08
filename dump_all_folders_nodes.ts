import { AffineClient } from './src/client/index.js';

const workspaceId = 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const email = process.env.AFFINE_EMAIL!;
const password = process.env.AFFINE_PASSWORD!;

async function main() {
  const client = new AffineClient();

  try {
    console.log('Signing in...');
    await client.signIn(email, password);

    console.log('Connecting socket...');
    await client.connectSocket();

    console.log('Joining workspace...');
    await client.joinWorkspace(workspaceId);

    console.log('\nLoading folders document...');
    const foldersId = `db$${workspaceId}$folders`;
    const { doc } = await client.loadWorkspaceDoc(workspaceId, foldersId);

    console.log('\n=== ALL NODES IN db$workspace$folders ===\n');

    let nodeCount = 0;
    let docTypeCount = 0;
    let folderTypeCount = 0;

    doc.share.forEach((_, nodeId) => {
      nodeCount++;
      const nodeMap = doc.getMap(nodeId);

      if (!nodeMap || nodeMap.size === 0) {
        console.log(`[${nodeId}] EMPTY MAP`);
        return;
      }

      const type = nodeMap.get('type');
      const data = nodeMap.get('data');
      const parentId = nodeMap.get('parentId');
      const index = nodeMap.get('index');

      if (type === 'doc') docTypeCount++;
      if (type === 'folder') folderTypeCount++;

      console.log(`[${nodeId}]`);
      console.log(`  type: ${type}`);
      console.log(`  data: ${data}`);
      console.log(`  parentId: ${parentId || 'null'}`);
      console.log(`  index: ${index}`);
      console.log();
    });

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total nodes: ${nodeCount}`);
    console.log(`Folders (type='folder'): ${folderTypeCount}`);
    console.log(`Docs (type='doc'): ${docTypeCount}`);

    // Now specifically search for Shopping's children
    console.log('\n=== SHOPPING CHILDREN (parentId=khWEUQyN4jmOdTM_SYimM) ===\n');
    const shoppingFolderNodeId = 'khWEUQyN4jmOdTM_SYimM';

    doc.share.forEach((_, nodeId) => {
      const nodeMap = doc.getMap(nodeId);
      if (!nodeMap || nodeMap.size === 0) return;

      const parentId = nodeMap.get('parentId');
      if (parentId === shoppingFolderNodeId) {
        const type = nodeMap.get('type');
        const data = nodeMap.get('data');
        console.log(`Found child: [${nodeId}]`);
        console.log(`  type: ${type}`);
        console.log(`  data: ${data}`);
        console.log();
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.disconnect();
  }
}

main();
