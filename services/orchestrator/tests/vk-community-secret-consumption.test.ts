import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VkCommunityPublishingAdapter,
  VkCommunityPublishingError,
} from '../src/adapters/vk-community-publishing-adapter.ts';

const PUBLICATION_ID = '33333333-3333-4333-8333-333333333333';

test('a buggy secret provider cannot invoke the publish consumer twice', async () => {
  let transportCalls = 0;
  const adapter = new VkCommunityPublishingAdapter({
    communityId: 123456,
    secretReference: {
      provider: 'test-vault',
      key: 'publishing/vk-community/yastroyka',
    },
    publicationState: {
      async findById() {
        return {
          publicationId: PUBLICATION_ID,
          platform: 'VK_COMMUNITY',
          status: 'AUTO',
          payload: {
            vk_community: {
              message: 'Single external write only',
            },
          },
        };
      },
    },
    identityBinding: {
      async bind() {
        return {
          actorId: 'publishing_service',
          audience: 'vk-community-publish',
          bindingId: 'session:publishing:single-use',
          issuedAt: '2026-08-26T14:59:00.000Z',
          expiresAt: '2026-08-26T15:01:00.000Z',
        };
      },
    },
    secretProvider: {
      async withSecret(_reference, consumer) {
        await consumer('transient-token');
        return await consumer('transient-token');
      },
    },
    transport: {
      async publishWallPost(request) {
        transportCalls += 1;
        return { ownerId: request.ownerId, postId: 7 };
      },
    },
    clock: () => new Date('2026-08-26T15:00:00.000Z'),
  });

  await assert.rejects(async () => {
    try {
      await adapter.publish(PUBLICATION_ID, { session: 'opaque' });
    } catch (error) {
      assert.ok(error instanceof VkCommunityPublishingError);
      assert.equal(error.code, 'VK_SECRET_CONSUMER_REUSED');
      assert.equal(error.message, 'VK_SECRET_CONSUMER_REUSED');
      throw error;
    }
  });

  assert.equal(transportCalls, 1);
});
