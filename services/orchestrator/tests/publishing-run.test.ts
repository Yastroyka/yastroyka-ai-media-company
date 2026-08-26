import assert from 'node:assert/strict';
import test from 'node:test';

import { planPublishingPreparation } from '../src/publishing-run.ts';

const ATTRIBUTION = {
  productId: 'product-100',
  offerId: 'offer-200',
  snapshotCapturedAt: '2026-08-25T10:00:00.000Z',
} as const;

test('stale offer blocks AUTO publishing instead of bypassing freshness', () => {
  const plan = planPublishingPreparation({
    mode: 'AUTO',
    freshness: {
      status: 'REFRESH',
      reason: 'PRICE_STOCK_STALE',
      ageSeconds: 600,
    },
    attribution: ATTRIBUTION,
  });

  assert.equal(plan.kind, 'BLOCKED');
  assert.equal(plan.freshness.status, 'REFRESH');
  assert.deepEqual(plan.attribution, ATTRIBUTION);
});

test('blocked freshness also blocks ASSISTED publishing', () => {
  const plan = planPublishingPreparation({
    mode: 'ASSISTED',
    freshness: {
      status: 'BLOCK',
      reason: 'PRICE_STOCK_EXPIRED',
      ageSeconds: 3_600,
    },
    attribution: ATTRIBUTION,
  });

  assert.equal(plan.kind, 'BLOCKED');
  assert.equal(plan.freshness.reason, 'PRICE_STOCK_EXPIRED');
});

test('fresh offer reaches AUTO only with validated attribution', () => {
  const plan = planPublishingPreparation({
    mode: 'AUTO',
    freshness: {
      status: 'FRESH',
      reason: 'PRICE_STOCK_FRESH',
      ageSeconds: 10,
    },
    attribution: ATTRIBUTION,
  });

  assert.equal(plan.kind, 'AUTO');
  assert.deepEqual(plan.attribution, ATTRIBUTION);
});

test('fresh ASSISTED plan preserves product, offer and snapshot attribution', () => {
  const plan = planPublishingPreparation({
    mode: 'ASSISTED',
    freshness: {
      status: 'FRESH',
      reason: 'PRICE_STOCK_FRESH',
      ageSeconds: 10,
    },
    attribution: ATTRIBUTION,
  });

  assert.equal(plan.kind, 'ASSISTED');
  assert.deepEqual(plan.attribution, ATTRIBUTION);
  assert.notEqual(plan.attribution, ATTRIBUTION);
});

test('malformed freshness and attribution fail closed', () => {
  assert.throws(
    () =>
      planPublishingPreparation({
        mode: 'AUTO',
        freshness: {
          status: 'FRESH',
          reason: 'PRICE_STOCK_STALE',
          ageSeconds: 1,
        } as never,
        attribution: ATTRIBUTION,
      }),
    /FRESH publishing freshness must use PRICE_STOCK_FRESH/u,
  );

  assert.throws(
    () =>
      planPublishingPreparation({
        mode: 'AUTO',
        freshness: {
          status: 'FRESH',
          reason: 'PRICE_STOCK_FRESH',
          ageSeconds: 1,
        },
        attribution: {
          ...ATTRIBUTION,
          offerId: 'unsafe offer id',
        },
      }),
    /attribution.offerId must be a safe identifier/u,
  );

  assert.throws(
    () =>
      planPublishingPreparation({
        mode: 'UNSUPPORTED' as never,
        freshness: {
          status: 'FRESH',
          reason: 'PRICE_STOCK_FRESH',
          ageSeconds: 1,
        },
        attribution: ATTRIBUTION,
      }),
    /Unsupported publishing mode/u,
  );
});
