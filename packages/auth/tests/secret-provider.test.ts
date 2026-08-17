import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  SecretReferenceError,
  type SecretProvider,
  validateSecretReference,
  withSecret,
} from '../src/secret-provider.ts';

test('valid secret references are accepted', () => {
  const reference = validateSecretReference({
    provider: 'local-test',
    key: 'services/provider/api-key',
  });

  assert.deepEqual(reference, {
    provider: 'local-test',
    key: 'services/provider/api-key',
  });
});

test('secret references reject unknown fields', () => {
  assert.throws(
    () =>
      validateSecretReference({
        provider: 'local-test',
        key: 'services/provider/api-key',
        value: 'not-allowed',
      }),
    (error: unknown) =>
      error instanceof SecretReferenceError &&
      error.message === 'secret reference contains unknown key: value',
  );
});

test('secret references reject invalid provider identifiers', () => {
  assert.throws(
    () =>
      validateSecretReference({
        provider: '../unsafe',
        key: 'services/provider/api-key',
      }),
    (error: unknown) =>
      error instanceof SecretReferenceError &&
      error.message === 'secret reference provider has an invalid format',
  );
});

test('withSecret validates the reference before calling the provider', async () => {
  let providerCalled = false;

  const provider: SecretProvider = {
    async withSecret(reference, consumer) {
      providerCalled = true;
      return consumer(randomUUID());
    },
  };

  await assert.rejects(
    () =>
      withSecret(
        provider,
        {
          provider: '../unsafe',
          key: 'services/provider/api-key',
        },
        () => 'unexpected',
      ),
    SecretReferenceError,
  );

  assert.equal(providerCalled, false);
});

test('withSecret exposes transient material only to the consumer operation', async () => {
  const transientValue = randomUUID();
  let receivedReference: unknown;

  const provider: SecretProvider = {
    async withSecret(reference, consumer) {
      receivedReference = reference;
      return consumer(transientValue);
    },
  };

  const result = await withSecret(
    provider,
    {
      provider: 'local-test',
      key: 'runtime/generated-value',
    },
    (secret) => {
      assert.equal(secret, transientValue);
      return 'operation-completed';
    },
  );

  assert.deepEqual(receivedReference, {
    provider: 'local-test',
    key: 'runtime/generated-value',
  });

  assert.equal(result, 'operation-completed');
});
