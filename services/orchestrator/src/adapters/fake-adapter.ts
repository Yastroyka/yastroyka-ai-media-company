import type {
  ProviderAdapter,
  ProviderGenerateRequest,
  ProviderGenerateResult,
} from '../contracts.ts';
import { ProviderAdapterUnavailableError } from '../provider-errors.ts';

export interface FakeAdapterOptions {
  readonly available?: boolean;
  readonly response?: string;
}

export class FakeAdapter implements ProviderAdapter {
  readonly provider = 'fake';
  readonly #available: boolean;
  readonly #response: string;

  constructor(options: FakeAdapterOptions = {}) {
    this.#available = options.available ?? true;
    this.#response = options.response ?? 'fake provider result';
  }

  async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    if (!this.#available) {
      throw new ProviderAdapterUnavailableError(this.provider);
    }

    return Promise.resolve({
      output: this.#response,
      model: 'fake-deterministic',
      providerRequestId: `fake:${request.operationId}`,
    });
  }
}
