import assert from 'node:assert/strict';
import test from 'node:test';

import { CommerceContractError, parseCatalogProduct, parseOfferSnapshot } from '../src/index.ts';

test('snapshot validation rejects non-finite price and stock values', () => {
  const base = {
    offer_id: 'offer-task-006',
    captured_at: '2026-08-17T12:00:00.000Z',
    currency: 'RUB',
    price: 100,
    stock: 1,
    availability: 'IN_STOCK',
    ttl_seconds: 300,
  };

  for (const invalid of [
    { ...base, price: Number.NaN },
    { ...base, price: Number.POSITIVE_INFINITY },
    { ...base, stock: Number.NaN },
    { ...base, stock: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => parseOfferSnapshot(invalid), CommerceContractError);
  }
});

test('catalog validation rejects malformed optional source fields', () => {
  const base = {
    product_id: 'product-task-006',
    name: 'Product',
    verified_facts: {},
  };

  assert.throws(() => parseCatalogProduct({ ...base, sku: 123 }), CommerceContractError);
  assert.throws(
    () => parseCatalogProduct({ ...base, media_assets: ['not-an-asset'] }),
    CommerceContractError,
  );
});
