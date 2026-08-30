import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
  runVkCommunityDestinationResolverOperator,
  type VkCommunityDestinationResolverDependencies,
  type VkCommunityDestinationResolverIo,
} from '../src/vk-community-destination-resolver-cli.ts';
import { VkCommunityScreenNameResolverError } from '@yastroyka/orchestrator';

const ACCESS_TOKEN = 'vk-destination-token-must-never-leak';

function io(stdout: string[], stderr: string[]): VkCommunityDestinationResolverIo {
  return {
    writeStdout(value) {
      stdout.push(value);
    },
    writeStderr(value) {
      stderr.push(value);
    },
  };
}

test('owner-confirmed VK URL resolves to exact numeric community and owner IDs', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let secretReads = 0;
  let resolverCalls = 0;

  const dependencies: VkCommunityDestinationResolverDependencies = {
    async withAccessToken(consumer) {
      secretReads += 1;
      return await consumer(ACCESS_TOKEN);
    },
    async resolveScreenName(screenName, accessToken) {
      resolverCalls += 1;
      assert.equal(screenName, 'yastroykaru');
      assert.equal(accessToken, ACCESS_TOKEN);
      return {
        screenName,
        objectType: 'group',
        communityId: 123456,
        ownerId: -123456,
      };
    },
  };

  const exitCode = await runVkCommunityDestinationResolverOperator(
    ['resolve-community', 'https://vk.ru/yastroykaru'],
    dependencies,
    io(stdout, stderr),
  );

  assert.equal(exitCode, 0);
  assert.equal(secretReads, 1);
  assert.equal(resolverCalls, 1);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'RESOLVED',
    suppliedUrl: 'https://vk.ru/yastroykaru',
    canonicalUrl: 'https://vk.ru/yastroykaru',
    screenName: 'yastroykaru',
    objectType: 'group',
    communityId: 123456,
    ownerId: -123456,
  });
  assert.doesNotMatch(stdout.join(''), new RegExp(ACCESS_TOKEN, 'u'));
});

test('vk.com alias canonicalizes to vk.ru without changing screen name', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runVkCommunityDestinationResolverOperator(
    ['resolve-community', 'https://vk.com/yastroykaru/'],
    {
      async withAccessToken(consumer) {
        return await consumer(ACCESS_TOKEN);
      },
      async resolveScreenName(screenName) {
        return {
          screenName,
          objectType: 'page',
          communityId: 987654,
          ownerId: -987654,
        };
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, []);
  assert.equal(JSON.parse(stdout[0] ?? '{}').canonicalUrl, 'https://vk.ru/yastroykaru');
});

test('invalid URL is rejected before secret or network access', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let secretReads = 0;
  let resolverCalls = 0;

  const exitCode = await runVkCommunityDestinationResolverOperator(
    ['resolve-community', 'https://example.com/yastroykaru'],
    {
      async withAccessToken(consumer) {
        secretReads += 1;
        return await consumer(ACCESS_TOKEN);
      },
      async resolveScreenName() {
        resolverCalls += 1;
        throw new Error('must not resolve');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 65);
  assert.equal(secretReads, 0);
  assert.equal(resolverCalls, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK community destination input invalid\n']);
});

test('missing token blocks safely and reports only required environment variable name', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let resolverCalls = 0;

  const exitCode = await runVkCommunityDestinationResolverOperator(
    ['resolve-community', 'https://vk.ru/yastroykaru'],
    {
      async withAccessToken() {
        throw new Error(`missing ${ACCESS_TOKEN}`);
      },
      async resolveScreenName() {
        resolverCalls += 1;
        throw new Error('must not resolve');
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 2);
  assert.equal(resolverCalls, 0);
  assert.deepEqual(stderr, []);
  assert.deepEqual(JSON.parse(stdout[0] ?? '{}'), {
    status: 'BLOCKED',
    stage: 'SECRET',
    reason: 'VK_ACCESS_TOKEN_UNAVAILABLE',
    requiredEnvironmentVariable: VK_COMMUNITY_ACCESS_TOKEN_ENVIRONMENT_VARIABLE,
  });
  assert.doesNotMatch(stdout.join(''), new RegExp(ACCESS_TOKEN, 'u'));
});

test('resolver failure is generic and never reflects token material', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runVkCommunityDestinationResolverOperator(
    ['resolve-community', 'https://vk.ru/yastroykaru'],
    {
      async withAccessToken(consumer) {
        return await consumer(ACCESS_TOKEN);
      },
      async resolveScreenName() {
        throw new VkCommunityScreenNameResolverError();
      },
    },
    io(stdout, stderr),
  );

  assert.equal(exitCode, 70);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ['VK community destination resolution failed\n']);
  assert.doesNotMatch(stderr.join(''), new RegExp(ACCESS_TOKEN, 'u'));
});
