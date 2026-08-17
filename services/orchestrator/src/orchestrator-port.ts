import type {
  OrchestrationCommand,
  OrchestrationResult,
  OrchestrationState,
  OrchestrationStateStore,
  ProviderAdapter,
  ProviderGenerateResult,
} from './contracts.ts';
import { ProviderAdapterUnavailableError, ProviderUnavailableError } from './provider-errors.ts';

function stateFor(
  command: OrchestrationCommand,
  provider: string,
  status: OrchestrationState['status'],
): OrchestrationState {
  return {
    operationId: command.operationId,
    stateRef: command.stateRef,
    provider,
    status,
  };
}

export class OrchestratorPort {
  readonly #adapter: ProviderAdapter;
  readonly #stateStore: OrchestrationStateStore;

  constructor(adapter: ProviderAdapter, stateStore: OrchestrationStateStore) {
    this.#adapter = adapter;
    this.#stateStore = stateStore;
  }

  async execute(command: OrchestrationCommand): Promise<OrchestrationResult> {
    const provider = this.#adapter.provider;

    await this.#stateStore.save(stateFor(command, provider, 'running'));

    let providerResult: ProviderGenerateResult;

    try {
      providerResult = await this.#adapter.generate({
        operationId: command.operationId,
        input: command.input,
      });
    } catch (error) {
      if (!(error instanceof ProviderAdapterUnavailableError)) {
        throw error;
      }

      await this.#stateStore.save(stateFor(command, provider, 'provider_unavailable'));

      throw new ProviderUnavailableError(command.operationId, provider, { cause: error });
    }

    await this.#stateStore.save(stateFor(command, provider, 'completed'));

    return {
      operationId: command.operationId,
      provider,
      output: providerResult.output,
      model: providerResult.model,
      providerRequestId: providerResult.providerRequestId,
    };
  }
}
