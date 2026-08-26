import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VkCommunityPublishingAdapter,
  VkCommunityPublishingError,
  type PublishingIdentityBinding,
  type VkCommunityPublishingAdapterOptions,
  type VkCommunityPublicationRecord,
  type VkCommunitySecretProviderPort,
} from '../src/adapters/vk-community-publishing-adapter.ts';

const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-26T15:00:00.000Z');
const TOKEN = 'vk-secret-token-that-must-never-leak';

function publication(
  overrides: Partial<VkCommunityPublicationRecord> = {},
): VkCommunityPublicationRecord {
  return {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    status: 'AUTO',
    payload: {
      vk_community: {
        message: 'Первый безопасный пост Ястройки',
      },
      publishing: {
        mode: 'AUTO',
      },
    },
    ...overrides,
  };
}

function validBinding(
  overrides: Partial<PublishingIdentityBinding> = {},
): PublishingIdentityBinding {
  return {
    actorId: 'publishing_service',
    audience: 'vk-community-publish',
    bindingId: 'session:publishing:001',
    issuedAt: '2026-08-26T14:59:00.000Z',
    expiresAt: '2026-08-26T15:01:00.000Z',
    ...overrides,
  };
}

function defaultOptions(
  overrides: Partial<VkCommunityPublishingAdapterOptions> = {},
): VkCommunityPublishingAdapterOptions {
  return {
    communityId: 123456,
    secretReference: {
      provider: 'test-vault',
      key: 'publishing/vk-community/yastroyka',
    },
    publicationState: {
      async findById() {
        return publication();
      },
    },
    identityBinding: {
      async bind() {
        return validBinding();
      },
    },
    secretProvider: {
      async withSecret(_reference, consumer) {
        return await consumer(TOKEN);
      },
    },
    transport: {
      async publishWallPost(request) {
        return { ownerId: request.ownerId, postId: 77 };
      },
    },
    clock: () => new Date(NOW),
    ...overrides,
  };
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof VkCommunityPublishingError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  };
}

test('preview is read-only, canonical and deterministic without touching identity or secrets', async () => {
  let identityCalls = 0;
  let secretCalls = 0;
  let transportCalls = 0;
  const adapter = new VkCommunityPublishingAdapter(
    defaultOptions({
      identityBinding: {
        async bind() {
          identityCalls += 1;
          return validBinding();
        },
      },
      secretProvider: {
        async withSecret(_reference, consumer) {
          secretCalls += 1;
          return await consumer(TOKEN);
        },
      },
      transport: {
        async publishWallPost(request) {
          transportCalls += 1;
          return { ownerId: request.ownerId, postId: 1 };
        },
      },
    }),
  );

  const first = await adapter.preview(PUBLICATION_ID);
  const second = await adapter.preview(PUBLICATION_ID);

  assert.deepEqual(first, second);
  assert.equal(first.publicationId, PUBLICATION_ID);
  assert.equal(first.platform, 'VK_COMMUNITY');
  assert.equal(first.ownerId, -123456);
  assert.equal(first.fromGroup, true);
  assert.equal(first.message, 'Первый безопасный пост Ястройки');
  assert.match(first.idempotencyKey, /^[0-9a-f]{64}$/u);
  assert.equal(identityCalls, 0);
  assert.equal(secretCalls, 0);
  assert.equal(transportCalls, 0);
  assert.doesNotMatch(JSON.stringify(first), /token|secret/iu);
});

test('preview fails closed unless canonical publication is exact VK_COMMUNITY AUTO state', async () => {
  const wrongStatus = new VkCommunityPublishingAdapter(
    defaultOptions({
      publicationState: {
        async findById() {
          return publication({ status: 'APPROVED' });
        },
      },
    }),
  );
  await assert.rejects(
    () => wrongStatus.preview(PUBLICATION_ID),
    expectCode('VK_PUBLICATION_NOT_AUTO'),
  );

  const wrongPlatform = new VkCommunityPublishingAdapter(
    defaultOptions({
      publicationState: {
        async findById() {
          return publication({ platform: 'MAX' });
        },
      },
    }),
  );
  await assert.rejects(
    () => wrongPlatform.preview(PUBLICATION_ID),
    expectCode('VK_PUBLICATION_INVALID'),
  );

  const malformedPayload = new VkCommunityPublishingAdapter(
    defaultOptions({
      publicationState: {
        async findById() {
          return publication({ payload: { vk_community: { message: 'ok', token: 'forged' } } });
        },
      },
    }),
  );
  await assert.rejects(
    () => malformedPayload.preview(PUBLICATION_ID),
    expectCode('VK_PUBLICATION_INVALID'),
  );
});

test('untrusted identity is denied before canonical publication, secret and transport access', async () => {
  let publicationReads = 0;
  let secretCalls = 0;
  let transportCalls = 0;
  const adapter = new VkCommunityPublishingAdapter(
    defaultOptions({
      identityBinding: {
        async bind() {
          return validBinding({ actorId: 'claude_orchestrator' });
        },
      },
      publicationState: {
        async findById() {
          publicationReads += 1;
          return publication();
        },
      },
      secretProvider: {
        async withSecret(_reference, consumer) {
          secretCalls += 1;
          return await consumer(TOKEN);
        },
      },
      transport: {
        async publishWallPost(request) {
          transportCalls += 1;
          return { ownerId: request.ownerId, postId: 1 };
        },
      },
    }),
  );

  await assert.rejects(
    () => adapter.publish(PUBLICATION_ID, { session: 'opaque' }),
    expectCode('VK_IDENTITY_DENIED'),
  );
  assert.equal(publicationReads, 0);
  assert.equal(secretCalls, 0);
  assert.equal(transportCalls, 0);
});

