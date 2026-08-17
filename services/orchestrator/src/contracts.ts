export interface OrchestrationCommand {
  readonly operationId: string;
  readonly stateRef: string;
  readonly input: string;
}

export interface ProviderGenerateRequest {
  readonly operationId: string;
  readonly input: string;
}

export interface ProviderGenerateResult {
  readonly output: string;
  readonly model: string | null;
  readonly providerRequestId: string | null;
}

export interface ProviderAdapter {
  readonly provider: string;
  generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult>;
}

export type OrchestrationStatus = 'running' | 'completed' | 'provider_unavailable';

export interface OrchestrationState {
  readonly operationId: string;
  readonly stateRef: string;
  readonly provider: string;
  readonly status: OrchestrationStatus;
}

export interface OrchestrationStateStore {
  save(state: OrchestrationState): Promise<void>;
}

export interface OrchestrationResult extends ProviderGenerateResult {
  readonly operationId: string;
  readonly provider: string;
}
