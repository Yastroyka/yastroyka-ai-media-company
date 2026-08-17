export interface SecretReference {
  readonly provider: string;
  readonly key: string;
}

export type SecretConsumer<T> = (secret: string) => T | Promise<T>;

export interface SecretProvider {
  withSecret<T>(reference: SecretReference, consumer: SecretConsumer<T>): Promise<T>;
}

export class SecretReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretReferenceError';
  }
}

function fail(message: string): never {
  throw new SecretReferenceError(message);
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('secret reference must be an object');
  }

  return value as Record<string, unknown>;
}

function expectIdentifier(value: unknown, field: 'provider' | 'key'): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`secret reference ${field} must be a non-empty string`);
  }

  if (value.length > 256) {
    fail(`secret reference ${field} is too long`);
  }

  const pattern = field === 'provider' ? /^[a-z0-9][a-z0-9._-]*$/ : /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

  if (!pattern.test(value)) {
    fail(`secret reference ${field} has an invalid format`);
  }

  return value;
}

export function validateSecretReference(value: unknown): SecretReference {
  const reference = expectRecord(value);
  const allowedKeys = new Set(['provider', 'key']);

  for (const key of Object.keys(reference)) {
    if (!allowedKeys.has(key)) {
      fail(`secret reference contains unknown key: ${key}`);
    }
  }

  return {
    provider: expectIdentifier(reference.provider, 'provider'),
    key: expectIdentifier(reference.key, 'key'),
  };
}

export async function withSecret<T>(
  provider: SecretProvider,
  reference: unknown,
  consumer: SecretConsumer<T>,
): Promise<T> {
  const validatedReference = validateSecretReference(reference);

  return provider.withSecret(validatedReference, consumer);
}
