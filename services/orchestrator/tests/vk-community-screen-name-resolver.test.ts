import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VK_RESOLVE_SCREEN_NAME_ENDPOINT,
  VkCommunityScreenNameResolver,
  VkCommunityScreenNameResolverError,
} from '../src/index.ts';

const ACCESS_TOKEN = 'vk-test-token-must-never-leak';

test('resolver posts screen name and token to official VK endpoint and returns group binding', async () => {
  let requestBody = '';
  const resolver = new VkCommunityScreenNameResolver({
    async fetchImplementation(input, init) {
      assert.equal(String(input), VK_RESOLVE_SCREEN_NAME_ENDPOINT);
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({
          response: {
            type: 'group',
            object_id: 123456,
          },
        }),
        { status: 200 },
      );
    },
  });

  const result = await resolver.resolve('yastroykaru', ACCESS_TOKEN);

  assert.deepEqual(result, {
    screenName: 'yastroykaru',
    objectType: 'group',
    communityId: 123456,
    ownerId: -123456,
  });

  const body = new URLSearchParams(requestBody);
  assert.equal(body.get('screen_name'), 'yastroykaru');
  assert.equal(body.get('access_token'), ACCESS_TOKEN);
  assert.equal(body.get('v'), '5.199');
});

test('resolver accepts public-page community type', async () => {
  const resolver = new VkCommunityScreenNameResolver({
    async fetchImplementation() {
      return new Response(
        JSON.stringify({
          response: {
            type: 'page',
            object_id: 987654,
          },
        }),
        { status: 200 },
      );
    },
  });

  assert.deepEqual(await resolver.resolve('yastroykaru', ACCESS_TOKEN), {
    screenName: 'yastroykaru',
    objectType: 'page',
    communityId: 987654,
    ownerId: -987654,
  });
});

test('resolver rejects non-community objects without reflecting secret material', async () => {
  const resolver = new VkCommunityScreenNameResolver({
    async fetchImplementation() {
      return new Response(
        JSON.stringify({
          response: {
            type: 'user',
            object_id: 1,
          },
        }),
        { status: 200 },
      );
    },
  });

  await assert.rejects(
    resolver.resolve('yastroykaru', ACCESS_TOKEN),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityScreenNameResolverError);
      assert.doesNotMatch(error.message, new RegExp(ACCESS_TOKEN, 'u'));
      return true;
    },
  );
});

test('resolver rejects malformed input before network access', async () => {
  let fetchCalls = 0;
  const resolver = new VkCommunityScreenNameResolver({
    async fetchImplementation() {
      fetchCalls += 1;
      throw new Error('must not fetch');
    },
  });

  await assert.rejects(resolver.resolve('https://vk.ru/yastroykaru', ACCESS_TOKEN),
    VkCommunityScreenNameResolverError,
  );
  assert.equal(fetchCalls, 0);
});

test('VK API and transport failures collapse to generic resolver error', async () => {
  const resolver = new VkCommunityScreenNameResolver({
    async fetchImplementation() {
      return new Response(
        JSON.stringify({
          error: {
            error_msg: `credential=${ACCESS_TOKEN}`,
          },
        }),
        { status: 200 },
      );
    },
  });

  await assert.rejects(
    resolver.resolve('yastroykaru', ACCESS_TOKEN),
    (error: unknown) => {
      assert.ok(error instanceof VkCommunityScreenNameResolverError);
      assert.equal(error.message, 'VK community screen-name resolution failed');
      assert.doesNotMatch(error.message, new RegExp(ACCESS_TOKEN, 'u'));
      return true;
    },
  );
});
