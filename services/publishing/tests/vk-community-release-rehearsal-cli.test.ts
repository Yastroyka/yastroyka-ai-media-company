import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
  VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
} from '../src/vk-community-live-execution-cli.ts';
import {
  runVkCommunityReleaseRehearsal,
  type VkCommunityReleaseRehearsalDependencies,
  type VkCommunityReleaseRehearsalIo,
} from '../src/vk-community-release-rehearsal-cli.ts';

const PUBLICATION_ID = '22222222-2222-4222-8222-222222222222';
const COMMUNITY_ID = 123456;
const OWNER_ID = -COMMUNITY_ID;

function ownerPublicKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function readyManifest(): Record<string, unknown> {
  return {
    communityId: COMMUNITY_ID,
    ownerApprovalPublicKey: ownerPublicKey(),
    vkCredentialSecretReference: {
      provider: 'env',
      key: 'publishing/vk-community/yastroyka',
    },
    publishingIdentitySecretReference: {
      provider: 'env',
      key: 'publishing/identity/vk-community/runtime',
    },
  };
}

function io(stdout: string[], stderr: string[]): VkCommunityReleaseRehearsalIo {
  return {
    writeStdout(value) {
      stdout.push(value);
    },
    writeStderr(value) {
      stderr.push(value);
    },
  };
}

test('READY rehearsal emits exact canonical preview and live confirmation without secret material', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  let closes = 0;

  const dependencies: VkCommunityReleaseRehearsalDependencies = {
    async readTextFile() {
      return JSON.stringify(readyManifest());
    },
    async openPublicationState() {
      opens += 1;
      return {
        publicationState: {
          async findById(publicationId) {
            assert.equal(publicationId, PUBLICATION_ID);
            return {
              publicationId,
              platform: 'VK_COMMUNITY',
              status: 'AUTO',
              payload: {
                vk_community: {
                  message: 'Первый реальный пост Ястройки',
                },
              },
            };
          },
        },
        async close() {
          closes += 1;
        },
      };
    },
  };

  const exitCode = await runVkCommunityReleaseRehearsal(
    ['release-rehearsal', PUBLICATION_ID, 'vk-production.json'],
    dependencies,
    io(stdout, stderr),
  );

  assert.equal(exitCode, 0);
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.deepEqual(stderr, []);
  assert.equal(stdout.length, 1);

  const output = JSON.parse(stdout[0] ?? '{}') as {
    readonly status?: string;
    readonly communityId?: number;
    readonly ownerId?: number;
    readonly publicationId?: string;
    readonly approvalPacket?: {
      readonly preview?: {
        readonly publicationId?: string;
        readonly ownerId?: number;
        readonly message?: string;
      };
      readonly previewFingerprint?: string;
    };
    readonly liveConfirmation?: string;
    readonly requiredEnvironmentVariables?: readonly string[];
    readonly guarantees?: {
      readonly secretMaterialAccess?: boolean;
      readonly networkAccess?: boolean;
    };
  };

  assert.equal(output.status, 'READY');
  assert.equal(output.communityId, COMMUNITY_ID);
  assert.equal(output.ownerId, OWNER_ID);
  assert.equal(output.publicationId, PUBLICATION_ID);
  assert.equal(output.approvalPacket?.preview?.publicationId, PUBLICATION_ID);
  assert.equal(output.approvalPacket?.preview?.ownerId, OWNER_ID);
  assert.equal(output.approvalPacket?.preview?.message, 'Первый реальный пост Ястройки');
  assert.match(output.approvalPacket?.previewFingerprint ?? '', /^[0-9a-f]{64}$/u);
  assert.equal(output.liveConfirmation, '--confirm-live-wall-post=-123456');
  assert.deepEqual(output.requiredEnvironmentVariables, [
    VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
    VK_COMMUNITY_PUBLISHING_IDENTITY_ENVIRONMENT_VARIABLE,
  ]);
  assert.deepEqual(output.guarantees, {
    secretMaterialAccess: false,
    networkAccess: false,
  });
  assert.doesNotMatch(stdout.join(''), /BEGIN PUBLIC KEY|must-never-leak|private key/iu);
});

test('production preflight blocks before PostgreSQL open', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  const manifest = readyManifest();
  delete manifest.communityId;

  const exitCode = await runVkCommunityReleaseRehearsal(
    ['release-rehearsal', PUBLICATION_ID, 'vk-production.json'],
    {
      async readTextFile() {
        return JSON.stringify(manifest);
      },
      async openPublicationState() {
        opens += 1;
        throw new Error('must not open');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.equal(opens, 0);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'PRODUCTION_PREFLIGHT',
    reasons: ['COMMUNITY_ID_MISSING'],
  });
});

test('invalid manifest is sanitized and never opens PostgreSQL', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  const rejected = 'must-never-leak';

  const exitCode = await runVkCommunityReleaseRehearsal(
    ['release-rehearsal', PUBLICATION_ID, 'vk-production.json'],
    {
      async readTextFile() {
        return JSON.stringify({
          ...readyManifest(),
          accessToken: rejected,
        });
      },
      async openPublicationState() {
        opens += 1;
        throw new Error('must not open');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 65);
  assert.equal(opens, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK release rehearsal input invalid\n']);
  assert.doesNotMatch(stderr.join(''), new RegExp(rejected, 'u'));
});

test('non-AUTO publication blocks and closes read-only lease', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let closes = 0;

  const exitCode = await runVkCommunityReleaseRehearsal(
    ['release-rehearsal', PUBLICATION_ID, 'vk-production.json'],
    {
      async readTextFile() {
        return JSON.stringify(readyManifest());
      },
      async openPublicationState() {
        return {
          publicationState: {
            async findById(publicationId) {
              return {
                publicationId,
                platform: 'VK_COMMUNITY',
                status: 'APPROVED',
                payload: {
                  vk_community: {
                    message: 'not AUTO',
                  },
                },
              };
            },
          },
          async close() {
            closes += 1;
          },
        };
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.equal(closes, 1);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'PUBLICATION',
    reason: 'VK_PUBLICATION_NOT_AUTO',
  });
});

test('usage failure touches no file or PostgreSQL state', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let reads = 0;
  let opens = 0;

  const exitCode = await runVkCommunityReleaseRehearsal(
    ['release-rehearsal'],
    {
      async readTextFile() {
        reads += 1;
        throw new Error('must not read');
      },
      async openPublicationState() {
        opens += 1;
        throw new Error('must not open');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 64);
  assert.equal(reads, 0);
  assert.equal(opens, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    'Usage: vk:release-rehearsal <publication-id> <non-secret-manifest.json>\n',
  ]);
});
