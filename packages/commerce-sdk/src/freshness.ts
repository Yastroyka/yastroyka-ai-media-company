import type {
  FreshnessBlockedDecision,
  FreshnessDecision,
  FreshnessPolicy,
  OfferSnapshot,
} from './contracts.ts';

function blocked(reason: FreshnessBlockedDecision['reason']): FreshnessBlockedDecision {
  return {
    status: 'BLOCK',
    reason,
    checked_fields: ['price', 'stock'],
    age_seconds: null,
  };
}

export function evaluateOfferSnapshotFreshness(
  snapshot: OfferSnapshot,
  policy: FreshnessPolicy,
  now: Date,
): FreshnessDecision {
  const capturedAtMilliseconds = Date.parse(snapshot.captured_at);
  const nowMilliseconds = now.getTime();
  const ttlSeconds = snapshot.ttl_seconds;

  if (
    !Number.isFinite(capturedAtMilliseconds) ||
    !Number.isFinite(nowMilliseconds) ||
    ttlSeconds === undefined ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 0 ||
    !Number.isSafeInteger(policy.refresh_grace_seconds) ||
    policy.refresh_grace_seconds < 0
  ) {
    return blocked('FRESHNESS_UNVERIFIABLE');
  }

  const ttlMilliseconds = ttlSeconds * 1_000;
  const refreshGraceMilliseconds = policy.refresh_grace_seconds * 1_000;

  if (!Number.isSafeInteger(ttlMilliseconds + refreshGraceMilliseconds)) {
    return blocked('FRESHNESS_UNVERIFIABLE');
  }

  const ageMilliseconds = nowMilliseconds - capturedAtMilliseconds;
  const ageSeconds = ageMilliseconds / 1_000;

  if (ageMilliseconds < 0) {
    return blocked('SNAPSHOT_CAPTURED_IN_FUTURE');
  }

  if (ageMilliseconds < ttlMilliseconds) {
    return {
      status: 'FRESH',
      reason: 'PRICE_STOCK_FRESH',
      checked_fields: ['price', 'stock'],
      age_seconds: ageSeconds,
    };
  }

  if (ageMilliseconds < ttlMilliseconds + refreshGraceMilliseconds) {
    return {
      status: 'REFRESH',
      reason: 'PRICE_STOCK_STALE',
      checked_fields: ['price', 'stock'],
      age_seconds: ageSeconds,
    };
  }

  return {
    status: 'BLOCK',
    reason: 'PRICE_STOCK_EXPIRED',
    checked_fields: ['price', 'stock'],
    age_seconds: ageSeconds,
  };
}
