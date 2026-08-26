import {
  authorizeAndAudit,
  type AuthorizationAuditSink,
  type PolicyContractV2,
} from '@yastroyka/auth';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import {
  PUBLICATION_PLATFORMS,
  PUBLICATION_STATUSES,
  type PlatformPublicationRecord,
  type PlatformPublicationStatus,
  type PublicationPlatform,
} from './postgres-platform-workspace-store.ts';

export type PublishingQaOutcome = 'PASS' | 'FAIL';
export type PublishingApprovalDecision = 'APPROVED' | 'REJECTED';
export type PublishingMode = 'AUTO' | 'ASSISTED';
export type PublishingFreshnessStatus = 'FRESH' | 'REFRESH' | 'BLOCK';
export type PublishingFreshnessReason =
  | 'PRICE_STOCK_FRESH'
  | 'PRICE_STOCK_STALE'
  | 'PRICE_STOCK_EXPIRED'
  | 'FRESHNESS_UNVERIFIABLE'
  | 'SNAPSHOT_CAPTURED_IN_FUTURE';

type PublishingAuthorizationAction = 'decide_approval' | 'prepare' | 'record_result';

export interface PublishingFreshnessDecision {
  readonly status: PublishingFreshnessStatus;
  readonly reason: PublishingFreshnessReason;
  readonly ageSeconds: number | null;
}

export interface PublishingFreshnessPolicy {
  readonly refreshGraceSeconds: number;
}

export interface PostgresPublishingStoreOptions {
  readonly freshnessPolicy: PublishingFreshnessPolicy;
  readonly authorizationPolicy: PolicyContractV2;
  readonly authorizationAuditSink: AuthorizationAuditSink;
  readonly clock?: () => Date;
}

export interface PublishingAttribution {
  readonly productId: string;
  readonly offerId: string;
  readonly snapshotCapturedAt: string;
  readonly snapshotId: string;
}

export interface PublishingAssistedPacket {
  readonly publication_id: string;
  readonly master_content_id: string;
  readonly workspace_id: string;
  readonly platform: PublicationPlatform;
  readonly product_id: string;
  readonly offer_id: string;
  readonly snapshot_id: string;
  readonly snapshot_captured_at: string;
}

export interface RecordPublishingQaResultInput {
  readonly publicationId: string;
  readonly platform: PublicationPlatform;
  readonly outcome: PublishingQaOutcome;
  readonly evidenceId: string;
  readonly code: string;
}

export interface RequestPublishingApprovalInput {
  readonly publicationId: string;
  readonly platform: PublicationPlatform;
  readonly approvalId: string;
  readonly requestedBy: string;
}

export interface DecidePublishingApprovalInput {
  readonly publicationId: string;
  readonly platform: PublicationPlatform;
  readonly approvalId: string;
  readonly decision: PublishingApprovalDecision;
  readonly decidedBy: string;
  readonly reasonCode?: string;
}

export type PublishingPreparationKind = 'BLOCKED' | 'AUTO' | 'ASSISTED';

export interface ApplyPublishingPreparationInput {
  readonly publicationId: string;
  readonly platform: PublicationPlatform;
  readonly mode: PublishingMode;
  readonly snapshotId: string;
  readonly actorId: string;
}

export interface RecordAutoPublishingResultInput {
  readonly publicationId: string;
  readonly platform: PublicationPlatform;
  readonly actorId: string;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly code: string;
  readonly externalId?: string;
  readonly publishedAt?: string;
}

interface PublicationRow {
  readonly id: string;
  readonly master_content_id: string;
  readonly workspace_id: string;
  readonly platform: string;
  readonly status: string;
  readonly payload: unknown;
  readonly created_at: Date | string;
  readonly published_at: Date | string | null;
}

interface ApprovalRow {
  readonly id: string;
  readonly requested_by: string;
  readonly status: string;
}

interface CanonicalOfferSnapshotRow {
  readonly id: string;
  readonly product_id: string;
  readonly offer_id: string;
  readonly captured_at: Date | string;
  readonly payload: unknown;
}

interface CanonicalOfferSnapshot {
  readonly snapshotId: string;
  readonly productId: string;
  readonly offerId: string;
  readonly capturedAt: string;
  readonly ttlSeconds: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const SAFE_ACTOR_PATTERN = /^[A-Za-z0-9@._:+-]{1,128}$/u;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/u;
const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|api[_-]?key)/iu;

