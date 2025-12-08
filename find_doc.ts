import { AffineClient } from './src/client/runtime/affine-client.ts';
import * as Y from 'yjs';

async function findDoc(workspaceName: string, docTitle: string) {
    const client = new AffineClient({
        baseUrl: process.env.AFFINE_BASE_URL,
    });

    const email = process.env.AFFINE_EMAIL;
    const password = process.env.AFFINE_PASSWORD;
    const sessionCookie = process.env.AFFINE_SESSION_COOKIE;

    if (!sessionCookie && (!email || !password)) {
        console.error('Please set credentials in .env');
        process.exit(1);
    }

    try {
        if (!sessionCookie) {
            console.log('Attempting sign-in...');
            const authResult = await client.signIn(email!, password!);
            console.log('Sign-in successful!');
        } else {
            console.log('Using provided session cookie...');
            (client as any).cookieJar.set('affine_session', sessionCookie);
            // Try to fetch session to get user ID
            const meRes = await (client as any).fetchFn(`${(client as any).baseUrl}/api/auth/session`, {
                headers: { Cookie: (client as any).getCookieHeader() }
            });
            if (meRes.ok) {
                const me = await meRes.json();
                console.log('Authenticated as:', me.user?.email);
                (client as any).userId = me.user?.id;
                (client as any).cookieJar.set('affine_user_id', me.user?.id);
            }
        }

        console.log('Fetching workspaces via GraphQL...');
        const workspacesQuery = `
        query {
            workspaces {
                id
                public
            }
        }
    `;

        let workspaces: any[] = [];
        try {
            const result = await (client as any).graphqlQuery(workspacesQuery);
            workspaces = result.workspaces;
            console.log(`Found ${workspaces.length} workspaces.`);
        } catch (e: any) {
            console.error('GraphQL query failed:', e.message);
            return;
        }

        // We don't have names in GraphQL, so we search in all workspaces
        console.log('Searching for document in all workspaces...');

        for (const ws of workspaces) {
            const wsId = ws.id;
            console.log(`Checking workspace ${wsId}...`);
            try {
                if (!(client as any).socket) {
                    await client.connectSocket();
                }

                console.log(`Joining workspace ${wsId}...`);
                await client.joinWorkspace(wsId);
                console.log(`Joined workspace ${wsId}. Waiting 1s...`);
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Try to load docProperties to find title
                // docProperties doc name: db${wsId}docProperties ?
                // Let's try to find where titles are.
                // In Affine, titles are often in the 'meta' of the doc, or in a central store.
                // The 'folders' doc (db${wsId}folders) has the tree structure.

                // Let's try to load the 'folders' doc first.
                const foldersId = `db$${wsId}$folders`;
                console.log(`Loading folders doc ${foldersId}...`);
                const { doc: foldersDoc } = await client.loadWorkspaceDoc(wsId, foldersId);

                // Dump folders doc
                console.log(`Folders Doc Keys: ${Array.from(foldersDoc.share.keys()).join(', ')}`);

                // Extract docIds from folders
                const docIds = new Set<string>();
                for (const key of foldersDoc.share.keys()) {
                    if (key === 'meta') continue;
                    const val = foldersDoc.share.get(key);
                    let obj: any;
                    if (val instanceof Y.Map) {
                        obj = val.toJSON();
                    } else if (val instanceof Y.AbstractType) {
                        obj = val.toJSON();
                    } else {
                        obj = val;
                    }

                    // Debug folder entry
                    console.log(`Folder Entry ${key}:`, JSON.stringify(obj));

                    // In Affine, folders doc usually maps NodeId -> NodeData
                    // NodeData has `data` which is docId if `type` is 'doc' (or 'page'?)
                    // Let's check the structure.
                    if (obj && obj.index) {
                        // It seems to be a node.
                        // Check if it has 'data' or 'id'
                        // console.log(`Node ${key}: type=${obj.type}, data=${obj.data}`);

                        // Maybe type is 'page'?
                        if (obj.type === 'page' || obj.type === 'doc') {
                            if (obj.data) docIds.add(obj.data);
                            // Also check if the key itself is the docId? No, key is usually random.
                            // Sometimes `id` property is the docId?
                            if (obj.id && !obj.data) docIds.add(obj.id);
                        }
                    }
                }

                console.log(`Found ${docIds.size} documents in folders.`);

                // Scan docs for surface
                for (const docId of docIds) {
                    // console.log(`Scanning doc ${docId}...`);
                    try {
                        const { doc } = await client.loadWorkspaceDoc(wsId, docId);
                        // Check for surface block
                        // Blocks are usually in 'blocks' map?
                        // Let's check top level keys of doc
                        // console.log(`Doc ${docId} keys:`, Array.from(doc.share.keys()));

                        const blocks = doc.getMap('blocks');
                        if (blocks) {
                            for (const blockId of blocks.keys()) {
                                const block = blocks.get(blockId) as Y.Map<any>;
                                if (block && block.get('flavour') === 'affine:surface') {
                                    console.log(`Found Surface in Doc ${docId}!`);
                                    // Check if it has elements
                                    // Surface block usually has 'prop:elements' or similar?
                                    // Or elements are stored in a separate map?
                                    // In Affine, surface elements are in `doc.getMap('affine:surface')`?
                                    // Or `doc.getMap('surface')`?

                                    // Let's dump keys to see where elements are.
                                    console.log(`Doc ${docId} has surface block. Keys: ${Array.from(doc.share.keys()).join(', ')}`);

                                    // If we find a surface, this is likely the doc (or one of them).
                                    // Let's assume this is the one and exit.
                                    console.log(`Target Workspace ID: ${wsId}`);
                                    console.log(`Target Doc ID: ${docId}`);
                                    process.exit(0);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Error loading doc ${docId}:`, err);
                    }
                }

            } catch (err) {
                console.error(`Error checking workspace ${wsId}:`, err);
            }
        }

        console.log('Document not found.');

    } catch (error: any) {
        console.error('Error details:', error.message || error);
    }
}

findDoc('tests', 'test sketch-api');
