// Script pour examiner la structure d'un brush dans un document AFFiNE
const Y = require('yjs');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const AFFINE_URL = process.env.AFFINE_URL || 'https://affine.robotsinlove.be';
const WORKSPACE_ID = process.env.WORKSPACE_ID || 'b89db6a1-b52c-4634-a5a0-24f555dbebdc';
const DOC_ID = process.env.DOC_ID || process.argv[2];

if (!DOC_ID) {
    console.error('Usage: DOC_ID=xxx node examine-brush.cjs');
    console.error('   or: node examine-brush.cjs <docId>');
    process.exit(1);
}

// Load session cookies from notebooks_api
const SESSION_FILE = path.join(process.env.HOME, '.tmp/affine_capture/session.json');

let cookies = '';
try {
    const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    cookies = sessionData.cookies || '';
    console.log('Session loaded from:', SESSION_FILE);
} catch (e) {
    console.warn('No session file found, trying without auth');
}

async function examineDocument() {
    console.log(`\n=== Examining document ===`);
    console.log(`Workspace: ${WORKSPACE_ID}`);
    console.log(`Doc: ${DOC_ID}`);
    console.log(`URL: ${AFFINE_URL}`);

    const socket = io(AFFINE_URL, {
        transports: ['websocket', 'polling'],
        extraHeaders: cookies ? { Cookie: cookies } : {},
        timeout: 30000,
    });

    return new Promise((resolve, reject) => {
        socket.on('connect', async () => {
            console.log('\n=== Socket connected ===');

            // Join workspace
            const clientVersion = `brush-examiner-${Date.now()}`;
            socket.emit('space:join', {
                spaceType: 'workspace',
                spaceId: WORKSPACE_ID,
                clientVersion,
            }, (joinRes) => {
                console.log('Join response:', JSON.stringify(joinRes, null, 2));

                if (joinRes?.error) {
                    reject(new Error(`Join failed: ${joinRes.error}`));
                    return;
                }

                // Load document
                socket.emit('space:load-doc', {
                    spaceType: 'workspace',
                    spaceId: WORKSPACE_ID,
                    docId: DOC_ID,
                }, (loadRes) => {
                    console.log('\n=== Load doc response ===');

                    if (loadRes?.error) {
                        reject(new Error(`Load failed: ${loadRes.error}`));
                        return;
                    }

                    // Decode Yjs doc
                    const ydoc = new Y.Doc({ guid: DOC_ID });

                    if (loadRes?.data?.missing) {
                        const missingBytes = Buffer.from(loadRes.data.missing, 'base64');
                        console.log(`Applying ${missingBytes.length} bytes from "missing"`);
                        Y.applyUpdate(ydoc, missingBytes);
                    }

                    // Examine structure
                    console.log('\n=== Document Structure ===');
                    console.log('Root maps:', Array.from(ydoc.share.keys()));

                    // Get blocks map
                    const blocks = ydoc.getMap('blocks');
                    console.log(`\nBlocks count: ${blocks.size}`);

                    // Find surface block and examine elements
                    let surfaceBlock = null;
                    let surfaceId = null;

                    blocks.forEach((block, id) => {
                        if (block instanceof Y.Map) {
                            const flavour = block.get('sys:flavour');
                            console.log(`  Block ${id}: flavour=${flavour}`);

                            if (flavour === 'affine:surface') {
                                surfaceBlock = block;
                                surfaceId = id;
                            }
                        }
                    });

                    if (surfaceBlock) {
                        console.log(`\n=== Surface Block (${surfaceId}) ===`);
                        console.log('Keys:', Array.from(surfaceBlock.keys()));

                        const elements = surfaceBlock.get('prop:elements');
                        console.log('\n=== prop:elements ===');

                        if (elements) {
                            if (elements instanceof Y.Map) {
                                console.log('Type: Y.Map');
                                console.log('Keys:', Array.from(elements.keys()));

                                const type = elements.get('type');
                                const value = elements.get('value');

                                console.log(`type: ${type}`);

                                if (value instanceof Y.Map) {
                                    console.log('value is Y.Map');
                                    console.log(`value keys (${value.size}):`, Array.from(value.keys()));

                                    // Show each element
                                    console.log('\n=== Elements ===');
                                    value.forEach((element, elemId) => {
                                        console.log(`\n--- Element: ${elemId} ---`);
                                        if (element instanceof Y.Map) {
                                            const json = {};
                                            element.forEach((v, k) => {
                                                json[k] = v instanceof Y.Map || v instanceof Y.Array
                                                    ? '[Yjs object]'
                                                    : v;
                                            });
                                            console.log(JSON.stringify(json, null, 2));
                                        } else {
                                            console.log(JSON.stringify(element, null, 2));
                                        }
                                    });
                                } else if (typeof value === 'object') {
                                    console.log('value is plain object');
                                    console.log(JSON.stringify(value, null, 2));
                                }
                            } else if (typeof elements === 'object') {
                                console.log('Type: plain object');
                                console.log(JSON.stringify(elements, null, 2));
                            }
                        } else {
                            console.log('prop:elements is null/undefined');
                        }
                    } else {
                        console.log('\n⚠️ No surface block found!');
                        console.log('This document may not have edgeless mode enabled');
                    }

                    // Also check if there's a direct 'surface' map
                    const directSurface = ydoc.getMap('surface');
                    if (directSurface.size > 0) {
                        console.log('\n=== Direct "surface" map ===');
                        console.log('Keys:', Array.from(directSurface.keys()));
                        directSurface.forEach((v, k) => {
                            console.log(`  ${k}:`, typeof v, v instanceof Y.Map ? '(Y.Map)' : '');
                        });
                    }

                    socket.disconnect();
                    resolve();
                });
            });
        });

        socket.on('connect_error', (err) => {
            reject(new Error(`Connect error: ${err.message}`));
        });

        setTimeout(() => reject(new Error('Timeout')), 30000);
    });
}

examineDocument()
    .then(() => {
        console.log('\n=== Done ===');
        process.exit(0);
    })
    .catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
