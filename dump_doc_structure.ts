import { AffineClient } from './src/client/runtime/affine-client';
import { config } from 'dotenv';
import * as Y from 'yjs';

config();

async function dumpDocStructure(workspaceId: string, docId: string) {
    const client = new AffineClient({
        baseUrl: process.env.AFFINE_BASE_URL,
    });

    const email = process.env.AFFINE_EMAIL;
    const password = process.env.AFFINE_PASSWORD;

    if (!email || !password) {
        console.error('Please set AFFINE_EMAIL and AFFINE_PASSWORD in .env');
        process.exit(1);
    }

    try {
        console.log('Signing in...');
        await client.signIn(email, password);
        await client.connectSocket();

        console.log(`Loading document ${docId} from workspace ${workspaceId}...`);
        const { doc } = await client.loadWorkspaceDoc(workspaceId, docId);

        const blocks = doc.getMap('blocks');
        console.log(`\nFound ${blocks.size} blocks.`);

        const dump: Record<string, any> = {};

        blocks.forEach((value, key) => {
            if (value instanceof Y.Map) {
                dump[key] = value.toJSON();
            } else if (value instanceof Y.XmlText) {
                dump[key] = value.toString();
            } else {
                dump[key] = value;
            }
        });

        console.log(JSON.stringify(dump, null, 2));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.disconnect();
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: npx tsx dump_doc_structure.ts <workspaceId> <docId>');
    process.exit(1);
}

dumpDocStructure(args[0], args[1]);
