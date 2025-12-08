import { AffineClient } from '../src/client';
import * as Y from 'yjs';

type BlockSummary = {
  flavour: string | null;
  text?: string;
  isYText?: boolean;
  order?: unknown;
  type?: unknown;
  rows?: number;
  columns?: number;
  sample?: unknown;
};

const workspaceId = 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const folderId = 'Sif6m2iLTXMPqw47IULGE';

const markdown = `# API Test Run\n\nBienvenue dans le test complet.\n\n- Initialiser le client\n- Authentifier et rejoindre le workspace\n- Vérifier le rendu Markdown\n\n1. Préparer les identifiants\n2. Générer le document\n3. Contrôler les blocs\n\n| Section | Description |\n| --- | --- |\n| Liste | Vérifie la conversion des puces |\n| Table | Vérifie la table AFFiNE |\n`;

async function main() {
  const email = process.env.AFFINE_EMAIL;
  const password = process.env.AFFINE_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing AFFINE_EMAIL/AFFINE_PASSWORD environment variables');
  }

  const client = new AffineClient();
  await client.signIn(email, password);

  try {
    await client.connectSocket();
    await client.joinWorkspace(workspaceId);

    const title = `API Regression ${new Date().toISOString()}`;
    const creation = await client.createDocument(workspaceId, {
      title,
      markdown,
      folderId,
      tags: ['test api'],
    });
    console.log('Created doc metadata', creation);

    const { doc: folderDoc } = await client.loadWorkspaceDoc(
      workspaceId,
      `db$${workspaceId}$folders`,
    );
    const folderEntry = creation.folderNodeId
      ? folderDoc.getMap(creation.folderNodeId)
      : null;
    console.log('Folder entry', folderEntry?.toJSON());

    const { doc } = await client.loadWorkspaceDoc(workspaceId, creation.docId);
    const meta = doc.getMap('meta');
    const tags = meta.get('tags');
    console.log(
      'Verification tags',
      tags instanceof Y.Array ? tags.toJSON() : tags,
    );

    const blocks = doc.getMap('blocks');
    const summaries: BlockSummary[] = [];

    blocks.forEach(value => {
      if (value instanceof Y.Map) {
        const flavour = value.get('sys:flavour') as string | null;
        if (flavour === 'affine:list') {
          const text = value.get('prop:text');
          summaries.push({
            flavour,
            isYText: text instanceof Y.Text,
            text: text instanceof Y.Text ? text.toString() : String(text ?? ''),
            order: value.get('prop:order'),
            type: value.get('prop:type'),
          });
        } else if (flavour === 'affine:table') {
          const keys = Array.from(value.keys()).filter(
            (key): key is string => typeof key === 'string',
          );
          const rowIds = keys
            .filter(key => key.startsWith('prop:rows.') && key.endsWith('.rowId'))
            .map(key => value.get(key) as string);
          const columnIds = keys
            .filter(key => key.startsWith('prop:columns.') && key.endsWith('.columnId'))
            .map(key => value.get(key) as string);
          const sample = rowIds.slice(0, 2).map(rowId =>
            columnIds.map(columnId => value.get(`prop:cells.${rowId}:${columnId}.text`)),
          );
          summaries.push({
            flavour,
            rows: rowIds.length,
            columns: columnIds.length,
            sample,
          });
        }
      }
    });

    console.log('Block summaries', summaries);

    const docPropsId = `db$${workspaceId}$docProperties`;
    const { doc: docProps } = await client.loadWorkspaceDoc(
      workspaceId,
      docPropsId,
    );
    const docPropsEntry = docProps.getMap(creation.docId);
    console.log('Doc properties entry', docPropsEntry?.toJSON());

    console.log('Cleaning up generated document…');
    await client.deleteDocument(workspaceId, creation.docId);
    console.log('Cleanup complete');
  } finally {
    await client.disconnect();
  }
}

main().catch(err => {
  console.error('Error', err);
  process.exit(1);
});
