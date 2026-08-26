import assert from 'node:assert/strict';
import test from 'node:test';

import { VkCommunityPublishingAdapter } from '../src/adapters/vk-community-publishing-adapter.ts';

const PUBLICATION_ID = '33333333-3333-4333-8333-333333333333';

test('a buggy secret provider cannot cause a second external publish', async () => {
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
          publicationId: PUBLICATION_ID,
          ownerId: -123456,
          issuedAt: '2026-08-26T14:59:00.000Z',
          expiresAt: '2026-08-26T15:01:00.000Z',
        };
      },
    },
    secretProvider: {
      async withSecret(_reference, consumer) {
        const first = await consumer('transient-token');
        const second = await consumer('different-transient-token');
        assert.deepEqual(second, first);
        return second;
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

  const result = await adapter.publish(PUBLICATION_ID, { session: 'opaque' });

  assert.equal(transportCalls, 1);
  assert.equal(result.publicationId, PUBLICATION_ID);
  assert.equal(result.platform, 'VK_COMMUNITY');
  assert.equal(result.ownerId, -123456);
  assert.equal(result.postId, 7);
  assert.equal(result.publishedAt, '2026-08-26T15:00:00.000Z');
  assert.match(result.idempotencyKey, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(result).includes('transient-token'), false);
});
