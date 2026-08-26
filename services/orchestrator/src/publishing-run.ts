export type PublishingMode = 'AUTO' | 'ASSISTED';

export type PublishingFreshnessReason =
  | 'PRICE_STOCK_FRESH'
  | 'PRICE_STOCK_STALE'
  | 'PRICE_STOCK_EXPIRED'
  | 'FRESHNESS_UNVERIFIABLE'
  | 'SNAPSHOT_CAPTURED_IN_FUTURE';

export interface PublishingFreshDecision {
  readonly status: 'FRESH';
  readonly reason: 'PRICE_STOCK_FRESH';
  readonly ageSeconds: number;
}

export interface PublishingRefreshDecision {
  readonly status: 'REFRESH';
  readonly reason: 'PRICE_STOCK_STALE';
  readonly ageSeconds: number;
}

export interface PublishingBlockedFreshnessDecision {
  readonly status: 'BLOCK';
  readonly reason: Exclude<PublishingFreshnessReason, 'PRICE_STOCK_FRESH' | 'PRICE_STOCK_STALE'>;
  readonly ageSeconds: number | null;
}

export type PublishingFreshnessDecision =
  PublishingFreshDecision | PublishingRefreshDecision | PublishingBlockedFreshnessDecision;

export interface PublishingAttribution {
  readonly productId: string;
  readonly offerId: string;
  readonly snapshotCapturedAt: string;
}

export interface PublishingPreparationInput {
  readonly mode: PublishingMode;
  readonly freshness: PublishingFreshnessDecision;
  readonly attribution: PublishingAttribution;
}

export interface PublishingAutoPlan {
  readonly kind: 'AUTO';
  readonly freshness: PublishingFreshDecision;
  readonly attribution: PublishingAttribution;
}

export interface PublishingAssistedPlan {
  readonly kind: 'ASSISTED';
  readonly freshness: PublishingFreshDecision;
  readonly attribution: PublishingAttribution;
}

export interface PublishingBlockedPlan {
  readonly kind: 'BLOCKED';
  readonly freshness: PublishingRefreshDecision | PublishingBlockedFreshnessDecision;
  readonly attribution: PublishingAttribution;
}

export type PublishingPreparationPlan =
  PublishingAutoPlan | PublishingAssistedPlan | PublishingBlockedPlan;

const SAFE_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const BLOCK_REASONS = new Set<PublishingBlockedFreshnessDecision['reason']>([
  'PRICE_STOCK_EXPIRED',
  'FRESHNESS_UNVERIFIABLE',
  'SNAPSHOT_CAPTURED_IN_FUTURE',
]);

function requireSafeExternalId(value: string, field: string): void {
  if (!SAFE_EXTERNAL_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe identifier no longer than 256 characters.`);
  }
}

function requireExactIsoTimestamp(value: string, field: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${field} must be an exact ISO-8601 UTC timestamp.`);
  }
}

function requireAgeSeconds(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative number.`);
  }
}

function validateFreshnessDecision(
  decision: PublishingFreshnessDecision,
): PublishingFreshnessDecision {
  if (decision.status === 'FRESH') {
    if (decision.reason !== 'PRICE_STOCK_FRESH') {
      throw new Error('FRESH publishing freshness must use PRICE_STOCK_FRESH.');
    }
    requireAgeSeconds(decision.ageSeconds, 'freshness.ageSeconds');
    return { ...decision };
  }

  if (decision.status === 'REFRESH') {
    if (decision.reason !== 'PRICE_STOCK_STALE') {
      throw new Error('REFRESH publishing freshness must use PRICE_STOCK_STALE.');
    }
    requireAgeSeconds(decision.ageSeconds, 'freshness.ageSeconds');
    return { ...decision };
  }

  if (decision.status !== 'BLOCK' || !BLOCK_REASONS.has(decision.reason)) {
    throw new Error('Unsupported publishing freshness decision.');
  }
  if (decision.ageSeconds !== null) {
    requireAgeSeconds(decision.ageSeconds, 'freshness.ageSeconds');
  }
  return { ...decision };
}

function validateAttribution(attribution: PublishingAttribution): PublishingAttribution {
  requireSafeExternalId(attribution.productId, 'attribution.productId');
  requireSafeExternalId(attribution.offerId, 'attribution.offerId');
  requireExactIsoTimestamp(attribution.snapshotCapturedAt, 'attribution.snapshotCapturedAt');
  return { ...attribution };
}

export function planPublishingPreparation(
  input: PublishingPreparationInput,
): PublishingPreparationPlan {
  const freshness = validateFreshnessDecision(input.freshness);
  const attribution = validateAttribution(input.attribution);

  if (freshness.status !== 'FRESH') {
    return {
      kind: 'BLOCKED',
      freshness,
      attribution,
    };
  }

  if (input.mode === 'AUTO') {
    return {
      kind: 'AUTO',
      freshness,
      attribution,
    };
  }

  if (input.mode === 'ASSISTED') {
    return {
      kind: 'ASSISTED',
      freshness,
      attribution,
    };
  }

  throw new Error('Unsupported publishing mode.');
}
