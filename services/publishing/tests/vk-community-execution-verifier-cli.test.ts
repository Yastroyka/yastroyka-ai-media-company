import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  computeVkCommunityPreviewFingerprint,
  createVkCommunityOwnerGrantAssertion,
  signVkCommunityOwnerGrant,
  type VkCommunityPublishingPreview,
} from '@yastroyka/orchestrator';

import {
  runVkCommunityExecutionVerifier,
  type VkCommunityExecutionVerifierDependencies,
  type VkCommunityExecutionVerifierIo,
} from '../src/vk-community-execution-verifier-cli.ts';

const PUBLICATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-29T19:01:00.000Z');

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}

function manifest(publicPem: string, communityId = 123456): Record<string, unknown> {
  return {
    communityId,
    ownerApprovalPublicKey: publicPem,
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

function preview(message = 'Свежий текст первого поста'): VkCommunityPublishingPreview {
  return {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    ownerId: -123456,
    fromGroup: true,
    message,
    idempotencyKey: createHash('sha256').update(PUBLICATION_ID, 'utf8').digest('hex'),
  };
}

function record(message = 'Свежий текст первого поста') {
  return {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    status: 'AUTO',
    payload: {
      vk_community: {
        message,
      },
    },
  } as const;
}

function grant(privateKey: ReturnType<typeof keys>['privateKey'], signedPreview = preview()) {
  const assertion = createVkCommunityOwnerGrantAssertion({
    grantId: 'task-019-grant',
    publicationId: PUBLICATION_ID,
    ownerId: signedPreview.ownerId,
    previewFingerprint: computeVkCommunityPreviewFingerprint(signedPreview),
    issuedAt: '2026-08-29T19:00:00.000Z',
    expiresAt: '2026-08-29T19:02:00.000Z',
  });
  return signVkCommunityOwnerGrant(assertion, privateKey);
}

function io(stdout: string[], stderr: string[]): VkCommunityExecutionVerifierIo {
  return {
    writeStdout(value) {
      stdout.push(value);
    },
    writeStderr(value) {
      stderr.push(value);
    },
  };
}

function dependencies(
  publicPem: string,
  ownerGrant: unknown,
  stateRecord = record(),
  counters: { reads: string[]; opens: number; closes: number },
): VkCommunityExecutionVerifierDependencies {
  return {
    async readTextFile(path) {
      counters.reads.push(path);
      if (path === 'manifest.json') {
        return JSON.stringify(manifest(publicPem));
      }
      return JSON.stringify(ownerGrant);
    },
    async openPublicationState() {
      counters.opens += 1;
      return {
        publicationState: {
          async findById(publicationId) {
            assert.equal(publicationId, PUBLICATION_ID);
            return stateRecord;
          },
        },
        async close() {
          counters.closes += 1;
        },
      };
    },
    clock: () => NOW,
  };
}

test('execution verifier returns a sanitized READY binding for exact fresh canonical state', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const counters = { reads: [] as string[], opens: 0, closes: 0 };

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    dependencies(pair.publicPem, grant(pair.privateKey), record(), counters),
    io(stdout, stderr),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(counters, {
    reads: ['manifest.json', 'grant.json'],
    opens: 1,
    closes: 1,
  });
  assert.deepEqual(stderr, []);

  const output = JSON.parse(stdout[0] ?? '{}') as {
    readonly status?: string;
    readonly executionBinding?: {
      readonly publicationId?: string;
      readonly ownerId?: number;
      readonly previewFingerprint?: string;
      readonly grantId?: string;
      readonly grantExpiresAt?: string;
    };
  };
  assert.equal(output.status, 'READY');
  assert.equal(output.executionBinding?.publicationId, PUBLICATION_ID);
  assert.equal(output.executionBinding?.ownerId, -123456);
  assert.equal(output.executionBinding?.grantId, 'task-019-grant');
  assert.equal(output.executionBinding?.grantExpiresAt, '2026-08-29T19:02:00.000Z');
  assert.equal(
    output.executionBinding?.previewFingerprint,
    computeVkCommunityPreviewFingerprint(preview()),
  );
  assert.doesNotMatch(
    stdout.join(''),
    /BEGIN PUBLIC KEY|PRIVATE KEY|access[_-]?token|credential|password|hmac|secret/iu,
  );
});

test('changed canonical publication invalidates an already signed grant', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const counters = { reads: [] as string[], opens: 0, closes: 0 };

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    dependencies(
      pair.publicPem,
      grant(pair.privateKey, preview('Подписанный текст')),
      record('Текст изменён после подписи'),
      counters,
    ),
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.equal(counters.closes, 1);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'OWNER_GRANT',
    reason: 'VK_OWNER_GRANT_INVALID',
  });
});