export class PublishingStateConflictError extends Error {
  constructor() {
    super('Publishing state transition conflict.');
    this.name = 'PublishingStateConflictError';
  }
}

export class PublishingAuthorizationDeniedError extends Error {
  constructor() {
    super('Publishing authorization denied.');
    this.name = 'PublishingAuthorizationDeniedError';
  }
}

function requireUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a UUID.`);
  }
}

function requirePlatform(value: string): asserts value is PublicationPlatform {
  if (!(PUBLICATION_PLATFORMS as readonly string[]).includes(value)) {
    throw new Error('Unsupported publication platform.');
  }
}

function requireStatus(value: string): asserts value is PlatformPublicationStatus {
  if (!(PUBLICATION_STATUSES as readonly string[]).includes(value)) {
    throw new Error('Unsupported publication status.');
  }
}

function requireMode(value: string): asserts value is PublishingMode {
  if (value !== 'AUTO' && value !== 'ASSISTED') {
    throw new Error('Unsupported publishing mode.');
  }
}

function requireSafeIdentifier(value: string, field: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe identifier no longer than 256 characters.`);
  }
}

function requireActor(value: string, field: string): void {
  if (!SAFE_ACTOR_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe actor identifier no longer than 128 characters.`);
  }
}

function requireCode(value: string, field: string): void {
  if (!SAFE_CODE_PATTERN.test(value)) {
    throw new Error(`${field} must be a safe uppercase code.`);
  }
}

function requireExactIsoTimestamp(value: string, field: string): void {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${field} must be an exact ISO-8601 UTC timestamp.`);
  }
}

function requireFreshnessPolicy(policy: PublishingFreshnessPolicy): PublishingFreshnessPolicy {
  if (
    !Number.isSafeInteger(policy.refreshGraceSeconds) ||
    policy.refreshGraceSeconds < 0 ||
    policy.refreshGraceSeconds > 86_400
  ) {
    throw new Error('freshnessPolicy.refreshGraceSeconds must be an integer between 0 and 86400.');
  }
  return { refreshGraceSeconds: policy.refreshGraceSeconds };
}

function normalizeDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Publication row contains an invalid date.');
  }
  return date.toISOString();
}

function assertJsonSafe(value: unknown, path = 'payload'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${path} contains an unsupported value.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON-compatible objects only.`);
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error('Publishing state must not contain credentials or secret material.');
    }
    assertJsonSafe(nested, `${path}.${key}`);
  }
}

function requireJsonObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${field} must be a JSON object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field} must be a plain JSON object.`);
  }
  assertJsonSafe(value, field);
  return value as Record<string, unknown>;
}

function normalizeRow(row: PublicationRow): PlatformPublicationRecord {
  requireUuid(row.id, 'publicationId');
  requireUuid(row.master_content_id, 'masterContentId');
  requireSafeIdentifier(row.workspace_id, 'workspaceId');
  requirePlatform(row.platform);
  requireStatus(row.status);
  const payload = requireJsonObject(row.payload, 'payload');

  return {
    publicationId: row.id,
    masterContentId: row.master_content_id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    status: row.status,
    payload,
    createdAt: normalizeDate(row.created_at),
    publishedAt: row.published_at === null ? null : normalizeDate(row.published_at),
  };
}

function withPublishingMetadata(
  payloadValue: unknown,
  patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const payload = requireJsonObject(payloadValue, 'payload');
  const existingPublishing = payload.publishing;
  const publishing =
    existingPublishing === undefined
      ? {}
      : requireJsonObject(existingPublishing, 'payload.publishing');
  const nextPayload = {
    ...payload,
    publishing: {
      ...publishing,
      ...patch,
    },
  };
  assertJsonSafe(nextPayload);
  return nextPayload;
}