test('expired or overlong publishing bindings fail closed', async () => {
  const expired = new VkCommunityPublishingAdapter(
    defaultOptions({
      identityBinding: {
        async bind() {
          return validBinding({ expiresAt: '2026-08-26T14:59:59.000Z' });
        },
      },
    }),
  );
  await assert.rejects(
    () => expired.publish(PUBLICATION_ID, null),
    expectCode('VK_IDENTITY_DENIED'),
  );

  const overlong = new VkCommunityPublishingAdapter(
    defaultOptions({
      identityBinding: {
        async bind() {
          return validBinding({
            issuedAt: '2026-08-26T14:55:00.000Z',
            expiresAt: '2026-08-26T15:05:01.000Z',
          });
        },
      },
    }),
  );
  await assert.rejects(
    () => overlong.publish(PUBLICATION_ID, null),
    expectCode('VK_IDENTITY_DENIED'),
  );
});

test('VK credential reference is namespace-bound and rejects inline or unrelated secret references', () => {
  assert.throws(
    () =>
      new VkCommunityPublishingAdapter(
        defaultOptions({
          secretReference: {
            provider: 'test-vault',
            key: 'providers/openai/api-key',
          },
        }),
      ),
    expectCode('VK_SECRET_REFERENCE_INVALID'),
  );

  assert.throws(
    () =>
      new VkCommunityPublishingAdapter(
        defaultOptions({
          secretReference: {
            provider: 'test-vault',
            key: 'publishing/vk-community/yastroyka',
            token: TOKEN,
          },
        }),
      ),
    expectCode('VK_SECRET_REFERENCE_INVALID'),
  );
});

test('secret-provider failures are sanitized and never expose raw secret material', async () => {
  const secretProvider: VkCommunitySecretProviderPort = {
    async withSecret() {
      throw new Error(`vault failed while reading ${TOKEN}`);
    },
  };
  const adapter = new VkCommunityPublishingAdapter(defaultOptions({ secretProvider }));

  await assert.rejects(async () => {
    try {
      await adapter.publish(PUBLICATION_ID, { session: 'opaque' });
    } catch (error) {
      assert.doesNotMatch(JSON.stringify(error), new RegExp(TOKEN, 'u'));
      throw error;
    }
  }, expectCode('VK_SECRET_ACCESS_FAILED'));
});

test('transport failures are sanitized and transient VK token never enters result or error evidence', async () => {
  const adapter = new VkCommunityPublishingAdapter(
    defaultOptions({
      transport: {
        async publishWallPost(_request, accessToken) {
          assert.equal(accessToken, TOKEN);
          throw new Error(`VK raw response leaked token=${accessToken}`);
        },
      },
    }),
  );

  await assert.rejects(async () => {
    try {
      await adapter.publish(PUBLICATION_ID, { session: 'opaque' });
    } catch (error) {
      assert.doesNotMatch(JSON.stringify(error), new RegExp(TOKEN, 'u'));
      throw error;
    }
  }, expectCode('VK_TRANSPORT_FAILED'));
});

test('successful publish returns only sanitized canonical evidence and stable idempotency', async () => {
  let observedReference: unknown = null;
  let observedToken: string | null = null;
  let observedRequest: unknown = null;
  const adapter = new VkCommunityPublishingAdapter(
    defaultOptions({
      secretProvider: {
        async withSecret(reference, consumer) {
          observedReference = reference;
          return await consumer(TOKEN);
        },
      },
      transport: {
        async publishWallPost(request, accessToken) {
          observedRequest = request;
          observedToken = accessToken;
          return { ownerId: request.ownerId, postId: 4242 };
        },
      },
    }),
  );

  const preview = await adapter.preview(PUBLICATION_ID);
  const result = await adapter.publish(PUBLICATION_ID, { session: 'opaque' });

  assert.deepEqual(observedReference, {
    provider: 'test-vault',
    key: 'publishing/vk-community/yastroyka',
  });
  assert.equal(observedToken, TOKEN);
  assert.deepEqual(observedRequest, {
    ownerId: -123456,
    fromGroup: true,
    message: 'Первый безопасный пост Ястройки',
    idempotencyKey: preview.idempotencyKey,
  });
  assert.deepEqual(result, {
    publicationId: PUBLICATION_ID,
    platform: 'VK_COMMUNITY',
    ownerId: -123456,
    postId: 4242,
    idempotencyKey: preview.idempotencyKey,
    publishedAt: NOW.toISOString(),
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN, 'u'));
});

test('transport evidence for another destination or invalid post id fails closed', async () => {
  const wrongDestination = new VkCommunityPublishingAdapter(
    defaultOptions({
      transport: {
        async publishWallPost() {
          return { ownerId: -999999, postId: 1 };
        },
      },
    }),
  );
  await assert.rejects(
    () => wrongDestination.publish(PUBLICATION_ID, { session: 'opaque' }),
    expectCode('VK_TRANSPORT_EVIDENCE_INVALID'),
  );

  const invalidPostId = new VkCommunityPublishingAdapter(
    defaultOptions({
      transport: {
        async publishWallPost(request) {
          return { ownerId: request.ownerId, postId: 0 };
        },
      },
    }),
  );
  await assert.rejects(
    () => invalidPostId.publish(PUBLICATION_ID, { session: 'opaque' }),
    expectCode('VK_TRANSPORT_EVIDENCE_INVALID'),
  );
});
