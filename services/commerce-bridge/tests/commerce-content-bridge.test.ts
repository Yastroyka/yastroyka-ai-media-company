import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CommerceContentBridge, type CommerceReadSource } from '../src/index.ts';

function createSource(
  overrides: Partial<CommerceReadSource> & Pick<CommerceReadSource, 'mode'>,
): CommerceReadSource {
  return {
    async readCatalogProduct() {
      return {
        product_id: 'product-task-006',
        sku: 'SKU-006',
        name: 'YASTROYKA test product',
        brand: 'YASTROYKA',
        verified_facts: { material: 'steel' },
        media_assets: [],
      };
    },
    async readSellerOffer() {
      return {
        offer_id: 'offer-task-006',
        product_id: 'product-task-006',
        seller_id: 'seller-task-006',
        region: 'RU-MOW',
        status: 'ACTIVE',
      };
    },
    async readLatestOfferSnapshot() {
      return {
        offer_id: 'offer-task-006',
        captured_at: '2026-08-17T12:00:00.000Z',
        currency: 'RUB',
        price: 12_500,
        stock: 4,
        availability: 'IN_STOCK',
        ttl_seconds: 300,
      };
    },
    async readRights() {
      return {
        source: 'rights-registry/task-006',
        verified_at: '2026-08-17T11:00:00.000Z',
        allowed_channels: ['VK', 'MAX'],
      };
    },
    async readClaims() {
      return [
        {
          claim: 'Verified steel construction',
          source: 'product-facts/task-006',
          verified_at: '2026-08-17T11:00:00.000Z',
        },
      ];
    },
    ...overrides,
  };
}

function createBridge(source: CommerceReadSource, now: string): CommerceContentBridge {
  return new CommerceContentBridge({
    source,
    freshnessPolicy: { refresh_grace_seconds: 600 },
    clock: () => new Date(now),
  });
}

const request = {
  productId: 'product-task-006',
  offerId: 'offer-task-006',
} as const;

test('a fresh staging offer builds a product content pack with provenance', async () => {
  const result = await createBridge(
    createSource({ mode: 'staging' }),
    '2026-08-17T12:04:00.000Z',
  ).buildContentPack(request);

  assert.equal(result.status, 'READY');

  if (result.status !== 'READY') {
    return;
  }

  assert.notEqual(result.pack.product, result.pack.offer);
  assert.equal(result.pack.product.product_id, result.pack.offer.product_id);
  assert.equal(result.pack.offer.offer_id, result.pack.offer_snapshot.offer_id);
  assert.deepEqual(result.pack.rights.allowed_channels, ['VK', 'MAX']);
  assert.equal(result.pack.claims[0]?.source, 'product-facts/task-006');
  assert.equal(result.pack.tracking.source_mode, 'staging');
});

test('stale real price and stock request refresh without building a pack', async () => {
  const result = await createBridge(
    createSource({ mode: 'real' }),
    '2026-08-17T12:06:00.000Z',
  ).buildContentPack(request);

  assert.equal(result.status, 'REFRESH');

  if (result.status !== 'REFRESH') {
    return;
  }

  assert.equal(result.freshness.reason, 'PRICE_STOCK_STALE');
  assert.deepEqual(result.freshness.checked_fields, ['price', 'stock']);
  assert.equal('pack' in result, false);
});

test('expired real price and stock block content-pack construction', async () => {
  const result = await createBridge(
    createSource({ mode: 'real' }),
    '2026-08-17T12:16:00.000Z',
  ).buildContentPack(request);

  assert.equal(result.status, 'BLOCK');

  if (result.status !== 'BLOCK') {
    return;
  }

  assert.equal(result.reason, 'PRICE_STOCK_EXPIRED');
});

test('product, offer and snapshot identities cannot be collapsed or crossed', async () => {
  const source = createSource({
    mode: 'staging',
    async readSellerOffer() {
      return {
        offer_id: 'offer-task-006',
        product_id: 'another-product',
        seller_id: 'seller-task-006',
        region: 'RU-MOW',
        status: 'ACTIVE',
      };
    },
  });
  const result = await createBridge(source, '2026-08-17T12:04:00.000Z').buildContentPack(request);

  assert.deepEqual(result, {
    status: 'BLOCK',
    product_id: 'product-task-006',
    offer_id: 'offer-task-006',
    source_mode: 'staging',
    reason: 'PRODUCT_OFFER_MISMATCH',
  });
});

test('inactive offers block before snapshot, rights or claim reads', async () => {
  let downstreamReads = 0;
  const source = createSource({
    mode: 'real',
    async readSellerOffer() {
      return {
        offer_id: 'offer-task-006',
        product_id: 'product-task-006',
        seller_id: 'seller-task-006',
        region: 'RU-MOW',
        status: 'INACTIVE',
      };
    },
    async readLatestOfferSnapshot() {
      downstreamReads += 1;
      return null;
    },
    async readRights() {
      downstreamReads += 1;
      return null;
    },
    async readClaims() {
      downstreamReads += 1;
      return [];
    },
  });
  const result = await createBridge(source, '2026-08-17T12:04:00.000Z').buildContentPack(request);

  assert.equal(result.status, 'BLOCK');
  assert.equal(result.status === 'BLOCK' ? result.reason : null, 'OFFER_NOT_ACTIVE');
  assert.equal(downstreamReads, 0);
});

test('a snapshot from another offer fails closed', async () => {
  const source = createSource({
    mode: 'staging',
    async readLatestOfferSnapshot() {
      return {
        offer_id: 'another-offer',
        captured_at: '2026-08-17T12:00:00.000Z',
        currency: 'RUB',
        price: 12_500,
        stock: 4,
        availability: 'IN_STOCK',
        ttl_seconds: 300,
      };
    },
  });
  const result = await createBridge(source, '2026-08-17T12:04:00.000Z').buildContentPack(request);

  assert.equal(result.status, 'BLOCK');
  assert.equal(result.status === 'BLOCK' ? result.reason : null, 'OFFER_SNAPSHOT_MISMATCH');
});

test('invalid untrusted source payloads fail closed without exposing their content', async () => {
  const source = createSource({
    mode: 'real',
    async readLatestOfferSnapshot() {
      return {
        offer_id: 'offer-task-006',
        captured_at: 'not-a-date',
        currency: 'RUB',
        price: -1,
        availability: 'UNKNOWN',
      };
    },
  });
  const result = await createBridge(source, '2026-08-17T12:04:00.000Z').buildContentPack(request);

  assert.equal(result.status, 'BLOCK');

  if (result.status === 'BLOCK') {
    assert.equal(result.reason, 'SOURCE_CONTRACT_INVALID');
  }
});

test('the read source and OpenAPI contract expose no commerce mutation operation', async () => {
  const source = createSource({ mode: 'staging' });

  assert.deepEqual(
    Object.keys(source)
      .filter((key) => typeof source[key as keyof CommerceReadSource] === 'function')
      .sort(),
    [
      'readCatalogProduct',
      'readClaims',
      'readLatestOfferSnapshot',
      'readRights',
      'readSellerOffer',
    ],
  );

  const openApi = await readFile(
    new URL('../../../specs/openapi/openapi.yaml', import.meta.url),
    'utf8',
  );
  const commercePath = openApi.split('/v1/commerce/')[1]?.split('/v1/model-exchange/')[0] ?? '';

  assert.equal(/^\s+(post|put|patch|delete):/mu.test(commercePath), false);
});
