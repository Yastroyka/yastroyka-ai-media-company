import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { HmacPublishingIdentityBinding } from '../src/adapters/hmac-publishing-identity-binding.ts';
import {
  VkCommunityPublishingError,
  computeVkCommunityPreviewFingerprint,
  type VkCommunityPublishingPreview,
  type VkCommunityPublishingResult,
} from '../src/adapters/vk-community-publishing-adapter.ts';
import {
  VkCommunityRuntimeController,
  VkCommunityRuntimeGateError,
} from '../src/vk-community-runtime-controller.ts';

const PUBLICATION_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_PUBLICATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMMUNITY_ID = 123456;
const OWNER_ID = -COMMUNITY_ID;
const NOW = '2026-08-27T00:00:00.000Z';
const { publicKey: OWNER_APPROVAL_PUBLIC_KEY_OBJECT, privateKey: OWNER_APPROVAL_PRIVATE_KEY } =
  generateKeyPairSync('ed25519');
const OWNER_APPROVAL_PUBLIC_KEY = OWNER_APPROVAL_PUBLIC_KEY_OBJECT.export({
  type: 'spki',
  format: 'pem',
}).toString();
const IDENTITY_SECRET = 'identity-secret-material-1234567890-abcdef';
const IDENTITY_SECRET_REFERENCE = {
  provider: 'env',
  key: 'publishing/identity/vk-community/runtime',
} as const;
const IDEMPOTENCY_KEY = 'c'.repeat(64);

const PREVIEW = Object.freeze({
  publicationId: PUBLICATION_ID,
  platform: 'VK_COMMUNITY' as const,
  ownerId: OWNER_ID,
  fromGroup: true as const,
  message: 'Первый безопасный тестовый пост Ястройки',
  idempotencyKey: IDEMPOTENCY_KEY,
});

const PREVIEW_FINGERPRINT = computeVkCommunityPreviewFingerprint(PREVIEW);

const RESULT = Object.freeze({
  publicationId: PUBLICATION_ID,
  platform: 'VK_COMMUNITY' as const,
  ownerId: OWNER_ID,
  postId: 4242,
  idempotencyKey: IDEMPOTENCY_KEY,
  publishedAt: '2026-08-27T00:00:01.000Z',
});

interface GrantOverrides {
  readonly publicationId?: string;
  readonly ownerId?: number;
  readonly previewFingerprint?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly signature?: string;
  readonly grantId?: string;
}

function buildGrant(overrides: GrantOverrides = {}) {
  const assertion = {
    actor_id: 'human_owner',
    audience: 'vk-community-execute',
    grant_id: overrides.grantId ?? 'owner-grant-001',
    publication_id: overrides.publicationId ?? PUBLICATION_ID,
    owner_id: overrides.ownerId ?? OWNER_ID,
    preview_fingerprint: overrides.previewFingerprint ?? PREVIEW_FINGERPRINT,
    issued_at: overrides.issuedAt ?? '2026-08-26T23:59:30.000Z',
    expires_at: overrides.expiresAt ?? '2026-08-27T00:02:00.000Z',
  } as const;
  const payload = JSON.stringify({
    version: 1,
    actor_id: assertion.actor_id,
    audience: assertion.audience,
    grant_id: assertion.grant_id,
    publication_id: assertion.publication_id,
    owner_id: assertion.owner_id,
    preview_fingerprint: assertion.preview_fingerprint,
    issued_at: assertion.issued_at,
    expires_at: assertion.expires_at,
  });
  return {
    version: 1,
    assertion,
    signature:
      overrides.signature ??
      sign(null, Buffer.from(payload, 'utf8'), OWNER_APPROVAL_PRIVATE_KEY).toString('hex'),
  };
}

function createSecretProvider(accesses: string[], overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    [IDENTITY_SECRET_REFERENCE.key]: IDENTITY_SECRET,
    ...overrides,
  };
  return {
    async withSecret<T>(
      reference: { readonly provider: string; readonly key: string },
      consumer: (secret: string) => T | Promise<T>,
    ): Promise<T> {
      accesses.push(reference.key);
      const secret = values[reference.key];
      if (secret === undefined) {
        throw new Error('raw provider missing-secret details');
      }
      return await consumer(secret);
    },
  };
}

