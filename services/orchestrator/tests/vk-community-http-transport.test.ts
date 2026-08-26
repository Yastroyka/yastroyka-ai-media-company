import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VK_API_VERSION,
  VK_WALL_POST_ENDPOINT,
  VkCommunityHttpTransport,
  VkCommunityHttpTransportError,
} from '../src/adapters/vk-community-http-transport.ts';

const TOKEN = 'vk-live-token-must-remain-transient';
const IDEMPOTENCY_KEY = 'a'.repeat(64);

test('wall.post transport pins endpoint and maps idempotency to VK guid without token in URL', async () => {
  let observedInput: string | null = null;
  let observedInit: RequestInit | undefined;
  const transport = new VkCommunityHttpTransport({
    fetchImplementation: async (input, init) => {
      observedInput = String(input);
      observedInit = init;
      return new Response(JSON.stringify({ response: { post_id: 4242 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await transport.publishWallPost(
    {
      ownerId: -123456,
      fromGroup: true,
      message: 'Первый реальный пост Ястройки',
      idempotencyKey: IDEMPOTENCY_KEY,
    },
    TOKEN,
  );

  assert.equal(observedInput, VK_WALL_POST_ENDPOINT);
  assert.doesNotMatch(observedInput ?? '', new RegExp(TOKEN, 'u'));
  assert.equal(observedInit?.method, 'POST');
  assert.equal(observedInit?.redirect, 'error');
  const body = new URLSearchParams(String(observedInit?.body));
  assert.equal(body.get('owner_id'), '-123456');
  assert.equal(body.get('from_group'), '1');
  assert.equal(body.get('message'), 'Первый реальный пост Ястройки');
  assert.equal(body.get('guid'), IDEMPOTENCY_KEY);
  assert.equal(body.get('access_token'), TOKEN);
  assert.equal(body.get('v'), VK_API_VERSION);
  assert.deepEqual(result, { ownerId: -123456, postId: 4242 });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN, 'u'));
});

test('same internal idempotency key produces the same VK guid across retries', async () => {
  const observedGuids: string[] = [];
  const transport = new VkCommunityHttpTransport({
    fetchImplementation: async (_input, init) => {
      observedGuids.push(new URLSearchParams(String(init?.body)).get('guid') ?? '');
      return new Response(JSON.stringify({ response: { post_id: 77 } }), { status: 200 });
    },
  });
  const request = {
    ownerId: -123456,
    fromGroup: true as const,
    message: 'Retry-safe post',
    idempotencyKey: IDEMPOTENCY_KEY,
  };

  await transport.publishWallPost(request, TOKEN);
  await transport.publishWallPost(request, TOKEN);

  assert.deepEqual(observedGuids, [IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
});

test('HTTP, VK API and malformed response failures are sanitized', async () => {
  const transports = [
    new VkCommunityHttpTransport({
      fetchImplementation: async () => new Response(`raw ${TOKEN}`, { status: 500 }),
    }),
    new VkCommunityHttpTransport({
      fetchImplementation: async () =>
        new Response(JSON.stringify({ error: { error_msg: `raw ${TOKEN}` } }), { status: 200 }),
    }),
    new VkCommunityHttpTransport({
      fetchImplementation: async () =>
        new Response(JSON.stringify({ response: { post_id: 0, token: TOKEN } }), { status: 200 }),
    }),
  ];

  for (const transport of transports) {
    await assert.rejects(
      () =>
        transport.publishWallPost(
          {
            ownerId: -123456,
            fromGroup: true,
            message: 'Safe failure',
            idempotencyKey: IDEMPOTENCY_KEY,
          },
          TOKEN,
        ),
      (error: unknown) => {
        assert.ok(error instanceof VkCommunityHttpTransportError);
        assert.equal(error.message, 'VK HTTP transport failed');
        assert.doesNotMatch(JSON.stringify(error), new RegExp(TOKEN, 'u'));
        return true;
      },
    );
  }
});

test('transport rejects unsafe destination, payload and idempotency before fetch', async () => {
  let fetchCalls = 0;
  const transport = new VkCommunityHttpTransport({
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ response: { post_id: 1 } }), { status: 200 });
    },
  });

  await assert.rejects(
    () =>
      transport.publishWallPost(
        {
          ownerId: 123456,
          fromGroup: true,
          message: 'wrong destination',
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        TOKEN,
      ),
    VkCommunityHttpTransportError,
  );
  await assert.rejects(
    () =>
      transport.publishWallPost(
        {
          ownerId: -123456,
          fromGroup: true,
          message: '',
          idempotencyKey: 'not-a-guid',
        },
        TOKEN,
      ),
    VkCommunityHttpTransportError,
  );
  assert.equal(fetchCalls, 0);
});
