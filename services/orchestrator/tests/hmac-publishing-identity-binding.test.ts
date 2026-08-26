import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  HmacPublishingIdentityBinding,
  PublishingIdentityVerificationError,
} from '../src/adapters/hmac-publishing-identity-binding.ts';

const PUBLICATION_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_ID = -123456;
const HMAC_SECRET = 'identity-verification-key-32-bytes-minimum-material';

function identityContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const assertion = {
    actor_id: 'publishing_service',
    audience: 'vk-community-publish',
    binding_id: 'binding:vk:001',
    publication_id: PUBLICATION_ID,
    owner_id: OWNER_ID,
    issued_at: '2026-08-26T19:59:00.000Z',
    expires_at: '2026-08-26T20:01:00.000Z',
    ...overrides,
  };
  const payload = JSON.stringify({ version: 1, ...assertion });
  return {
    version: 1,
    assertion,
    signature: createHmac('sha256', HMAC_SECRET).update(payload, 'utf8').digest('hex'),
  };
}

test('signed identity is verified and binds exact publication plus VK destination', async () => {
  let observedReference: unknown = null;
  const binding = new HmacPublishingIdentityBinding({
    secretReference: {
      provider: 'env',
      key: 'publishing/identity/vk-community/hmac',
    },
    secretProvider: {
      async withSecret(reference, consumer) {
        observedReference = reference;
        return await consumer(HMAC_SECRET);
      },
    },
  });

  const result = await binding.bind(identityContext());

  assert.deepEqual(observedReference, {
    provider: 'env',
    key: 'publishing/identity/vk-community/hmac',
  });
  assert.deepEqual(result, {
    actorId: 'publishing_service',
    audience: 'vk-community-publish',
    bindingId: 'binding:vk:001',
    publicationId: PUBLICATION_ID,
    ownerId: OWNER_ID,
    issuedAt: '2026-08-26T19:59:00.000Z',
    expiresAt: '2026-08-26T20:01:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(HMAC_SECRET, 'u'));
});

test('caller-controlled role, resource or signature tampering fails closed', async () => {
  const binding = new HmacPublishingIdentityBinding({
    secretReference: {
      provider: 'env',
      key: 'publishing/identity/vk-community/hmac',
    },
    secretProvider: {
      async withSecret(_reference, consumer) {
        return await consumer(HMAC_SECRET);
      },
    },
  });

  const tampered = identityContext();
  const assertion = tampered.assertion as Record<string, unknown>;
  assertion.publication_id = '55555555-5555-4555-8555-555555555555';

  await assert.rejects(
    () => binding.bind(tampered),
    (error: unknown) => {
      assert.ok(error instanceof PublishingIdentityVerificationError);
      assert.equal(error.message, 'publishing identity verification failed');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(HMAC_SECRET, 'u'));
      return true;
    },
  );

  await assert.rejects(
    () => binding.bind(identityContext({ actor_id: 'claude_orchestrator' })),
    PublishingIdentityVerificationError,
  );
});

test('identity verifier rejects unrelated secret namespaces and provider failures without leakage', async () => {
  assert.throws(
    () =>
      new HmacPublishingIdentityBinding({
        secretReference: {
          provider: 'env',
          key: 'publishing/vk-community/access-token',
        },
        secretProvider: {
          async withSecret() {
            throw new Error('not used');
          },
        },
      }),
    PublishingIdentityVerificationError,
  );

  const binding = new HmacPublishingIdentityBinding({
    secretReference: {
      provider: 'env',
      key: 'publishing/identity/vk-community/hmac',
    },
    secretProvider: {
      async withSecret() {
        throw new Error(`raw provider error ${HMAC_SECRET}`);
      },
    },
  });

  await assert.rejects(
    () => binding.bind(identityContext()),
    (error: unknown) => {
      assert.ok(error instanceof PublishingIdentityVerificationError);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(HMAC_SECRET, 'u'));
      return true;
    },
  );
});
