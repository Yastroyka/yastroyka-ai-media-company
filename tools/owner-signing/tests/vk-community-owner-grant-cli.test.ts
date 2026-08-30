import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  computeVkCommunityPreviewFingerprint,
  verifyVkCommunityOwnerGrant,
  type VkCommunityPublishingPreview,
} from '@yastroyka/orchestrator';

import {
  parseVkCommunityApprovalPacketOutput,
  runVkCommunityOwnerGrantCli,
  type VkCommunityOwnerGrantCliIo,
} from '../src/vk-community-owner-grant-cli.ts';

const PUBLICATION_ID = '99999999-9999-4999-8999-999999999999';
const CLOCK = new Date('2026-08-28T00:00:00.000Z');

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
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

function approvalPacket(ownerId = -123456): Record<string, unknown> {
  const preview: VkCommunityPublishingPreview = {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    ownerId,
    fromGroup: true,
    message: 'Точный текст первого реального поста Ястройки',
    idempotencyKey: createHash('sha256').update(PUBLICATION_ID, 'utf8').digest('hex'),
  };
  return {
    status: 'READY',
    approvalPacket: {
      preview,
      previewFingerprint: computeVkCommunityPreviewFingerprint(preview),
    },
  };
}

function io(stdout: string[], stderr: string[]): VkCommunityOwnerGrantCliIo {
  return {
    writeStdout(value) {
      stdout.push(value);
    },
    writeStderr(value) {
      stderr.push(value);
    },
  };
}

test('owner signer produces a two-minute self-verifying grant without exposing private material', async () => {
  const keys = keyPair();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];

  const exitCode = await runVkCommunityOwnerGrantCli(
    ['sign-grant', 'approval.json', 'manifest.json', 'owner-private.pem'],
    {
      async readTextFile(path) {
        reads.push(path);
        if (path === 'manifest.json') {
          return JSON.stringify(manifest(keys.publicPem));
        }
        if (path === 'approval.json') {
          return JSON.stringify(approvalPacket());
        }
        return keys.privatePem;
      },
      clock: () => CLOCK,
      grantIdFactory: () => 'task-018-test-grant',
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reads, ['manifest.json', 'approval.json', 'owner-private.pem']);
  assert.deepEqual(stderr, []);
  assert.equal(stdout.length, 1);
  assert.doesNotMatch(stdout[0] ?? '', /PRIVATE KEY|BEGIN PUBLIC KEY|credential|password|hmac/iu);

  const grant = JSON.parse(stdout[0] ?? '{}') as {
    readonly assertion?: {
      readonly issued_at?: string;
      readonly expires_at?: string;
      readonly publication_id?: string;
      readonly owner_id?: number;
      readonly preview_fingerprint?: string;
    };
  };
  assert.equal(grant.assertion?.issued_at, '2026-08-28T00:00:00.000Z');
  assert.equal(grant.assertion?.expires_at, '2026-08-28T00:02:00.000Z');
  assert.equal(grant.assertion?.publication_id, PUBLICATION_ID);
  assert.equal(grant.assertion?.owner_id, -123456);

  const packet = parseVkCommunityApprovalPacketOutput(JSON.stringify(approvalPacket()));
  verifyVkCommunityOwnerGrant({
    grant,
    ownerApprovalPublicKey: keys.publicPem,
    publicationId: PUBLICATION_ID,
    ownerId: -123456,
    previewFingerprint: packet.previewFingerprint,
    now: CLOCK,
  });
});

test('blocked production metadata returns before approval packet or private key is read', async () => {
  const keys = keyPair();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];
  const blockedManifest = manifest(keys.publicPem);
  delete blockedManifest.communityId;

  const exitCode = await runVkCommunityOwnerGrantCli(
    ['sign-grant', 'approval.json', 'manifest.json', 'owner-private.pem'],
    {
      async readTextFile(path) {
        reads.push(path);
        return JSON.stringify(blockedManifest);
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(reads, ['manifest.json']);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'PRODUCTION_PREFLIGHT',
    reasons: ['COMMUNITY_ID_MISSING'],
  });
});

test('tampered approval packet fails before private key access', async () => {
  const keys = keyPair();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];
  const packet = approvalPacket() as {
    approvalPacket: {
      previewFingerprint: string;
    };
  };
  packet.approvalPacket.previewFingerprint = 'b'.repeat(64);

  const exitCode = await runVkCommunityOwnerGrantCli(
    ['sign-grant', 'approval.json', 'manifest.json', 'owner-private.pem'],
    {
      async readTextFile(path) {
        reads.push(path);
        if (path === 'manifest.json') {
          return JSON.stringify(manifest(keys.publicPem));
        }
        if (path === 'approval.json') {
          return JSON.stringify(packet);
        }
        throw new Error('private key must not be read');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 65);
  assert.deepEqual(reads, ['manifest.json', 'approval.json']);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK owner grant signer input invalid\n']);
});

test('destination mismatch fails before private key access', async () => {
  const keys = keyPair();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];

  const exitCode = await runVkCommunityOwnerGrantCli(
    ['sign-grant', 'approval.json', 'manifest.json', 'owner-private.pem'],
    {
      async readTextFile(path) {
        reads.push(path);
        if (path === 'manifest.json') {
          return JSON.stringify(manifest(keys.publicPem, 123456));
        }
        if (path === 'approval.json') {
          return JSON.stringify(approvalPacket(-654321));
        }
        throw new Error('private key must not be read');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 65);
  assert.deepEqual(reads, ['manifest.json', 'approval.json']);
  assert.deepEqual(stdout, []);
});

test('wrong owner private key fails closed without reflecting key material', async () => {
  const configured = keyPair();
  const wrong = keyPair();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runVkCommunityOwnerGrantCli(
    ['sign-grant', 'approval.json', 'manifest.json', 'owner-private.pem'],
    {
      async readTextFile(path) {
        if (path === 'manifest.json') {
          return JSON.stringify(manifest(configured.publicPem));
        }
        if (path === 'approval.json') {
          return JSON.stringify(approvalPacket());
        }
        return wrong.privatePem;
      },
      clock: () => CLOCK,
      grantIdFactory: () => 'wrong-key-test',
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 65);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK owner grant signer input invalid\n']);
  assert.doesNotMatch(stderr.join(''), /PRIVATE KEY|wrong-key-test/iu);
});

test('usage errors read no files', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let reads = 0;

  const exitCode = await runVkCommunityOwnerGrantCli(
    [],
    {
      async readTextFile() {
        reads += 1;
        return '';
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 64);
  assert.equal(reads, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    'Usage: vk:sign-grant <approval-packet.json> <non-secret-manifest.json> <private-key.pem>\n',
  ]);
});
