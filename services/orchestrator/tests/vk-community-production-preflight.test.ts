import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { preflightVkCommunityProductionActivation } from '../src/vk-community-production-preflight.ts';

function ownerPublicKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

test('production preflight is side-effect free and blocks missing metadata explicitly', () => {
  const result = preflightVkCommunityProductionActivation({});

  assert.deepEqual(result, {
    status: 'BLOCKED',
    reasons: [
      'COMMUNITY_ID_MISSING',
      'OWNER_PUBLIC_KEY_MISSING',
      'VK_CREDENTIAL_REFERENCE_MISSING',
      'PUBLISHING_IDENTITY_REFERENCE_MISSING',
    ],
  });
});

test('production preflight rejects invalid destination, public key and secret namespaces', () => {
  const result = preflightVkCommunityProductionActivation({
    communityId: -1,
    ownerApprovalPublicKey: 'not-an-ed25519-key',
    vkCredentialSecretReference: {
      provider: 'env',
      key: 'providers/openai/api-key',
    },
    publishingIdentitySecretReference: {
      provider: 'env',
      key: 'publishing/vk-community/access-token',
    },
  });

  assert.deepEqual(result, {
    status: 'BLOCKED',
    reasons: [
      'COMMUNITY_ID_INVALID',
      'OWNER_PUBLIC_KEY_INVALID',
      'VK_CREDENTIAL_REFERENCE_INVALID',
      'PUBLISHING_IDENTITY_REFERENCE_INVALID',
    ],
  });
});

test('production preflight returns sanitized READY metadata without secret values', () => {
  const result = preflightVkCommunityProductionActivation({
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
  });

  assert.equal(result.status, 'READY');
  if (result.status !== 'READY') {
    assert.fail('expected READY');
  }
  assert.equal(result.communityId, 123456);
  assert.equal(result.ownerId, -123456);
  assert.match(result.ownerPublicKeyFingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.vkCredentialSecretReference, {
    provider: 'env',
    key: 'publishing/vk-community/yastroyka',
  });
  assert.deepEqual(result.publishingIdentitySecretReference, {
    provider: 'env',
    key: 'publishing/identity/vk-community/runtime',
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /access[_-]?token|private key|hmac-secret|credential-value/iu,
  );
});

test('production preflight rejects extra inline secret fields', () => {
  const result = preflightVkCommunityProductionActivation({
    communityId: 123456,
    ownerApprovalPublicKey: ownerPublicKey(),
    vkCredentialSecretReference: {
      provider: 'env',
      key: 'publishing/vk-community/yastroyka',
      token: 'must-not-be-accepted',
    },
    publishingIdentitySecretReference: {
      provider: 'env',
      key: 'publishing/identity/vk-community/runtime',
      secret: 'must-not-be-accepted',
    },
  });

  assert.deepEqual(result, {
    status: 'BLOCKED',
    reasons: [
      'VK_CREDENTIAL_REFERENCE_INVALID',
      'PUBLISHING_IDENTITY_REFERENCE_INVALID',
    ],
  });
});
