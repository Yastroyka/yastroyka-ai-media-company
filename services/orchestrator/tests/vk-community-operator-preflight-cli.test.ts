import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  parseVkCommunityOperatorManifest,
  runVkCommunityOperatorPreflightCli,
  VkCommunityOperatorManifestError,
} from '../src/vk-community-operator-preflight-cli.ts';

function ownerPublicKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function readyManifest() {
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

function ioFor(
  text: string,
  stdout: string[],
  stderr: string[],
  reads: string[],
) {
  return {
    async readTextFile(path: string) {
      reads.push(path);
      return text;
    },
    writeStdout(value: string) {
      stdout.push(value);
    },
    writeStderr(value: string) {
      stderr.push(value);
    },
  };
}

test('operator preflight emits sanitized READY metadata only', async () => {
  const manifest = readyManifest();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];

  const exitCode = await runVkCommunityOperatorPreflightCli(
    ['preflight', 'vk-production.json'],
    ioFor(JSON.stringify(manifest), stdout, stderr, reads),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(reads, ['vk-production.json']);
  assert.deepEqual(stderr, []);
  assert.equal(stdout.length, 1);

  const result = JSON.parse(stdout[0] ?? '{}') as Record<string, unknown>;
  assert.equal(result.status, 'READY');
  assert.equal(result.communityId, 123456);
  assert.equal(result.ownerId, -123456);
  assert.match(String(result.ownerPublicKeyFingerprint), /^sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    stdout.join(''),
    /BEGIN PUBLIC KEY|PRIVATE KEY|access[_-]?token|hmac/iu,
  );
});

test('operator preflight emits BLOCKED and exit code 2 for incomplete metadata', async () => {
  const manifest = readyManifest();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];
  const withoutCommunityId = {
    ownerApprovalPublicKey: manifest.ownerApprovalPublicKey,
    vkCredentialSecretReference: manifest.vkCredentialSecretReference,
    publishingIdentitySecretReference: manifest.publishingIdentitySecretReference,
  };

  const exitCode = await runVkCommunityOperatorPreflightCli(
    ['preflight', 'vk-production.json'],
    ioFor(JSON.stringify(withoutCommunityId), stdout, stderr, reads),
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    reasons: ['COMMUNITY_ID_MISSING'],
  });
});

test(
  'operator manifest rejects unknown top-level fields without reflecting secret input',
  async () => {
    const rejectedSecret = 'must-never-be-reflected';
    const stdout: string[] = [];
    const stderr: string[] = [];
    const reads: string[] = [];
    const manifest = {
      ...readyManifest(),
      vkAccessToken: rejectedSecret,
    };

    const exitCode = await runVkCommunityOperatorPreflightCli(
      ['preflight', 'vk-production.json'],
      ioFor(JSON.stringify(manifest), stdout, stderr, reads),
    );

    assert.equal(exitCode, 65);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, ['VK production preflight manifest invalid\n']);
    assert.doesNotMatch(stderr.join(''), new RegExp(rejectedSecret, 'u'));
  },
);

test(
  'operator preflight delegates inline secret-reference fields to fail-closed canonical validation',
  async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const reads: string[] = [];
    const manifest = {
      ...readyManifest(),
      vkCredentialSecretReference: {
        provider: 'env',
        key: 'publishing/vk-community/yastroyka',
        token: 'inline-secret-must-not-be-accepted',
      },
    };

    const exitCode = await runVkCommunityOperatorPreflightCli(
      ['preflight', 'vk-production.json'],
      ioFor(JSON.stringify(manifest), stdout, stderr, reads),
    );

    assert.equal(exitCode, 2);
    assert.deepEqual(stderr, []);
    const result = JSON.parse(stdout[0] ?? '{}') as {
      readonly status?: string;
      readonly reasons?: readonly string[];
    };
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.reasons, ['VK_CREDENTIAL_REFERENCE_INVALID']);
    assert.doesNotMatch(stdout.join(''), /inline-secret-must-not-be-accepted/u);
  },
);

test('usage errors do not read a manifest', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const reads: string[] = [];

  const exitCode = await runVkCommunityOperatorPreflightCli(
    [],
    ioFor('{}', stdout, stderr, reads),
  );

  assert.equal(exitCode, 64);
  assert.deepEqual(reads, []);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['Usage: vk:preflight <non-secret-manifest.json>\n']);
});

test('manifest parser rejects malformed, oversized, NUL and array inputs', () => {
  for (const value of [
    '{',
    'x'.repeat(65_537),
    '{"communityId":"\u0000"}',
    '[]',
  ]) {
    assert.throws(
      () => parseVkCommunityOperatorManifest(value),
      VkCommunityOperatorManifestError,
    );
  }
});
