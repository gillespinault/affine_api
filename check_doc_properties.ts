import { AffineClient } from './src/client/index.js';

const workspaceId = 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const subdocs = [
  { name: 'Running Shoes', docId: 'ZBcRJwoMfg91W96LwzdWT' },
  { name: 'Quartier', docId: 'JZZfsyqAjoZFgXG-CNlDY' },
  { name: 'Earbuds', docId: '87bLhYJ04YEqFBgWtXm9S' }
];

async function main() {
  const client = new AffineClient();

  try {
    const email = 'gillespinault@gmail.com';
    const password = 'AFFiNE56554ine*';

    await client.signIn(email, password);
    await client.connectSocket();
    await client.joinWorkspace(workspaceId);

    console.log('=== Checking docProperties for subdocs ===\n');

    const docPropsId = `db$${workspaceId}$docProperties`;
    const { doc } = await client.loadWorkspaceDoc(workspaceId, docPropsId);

    for (const subdoc of subdocs) {
      console.log(`\n[${subdoc.name}] (${subdoc.docId})`);

      const propsMap = doc.getMap(subdoc.docId);
      if (!propsMap || propsMap.size === 0) {
        console.log('  No properties found');
        continue;
      }

      console.log('  Properties:');
      propsMap.forEach((value, key) => {
        console.log(`    ${key}: ${JSON.stringify(value)}`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.disconnect();
  }
}

main();
