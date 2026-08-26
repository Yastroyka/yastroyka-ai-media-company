import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EnvironmentSecretProvider,
  SecretAccessError,
  SecretReferenceError,
} from '../src/index.ts';

const TOKEN = 'vk-token-material-must-never-leak';

test('environment provider exposes only an allowlisted secret to the consumer', async () => {
  const provider = new EnvironmentSecretProvider({
    bindings: [
      {
        key: 'publishing/vk-community/access-token',
        environmentVariable: 'YASTROYKA_VK_COMMUNITY_TOKEN',
      },
    ],
    environment: {
      YASTROYKA_VK_COMMUNITY_TOKEN: TOKEN,
      UNRELATED_SECRET: 'must-not-be-readable',
    },
  });

  const observed = await provider.withSecret(
    { provider: 'env', key: 'publishing/vk-community/access-token' },
    async (secret) => {
      assert.equal(secret, TOKEN);
      return 'ok';
    },
  );

  assert.equal(observed, 'ok');
});

test('environment provider fails closed for unbound providers, keys and missing material', async () => {
  const provider = new EnvironmentSecretProvider({
    bindings: [
      {
        key: 'publishing/vk-community/access-token',
        environmentVariable: 'YASTROYKA_VK_COMMUNITY_TOKEN',
      },
    ],
    environment: {},
  });

  for (const reference of [
    { provider: 'vault', key: 'publishing/vk-community/access-token' },
    { provider: 'env', key: 'publishing/vk-community/other' },
    { provider: 'env', key: 'publishing/vk-community/access-token' },
  ]) {
    await assert.rejects(
      () => provider.withSecret(reference, async () => 'not-called'),
      (error: unknown) => {
        assert.ok(error instanceof SecretAccessError);
        assert.equal(error.message, 'secret material unavailable');
        assert.doesNotMatch(JSON.stringify(error), /YASTROYKA|access-token|vk-token/iu);
        return true;
      },
    );
  }
});

test('environment provider rejects unsafe or duplicate binding configuration', () => {
  assert.throws(
    () =>
      new EnvironmentSecretProvider({
        bindings: [
          {
            key: 'publishing/vk-community/access-token',
            environmentVariable: 'unsafe-variable-name',
          },
        ],
      }),
    SecretReferenceError,
  );

  assert.throws(
    () =>
      new EnvironmentSecretProvider({
        bindings: [
          {
            key: 'publishing/vk-community/access-token',
            environmentVariable: 'YASTROYKA_VK_COMMUNITY_TOKEN',
          },
          {
            key: 'publishing/vk-community/access-token',
            environmentVariable: 'YASTROYKA_VK_COMMUNITY_TOKEN_2',
          },
        ],
      }),
    SecretReferenceError,
  );
});
