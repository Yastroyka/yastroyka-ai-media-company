import type {
  EngineeringModelCandidate,
  EngineeringModelRoutingDecision,
  EngineeringModelRoutingPort,
} from '../engineering-runner.ts';
import type { EngineeringRiskClass, EngineeringTaskEnvelope } from '../engineering-run.ts';

export type EngineeringModelRoutingMode =
  'MAX_QUALITY' | 'BEST_VALUE' | 'FAST' | 'BULK' | 'EXPERIMENT' | 'REDUNDANT' | 'CRITICAL';

export interface ModelExchangeEngineeringIdentity {
  readonly model_id: string;
  readonly provider: string;
  readonly revision: string;
}

export interface ModelExchangeEngineeringDecision {
  readonly winner: ModelExchangeEngineeringIdentity;
  readonly fallbacks: readonly ModelExchangeEngineeringIdentity[];
  readonly why_this_model: string;
}

export interface ModelExchangeEngineeringClient {
  route(request: unknown): Promise<ModelExchangeEngineeringDecision>;
}

export interface ModelExchangeEngineeringAdapterOptions {
  readonly taskClass: string;
  readonly modeByRisk: Readonly<Record<EngineeringRiskClass, EngineeringModelRoutingMode>>;
}

function requireIdentifier(value: string, field: string): void {
  if (value.trim().length === 0 || value.length > 256) {
    throw new Error(`${field} must be a non-empty identifier no longer than 256 characters.`);
  }
}

function requireExplanation(value: string): void {
  if (value.trim().length === 0 || value.length > 512) {
    throw new Error('why_this_model must be non-empty and no longer than 512 characters.');
  }
}

function toCandidate(
  identity: ModelExchangeEngineeringIdentity,
  field: string,
): EngineeringModelCandidate {
  requireIdentifier(identity.model_id, `${field}.model_id`);
  requireIdentifier(identity.provider, `${field}.provider`);
  requireIdentifier(identity.revision, `${field}.revision`);

  return {
    provider: identity.provider,
    model: identity.model_id,
    revision: identity.revision,
  };
}

function candidateKey(candidate: EngineeringModelCandidate): string {
  return `${candidate.provider}\u0000${candidate.model}\u0000${candidate.revision ?? ''}`;
}

export class ModelExchangeEngineeringAdapter implements EngineeringModelRoutingPort {
  readonly #client: ModelExchangeEngineeringClient;
  readonly #options: ModelExchangeEngineeringAdapterOptions;

  constructor(
    client: ModelExchangeEngineeringClient,
    options: ModelExchangeEngineeringAdapterOptions,
  ) {
    requireIdentifier(options.taskClass, 'taskClass');
    this.#client = client;
    this.#options = options;
  }

  async route(envelope: EngineeringTaskEnvelope): Promise<EngineeringModelRoutingDecision> {
    requireIdentifier(envelope.runId, 'runId');
    const mode = this.#options.modeByRisk[envelope.riskClass];

    const decision = await this.#client.route({
      request_id: envelope.runId,
      task_class: this.#options.taskClass,
      mode,
      requirements: {},
    });

    requireExplanation(decision.why_this_model);
    const winner = toCandidate(decision.winner, 'winner');
    const seen = new Set<string>([candidateKey(winner)]);
    const fallbacks = decision.fallbacks.map((fallback, index) => {
      const candidate = toCandidate(fallback, `fallbacks[${String(index)}]`);
      const key = candidateKey(candidate);
      if (seen.has(key)) {
        throw new Error('Model Exchange returned a duplicate engineering candidate identity.');
      }
      seen.add(key);
      return candidate;
    });

    return {
      winner,
      fallbacks,
      whyThisModel: decision.why_this_model,
    };
  }
}