function createController(options: {
  readonly secretAccesses?: string[];
  readonly preview?: VkCommunityPublishingPreview;
  readonly publishResult?: VkCommunityPublishingResult;
  readonly publishError?: Error;
  readonly onIdentity?: (identity: unknown) => void;
}) {
  const secretAccesses = options.secretAccesses ?? [];
  let publishCalls = 0;
  const controller = new VkCommunityRuntimeController({
    communityId: COMMUNITY_ID,
    ownerApprovalPublicKey: OWNER_APPROVAL_PUBLIC_KEY,
    publishingIdentitySecretReference: IDENTITY_SECRET_REFERENCE,
    secretProvider: createSecretProvider(secretAccesses),
    previewer: {
      async preview() {
        return options.preview ?? PREVIEW;
      },
    },
    publisher: {
      async publishAndPersist(_publicationId, identityContext) {
        publishCalls += 1;
        options.onIdentity?.(identityContext);
        if (options.publishError !== undefined) {
          throw options.publishError;
        }
        return options.publishResult ?? RESULT;
      },
    },
    clock: () => new Date(NOW),
  });

  return {
    controller,
    secretAccesses,
    publishCalls: () => publishCalls,
  };
}

test('preview and approval packet are read-only with no secret access or live publish', async () => {
  const runtime = createController({});

  assert.deepEqual(await runtime.controller.preview(PUBLICATION_ID), PREVIEW);
  assert.deepEqual(await runtime.controller.prepareApproval(PUBLICATION_ID), {
    preview: PREVIEW,
    previewFingerprint: PREVIEW_FINGERPRINT,
  });
  assert.deepEqual(runtime.secretAccesses, []);
  assert.equal(runtime.publishCalls(), 0);
});

test('valid owner grant issues a compatible short-lived publishing_service identity', async () => {
  let capturedIdentity: unknown = null;
  const runtime = createController({
    onIdentity(identity) {
      capturedIdentity = identity;
    },
  });

  assert.deepEqual(await runtime.controller.execute(PUBLICATION_ID, buildGrant()), RESULT);
  assert.deepEqual(runtime.secretAccesses, [IDENTITY_SECRET_REFERENCE.key]);
  assert.equal(runtime.publishCalls(), 1);

  const binding = new HmacPublishingIdentityBinding({
    secretReference: IDENTITY_SECRET_REFERENCE,
    secretProvider: {
      async withSecret<T>(
        _reference: { readonly provider: string; readonly key: string },
        consumer: (secret: string) => T | Promise<T>,
      ): Promise<T> {
        return await consumer(IDENTITY_SECRET);
      },
    },
  });
  const verified = await binding.bind(capturedIdentity);
  assert.deepEqual(verified, {
    actorId: 'publishing_service',
    audience: 'vk-community-publish',
    bindingId: 'owner-grant-001',
    publicationId: PUBLICATION_ID,
    ownerId: OWNER_ID,
    previewFingerprint: PREVIEW_FINGERPRINT,
    issuedAt: NOW,
    expiresAt: '2026-08-27T00:02:00.000Z',
  });
});

test('invalid owner grants fail closed before live publish', async () => {
  const cases = [
    buildGrant({ publicationId: OTHER_PUBLICATION_ID }),
    buildGrant({ ownerId: -999999 }),
    buildGrant({ previewFingerprint: 'f'.repeat(64) }),
    buildGrant({
      issuedAt: '2026-08-26T23:50:00.000Z',
      expiresAt: '2026-08-26T23:55:00.000Z',
    }),
    buildGrant({ signature: '0'.repeat(128) }),
  ];

  for (const grant of cases) {
    const runtime = createController({});
    await assert.rejects(
      () => runtime.controller.execute(PUBLICATION_ID, grant),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityRuntimeGateError);
        assert.equal(error.code, 'VK_OWNER_GRANT_FAILED');
        return true;
      },
    );
    assert.equal(runtime.publishCalls(), 0);
    assert.ok(!runtime.secretAccesses.includes(IDENTITY_SECRET_REFERENCE.key));
  }
});

