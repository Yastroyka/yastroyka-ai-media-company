import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  PostgresPlatformWorkspaceStore,
  createDatabaseConnection,
  createMigrator,
} from '@yastroyka/db';
import {
  createVkCommunityOwnerGrantAssertion,
  signVkCommunityOwnerGrant,
  type VkCommunitySecretProviderPort,
  type VkCommunitySecretReference,
  type VkCommunityWallPostRequest,
} from '@yastroyka/orchestrator';

import {
  VkCommunityProductionRuntimeError,
  createVkCommunityProductionRuntime,
} from '../src/vk-community-production-runtime.ts';

const TEST_DATABASE_HOST = '127.0.0.1';
const TEST_DATABASE_NAME = 'yastroyka_r1_test';
const TEST_DATABASE_USER = 'yastroyka_r1_app';
const MASTER_CONTENT_ID = '00000000-0000-4000-8000-000000000200';
const VALID_PUBLICATION_ID = '20202020-2020-4020-8020-202020202020';
const TAMPERED_PUBLICATION_ID = '20202020-2020-4020-8020-202020202021';
const COMMUNITY_ID = 123456;
const OWNER_ID = -COMMUNITY_ID;
const POST_ID = 42020;
const NOW = new Date('2026-08-30T11:00:00.000Z');
const VK_SECRET_KEY = 'publishing/vk-community/task-020';
const IDENTITY_SECRET_KEY = 'publishing/identity/vk-community/task-020';
const VK_ACCESS_TOKEN = 'task-020-fake-vk-token';
const IDENTITY_SECRET = 'task-020-identity-secret-material-32-bytes-minimum';

process.env.YASTROYKA_DB_HOST ??= TEST_DATABASE_HOST;
process.env.YASTROYKA_DB_PORT ??= '5432';
process.env.YASTROYKA_DB_NAME ??= TEST_DATABASE_NAME;
process.env.YASTROYKA_DB_USER ??= TEST_DATABASE_USER;

