import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VkCommunityPublishingAdapter,
  VkCommunityPublishingError,
} from '../src/adapters/vk-community-publishing-adapter.ts';

const PUBLICATION_ID = '22222222-2222-4222-8222-222222222222';
const RAW_SESSION = 'owner-session-material-must-not-leak';

test('identity binding failures are sanitized before publication or credential access', async () => {
  let publicationReads = 0;
  let secretReads = 0;
  let transportCalls = 0;
  const adapter = new VkCommunityPublishingAdapter({
    communityId: 123456,
    secretReference: {
      provider: 'test-vault',
      key: 'publishing/vk-community/yastroyka',
    },
    publicationState: {
      async findById() {
        publicationReads += 1;
        return null;
      },
    },
    identityBinding: {
      async bind() {
        throw new Error(`invalid session ${RAW_SESSION}`);
      },
    },
    secretProvider: {
      async withSecret(_reference, consumer) {
        secretReads += 1;
        return await consumer('should-not-be-read');
      },
    },
    transport: {
      async publishWallPost(request) {
        transportCalls += 1;
        return { ownerId: request.ownerId, postId: 1 };
      },
    },
    clock: () => new Date('2026-08-26T15:00:00.000Z'),
  });

  await assert.rejects(async () => {
    try {
      await adapter.publish(PUBLICATION_ID, { session: RAW_SESSION });
    } catch (error) {
      assert.ok(error instanceof VkCommunityPublishingError);
      assert.equal(error.code, 'VK_IDENTITY_BINDING_FAILED');
      assert.equal(error.message, 'VK_IDENTITY_BINDING_FAILED');
      assert.doesNotMatch(JSON.stringify(error), new RegExp(RAW_SESSION, 'u'));
      throw error;
    }
  });

  assert.equal(publicationReads, 0);
  assert.equal(secretReads, 0);
  assert.equal(transportCalls, 0);
});
