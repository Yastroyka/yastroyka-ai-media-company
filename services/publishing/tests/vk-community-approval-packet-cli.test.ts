import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  runVkCommunityApprovalPacketOperator,
  type VkCommunityApprovalPacketOperatorDependencies,
  type VkCommunityApprovalPacketOperatorIo,
} from '../src/vk-community-approval-packet-cli.ts';

const PUBLICATION_ID = '88888888-8888-4888-8888-888888888888';

function ownerPublicKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function readyManifest(): Record<string, unknown> {
  return {
    communityId: 123456,
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

function io(stdout: string[], stderr: string[]): VkCommunityApprovalPacketOperatorIo {
  return {
    writeStdout(value) {
      stdout.push(value);
    },
    writeStderr(value) {
      stderr.push(value);
    },
  };
}

test('operator reads canonical state and emits only the exact approval packet', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  let closes = 0;

  const dependencies: VkCommunityApprovalPacketOperatorDependencies = {
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

  const exitCode = await runVkCommunityApprovalPacketOperator(
    ['approval-packet', PUBLICATION_ID, 'vk-production.json'],
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
    readonly approvalPacket?: {
      readonly preview?: {
        readonly publicationId?: string;
        readonly ownerId?: number;
        readonly message?: string;
      };
      readonly previewFingerprint?: string;
    };
  };

  assert.equal(output.status, 'READY');
  assert.equal(output.approvalPacket?.preview?.publicationId, PUBLICATION_ID);
  assert.equal(output.approvalPacket?.preview?.ownerId, -123456);
  assert.equal(output.approvalPacket?.preview?.message, 'Первый реальный пост Ястройки');
  assert.match(output.approvalPacket?.previewFingerprint ?? '', /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    stdout.join(''),
    /BEGIN PUBLIC KEY|access[_-]?token|private key|password|credential|hmac|secret/iu,
  );
});

test('production metadata blocks before PostgreSQL is opened', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  const manifest = readyManifest();
  delete manifest.communityId;

  const exitCode = await runVkCommunityApprovalPacketOperator(
    ['approval-packet', PUBLICATION_ID, 'vk-production.json'],
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

test('invalid manifest is rejected without opening PostgreSQL or reflecting input', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  const rejectedSecret = 'must-never-be-reflected';

  const exitCode = await runVkCommunityApprovalPacketOperator(
    ['approval-packet', PUBLICATION_ID, 'vk-production.json'],
    {
      async readTextFile() {
        return JSON.stringify({
          ...readyManifest(),
          accessToken: rejectedSecret,
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
  assert.deepEqual(stderr, ['VK approval packet operator input invalid\n']);
  assert.doesNotMatch(stderr.join(''), new RegExp(rejectedSecret, 'u'));
});

test('canonical publication blocks safely and always closes its database lease', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let closes = 0;

  const exitCode = await runVkCommunityApprovalPacketOperator(
    ['approval-packet', PUBLICATION_ID, 'vk-production.json'],
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
                    message: 'not yet AUTO',
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

test('canonical state read errors are sanitized to a safe publication block code', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let closes = 0;

  const exitCode = await runVkCommunityApprovalPacketOperator(
    ['approval-packet', PUBLICATION_ID, 'vk-production.json'],
    {
      async readTextFile() {
        return JSON.stringify(readyManifest());
      },
      async openPublicationState() {
        return {
          publicationState: {
            async findById() {
              throw new Error('db password=must-not-leak');
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
    reason: 'VK_PUBLICATION_READ_FAILED',
  });
  assert.doesNotMatch(stdout.join(''), /must-not-leak/u);
});

test('database open failures are generic and do not reflect credentials', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runVkCommunityApprovalPacketOperator(
    ['approval-packet', PUBLICATION_ID, 'vk-production.json'],
    {
      async readTextFile() {
        return JSON.stringify(readyManifest());
      },
      async openPublicationState() {
        throw new Error('postgres password=must-not-leak');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 70);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK approval packet operator failed\n']);
  assert.doesNotMatch(stderr.join(''), /must-not-leak/u);
});

test('usage and invalid publication IDs do not open PostgreSQL', async () => {
  for (const args of [[], ['approval-packet', 'not-a-uuid', 'vk-production.json']]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let reads = 0;
    let opens = 0;

    const exitCode = await runVkCommunityApprovalPacketOperator(
      args,
      {
        async readTextFile() {
          reads += 1;
          return JSON.stringify(readyManifest());
        },
        async openPublicationState() {
          opens += 1;
          throw new Error('must not open');
        },
      },
      io(stdout, stderr),
    );

    assert.equal(opens, 0);
    assert.deepEqual(stdout, []);
    if (args.length === 0) {
      assert.equal(exitCode, 64);
      assert.equal(reads, 0);
    } else {
      assert.equal(exitCode, 65);
      assert.equal(reads, 0);
    }
  }
});
