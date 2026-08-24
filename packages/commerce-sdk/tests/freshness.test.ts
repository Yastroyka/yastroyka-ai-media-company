import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateOfferSnapshotFreshness, type OfferSnapshot } from '../src/index.ts';

const snapshot: OfferSnapshot = {
  offer_id: 'offer-task-006',
  captured_at: '2026-08-17T12:00:00.000Z',
  currency: 'RUB',
  price: 100,
  stock: 7,
  availability: 'IN_STOCK',
  ttl_seconds: 300,
};

const policy = { refresh_grace_seconds: 600 } as const;

test('price and stock are fresh one millisecond before the TTL boundary', () => {
  const decision = evaluateOfferSnapshotFreshness(
    snapshot,
    policy,
    new Date('2026-08-17T12:04:59.999Z'),
  );

  assert.deepEqual(decision, {
    status: 'FRESH',
    reason: 'PRICE_STOCK_FRESH',
    checked_fields: ['price', 'stock'],
    age_seconds: 299.999,
  });
});

test('price and stock request refresh at the exact TTL boundary', () => {
  const decision = evaluateOfferSnapshotFreshness(
    snapshot,
    policy,
    new Date('2026-08-17T12:05:00.000Z'),
  );

  assert.equal(decision.status, 'REFRESH');
  assert.equal(decision.reason, 'PRICE_STOCK_STALE');
});

test('price and stock block at the exact TTL plus grace boundary', () => {
  const decision = evaluateOfferSnapshotFreshness(
    snapshot,
    policy,
    new Date('2026-08-17T12:15:00.000Z'),
  );

  assert.equal(decision.status, 'BLOCK');
  assert.equal(decision.reason, 'PRICE_STOCK_EXPIRED');
});

test('zero TTL and zero grace block immediately', () => {
  const decision = evaluateOfferSnapshotFreshness(
    { ...snapshot, ttl_seconds: 0 },
    { refresh_grace_seconds: 0 },
    new Date(snapshot.captured_at),
  );

  assert.equal(decision.status, 'BLOCK');
  assert.equal(decision.reason, 'PRICE_STOCK_EXPIRED');
});

test('missing TTL and future snapshots fail closed', () => {
  const withoutTtl = { ...snapshot };
  delete withoutTtl.ttl_seconds;

  assert.equal(
    evaluateOfferSnapshotFreshness(withoutTtl, policy, new Date('2026-08-17T12:00:01.000Z')).reason,
    'FRESHNESS_UNVERIFIABLE',
  );
  assert.equal(
    evaluateOfferSnapshotFreshness(snapshot, policy, new Date('2026-08-17T11:59:59.000Z')).reason,
    'SNAPSHOT_CAPTURED_IN_FUTURE',
  );
});

test('an invalid clock and unsafe policy fail closed', () => {
  assert.equal(
    evaluateOfferSnapshotFreshness(snapshot, policy, new Date(Number.NaN)).reason,
    'FRESHNESS_UNVERIFIABLE',
  );
  assert.equal(
    evaluateOfferSnapshotFreshness(
      snapshot,
      { refresh_grace_seconds: Number.MAX_SAFE_INTEGER },
      new Date('2026-08-17T12:00:00.000Z'),
    ).reason,
    'FRESHNESS_UNVERIFIABLE',
  );
});
