export type CommerceSourceMode = 'real' | 'staging';

export interface CatalogProduct {
  readonly product_id: string;
  readonly sku?: string | null;
  readonly name: string;
  readonly brand?: string | null;
  readonly verified_facts: Readonly<Record<string, unknown>>;
  readonly media_assets?: readonly Readonly<Record<string, unknown>>[];
}

export type SellerOfferStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export interface SellerOffer {
  readonly offer_id: string;
  readonly product_id: string;
  readonly seller_id: string;
  readonly region: string;
  readonly status: SellerOfferStatus;
}

export interface OfferSnapshot {
  readonly offer_id: string;
  readonly captured_at: string;
  readonly currency: string;
  readonly price: number;
  readonly stock?: number | null;
  readonly availability: string;
  readonly ttl_seconds?: number;
}

export interface RightsProvenance {
  readonly source: string;
  readonly verified_at: string;
  readonly allowed_channels: readonly string[];
}

export interface ClaimProvenance {
  readonly claim: string;
  readonly source: string;
  readonly verified_at: string;
}

export interface ContentPackTracking {
  readonly source_mode: CommerceSourceMode;
  readonly product_id: string;
  readonly offer_id: string;
  readonly snapshot_captured_at: string;
  readonly built_at: string;
}

export interface ProductContentPack {
  readonly product: CatalogProduct;
  readonly offer: SellerOffer;
  readonly offer_snapshot: OfferSnapshot;
  readonly rights: RightsProvenance;
  readonly claims: readonly ClaimProvenance[];
  readonly tracking: ContentPackTracking;
}

export type FreshnessStatus = 'FRESH' | 'REFRESH' | 'BLOCK';

export type FreshnessReason =
  | 'PRICE_STOCK_FRESH'
  | 'PRICE_STOCK_STALE'
  | 'PRICE_STOCK_EXPIRED'
  | 'FRESHNESS_UNVERIFIABLE'
  | 'SNAPSHOT_CAPTURED_IN_FUTURE';

export interface FreshnessDecision {
  readonly status: FreshnessStatus;
  readonly reason: FreshnessReason;
  readonly checked_fields: readonly ['price', 'stock'];
  readonly age_seconds: number | null;
}

export interface FreshnessPolicy {
  readonly refresh_grace_seconds: number;
}
