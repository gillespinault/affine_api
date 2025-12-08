import { describe, expect, it } from 'vitest';
import { AffineClient } from '../../src/client';

type GraphqlHandler = (payload: { query: string; variables?: Record<string, unknown> }) => unknown;

function createTestClient(handlers: GraphqlHandler[]) {
  const fetchFn = async (input: URL | string, init?: Record<string, unknown>) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/auth/sign-in')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => null,
          getSetCookie: () => [
            'affine_session=s%3Atest-session; Path=/',
            'affine_user_id=user-123; Path=/',
          ],
        },
        text: async () => '',
      };
    }

    if (url.endsWith('/graphql')) {
      if (!init?.body || typeof init.body !== 'string') {
        throw new Error('Missing GraphQL payload');
      }
      const payload = JSON.parse(init.body) as {
        query: string;
        variables?: Record<string, unknown>;
      };
      const handler = handlers.shift();
      if (!handler) {
        throw new Error(`Unexpected GraphQL query: ${payload.query}`);
      }
      const data = handler(payload);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => 'application/json',
        },
        text: async () => JSON.stringify({ data }),
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  return new AffineClient({ fetchFn });
}

async function createSignedClient(handlers: GraphqlHandler[]) {
  const client = createTestClient(handlers);
  await client.signIn('integration@example.com', 'password');
  return client;
}

describe('AffineClient collaboration helpers', () => {
  it('lists comments with pagination metadata', async () => {
    const client = await createSignedClient([
      ({ variables }) => {
        expect(variables).toMatchObject({
          workspaceId: 'workspace-1',
          docId: 'doc-42',
          pagination: {
            first: 5,
            offset: 2,
            after: 'cursor-10',
          },
        });

        return {
          workspace: {
            comments: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: 'cursor-end' },
              edges: [
                {
                  node: {
                    id: 'comment-1',
                    content: { text: 'Hello' },
                    createdAt: '2025-11-08T00:00:00Z',
                    updatedAt: '2025-11-08T00:00:00Z',
                    resolved: false,
                    user: { id: 'user-123', name: 'Gilles', avatarUrl: null },
                    replies: [],
                  },
                },
              ],
            },
          },
        };
      },
    ]);

    const connection = await client.listComments('workspace-1', 'doc-42', {
      first: 5,
      offset: 2,
      after: '  cursor-10 ',
    });
    expect(connection.totalCount).toBe(1);
    expect(connection.pageInfo.endCursor).toBe('cursor-end');
    expect(connection.comments).toHaveLength(1);
    expect(connection.comments[0]?.id).toBe('comment-1');
  });

  it('creates comments with defaults and lists notifications', async () => {
    const client = await createSignedClient([
      ({ variables }) => {
        expect(variables?.input).toMatchObject({
          workspaceId: 'workspace-1',
          docId: 'doc-1',
          docMode: 'page',
          docTitle: '',
        });
        return {
          createComment: {
            id: 'comment-new',
            content: { text: 'Ping' },
            createdAt: '2025-11-08T10:00:00Z',
            updatedAt: '2025-11-08T10:00:00Z',
            resolved: false,
            user: { id: 'user-123', name: 'Codex', avatarUrl: null },
            replies: [],
          },
        };
      },
      ({ variables }) => {
        expect(variables).toMatchObject({ pagination: { first: 10, offset: 0 } });
        return {
          currentUser: {
            notifications: {
              edges: [
                {
                  node: {
                    id: 'notif-1',
                    type: 'comment',
                    read: false,
                    createdAt: '2025-11-08T11:00:00Z',
                  },
                },
                {
                  node: {
                    id: 'notif-2',
                    type: 'system',
                    read: true,
                    createdAt: '2025-11-07T11:00:00Z',
                  },
                },
              ],
              totalCount: 2,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      },
      ({ variables }) => {
        expect(variables).toMatchObject({ id: 'notif-1' });
        return { readNotification: true };
      },
    ]);

    const created = await client.createComment('workspace-1', {
      docId: 'doc-1',
      content: { text: 'Ping' },
    });
    expect(created.id).toBe('comment-new');

    const notifications = await client.listNotifications({
      first: 10,
      unreadOnly: true,
    });
    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.unreadCount).toBe(1);

    const marked = await client.markNotificationRead('notif-1');
    expect(marked).toBe(true);
  });

  it('manages access tokens via GraphQL helpers', async () => {
    const client = await createSignedClient([
      () => ({ accessTokens: null }),
      ({ variables }) => {
        expect(variables?.input).toMatchObject({
          name: 'automation',
          expiresAt: null,
        });
        return {
          generateUserAccessToken: {
            id: 'token-1',
            name: 'automation',
            createdAt: '2025-11-08T12:00:00Z',
            expiresAt: null,
            token: 'secret-token',
          },
        };
      },
      ({ variables }) => {
        expect(variables).toMatchObject({ id: 'token-1' });
        return { revokeUserAccessToken: true };
      },
    ]);

    const tokens = await client.listAccessTokens();
    expect(tokens).toEqual([]);

    const created = await client.createAccessToken({ name: 'automation' });
    expect(created.token).toBe('secret-token');

    const revoked = await client.revokeAccessToken('token-1');
    expect(revoked).toBe(true);
  });

  it('publishes and revokes documents via GraphQL helpers', async () => {
    const client = await createSignedClient([
      ({ variables }) => {
        expect(variables).toMatchObject({
          workspaceId: 'workspace-1',
          docId: 'doc-1',
          mode: 'Page',
        });
        return {
          publishDoc: {
            id: 'doc-1',
            workspaceId: 'workspace-1',
            public: true,
            mode: 'Page',
          },
        };
      },
      ({ variables }) => {
        expect(variables).toMatchObject({
          workspaceId: 'workspace-1',
          docId: 'doc-1',
        });
        return {
          revokePublicDoc: {
            id: 'doc-1',
            workspaceId: 'workspace-1',
            public: false,
            mode: null,
          },
        };
      },
    ]);

    const published = await client.publishDocument('workspace-1', 'doc-1', { mode: 'page' });
    expect(published).toEqual({
      docId: 'doc-1',
      workspaceId: 'workspace-1',
      public: true,
      mode: 'page',
    });

    const revoked = await client.revokeDocumentPublication('workspace-1', 'doc-1');
    expect(revoked.public).toBe(false);
    expect(revoked.mode).toBeNull();
  });
});