function parseCanonicalOfferSnapshot(
  row: CanonicalOfferSnapshotRow,
): CanonicalOfferSnapshot | null {
  try {
    requireUuid(row.id, 'snapshotId');
    requireSafeIdentifier(row.product_id, 'snapshot.productId');
    requireSafeIdentifier(row.offer_id, 'snapshot.offerId');

    const capturedAt = normalizeDate(row.captured_at);
    const payload = requireJsonObject(row.payload, 'snapshot.payload');
    const payloadOfferId = payload.offer_id;
    const payloadCapturedAt = payload.captured_at;
    const currency = payload.currency;
    const price = payload.price;
    const stock = payload.stock;
    const availability = payload.availability;
    const ttlSeconds = payload.ttl_seconds;

    if (
      typeof payloadOfferId !== 'string' ||
      payloadOfferId !== row.offer_id ||
      typeof payloadCapturedAt !== 'string' ||
      typeof currency !== 'string' ||
      currency.length === 0 ||
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price < 0 ||
      typeof availability !== 'string' ||
      availability.length === 0 ||
      !Number.isSafeInteger(ttlSeconds) ||
      Number(ttlSeconds) < 0
    ) {
      return null;
    }

    if (
      stock !== undefined &&
      stock !== null &&
      (typeof stock !== 'number' || !Number.isFinite(stock) || stock < 0)
    ) {
      return null;
    }

    requireExactIsoTimestamp(payloadCapturedAt, 'snapshot.payload.captured_at');
    if (payloadCapturedAt !== capturedAt) {
      return null;
    }

    return {
      snapshotId: row.id,
      productId: row.product_id,
      offerId: row.offer_id,
      capturedAt,
      ttlSeconds: Number(ttlSeconds),
    };
  } catch {
    return null;
  }
}

function evaluateCanonicalSnapshotFreshness(
  snapshot: CanonicalOfferSnapshot | null,
  policy: PublishingFreshnessPolicy,
  now: Date,
): PublishingFreshnessDecision {
  if (snapshot === null || Number.isNaN(now.getTime())) {
    return {
      status: 'BLOCK',
      reason: 'FRESHNESS_UNVERIFIABLE',
      ageSeconds: null,
    };
  }

  const capturedAtMilliseconds = Date.parse(snapshot.capturedAt);
  const nowMilliseconds = now.getTime();
  const ttlMilliseconds = snapshot.ttlSeconds * 1_000;
  const refreshGraceMilliseconds = policy.refreshGraceSeconds * 1_000;

  if (
    !Number.isSafeInteger(ttlMilliseconds) ||
    !Number.isSafeInteger(refreshGraceMilliseconds) ||
    !Number.isSafeInteger(ttlMilliseconds + refreshGraceMilliseconds)
  ) {
    return {
      status: 'BLOCK',
      reason: 'FRESHNESS_UNVERIFIABLE',
      ageSeconds: null,
    };
  }

  const ageMilliseconds = nowMilliseconds - capturedAtMilliseconds;
  const ageSeconds = ageMilliseconds / 1_000;

  if (ageMilliseconds < 0) {
    return {
      status: 'BLOCK',
      reason: 'SNAPSHOT_CAPTURED_IN_FUTURE',
      ageSeconds: null,
    };
  }

  if (ageMilliseconds < ttlMilliseconds) {
    return {
      status: 'FRESH',
      reason: 'PRICE_STOCK_FRESH',
      ageSeconds,
    };
  }

  if (ageMilliseconds < ttlMilliseconds + refreshGraceMilliseconds) {
    return {
      status: 'REFRESH',
      reason: 'PRICE_STOCK_STALE',
      ageSeconds,
    };
  }

  return {
    status: 'BLOCK',
    reason: 'PRICE_STOCK_EXPIRED',
    ageSeconds,
  };
}

