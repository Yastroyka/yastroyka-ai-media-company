import {
  CommerceContractError,
  evaluateOfferSnapshotFreshness,
  parseCatalogProduct,
  parseClaimProvenance,
  parseOfferSnapshot,
  parseRightsProvenance,
  parseSellerOffer,
  type FreshnessPolicy,
} from '@yastroyka/commerce-sdk';

import type {
  CommerceBlockReason,
  CommerceReadSource,
  ContentPackBlocked,
  ContentPackDecision,
  ContentPackRequest,
} from './contracts.ts';

export interface CommerceContentBridgeOptions {
  readonly source: CommerceReadSource;
  readonly freshnessPolicy: FreshnessPolicy;
  readonly clock?: () => Date;
}

export class CommerceContentBridge {
  readonly #source: CommerceReadSource;
  readonly #freshnessPolicy: FreshnessPolicy;
  readonly #clock: () => Date;

  constructor(options: CommerceContentBridgeOptions) {
    this.#source = options.source;
    this.#freshnessPolicy = options.freshnessPolicy;
    this.#clock = options.clock ?? (() => new Date());
  }

  async buildContentPack(request: ContentPackRequest): Promise<ContentPackDecision> {
    let productValue: unknown | null;
    let offerValue: unknown | null;

    try {
      [productValue, offerValue] = await Promise.all([
        this.#source.readCatalogProduct(request.productId),
        this.#source.readSellerOffer(request.offerId),
      ]);
    } catch {
      return this.#blocked(request, 'SOURCE_READ_FAILED');
    }

    if (productValue === null) {
      return this.#blocked(request, 'PRODUCT_NOT_FOUND');
    }

    if (offerValue === null) {
      return this.#blocked(request, 'OFFER_NOT_FOUND');
    }

    try {
      const product = parseCatalogProduct(productValue);
      const offer = parseSellerOffer(offerValue);

      if (product.product_id !== request.productId || offer.product_id !== product.product_id) {
        return this.#blocked(request, 'PRODUCT_OFFER_MISMATCH');
      }

      if (offer.offer_id !== request.offerId) {
        return this.#blocked(request, 'OFFER_NOT_FOUND');
      }

      if (offer.status !== 'ACTIVE') {
        return this.#blocked(request, 'OFFER_NOT_ACTIVE');
      }

      let snapshotValue: unknown | null;
      let rightsValue: unknown | null;
      let claimValues: readonly unknown[];

      try {
        [snapshotValue, rightsValue, claimValues] = await Promise.all([
          this.#source.readLatestOfferSnapshot(offer.offer_id),
          this.#source.readRights(product.product_id),
          this.#source.readClaims(product.product_id),
        ]);
      } catch {
        return this.#blocked(request, 'SOURCE_READ_FAILED');
      }

      if (snapshotValue === null) {
        return this.#blocked(request, 'SNAPSHOT_NOT_FOUND');
      }

      if (rightsValue === null) {
        return this.#blocked(request, 'RIGHTS_NOT_FOUND');
      }

      const snapshot = parseOfferSnapshot(snapshotValue);

      if (snapshot.offer_id !== offer.offer_id) {
        return this.#blocked(request, 'OFFER_SNAPSHOT_MISMATCH');
      }

      const freshness = evaluateOfferSnapshotFreshness(
        snapshot,
        this.#freshnessPolicy,
        this.#clock(),
      );

      if (freshness.status === 'REFRESH') {
        return {
          status: 'REFRESH',
          product_id: product.product_id,
          offer_id: offer.offer_id,
          source_mode: this.#source.mode,
          freshness,
        };
      }

      if (freshness.status === 'BLOCK') {
        return {
          status: 'BLOCK',
          product_id: product.product_id,
          offer_id: offer.offer_id,
          source_mode: this.#source.mode,
          reason: freshness.reason,
          freshness,
        };
      }

      const rights = parseRightsProvenance(rightsValue);

      if (!Array.isArray(claimValues)) {
        throw new CommerceContractError('ClaimProvenance[]', '$');
      }

      const claims = claimValues.map((claim) => parseClaimProvenance(claim));
      const builtAt = this.#clock().toISOString();

      return {
        status: 'READY',
        product_id: product.product_id,
        offer_id: offer.offer_id,
        source_mode: this.#source.mode,
        freshness,
        pack: {
          product,
          offer,
          offer_snapshot: snapshot,
          rights,
          claims,
          tracking: {
            source_mode: this.#source.mode,
            product_id: product.product_id,
            offer_id: offer.offer_id,
            snapshot_captured_at: snapshot.captured_at,
            built_at: builtAt,
          },
        },
      };
    } catch (error) {
      if (error instanceof CommerceContractError) {
        return this.#blocked(request, 'SOURCE_CONTRACT_INVALID');
      }

      throw error;
    }
  }

  #blocked(request: ContentPackRequest, reason: CommerceBlockReason): ContentPackBlocked {
    return {
      status: 'BLOCK',
      product_id: request.productId,
      offer_id: request.offerId,
      source_mode: this.#source.mode,
      reason,
    };
  }
}
