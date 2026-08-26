import {
  SecretReferenceError,
  validateSecretReference,
  type SecretConsumer,
  type SecretProvider,
  type SecretReference,
} from './secret-provider.ts';

export class SecretAccessError extends Error {
  constructor() {
    super('secret material unavailable');
    this.name = 'SecretAccessError';
  }
}

export interface EnvironmentSecretBinding {
  readonly key: string;
  readonly environmentVariable: string;
}

export interface EnvironmentSecretProviderOptions {
  readonly bindings: readonly EnvironmentSecretBinding[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
const MAX_SECRET_LENGTH = 8_192;

function fail(): never {
  throw new SecretAccessError();
}

function requireEnvironmentVariable(value: string): string {
  if (!ENVIRONMENT_VARIABLE_PATTERN.test(value)) {
    throw new SecretReferenceError('environment secret binding has an invalid variable name');
  }
  return value;
}

function requireBindingKey(value: string): string {
  return validateSecretReference({ provider: 'env', key: value }).key;
}

export class EnvironmentSecretProvider implements SecretProvider {
  readonly #bindings: ReadonlyMap<string, string>;
  readonly #environment: Readonly<Record<string, string | undefined>>;

  constructor(options: EnvironmentSecretProviderOptions) {
    const bindings = new Map<string, string>();
    for (const binding of options.bindings) {
      const key = requireBindingKey(binding.key);
      const environmentVariable = requireEnvironmentVariable(binding.environmentVariable);
      if (bindings.has(key)) {
        throw new SecretReferenceError('environment secret binding key is duplicated');
      }
      bindings.set(key, environmentVariable);
    }

    this.#bindings = bindings;
    this.#environment = options.environment ?? process.env;
  }

  async withSecret<T>(referenceValue: SecretReference, consumer: SecretConsumer<T>): Promise<T> {
    const reference = validateSecretReference(referenceValue);
    if (reference.provider !== 'env') {
      fail();
    }

    const environmentVariable = this.#bindings.get(reference.key);
    if (environmentVariable === undefined) {
      fail();
    }

    let secret: string | undefined;
    try {
      secret = this.#environment[environmentVariable];
    } catch {
      fail();
    }

    if (
      typeof secret !== 'string' ||
      secret.length === 0 ||
      secret.length > MAX_SECRET_LENGTH ||
      secret.includes('\u0000')
    ) {
      fail();
    }

    return await consumer(secret);
  }
}

export function createEnvironmentSecretProvider(
  options: EnvironmentSecretProviderOptions,
): EnvironmentSecretProvider {
  return new EnvironmentSecretProvider(options);
}