if (
  process.env.YASTROYKA_DB_PASSWORD === undefined &&
  process.env.GITHUB_RUN_ID !== undefined &&
  process.env.GITHUB_RUN_ATTEMPT !== undefined
) {
  process.env.YASTROYKA_DB_PASSWORD = `ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
}

const HAS_DATABASE_ENVIRONMENT = [
  'YASTROYKA_DB_HOST',
  'YASTROYKA_DB_PORT',
  'YASTROYKA_DB_NAME',
  'YASTROYKA_DB_USER',
  'YASTROYKA_DB_PASSWORD',
].every((name) => {
  const value = process.env[name];
  return value !== undefined && value.length > 0;
});
const integrationTest = HAS_DATABASE_ENVIRONMENT ? test : test.skip;

const AUTHORIZATION_POLICY = {
  version: 2 as const,
  principles: {
    default_deny: true as const,
    least_privilege: true as const,
  },
  risk_classes: {
    R0: { description: 'read-only low-risk' },
    R1: { description: 'reversible staging action' },
    R2: { description: 'production write' },
    R3: { description: 'irreversible/high-impact action' },
  },
  actors: {
    publishing_service: {
      default_scopes: ['publication:result'],
    },
  },
  permissions: [
    {
      id: 'publication-record-result',
      resource: 'publication',
      action: 'record_result',
      required_scope: 'publication:result',
      risk_class: 'R3' as const,
    },
  ],
  rules: [],
};

function createOwnerKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}

function manifest(ownerApprovalPublicKey: string) {
  return {
    communityId: COMMUNITY_ID,
    ownerApprovalPublicKey,
    vkCredentialSecretReference: {
      provider: 'env',
      key: VK_SECRET_KEY,
    },
    publishingIdentitySecretReference: {
      provider: 'env',
      key: IDENTITY_SECRET_KEY,
    },
  };
}

class RecordingSecretProvider implements VkCommunitySecretProviderPort {
  readonly accesses: string[] = [];
  readonly #secrets = new Map<string, string>([
    [VK_SECRET_KEY, VK_ACCESS_TOKEN],
    [IDENTITY_SECRET_KEY, IDENTITY_SECRET],
  ]);

  async withSecret<T>(
    reference: VkCommunitySecretReference,
    consumer: (secret: string) => T | Promise<T>,
  ): Promise<T> {
    this.accesses.push(reference.key);
    const secret = this.#secrets.get(reference.key);
    if (reference.provider !== 'env' || secret === undefined) {
      throw new Error('secret unavailable');
    }
    return await consumer(secret);
  }
}

async function seedAutoPublication(
  workspaces: PostgresPlatformWorkspaceStore,
  database: ReturnType<typeof createDatabaseConnection>,
  publicationId: string,
  message: string,
): Promise<void> {
  await workspaces.createDraft({
    publicationId,
    masterContentId: MASTER_CONTENT_ID,
    workspaceId: 'yastroyka-vk-community',
    platform: 'VK_COMMUNITY',
    payload: {
      vk_community: {
        message,
      },
    },
  });
  await database.query(
    `UPDATE publications SET status = 'AUTO' WHERE id = :publicationId AND platform = 'VK_COMMUNITY';`,
    { replacements: { publicationId } },
  );
}

integrationTest(
  'TASK-020 composes the full guarded VK runtime without a real network call',
  async (t) => {
    const database = createDatabaseConnection();
    const keys = createOwnerKeys();
    const workspaces = new PostgresPlatformWorkspaceStore(database);

    try {
      const migrator = createMigrator(database);
      await migrator.up();
      await database.query(
        `DELETE FROM publications WHERE id IN (:validPublicationId, :tamperedPublicationId);`,
        {
          replacements: {
            validPublicationId: VALID_PUBLICATION_ID,
            tamperedPublicationId: TAMPERED_PUBLICATION_ID,
          },
        },
      );

      await seedAutoPublication(
        workspaces,
        database,
        VALID_PUBLICATION_ID,
        'TASK-020 canonical production composition test',
      );
      await seedAutoPublication(
        workspaces,
        database,
        TAMPERED_PUBLICATION_ID,
        'TASK-020 tampered grant must fail before secrets',
      );

      await t.test('BLOCKED production metadata fails at construction', () => {
        const secrets = new RecordingSecretProvider();
        assert.throws(
          () =>
            createVkCommunityProductionRuntime({
              manifest: {
                ...manifest(keys.publicPem),
                communityId: undefined,
              },
              database,
              authorizationPolicy: AUTHORIZATION_POLICY,
              authorizationAuditSink: {
                async record() {
                  throw new Error('unexpected authorization denial');
                },
              },
              secretProvider: secrets,
              transport: {
                async publishWallPost() {
                  throw new Error('transport must not run');
                },
              },
              clock: () => NOW,
            }),
          VkCommunityProductionRuntimeError,
        );
        assert.deepEqual(secrets.accesses, []);
      });

      await t.test(
        'valid owner grant reaches fake transport and persists exact PUBLISHED evidence',
        async () => {
          const secrets = new RecordingSecretProvider();
          const transportCalls: Array<{
            request: VkCommunityWallPostRequest;
            accessToken: string;
          }> = [];
          const runtime = createVkCommunityProductionRuntime({
            manifest: manifest(keys.publicPem),
            database,
            authorizationPolicy: AUTHORIZATION_POLICY,
            authorizationAuditSink: {
              async record() {
                throw new Error('unexpected authorization denial');
              },
            },
            secretProvider: secrets,
            transport: {
              async publishWallPost(request, accessToken) {
                transportCalls.push({ request, accessToken });
                return {
                  ownerId: request.ownerId,
                  postId: POST_ID,
                };
              },
            },
            clock: () => NOW,
          });

          assert.deepEqual(runtime.deployment, {
            communityId: COMMUNITY_ID,
            ownerId: OWNER_ID,
            ownerPublicKeyFingerprint: runtime.deployment.ownerPublicKeyFingerprint,
          });

          const approval = await runtime.prepareApproval(VALID_PUBLICATION_ID);
          const ownerGrant = signVkCommunityOwnerGrant(
            createVkCommunityOwnerGrantAssertion({
              grantId: 'task-020-valid-grant',
              publicationId: VALID_PUBLICATION_ID,
              ownerId: OWNER_ID,
              previewFingerprint: approval.previewFingerprint,
              issuedAt: '2026-08-30T10:59:30.000Z',
              expiresAt: '2026-08-30T11:02:00.000Z',
            }),
            keys.privateKey,
          );

          const result = await runtime.execute(VALID_PUBLICATION_ID, ownerGrant);
          assert.deepEqual(result, {
            publicationId: VALID_PUBLICATION_ID,
            platform: 'VK_COMMUNITY',
            ownerId: OWNER_ID,
            postId: POST_ID,
            idempotencyKey: approval.preview.idempotencyKey,
            publishedAt: NOW.toISOString(),
          });

          assert.equal(transportCalls.length, 1);
          assert.deepEqual(transportCalls[0]?.request, {
            ownerId: OWNER_ID,
            fromGroup: true,
            message: approval.preview.message,
            idempotencyKey: approval.preview.idempotencyKey,
          });
          assert.equal(transportCalls[0]?.accessToken, VK_ACCESS_TOKEN);
          assert.deepEqual(secrets.accesses, [
            IDENTITY_SECRET_KEY,
            IDENTITY_SECRET_KEY,
            VK_SECRET_KEY,
          ]);

          const publication = await workspaces.findById(VALID_PUBLICATION_ID);
          assert.equal(publication?.status, 'PUBLISHED');
          assert.equal(publication?.publishedAt, NOW.toISOString());
          assert.doesNotMatch(
            JSON.stringify(publication),
            /task-020-fake-vk-token|task-020-identity-secret-material/iu,
          );
        },
      );

      await t.test('tampered owner grant fails before any secret or transport access', async () => {
        const secrets = new RecordingSecretProvider();
        let transportCalls = 0;
        const runtime = createVkCommunityProductionRuntime({
          manifest: manifest(keys.publicPem),
          database,
          authorizationPolicy: AUTHORIZATION_POLICY,
          authorizationAuditSink: {
            async record() {
              throw new Error('unexpected authorization denial');
            },
          },
          secretProvider: secrets,
          transport: {
            async publishWallPost() {
              transportCalls += 1;
              return { ownerId: OWNER_ID, postId: POST_ID + 1 };
            },
          },
          clock: () => NOW,
        });

        const badGrant = signVkCommunityOwnerGrant(
          createVkCommunityOwnerGrantAssertion({
            grantId: 'task-020-tampered-grant',
            publicationId: TAMPERED_PUBLICATION_ID,
            ownerId: OWNER_ID,
            previewFingerprint: 'b'.repeat(64),
            issuedAt: '2026-08-30T10:59:30.000Z',
            expiresAt: '2026-08-30T11:02:00.000Z',
          }),
          keys.privateKey,
        );

        await assert.rejects(runtime.execute(TAMPERED_PUBLICATION_ID, badGrant));
        assert.deepEqual(secrets.accesses, []);
        assert.equal(transportCalls, 0);
        assert.equal((await workspaces.findById(TAMPERED_PUBLICATION_ID))?.status, 'AUTO');
      });
    } finally {
      await database
        .query(
          `DELETE FROM publications WHERE id IN (:validPublicationId, :tamperedPublicationId);`,
          {
            replacements: {
              validPublicationId: VALID_PUBLICATION_ID,
              tamperedPublicationId: TAMPERED_PUBLICATION_ID,
            },
          },
        )
        .catch(() => {});
      await database.close().catch(() => {});
    }
  },
);