test('owner grant cannot publish a canonical message changed after approval', async () => {
  const changedPreview = {
    ...PREVIEW,
    message: 'Текст изменён после owner approval',
  };
  const runtime = createController({
    preview: changedPreview,
  });

  await assert.rejects(
    () => runtime.controller.execute(PUBLICATION_ID, buildGrant()),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityRuntimeGateError);
      assert.equal(error.code, 'VK_OWNER_GRANT_FAILED');
      return true;
    },
  );
  assert.equal(runtime.publishCalls(), 0);
  assert.ok(!runtime.secretAccesses.includes(IDENTITY_SECRET_REFERENCE.key));
});

test('publishing identity secret provider failures are sanitized after owner verification', async () => {
  const rawSecret = 'raw-provider-error-containing-sensitive-context';
  let publishCalls = 0;
  const controller = new VkCommunityRuntimeController({
    communityId: COMMUNITY_ID,
    ownerApprovalPublicKey: OWNER_APPROVAL_PUBLIC_KEY,
    publishingIdentitySecretReference: IDENTITY_SECRET_REFERENCE,
    secretProvider: {
      async withSecret() {
        throw new Error(rawSecret);
      },
    },
    previewer: {
      async preview() {
        return PREVIEW;
      },
    },
    publisher: {
      async publishAndPersist() {
        publishCalls += 1;
        return RESULT;
      },
    },
    clock: () => new Date(NOW),
  });

  await assert.rejects(
    () => controller.execute(PUBLICATION_ID, buildGrant()),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityRuntimeGateError);
      assert.equal(error.code, 'VK_IDENTITY_ISSUE_FAILED');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(rawSecret, 'u'));
      return true;
    },
  );
  assert.equal(publishCalls, 0);
});

test('runtime accepts only an Ed25519 public verification key and never needs the owner private key', () => {
  assert.throws(
    () =>
      new VkCommunityRuntimeController({
        communityId: COMMUNITY_ID,
        ownerApprovalPublicKey: 'not-an-ed25519-public-key',
        publishingIdentitySecretReference: IDENTITY_SECRET_REFERENCE,
        secretProvider: createSecretProvider([]),
        previewer: {
          async preview() {
            return PREVIEW;
          },
        },
        publisher: {
          async publishAndPersist() {
            return RESULT;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityRuntimeGateError);
      assert.equal(error.code, 'VK_OWNER_GRANT_FAILED');
      return true;
    },
  );
});

test('runtime rejects preview or result evidence for another target', async () => {
  {
    const runtime = createController({
      preview: {
        ...PREVIEW,
        ownerId: -999999,
      },
    });
    await assert.rejects(
      () => runtime.controller.preview(PUBLICATION_ID),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityRuntimeGateError);
        assert.equal(error.code, 'VK_RUNTIME_PREVIEW_INVALID');
        return true;
      },
    );
    assert.deepEqual(runtime.secretAccesses, []);
    assert.equal(runtime.publishCalls(), 0);
  }

  for (const publishResult of [
    { ...RESULT, publicationId: OTHER_PUBLICATION_ID },
    { ...RESULT, ownerId: -999999 },
    { ...RESULT, idempotencyKey: 'd'.repeat(64) },
  ]) {
    const runtime = createController({
      publishResult,
    });
    await assert.rejects(
      () => runtime.controller.execute(PUBLICATION_ID, buildGrant()),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityRuntimeGateError);
        assert.equal(error.code, 'VK_RUNTIME_RESULT_INVALID');
        return true;
      },
    );
  }
});

test('safe publishing errors pass through while unknown runtime errors are sanitized', async () => {
  {
    const runtime = createController({
      publishError: new VkCommunityPublishingError('VK_RESULT_PERSIST_FAILED'),
    });
    await assert.rejects(
      () => runtime.controller.execute(PUBLICATION_ID, buildGrant()),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityPublishingError);
        assert.equal(error.code, 'VK_RESULT_PERSIST_FAILED');
        return true;
      },
    );
  }

  {
    const rawError = 'raw runtime infrastructure failure';
    const runtime = createController({
      publishError: new Error(rawError),
    });
    await assert.rejects(
      () => runtime.controller.execute(PUBLICATION_ID, buildGrant()),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityRuntimeGateError);
        assert.equal(error.code, 'VK_RUNTIME_PUBLISH_FAILED');
        assert.doesNotMatch(JSON.stringify(error), new RegExp(rawError, 'u'));
        return true;
      },
    );
  }
});
