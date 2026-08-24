import type {
  CommerceSourceMode,
  FreshnessDecision,
  ProductContentPack,
} from '@yastroyka/commerce-sdk';

export interface CommerceReadSource {
  readonly mode: CommerceSourceMode;
  readCatalogProduct(productId: string): Promise<unknown | null>;
  readSellerOffer(offerId: string): Promise<unknown | null>;
  readLatestOfferSnapshot(offerId: string): Promise<unknown | null>;
  readRights(productId: string): Promise<unknown | null>;
  readClaims(productId: string): Promise<readonly unknown[]>;
}

export interface ContentPackRequest {
  readonly productId: string;
  readonly offerId: string;
}

export type CommerceBlockReason =
  | 'PRODUCT_NOT_FOUND'
  | 'OFFER_NOT_FOUND'
  | 'PRODUCT_OFFER_MISMATCH'
  | 'OFFER_NOT_ACTIVE'
  | 'SNAPSHOT_NOT_FOUND'
  | 'OFFER_SNAPSHOT_MISMATCH'
  | 'RIGHTS_NOT_FOUND'
  | 'SOURCE_CONTRACT_INVALID'
  | 'SOURCE_READ_FAILED';

interface ContentPackDecisionBase {
  readonly product_id: string;
  readonly offer_id: string;
  readonly source_mode: CommerceSourceMode;
}

export interface ContentPackReady extends ContentPackDecisionBase {
  readonly status: 'READY';
  readonly pack: ProductContentPack;
  readonly freshness: FreshnessDecision & { readonly status: 'FRESH' };
}

export interface ContentPackRefresh extends ContentPackDecisionBase {
  readonly status: 'REFRESH';
  readonly freshness: FreshnessDecision & { readonly status: 'REFRESH' };
}

export interface ContentPackBlocked extends ContentPackDecisionBase {
  readonly status: 'BLOCK';
  readonly reason: CommerceBlockReason | FreshnessDecision['reason'];
  readonly freshness?: FreshnessDecision;
}

export type ContentPackDecision = ContentPackReady | ContentPackRefresh | ContentPackBlocked;