test('expired owner grant is blocked against fresh canonical state', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const counters = { reads: [] as string[], opens: 0, closes: 0 };
  const expired = signVkCommunityOwnerGrant(
    createVkCommunityOwnerGrantAssertion({
      grantId: 'expired-grant',
      publicationId: PUBLICATION_ID,
      ownerId: -123456,
      previewFingerprint: computeVkCommunityPreviewFingerprint(preview()),
      issuedAt: '2026-08-29T18:58:00.000Z',
      expiresAt: '2026-08-29T19:00:00.000Z',
    }),
    pair.privateKey,
  );

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    dependencies(pair.publicPem, expired, record(), counters),
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.equal(counters.closes, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'OWNER_GRANT',
    reason: 'VK_OWNER_GRANT_INVALID',
  });
});

test('blocked production metadata prevents grant read and PostgreSQL access', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];
  let opens = 0;
  const blocked = manifest(pair.publicPem);
  delete blocked.communityId;

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    {
      async readTextFile(path) {
        reads.push(path);
        return JSON.stringify(blocked);
      },
      async openPublicationState() {
        opens += 1;
        throw new Error('must not open');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(reads, ['manifest.json']);
  assert.equal(opens, 0);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'PRODUCTION_PREFLIGHT',
    reasons: ['COMMUNITY_ID_MISSING'],
  });
});

test('malformed grant JSON fails before PostgreSQL opens and does not reflect input', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let opens = 0;
  const rejected = '{"signature":"must-not-be-reflected"';

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    {
      async readTextFile(path) {
        if (path === 'manifest.json') {
          return JSON.stringify(manifest(pair.publicPem));
        }
        return rejected;
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
  assert.deepEqual(stderr, ['VK execution verifier input invalid\n']);
  assert.doesNotMatch(stderr.join(''), /must-not-be-reflected/u);
});

test('non-AUTO publication is safely blocked and closes the read-only lease', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const counters = { reads: [] as string[], opens: 0, closes: 0 };

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    dependencies(
      pair.publicPem,
      grant(pair.privateKey),
      { ...record(), status: 'APPROVED' as const },
      counters,
    ),
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.equal(counters.closes, 1);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'PUBLICATION',
    reason: 'VK_PUBLICATION_NOT_AUTO',
  });
});

test('database open failure is generic and does not reflect internal errors', async () => {
  const pair = keys();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runVkCommunityExecutionVerifier(
    ['verify-execution', PUBLICATION_ID, 'grant.json', 'manifest.json'],
    {
      async readTextFile(path) {
        if (path === 'manifest.json') {
          return JSON.stringify(manifest(pair.publicPem));
        }
        return JSON.stringify(grant(pair.privateKey));
      },
      async openPublicationState() {
        throw new Error('postgres password=must-not-leak');
      },
      clock: () => NOW,
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 70);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK execution verifier failed\n']);
  assert.doesNotMatch(stderr.join(''), /must-not-leak/u);
});

test('usage errors read no files or PostgreSQL state', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let reads = 0;
  let opens = 0;

  const exitCode = await runVkCommunityExecutionVerifier(
    [],
    {
      async readTextFile() {
        reads += 1;
        return '';
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
});
