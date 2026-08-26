import assert from 'node:assert/strict';
import test from 'node:test';

import { VkCommunityPublishingError } from '../src/adapters/vk-community-publishing-adapter.ts';
import {
  VkCommunityLivePublisher,
  type VkCommunityPersistedResultRecord,
} from '../src/vk-community-live-publisher.ts';

const PUBLICATION_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_PUBLICATION_ID = '88888888-8888-4888-8888-888888888888';
const COMMUNITY_ID = 123456;
const OWNER_ID = -COMMUNITY_ID;
const EXTERNAL_RESULT = {
  publicationId: PUBLICATION_ID,
  platform: 'VK_COMMUNITY' as const,
  ownerId: OWNER_ID,
  postId: 4242,
  idempotencyKey: 'a'.repeat(64),
  publishedAt: '2026-08-26T20:30:00.000Z',
};

function persistedResult(
  overrides: Partial<VkCommunityPersistedResultRecord> = {},
): VkCommunityPersistedResultRecord {
  return {
    ...EXTERNAL_RESULT,
    status: 'PUBLISHED',
    ...overrides,
  };
}

test('successful VK write is followed by exact canonical result persistence', async () => {
  let observedInput: unknown = null;
  const publisher = new VkCommunityLivePublisher({
    communityId: COMMUNITY_ID,
    execution: {
      async publish() {
        return EXTERNAL_RESULT;
      },
    },
    results: {
      async recordSuccess(input) {
        observedInput = input;
        return persistedResult();
      },
    },
  });

  const result = await publisher.publishAndPersist(PUBLICATION_ID, { signed: 'identity' });

  assert.deepEqual(observedInput, {
    publicationId: PUBLICATION_ID,
    actorId: 'publishing_service',
    ownerId: OWNER_ID,
    postId: 4242,
    idempotencyKey: 'a'.repeat(64),
    publishedAt: '2026-08-26T20:30:00.000Z',
  });
  assert.deepEqual(result, EXTERNAL_RESULT);
});

test('execution evidence for another publication or VK destination is rejected before persistence', async () => {
  for (const external of [
    { ...EXTERNAL_RESULT, publicationId: OTHER_PUBLICATION_ID },
    { ...EXTERNAL_RESULT, ownerId: -999999 },
  ]) {
    let resultWrites = 0;
    const publisher = new VkCommunityLivePublisher({
      communityId: COMMUNITY_ID,
      execution: {
        async publish() {
          return external;
        },
      },
      results: {
        async recordSuccess() {
          resultWrites += 1;
          return persistedResult();
        },
      },
    });

    await assert.rejects(
      () => publisher.publishAndPersist(PUBLICATION_ID, null),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityPublishingError);
        assert.equal(error.code, 'VK_RESULT_EVIDENCE_INVALID');
        return true;
      },
    );
    assert.equal(resultWrites, 0);
  }
});

test('transport or identity failure never writes a canonical success result', async () => {
  let resultWrites = 0;
  const publisher = new VkCommunityLivePublisher({
    communityId: COMMUNITY_ID,
    execution: {
      async publish() {
        throw new VkCommunityPublishingError('VK_TRANSPORT_FAILED');
      },
    },
    results: {
      async recordSuccess() {
        resultWrites += 1;
        return persistedResult();
      },
    },
  });

  await assert.rejects(
    () => publisher.publishAndPersist(PUBLICATION_ID, null),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityPublishingError);
      assert.equal(error.code, 'VK_TRANSPORT_FAILED');
      return true;
    },
  );
  assert.equal(resultWrites, 0);
});

test('persistence failure is sanitized so external post evidence can be retried by guid', async () => {
  const RAW_DATABASE_ERROR = 'postgres raw error with infrastructure details';
  const publisher = new VkCommunityLivePublisher({
    communityId: COMMUNITY_ID,
    execution: {
      async publish() {
        return EXTERNAL_RESULT;
      },
    },
    results: {
      async recordSuccess() {
        throw new Error(RAW_DATABASE_ERROR);
      },
    },
  });

  await assert.rejects(
    () => publisher.publishAndPersist(PUBLICATION_ID, null),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityPublishingError);
      assert.equal(error.code, 'VK_RESULT_PERSIST_FAILED');
      assert.equal(error.message, 'VK_RESULT_PERSIST_FAILED');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(RAW_DATABASE_ERROR, 'u'));
      return true;
    },
  );
});

test('canonical persistence cannot substitute different VK evidence', async () => {
  for (const persisted of [
    persistedResult({ postId: 9999 }),
    persistedResult({ idempotencyKey: 'b'.repeat(64) }),
    persistedResult({ ownerId: -999999 }),
    persistedResult({ publishedAt: '2026-08-26T20:31:00.000Z' }),
  ]) {
    const publisher = new VkCommunityLivePublisher({
      communityId: COMMUNITY_ID,
      execution: {
        async publish() {
          return EXTERNAL_RESULT;
        },
      },
      results: {
        async recordSuccess() {
          return persisted;
        },
      },
    });

    await assert.rejects(
      () => publisher.publishAndPersist(PUBLICATION_ID, null),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityPublishingError);
        assert.equal(error.code, 'VK_RESULT_EVIDENCE_INVALID');
        return true;
      },
    );
  }
});
