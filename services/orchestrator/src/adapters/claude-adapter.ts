import type {
  ProviderAdapter,
  ProviderGenerateRequest,
  ProviderGenerateResult,
} from '../contracts.ts';
import { ProviderAdapterUnavailableError } from '../provider-errors.ts';

export interface ClaudeMessageRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<{
    readonly role: 'user';
    readonly content: string;
  }>;
}

export interface ClaudeMessageResponse {
  readonly id: string;
  readonly model: string;
  readonly text: string;
}

export interface ClaudeTransport {
  createMessage(request: ClaudeMessageRequest): Promise<ClaudeMessageResponse>;
}

export interface ClaudeAdapterOptions {
  readonly model: string;
  readonly transport: ClaudeTransport;
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude';
  readonly #model: string;
  readonly #transport: ClaudeTransport;

  constructor(options: ClaudeAdapterOptions) {
    this.#model = options.model;
    this.#transport = options.transport;
  }

  async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    let response: ClaudeMessageResponse;

    try {
      response = await this.#transport.createMessage({
        model: this.#model,
        messages: [{ role: 'user', content: request.input }],
      });
    } catch (error) {
      throw new ProviderAdapterUnavailableError(this.provider, { cause: error });
    }

    return {
      output: response.text,
      model: response.model,
      providerRequestId: response.id,
    };
  }
}