async function selectPublicationForUpdate(
  database: Sequelize,
  transaction: Transaction,
  publicationId: string,
  platform: PublicationPlatform,
  expectedStatus: PlatformPublicationStatus,
): Promise<PublicationRow> {
  const rows = await database.query<PublicationRow>(
    `
      SELECT
        id,
        master_content_id,
        workspace_id,
        platform,
        status,
        payload,
        created_at,
        published_at
      FROM publications
      WHERE id = :publicationId
        AND platform = :platform
        AND status = :expectedStatus
      FOR UPDATE;
    `,
    {
      replacements: { publicationId, platform, expectedStatus },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  const row = rows[0];
  if (row === undefined) {
    throw new PublishingStateConflictError();
  }
  return row;
}

async function selectCanonicalSnapshot(
  database: Sequelize,
  transaction: Transaction,
  snapshotId: string,
): Promise<CanonicalOfferSnapshotRow | null> {
  const rows = await database.query<CanonicalOfferSnapshotRow>(
    `
      SELECT
        id,
        product_id,
        offer_id,
        captured_at,
        payload
      FROM commerce_offer_snapshots
      WHERE id = :snapshotId
      FOR SHARE;
    `,
    {
      replacements: { snapshotId },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  return rows[0] ?? null;
}

async function persistPublication(
  database: Sequelize,
  transaction: Transaction,
  row: PublicationRow,
  expectedStatus: PlatformPublicationStatus,
  nextStatus: PlatformPublicationStatus,
  payload: Readonly<Record<string, unknown>>,
  publishedAt: string | null = row.published_at === null ? null : normalizeDate(row.published_at),
): Promise<PlatformPublicationRecord> {
  const rows = await database.query<PublicationRow>(
    `
      UPDATE publications
      SET
        status = :nextStatus,
        payload = CAST(:payload AS jsonb),
        published_at = :publishedAt
      WHERE id = :publicationId
        AND platform = :platform
        AND status = :expectedStatus
      RETURNING
        id,
        master_content_id,
        workspace_id,
        platform,
        status,
        payload,
        created_at,
        published_at;
    `,
    {
      replacements: {
        nextStatus,
        payload: JSON.stringify(payload),
        publishedAt,
        publicationId: row.id,
        platform: row.platform,
        expectedStatus,
      },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  const updated = rows[0];
  if (updated === undefined) {
    throw new PublishingStateConflictError();
  }
  return normalizeRow(updated);
}

export class PostgresPublishingStore {
  readonly #database: Sequelize;
  readonly #freshnessPolicy: PublishingFreshnessPolicy;
  readonly #authorizationPolicy: PolicyContractV2;
  readonly #authorizationAuditSink: AuthorizationAuditSink;
  readonly #clock: () => Date;

  constructor(database: Sequelize, options: PostgresPublishingStoreOptions) {
    this.#database = database;
    this.#freshnessPolicy = requireFreshnessPolicy(options.freshnessPolicy);
    this.#authorizationPolicy = options.authorizationPolicy;
    this.#authorizationAuditSink = options.authorizationAuditSink;
    this.#clock = options.clock ?? (() => new Date());
  }

  async #requireAuthorization(
    actorId: string,
    action: PublishingAuthorizationAction,
  ): Promise<void> {
    const decision = await authorizeAndAudit(
      this.#authorizationPolicy,
      {
        actor_id: actorId,
        resource: 'publication',
        action,
      },
      this.#authorizationAuditSink,
    );

    if (!decision.allowed) {
      throw new PublishingAuthorizationDeniedError();
    }
  }

  async recordQaResult(input: RecordPublishingQaResultInput): Promise<PlatformPublicationRecord> {
    requireUuid(input.publicationId, 'publicationId');
    requirePlatform(input.platform);
    requireSafeIdentifier(input.evidenceId, 'evidenceId');
    requireCode(input.code, 'code');

    return this.#database.transaction(async (transaction) => {
      const row = await selectPublicationForUpdate(
        this.#database,
        transaction,
        input.publicationId,
        input.platform,
        'DRAFT',
      );
      const nextStatus: PlatformPublicationStatus =
        input.outcome === 'PASS' ? 'QA_PASSED' : 'BLOCKED';
      if (input.outcome !== 'PASS' && input.outcome !== 'FAIL') {
        throw new Error('Unsupported QA outcome.');
      }
      const payload = withPublishingMetadata(row.payload, {
        qa: {
          outcome: input.outcome,
          evidence_id: input.evidenceId,
          code: input.code,
        },
      });
      return persistPublication(this.#database, transaction, row, 'DRAFT', nextStatus, payload);
    });
  }

  async requestApproval(input: RequestPublishingApprovalInput): Promise<PlatformPublicationRecord> {
    requireUuid(input.publicationId, 'publicationId');
    requirePlatform(input.platform);
    requireUuid(input.approvalId, 'approvalId');
    requireActor(input.requestedBy, 'requestedBy');

    return this.#database.transaction(async (transaction) => {
      const row = await selectPublicationForUpdate(
        this.#database,
        transaction,
        input.publicationId,
        input.platform,
        'QA_PASSED',
      );

      await this.#database.query(
        `
          INSERT INTO approvals (
            id,
            aggregate_type,
            aggregate_id,
            status,
            requested_by
          )
          VALUES (
            :approvalId,
            'publication',
            :publicationId,
            'PENDING',
            :requestedBy
          );
        `,
        {
          replacements: {
            approvalId: input.approvalId,
            publicationId: input.publicationId,
            requestedBy: input.requestedBy,
          },
          transaction,
        },
      );

      const payload = withPublishingMetadata(row.payload, {
        approval: {
          approval_id: input.approvalId,
          status: 'PENDING',
          requested_by: input.requestedBy,
        },
      });
      return persistPublication(
        this.#database,
        transaction,
        row,
        'QA_PASSED',
        'AWAITING_APPROVAL',
        payload,
      );
    });
  }

  async decideApproval(input: DecidePublishingApprovalInput): Promise<PlatformPublicationRecord> {
    requireUuid(input.publicationId, 'publicationId');
    requirePlatform(input.platform);
    requireUuid(input.approvalId, 'approvalId');
    requireActor(input.decidedBy, 'decidedBy');
    if (input.reasonCode !== undefined) {
      requireCode(input.reasonCode, 'reasonCode');
    }
    if (input.decision === 'REJECTED' && input.reasonCode === undefined) {
      throw new Error('Rejected publication approval requires reasonCode.');
    }
    if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
      throw new Error('Unsupported approval decision.');
    }

    await this.#requireAuthorization(input.decidedBy, 'decide_approval');

    return this.#database.transaction(async (transaction) => {
      const publication = await selectPublicationForUpdate(
        this.#database,
        transaction,
        input.publicationId,
        input.platform,
        'AWAITING_APPROVAL',
      );

      const approvals = await this.#database.query<ApprovalRow>(
        `
          UPDATE approvals
          SET
            status = :decision,
            decided_by = :decidedBy,
            reason = :reasonCode,
            decided_at = now()
          WHERE id = :approvalId
            AND aggregate_type = 'publication'
            AND aggregate_id = :publicationId
            AND status = 'PENDING'
          RETURNING
            id,
            requested_by,
            status;
        `,
        {
          replacements: {
            decision: input.decision,
            decidedBy: input.decidedBy,
            reasonCode: input.reasonCode ?? null,
            approvalId: input.approvalId,
            publicationId: input.publicationId,
          },
          type: QueryTypes.SELECT,
          transaction,
        },
      );

      const approval = approvals[0];
      if (approval === undefined) {
        throw new PublishingStateConflictError();
      }

      const nextStatus: PlatformPublicationStatus =
        input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
      const payload = withPublishingMetadata(publication.payload, {
        approval: {
          approval_id: approval.id,
          status: approval.status,
          requested_by: approval.requested_by,
          decided_by: input.decidedBy,
          reason_code: input.reasonCode ?? null,
        },
      });
      return persistPublication(
        this.#database,
        transaction,
        publication,
        'AWAITING_APPROVAL',
        nextStatus,
        payload,
      );
    });
  }

  async applyPreparation(
    input: ApplyPublishingPreparationInput,
  ): Promise<PlatformPublicationRecord> {
    requireUuid(input.publicationId, 'publicationId');
    requirePlatform(input.platform);
    requireMode(input.mode);
    requireUuid(input.snapshotId, 'snapshotId');
    requireActor(input.actorId, 'actorId');

    await this.#requireAuthorization(input.actorId, 'prepare');

    return this.#database.transaction(async (transaction) => {
      const row = await selectPublicationForUpdate(
        this.#database,
        transaction,
        input.publicationId,
        input.platform,
        'APPROVED',
      );
      const snapshotRow = await selectCanonicalSnapshot(
        this.#database,
        transaction,
        input.snapshotId,
      );
      const snapshot = snapshotRow === null ? null : parseCanonicalOfferSnapshot(snapshotRow);
      const freshness = evaluateCanonicalSnapshotFreshness(
        snapshot,
        this.#freshnessPolicy,
        this.#clock(),
      );

      if (snapshotRow === null) {
        throw new Error('Canonical commerce offer snapshot was not found.');
      }

      const canonicalSnapshot = snapshot ?? {
        snapshotId: snapshotRow.id,
        productId: snapshotRow.product_id,
        offerId: snapshotRow.offer_id,
        capturedAt: normalizeDate(snapshotRow.captured_at),
        ttlSeconds: 0,
      };
      requireUuid(canonicalSnapshot.snapshotId, 'snapshotId');
      requireSafeIdentifier(canonicalSnapshot.productId, 'snapshot.productId');
      requireSafeIdentifier(canonicalSnapshot.offerId, 'snapshot.offerId');

      const canonical = normalizeRow(row);
      const nextStatus: PublishingPreparationKind =
        freshness.status === 'FRESH' ? input.mode : 'BLOCKED';
      const attribution: PublishingAttribution = {
        productId: canonicalSnapshot.productId,
        offerId: canonicalSnapshot.offerId,
        snapshotCapturedAt: canonicalSnapshot.capturedAt,
        snapshotId: canonicalSnapshot.snapshotId,
      };
      const assistedPacket: PublishingAssistedPacket | null =
        nextStatus === 'ASSISTED'
          ? {
              publication_id: canonical.publicationId,
              master_content_id: canonical.masterContentId,
              workspace_id: canonical.workspaceId,
              platform: canonical.platform,
              product_id: attribution.productId,
              offer_id: attribution.offerId,
              snapshot_id: attribution.snapshotId,
              snapshot_captured_at: attribution.snapshotCapturedAt,
            }
          : null;

      const patch: Record<string, unknown> = {
        requested_mode: input.mode,
        freshness: {
          status: freshness.status,
          reason: freshness.reason,
          age_seconds: freshness.ageSeconds,
        },
        attribution: {
          product_id: attribution.productId,
          offer_id: attribution.offerId,
          snapshot_id: attribution.snapshotId,
          snapshot_captured_at: attribution.snapshotCapturedAt,
        },
      };
      if (nextStatus !== 'BLOCKED') {
        patch.mode = nextStatus;
      }
      if (assistedPacket !== null) {
        patch.assisted_packet = assistedPacket;
      }

      const payload = withPublishingMetadata(row.payload, patch);
      return persistPublication(this.#database, transaction, row, 'APPROVED', nextStatus, payload);
    });
  }

  async recordAutoResult(
    input: RecordAutoPublishingResultInput,
  ): Promise<PlatformPublicationRecord> {
    requireUuid(input.publicationId, 'publicationId');
    requirePlatform(input.platform);
    requireActor(input.actorId, 'actorId');
    requireCode(input.code, 'code');

    await this.#requireAuthorization(input.actorId, 'record_result');

    let nextStatus: PlatformPublicationStatus;
    let publishedAt: string | null;
    let result: Record<string, unknown>;

    if (input.outcome === 'SUCCESS') {
      if (input.externalId === undefined || input.publishedAt === undefined) {
        throw new Error('Successful AUTO result requires externalId and publishedAt.');
      }
      requireSafeIdentifier(input.externalId, 'externalId');
      requireExactIsoTimestamp(input.publishedAt, 'publishedAt');
      nextStatus = 'PUBLISHED';
      publishedAt = input.publishedAt;
      result = {
        outcome: input.outcome,
        code: input.code,
        external_id: input.externalId,
      };
    } else if (input.outcome === 'FAILURE') {
      if (input.externalId !== undefined || input.publishedAt !== undefined) {
        throw new Error('Failed AUTO result must not claim publication evidence.');
      }
      nextStatus = 'FAILED';
      publishedAt = null;
      result = {
        outcome: input.outcome,
        code: input.code,
      };
    } else {
      throw new Error('Unsupported AUTO publishing result.');
    }

    return this.#database.transaction(async (transaction) => {
      const row = await selectPublicationForUpdate(
        this.#database,
        transaction,
        input.publicationId,
        input.platform,
        'AUTO',
      );
      const payload = withPublishingMetadata(row.payload, { result });
      return persistPublication(
        this.#database,
        transaction,
        row,
        'AUTO',
        nextStatus,
        payload,
        publishedAt,
      );
    });
  }
}

export function createPostgresPublishingStore(
  database: Sequelize,
  options: PostgresPublishingStoreOptions,
): PostgresPublishingStore {
  return new PostgresPublishingStore(database, options);
}
