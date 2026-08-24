import type {
  CatalogProduct,
  ClaimProvenance,
  OfferSnapshot,
  RightsProvenance,
  SellerOffer,
} from './contracts.ts';

export class CommerceContractError extends Error {
  readonly contract: string;
  readonly field: string;

  constructor(contract: string, field: string) {
    super(`${contract} violates the commerce contract at ${field}.`);
    this.name = 'CommerceContractError';
    this.contract = contract;
    this.field = field;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, contract: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CommerceContractError(contract, '$');
  }

  return value;
}

function requireString(record: Record<string, unknown>, field: string, contract: string): string {
  const value = record[field];

  if (typeof value !== 'string' || value.length === 0) {
    throw new CommerceContractError(contract, field);
  }

  return value;
}

function requireDateTime(record: Record<string, unknown>, field: string, contract: string): string {
  const value = requireString(record, field, contract);

  if (!Number.isFinite(Date.parse(value))) {
    throw new CommerceContractError(contract, field);
  }

  return value;
}

export function parseCatalogProduct(value: unknown): CatalogProduct {
  const record = requireRecord(value, 'CatalogProduct');
  const verifiedFacts = record.verified_facts;
  const sku = record.sku;
  const brand = record.brand;
  const mediaAssets = record.media_assets;

  if (!isRecord(verifiedFacts)) {
    throw new CommerceContractError('CatalogProduct', 'verified_facts');
  }

  if (sku !== undefined && sku !== null && typeof sku !== 'string') {
    throw new CommerceContractError('CatalogProduct', 'sku');
  }

  if (brand !== undefined && brand !== null && typeof brand !== 'string') {
    throw new CommerceContractError('CatalogProduct', 'brand');
  }

  if (
    mediaAssets !== undefined &&
    (!Array.isArray(mediaAssets) || !mediaAssets.every((asset) => isRecord(asset)))
  ) {
    throw new CommerceContractError('CatalogProduct', 'media_assets');
  }

  return {
    product_id: requireString(record, 'product_id', 'CatalogProduct'),
    ...(sku !== undefined ? { sku: sku as string | null } : {}),
    name: requireString(record, 'name', 'CatalogProduct'),
    ...(brand !== undefined ? { brand: brand as string | null } : {}),
    verified_facts: verifiedFacts,
    ...(mediaAssets !== undefined
      ? { media_assets: mediaAssets as readonly Readonly<Record<string, unknown>>[] }
      : {}),
  };
}

export function parseSellerOffer(value: unknown): SellerOffer {
  const record = requireRecord(value, 'SellerOffer');
  const status = requireString(record, 'status', 'SellerOffer');

  if (!['ACTIVE', 'INACTIVE', 'BLOCKED'].includes(status)) {
    throw new CommerceContractError('SellerOffer', 'status');
  }

  return {
    offer_id: requireString(record, 'offer_id', 'SellerOffer'),
    product_id: requireString(record, 'product_id', 'SellerOffer'),
    seller_id: requireString(record, 'seller_id', 'SellerOffer'),
    region: requireString(record, 'region', 'SellerOffer'),
    status,
  } as SellerOffer;
}

export function parseOfferSnapshot(value: unknown): OfferSnapshot {
  const record = requireRecord(value, 'OfferSnapshot');
  const price = record.price;
  const stock = record.stock;
  const ttlSeconds = record.ttl_seconds;

  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    throw new CommerceContractError('OfferSnapshot', 'price');
  }

  if (
    stock !== undefined &&
    stock !== null &&
    (typeof stock !== 'number' || !Number.isFinite(stock) || stock < 0)
  ) {
    throw new CommerceContractError('OfferSnapshot', 'stock');
  }

  if (
    ttlSeconds !== undefined &&
    (!Number.isSafeInteger(ttlSeconds) || Number(ttlSeconds) < 0)
  ) {
    throw new CommerceContractError('OfferSnapshot', 'ttl_seconds');
  }

  return {
    offer_id: requireString(record, 'offer_id', 'OfferSnapshot'),
    captured_at: requireDateTime(record, 'captured_at', 'OfferSnapshot'),
    currency: requireString(record, 'currency', 'OfferSnapshot'),
    price,
    ...(stock !== undefined ? { stock: stock as number | null } : {}),
    availability: requireString(record, 'availability', 'OfferSnapshot'),
    ...(ttlSeconds !== undefined ? { ttl_seconds: ttlSeconds as number } : {}),
  };
}

export function parseRightsProvenance(value: unknown): RightsProvenance {
  const record = requireRecord(value, 'RightsProvenance');
  const allowedChannels = record.allowed_channels;

  if (
    !Array.isArray(allowedChannels) ||
    !allowedChannels.every((channel) => typeof channel === 'string' && channel.length > 0)
  ) {
    throw new CommerceContractError('RightsProvenance', 'allowed_channels');
  }

  return {
    source: requireString(record, 'source', 'RightsProvenance'),
    verified_at: requireDateTime(record, 'verified_at', 'RightsProvenance'),
    allowed_channels: allowedChannels,
  };
}

export function parseClaimProvenance(value: unknown): ClaimProvenance {
  const record = requireRecord(value, 'ClaimProvenance');

  return {
    claim: requireString(record, 'claim', 'ClaimProvenance'),
    source: requireString(record, 'source', 'ClaimProvenance'),
    verified_at: requireDateTime(record, 'verified_at', 'ClaimProvenance'),
  };
}
