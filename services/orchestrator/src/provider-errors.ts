export class ProviderAdapterUnavailableError extends Error {
  readonly provider: string;

  constructor(provider: string, options?: ErrorOptions) {
    super(`Provider ${provider} is unavailable.`, options);
    this.name = 'ProviderAdapterUnavailableError';
    this.provider = provider;
  }
}

export class ProviderUnavailableError extends Error {
  readonly operationId: string;
  readonly provider: string;

  constructor(operationId: string, provider: string, options?: ErrorOptions) {
    super(`Provider ${provider} is unavailable for operation ${operationId}.`, options);
    this.name = 'ProviderUnavailableError';
    this.operationId = operationId;
    this.provider = provider;
  }
}
